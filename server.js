import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware pour parser le JSON (limite la taille pour éviter les abus)
app.use(express.json({ limit: '50kb' }));

// Sécurité basique : headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// Clé API OpenRouter sécurisée côté serveur uniquement
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '';
// Token simple pour protéger /api/analyze (à définir dans l'env : API_AUTH_TOKEN)
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || '';

// Rate-limit minimaliste en mémoire pour /api/analyze
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30; // requêtes par minute par IP
const rateBuckets = new Map();

const hitRateLimit = (ip) => {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const recent = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateBuckets.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
};

// Cache Polymarket côté serveur
const POLY_CACHE_TTL_MS = 30 * 1000;
let polyCache = { data: null, expiresAt: 0 };

// Cache en mémoire pour limiter les appels OpenRouter sur des marchés inchangés
const ANALYSIS_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const analysisCache = new Map();

const makeCacheKey = ({ title, outcomes, marketProb, volume }) =>
  `${title}__${(outcomes || []).join('|')}__${Number(marketProb).toFixed(4)}__${Number(volume || 0).toFixed(2)}`;

// Route proxy backend pour Polymarket (évite corsproxy.io)
app.get('/api/polymarket/events', async (req, res) => {
  try {
    if (!API_AUTH_TOKEN) {
      return res.status(503).json({ error: 'API auth token not configured' });
    }
    if (req.headers['x-api-key'] !== API_AUTH_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Rate limit léger
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    if (hitRateLimit(ip)) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Cache 30s
    if (polyCache.data && polyCache.expiresAt > Date.now() && !req.query.closed) {
      return res.json(polyCache.data);
    }

    const limitParam = Math.min(Number(req.query.limit) || 200, 200);
    const closedParam = req.query.closed === 'true';
    const activeParam = req.query.active !== 'false'; // default true unless explicit false
    
    const url = `https://gamma-api.polymarket.com/events?limit=${limitParam}&active=${activeParam}&closed=${closedParam}&order=volume24hr&ascending=false`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'metapolymarket/1.0' },
      signal: controller.signal
    }).catch((e) => {
      if (e.name === 'AbortError') {
        return null;
      }
      throw e;
    });

    clearTimeout(timeout);

    if (!resp || !resp.ok) {
      return res.status(503).json({ error: 'Polymarket upstream error' });
    }

    const data = await resp.json();
    // Only cache standard "active" requests
    if (!req.query.closed) {
      polyCache = { data, expiresAt: Date.now() + POLY_CACHE_TTL_MS };
    }
    res.json(data);
  } catch (error) {
    console.error('Polymarket fetch failed:', error);
    res.status(503).json({ error: 'Polymarket fetch failed' });
  }
});

// Route API pour l'analyse AI (protège la clé OpenRouter)
app.post('/api/analyze', async (req, res) => {
  if (!OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'AI service unavailable - OPENROUTER_API_KEY not configured' });
  }

  if (!API_AUTH_TOKEN) {
    return res.status(503).json({ error: 'API auth token not configured' });
  }

  // Auth simple via en-tête x-api-key
  if (API_AUTH_TOKEN && req.headers['x-api-key'] !== API_AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Rate limit basique par IP
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (hitRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  try {
    const { title, outcomes, marketProb, volume } = req.body;
    
    if (!title || !outcomes || marketProb === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validation basique des entrées
    if (typeof title !== 'string' || title.length > 280) {
      return res.status(400).json({ error: 'Invalid title' });
    }
    if (!Array.isArray(outcomes) || outcomes.length < 2 || outcomes.some(o => typeof o !== 'string')) {
      return res.status(400).json({ error: 'Invalid outcomes' });
    }
    const probNum = Number(marketProb);
    if (Number.isNaN(probNum) || probNum < 0 || probNum > 1) {
      return res.status(400).json({ error: 'Invalid marketProb' });
    }
    const volumeNum = volume !== undefined ? Number(volume) : 0;
    if (Number.isNaN(volumeNum) || volumeNum < 0) {
      return res.status(400).json({ error: 'Invalid volume' });
    }

    const outcomeA = outcomes[0];
    const outcomeB = outcomes[1] || "Other";
    const currentOdds = `${outcomeA}: ${Math.round(marketProb * 100)}%, ${outcomeB}: ${Math.round((1 - marketProb) * 100)}%`;
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Retour cache si données récentes pour ce marché (titre, outcomes, probas, volume)
    const cacheKey = makeCacheKey({ title, outcomes, marketProb, volume });
    const cached = analysisCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }
    
    const prompt = `Model: google/gemma-2-9b-it. Role: "Meta-Oracle" superforecaster (Tetlock/Nate Silver style). Goal: beat market odds with concise, disciplined JSON.

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
        'HTTP-Referer': 'https://metapolymarket.com',
        'X-Title': 'MetaPolyMarket',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemma-2-9b-it',
        messages: [
          { role: 'user', content: prompt }
        ]
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
    res.json(payload);

  } catch (error) {
    console.error('AI Analysis error:', error);
    res.status(500).json({ error: 'AI analysis failed' });
  }
});

// Serve static files from the dist directory with cache control
app.use(express.static(join(__dirname, 'dist'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      // Never cache index.html
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      // Cache assets heavily (hashed filenames)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Handle SPA routing - serve index.html for all routes, BUT NOT for missing assets
app.get('*', (req, res) => {
  // If request is for an asset (js, css, png, etc) that wasn't found by static middleware, return 404
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg)$/)) {
    return res.status(404).send('Not found');
  }
  
  res.sendFile(join(__dirname, 'dist', 'index.html'), {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
