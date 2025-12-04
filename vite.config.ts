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
      // Clé API OpenRouter pour dev local - en prod, utilise le secret Firebase
      geminiApiKey = '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';
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
            res.end(JSON.stringify({ error: 'AI service unavailable - OPENROUTER_API_KEY not configured' }));
            return;
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

          const response = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              headers: { 
                'Authorization': `Bearer ${geminiApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: 'x-ai/grok-4.1-fast',
                messages: [
                  { role: 'user', content: prompt + '\n\nRespond ONLY with valid JSON, no markdown.' }
                ],
                reasoning: { enabled: true }
              })
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenRouter API error:', errorText);
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'OpenRouter API error' }));
            return;
          }

          const data = await response.json();
          const text = data.choices?.[0]?.message?.content;
          
          if (!text) {
            throw new Error('No response from OpenRouter');
          }

          // Clean potential markdown code blocks
          const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const parsed = JSON.parse(cleanText);

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
