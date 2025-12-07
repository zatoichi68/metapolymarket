import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware pour parser le JSON
app.use(express.json());

// Clé API OpenRouter sécurisée côté serveur uniquement
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '';

// Route API pour l'analyse AI (protège la clé OpenRouter)
app.post('/api/analyze', async (req, res) => {
  if (!OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'AI service unavailable - OPENROUTER_API_KEY not configured' });
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
    
    const prompt = `Model: x-ai/grok-4.1-fast. Role: "Meta-Oracle" superforecaster (Tetlock/Nate Silver style). Goal: beat market odds with concise, disciplined JSON.

Context
- Date: ${today}
- Market: "${title}"
- Outcomes: ${outcomes.join(" vs ")}
- Market odds: ${currentOdds}
- Volume: $${(volume || 0).toLocaleString()}

Protocol (keep it lean)
1) Rules check: flag traps/ambiguities.
2) Signals (one short line each):
   - Data: base rates/stats/polls.
   - Sentiment: crowd/media momentum.
   - Contrarian: hidden risks/why consensus fails.
3) Synthesis: true probability for "${outcomeA}" (0-1). Mention probability of the outcome you actually recommend.
4) Bet: compare to market; Kelly% = (b*p - q)/b with b = decimal odds - 1, p = prob of recommended outcome, q = 1-p. If edge < 1% or confidence < 3, set Kelly% = 0.

If data is missing, state a brief assumption instead of guessing.

Return ONLY raw JSON (no markdown, no code fences):
- aiProbability: number 0-1 for "${outcomeA}" ONLY
- prediction: "${outcomeA}" or "${outcomeB}" (your bet)
- reasoning: 2-3 sentences, <= 420 chars, summary of signals + edge
- category: Politics | Crypto | Sports | Business | Other
- kellyPercentage: number 0-100
- confidence: number 1-10
- riskFactor: main risk to the forecast

Critical rules for aiProbability:
- Always for "${outcomeA}" (first outcome), not necessarily the predicted one.
- If you predict "${outcomeB}" with 80% confidence -> aiProbability = 0.20.
- If you predict "${outcomeA}" with 70% confidence -> aiProbability = 0.70.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'x-ai/grok-4.1-fast',
        messages: [
          { role: 'user', content: prompt }
        ],
        reasoning: { enabled: true }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', errorText);
      return res.status(503).json({ error: 'OpenRouter API error' });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    
    if (!text) {
      throw new Error('No response from OpenRouter');
    }

    // Clean potential markdown code blocks
    const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanText);
    
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
