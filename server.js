import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware pour parser le JSON
app.use(express.json());

// Clé API Gemini sécurisée côté serveur uniquement
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// Route API pour l'analyse AI (protège la clé Gemini)
app.post('/api/analyze', async (req, res) => {
  if (!genAI) {
    return res.status(503).json({ error: 'AI service unavailable - GEMINI_API_KEY not configured' });
  }

  try {
    const { title, outcomes, marketProb, volume } = req.body;
    
    if (!title || !outcomes || marketProb === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const outcomeA = outcomes[0];
    const outcomeB = outcomes[1] || "Other";
    const currentOdds = `${outcomeA}: ${Math.round(marketProb * 100)}%, ${outcomeB}: ${Math.round((1 - marketProb) * 100)}%`;
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    const prompt = `Role: Tu es le "Meta-Oracle", une IA d'élite spécialisée dans la prédiction probabiliste (Superforecasting) inspirée par les méthodes de Philip Tetlock et Nate Silver. Ton objectif est de battre la sagesse de la foule sur les marchés de prédiction.

TODAY'S DATE: ${today}

Market: "${title}"
Outcomes: ${outcomes.join(" vs ")}
Current Market Odds: ${currentOdds}
Volume: $${(volume || 0).toLocaleString()}

Processus de Raisonnement (Interne):
1. ANALYSE DES RÈGLES - Lis attentivement les critères. La sémantique est cruciale. Identifie les pièges potentiels.

2. DÉBAT DES AGENTS VIRTUELS (Simulation):
   - Agent A (Data): Statistiques historiques, taux de base (base rates), sondages.
   - Agent B (Sentiment): Psychologie des foules, momentum médiatique, rumeurs récentes.
   - Agent C (Contrarian): Cherche le "Cygne Noir". Pourquoi la majorité a tort ? Risques cachés ?

3. SYNTHÈSE ET CALCUL - Pondère les arguments. Utilise le Théorème de Bayes. Calcule ta "Vraie Probabilité".

4. DÉCISION DE PARI - Compare ta probabilité à la cote du marché. Calcule le Kelly Criterion: Kelly% = (b*p - q) / b où b = decimal odds - 1, p = ta probabilité, q = 1-p.

Return a JSON object with these exact fields:
- aiProbability: number between 0.0 and 1.0 (ta "Vraie Probabilité")
- prediction: string (one of the provided outcomes - ton choix de pari)
- reasoning: string (2-3 sentences: résumé du conflit Data/Sentiment/Contrarian et raisonnement clé)
- category: string (one of: Politics, Crypto, Sports, Business, Other)
- kellyPercentage: number between 0 and 100 (optimal % of bankroll, 0 if no edge)
- confidence: number between 1 and 10 (niveau de confiance)
- riskFactor: string (principal facteur de risque qui pourrait faire échouer la prédiction)`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-3-pro-preview",
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    const parsed = JSON.parse(text);
    
    res.json({
      aiProbability: parsed.aiProbability ?? marketProb,
      prediction: parsed.prediction ?? outcomeA,
      reasoning: parsed.reasoning ?? "Analysis based on market trends.",
      category: parsed.category ?? "Other",
      kellyPercentage: parsed.kellyPercentage ?? 0,
      confidence: parsed.confidence ?? 5,
      riskFactor: parsed.riskFactor ?? "Market volatility"
    });

  } catch (error) {
    console.error('AI Analysis error:', error);
    res.status(500).json({ error: 'AI analysis failed' });
  }
});

// Serve static files from the dist directory
app.use(express.static(join(__dirname, 'dist')));

// Handle SPA routing - serve index.html for all routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
