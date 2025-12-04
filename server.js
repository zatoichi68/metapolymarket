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

    const prompt = `
      You are a Superforecaster AI analyzing a prediction market.
      
      Market: "${title}"
      Outcomes: ${outcomes.join(" vs ")}
      Current Crowd Odds: ${currentOdds}
      Volume: $${(volume || 0).toLocaleString()}
      Date: ${new Date().toISOString()}

      Task:
      1. Analyze the real-world probability of "${outcomeA}" occurring based on current news, sentiment, and facts.
      2. Compare your calculated probability with the Crowd Odds.
      3. If you disagree significantly, explain why (finding the edge).
      4. Determine the category (Politics, Crypto, Sports, Business, Other).

      Return a JSON object with these exact fields:
      - aiProbability: number between 0.0 and 1.0
      - prediction: string (one of the provided outcomes)
      - reasoning: string (max 2 sentences, focus on why the crowd might be wrong)
      - category: string (one of: Politics, Crypto, Sports, Business, Other)
    `;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-pro",
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
      category: parsed.category ?? "Other"
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
