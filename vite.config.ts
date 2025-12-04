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
          
          const prompt = `You are a Superforecaster AI analyzing a prediction market.

TODAY'S DATE: ${today}
(Use this date to assess time-sensitive events, deadlines, and recent developments)

Market: "${title}"
Outcomes: ${outcomes.join(" vs ")}
Current Crowd Odds: ${currentOdds}
Volume: $${(volume || 0).toLocaleString()}

Task:
1. Analyze the real-world probability of "${outcomeA}" occurring based on current news, sentiment, and facts AS OF TODAY.
2. Compare your calculated probability with the Crowd Odds.
3. If you disagree significantly, explain why (finding the edge).
4. Determine the category (Politics, Crypto, Sports, Business, Other).
5. Calculate the Kelly Criterion bet size: Kelly% = (b*p - q) / b, where b = decimal odds - 1, p = your probability, q = 1-p.
   If edge is negative, Kelly% should be 0.

Return a JSON object with these exact fields:
- aiProbability: number between 0.0 and 1.0
- prediction: string (one of the provided outcomes)
- reasoning: string (max 2 sentences, focus on why the crowd might be wrong)
- category: string (one of: Politics, Crypto, Sports, Business, Other)
- kellyPercentage: number between 0 and 100 (optimal % of bankroll to bet, 0 if no edge)`;

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
            kellyPercentage: parsed.kellyPercentage ?? 0
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
