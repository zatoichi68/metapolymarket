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
    
    const prompt = `Role: You are the "Meta-Oracle", an elite AI specialized in probabilistic prediction (Superforecasting) inspired by Philip Tetlock and Nate Silver's methods. Your goal is to beat the wisdom of the crowd on prediction markets.

TODAY'S DATE: ${today}

Market: "${title}"
Outcomes: ${outcomes.join(" vs ")}
Current Market Odds: ${currentOdds}
Volume: $${(volume || 0).toLocaleString()}

Internal Reasoning Process:
1. RULES ANALYSIS - Read the criteria carefully. Semantics are crucial. Identify potential traps.

2. VIRTUAL AGENTS DEBATE (Simulation):
   - Agent A (Data): Historical statistics, base rates, polls.
   - Agent B (Sentiment): Crowd psychology, media momentum, recent rumors.
   - Agent C (Contrarian): Look for the "Black Swan". Why is the majority wrong? Hidden risks?

3. SYNTHESIS & CALCULATION - Weigh the arguments. Use Bayes' Theorem. Calculate your "True Probability".

4. BET DECISION - Compare your probability to market odds. Calculate Kelly Criterion: Kelly% = (b*p - q) / b where b = decimal odds - 1, p = your probability, q = 1-p.

Return a JSON object with these exact fields:
- aiProbability: number between 0.0 and 1.0 (your "True Probability")
- prediction: string (one of the provided outcomes - your bet choice)
- reasoning: string (2-3 sentences: summary of Data/Sentiment/Contrarian conflict and key reasoning)
- category: string (one of: Politics, Crypto, Sports, Business, Other)
- kellyPercentage: number between 0 and 100 (optimal % of bankroll, 0 if no edge)
- confidence: number between 1 and 10 (confidence level)
- riskFactor: string (main risk factor that could invalidate the prediction)`;

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
