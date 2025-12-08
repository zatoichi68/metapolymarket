import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Plugin pour gérer /api/analyze en développement
function apiPlugin(): Plugin {
  let geminiApiKey: string;
  let envRef: Record<string, string>;
  const ANALYSIS_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
  const analysisCache = new Map<string, { data: any; expiresAt: number }>();
  const makeCacheKey = ({ title, outcomes, marketProb, volume }: { title: string; outcomes: string[]; marketProb: number; volume?: number }) =>
    `${title}__${(outcomes || []).join('|')}__${Number(marketProb).toFixed(4)}__${Number(volume || 0).toFixed(2)}`;

    return {
    name: 'api-plugin',
    configResolved(config) {
      // Charger la clé depuis .env (OPENROUTER_API_KEY) - jamais hardcodée !
      envRef = loadEnv(config.mode, process.cwd(), '');
      geminiApiKey = envRef.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
      if (!geminiApiKey) {
        console.warn('⚠️  OPENROUTER_API_KEY not found in .env - AI analysis will fail');
      }
    },
    configureServer(server) {
      // Dev handler for /api/polymarket/events -> hits production backend with API key
      server.middlewares.use('/api/polymarket/events', async (req, res) => {
        try {
          const apiKey = envRef?.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
          const token = envRef?.VITE_API_AUTH_TOKEN || process.env.VITE_API_AUTH_TOKEN || '';
          if (!token) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'API auth token not configured' }));
            return;
          }
          // Forward to the deployed backend to simplify local dev
          const base = envRef?.VITE_BACKEND_URL || process.env.VITE_BACKEND_URL || 'https://metapolymarket-140799832958.us-east5.run.app';
          const targetUrl = `${base}${req.originalUrl || req.url}`;
          const upstream = await fetch(targetUrl, {
            headers: {
              'x-api-key': token
            }
          });
          res.statusCode = upstream.status;
          for (const [k, v] of upstream.headers) {
            res.setHeader(k, v);
          }
          const body = await upstream.text();
          res.end(body);
        } catch (error) {
          console.error('Dev proxy /api/polymarket/events failed:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Dev proxy failed' }));
        }
      });

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
          const cacheKey = makeCacheKey({ title, outcomes, marketProb, volume });
          const cached = analysisCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(cached.data));
            return;
          }

          const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          
          const prompt = `Model: google/gemma-3-27b-it:free. Role: "Meta-Oracle" superforecaster (Tetlock/Nate Silver style). Goal: beat market odds with concise, disciplined JSON.

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

          const response = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              headers: { 
                'Authorization': `Bearer ${geminiApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: 'google/gemma-3-27b-it:free',
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

          const payload = {
            aiProbability: parsed.aiProbability ?? marketProb,
            prediction: parsed.prediction ?? outcomeA,
            reasoning: parsed.reasoning ?? "Analysis based on market trends.",
            category: parsed.category ?? "Other",
            kellyPercentage: parsed.kellyPercentage ?? 0,
            confidence: parsed.confidence ?? 5,
            riskFactor: parsed.riskFactor ?? "Market volatility"
          };

          analysisCache.set(cacheKey, { data: payload, expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS });

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));

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
