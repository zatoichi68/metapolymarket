import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Plugin pour gérer /api/analyze en développement
function apiPlugin(): Plugin {
  let geminiApiKey: string;
  
  return {
    name: 'api-plugin',
    configResolved() {
      // Clé API pour dev local - en prod, utilise le secret Firebase
      geminiApiKey = 'AIzaSyAE-sKwHqDLPuUmjmN2qnDObJz4-kHSgyE';
    },
    configureServer(server) {
      server.middlewares.use('/api/analyze', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        // Lire le body
        let body = '';
        for await (const chunk of req) {
          body += chunk;
        }

        try {
          const { title, outcomes, marketProb, volume } = JSON.parse(body);

          if (!geminiApiKey) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'AI service unavailable - GEMINI_API_KEY not configured in .env' }));
            return;
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

          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
              })
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API error:', errorText);
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Gemini API error' }));
            return;
          }

          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          
          if (!text) {
            throw new Error('No response from Gemini');
          }

          const parsed = JSON.parse(text);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            aiProbability: parsed.aiProbability ?? marketProb,
            prediction: parsed.prediction ?? outcomeA,
            reasoning: parsed.reasoning ?? "Analysis based on market trends.",
            category: parsed.category ?? "Other",
            kellyPercentage: parsed.kellyPercentage ?? 0,
            confidence: parsed.confidence ?? 5,
            riskFactor: parsed.riskFactor ?? "Market volatility"
          }));

        } catch (error) {
          console.error('API error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'AI analysis failed' }));
        }
      });
    }
  };
}

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react(), apiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
