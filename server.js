import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware pour parser le JSON (limite la taille pour éviter les abus)
app.use(express.json({ limit: '50kb' }));

// Sécurité basique : headers (CORS permis pour l'extension)
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  
  // Allow CORS from Polymarket and Extension
  const origin = req.headers.origin;
  if (origin && (origin.includes('polymarket.com') || origin.startsWith('chrome-extension://'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    // Important for cross-origin fetch
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  } else {
    // Default strict policy for other origins
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
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

const hitRateLimit = (ip, limit = RATE_LIMIT_MAX) => {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const recent = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateBuckets.set(ip, recent);
  return recent.length > limit;
};

// Cache Polymarket côté serveur
const POLY_CACHE_TTL_MS = 30 * 1000;
let polyCache = { data: null, expiresAt: 0 };

// Cache en mémoire pour limiter les appels OpenRouter sur des marchés inchangés
const ANALYSIS_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const analysisCache = new Map();

const makeCacheKey = ({ title, outcomes, marketProb, volume }) =>
  `${title}__${(outcomes || []).join('|')}__${Number(marketProb).toFixed(4)}__${Number(volume || 0).toFixed(2)}`;

const clamp01 = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
};

/**
 * Kelly "Option A" (bankroll compounding sans levier).
 * Important: on ne fait PAS confiance au Kelly du modèle (trop instable / erreurs de formule).
 * On calcule Kelly à partir de p (AI) et du prix marché pour l'outcome recommandé,
 * puis on applique des garde-fous pour éviter les "wipeouts" sur marchés extrêmes / edge minuscule.
 */
const computeKellyPercentage = ({
  aiProbabilityForOutcomeA,
  prediction,
  outcomes,
  marketProbOutcomeA,
  confidence
}) => {
  const outcomeA = outcomes?.[0];
  const outcomeB = outcomes?.[1] || 'Other';
  const aiA = clamp01(aiProbabilityForOutcomeA);
  const mpA = clamp01(marketProbOutcomeA);

  // Normalise prediction à outcomeA/outcomeB; fallback basé sur probabilité.
  const pred =
    prediction === outcomeA || prediction === outcomeB
      ? prediction
      : aiA >= 0.5
        ? outcomeA
        : outcomeB;

  const predictedProb = pred === outcomeA ? aiA : 1 - aiA;
  const marketSideProb = pred === outcomeA ? mpA : 1 - mpA;

  // Garde-fous de sizing (empiriques, basés sur l'échantillon Firestore):
  // - pas de bet sur prix extrêmes (p≈0 ou p≈1): faible payout + micro-edge => énorme Kelly instable
  // - pas de bet si edge < 2 points (bruit > signal pour ce modèle)
  // - si confiance faible, pas de bet
  const conf = Number(confidence);
  if (Number.isFinite(conf) && conf < 4) return 0;
  if (marketSideProb <= 0.05 || marketSideProb >= 0.95) return 0;
  const edgeAbs = Math.abs(predictedProb - marketSideProb);
  if (edgeAbs < 0.02) return 0;

  // Kelly binaire: f* = (bp - q)/b avec b = (1/price)-1
  const b = (1 / marketSideProb) - 1;
  if (!Number.isFinite(b) || b <= 0) return 0;
  const p = predictedProb;
  const q = 1 - p;
  let f = (b * p - q) / b;
  if (!Number.isFinite(f)) f = 0;

  // Option A sans levier: clamp [0, 1] => [0%, 100%]
  f = Math.max(0, Math.min(1, f));
  return Math.round(f * 10000) / 100; // 2 décimales
};

// Recherche une analyse spécifique par slug ou ID (dans l'historique récent)
app.get('/api/picks/find', async (req, res) => {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'Slug required' });

  // 1. Chercher dans le cache mémoire serveur d'abord
  // (Pas implémenté globalement pour l'historique, donc on passe)

  try {
    const projectId = 'metapolymarket-140799832958';
    // Stratégie : Chercher dans daily_picks d'aujourd'hui (déjà fait par l'extension mais bon)
    // Et chercher dans prediction_history (qui est archivé par date).
    // Firestore REST API search n'est pas trivial sans index.
    
    // TRICHE EFFICACE : On suppose que l'analyse est récente (aujourd'hui ou hier).
    // On va fetcher daily_picks d'aujourd'hui et d'hier.
    
    const datesToCheck = [
        new Date().toISOString().split('T')[0],
        new Date(Date.now() - 86400000).toISOString().split('T')[0]
    ];
    
    for (const date of datesToCheck) {
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/daily_picks/${date}`;
        const resp = await fetch(url);
        if (resp.ok) {
            const doc = await resp.json();
            // Parsing manuel rapide
            const marketsRaw = doc.fields?.markets?.arrayValue?.values || [];
            
            for (const mRaw of marketsRaw) {
                // Check slug match inside the raw structure
                // structure: { mapValue: { fields: { slug: { stringValue: "..." } } } }
                const mSlug = mRaw.mapValue?.fields?.slug?.stringValue;
                
                // Comparaison souple (parfois le slug change légèrement ou c'est l'ID)
                if (mSlug === slug || (mSlug && slug.includes(mSlug)) || (mSlug && mSlug.includes(slug))) {
                     // Found it! Parse and return.
                     const parseValue = (val) => {
                        if (val.stringValue !== undefined) return val.stringValue;
                        if (val.integerValue !== undefined) return Number(val.integerValue);
                        if (val.doubleValue !== undefined) return Number(val.doubleValue);
                        if (val.booleanValue !== undefined) return val.booleanValue;
                        if (val.arrayValue !== undefined) return (val.arrayValue.values || []).map(parseValue);
                        if (val.mapValue !== undefined) {
                            const obj = {};
                            for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
                                obj[k] = parseValue(v);
                            }
                            return obj;
                        }
                        return null;
                     };
                     return res.json(parseValue(mRaw.mapValue));
                }
            }
        }
    }
    
    return res.status(404).json({ error: 'Analysis not found' });
    
  } catch (e) {
    console.error('Find error:', e);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Endpoint léger pour récupérer les analyses du jour (pour l'extension)
app.get('/api/picks/today', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  // Cache simple serveur pour ne pas spammer Firestore à chaque appel d'extension
  if (polyCache.dailyPicks && polyCache.dailyPicksDate === today && Date.now() < polyCache.dailyPicksExpires) {
    return res.json(polyCache.dailyPicks);
  }

  try {
    // URL Firestore REST directe (puisque public en lecture) ou via Admin SDK si dispo (ici on n'a pas admin sdk init dans server.js, on a juste express)
    // Ah, server.js n'a pas firebase-admin initialisé, c'est functions/index.js qui l'a.
    // server.js est le serveur de dev/prod frontend node. 
    // On va utiliser l'API REST Firestore public puisque les règles l'autorisent.
    
    const projectId = 'metapolymarket-140799832958'; // ID du projet
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/daily_picks/${today}`;
    
    const resp = await fetch(url);
    if (!resp.ok) {
        // Si 404 (pas encore généré ajd), on essaie hier ? Ou on renvoie vide.
        return res.json({ date: today, markets: [] });
    }
    
    const doc = await resp.json();
    
    // Parser la structure Firestore REST horrible
    // fields: { markets: { arrayValue: { values: [ { mapValue: { fields: ... } } ] } } }
    const parseValue = (val) => {
        if (val.stringValue !== undefined) return val.stringValue;
        if (val.integerValue !== undefined) return Number(val.integerValue);
        if (val.doubleValue !== undefined) return Number(val.doubleValue);
        if (val.booleanValue !== undefined) return val.booleanValue;
        if (val.arrayValue !== undefined) return (val.arrayValue.values || []).map(parseValue);
        if (val.mapValue !== undefined) {
            const obj = {};
            for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
                obj[k] = parseValue(v);
            }
            return obj;
        }
        return null;
    };
    
    const marketsRaw = doc.fields?.markets?.arrayValue?.values || [];
    const markets = marketsRaw.map(parseValue);
    
    // Mettre en cache pour 5 minutes
    polyCache.dailyPicks = { date: today, markets };
    polyCache.dailyPicksDate = today;
    polyCache.dailyPicksExpires = Date.now() + 5 * 60 * 1000;
    
    res.json({ date: today, markets });
  } catch (e) {
    console.error('Error fetching picks:', e);
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

// Route proxy backend pour Polymarket (évite corsproxy.io)
app.get('/api/polymarket/events', async (req, res) => {
  try {
    // Auth simple via en-tête x-api-key (optionnel pour usage public avec rate limit)
    const clientApiKey = req.headers['x-api-key'];
    const isAuthenticated = API_AUTH_TOKEN && clientApiKey === API_AUTH_TOKEN;

    // Si pas authentifié par token, on applique un rate limit strict par IP
    if (!isAuthenticated) {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      // Limite pour les appels publics (proxy events) : 20 requêtes / minute (un peu plus large que analyze)
      const PUBLIC_PROXY_RATE_LIMIT = 20; 
      if (hitRateLimit(ip, PUBLIC_PROXY_RATE_LIMIT)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }
    }

    // Cache 30s (only for global list, not specific searches)
    const isSearch = req.query.slug || req.query.id;
    if (!isSearch && polyCache.data && polyCache.expiresAt > Date.now() && !req.query.closed) {
      return res.json(polyCache.data);
    }

    const limitParam = Math.min(Number(req.query.limit) || 200, 200);
    const closedParam = req.query.closed === 'true';
    const activeParam = req.query.active !== 'false'; // default true unless explicit false
    
    let url = `https://gamma-api.polymarket.com/events?limit=${limitParam}&active=${activeParam}&closed=${closedParam}&order=volume24hr&ascending=false`;

    // Handle specific event lookups
    if (req.query.slug) {
      url = `https://gamma-api.polymarket.com/events?slug=${req.query.slug}`;
    } else if (req.query.id) {
      url = `https://gamma-api.polymarket.com/events?id=${req.query.id}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MetaPolymarket/1.0; +https://metapolymarket.com)' },
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
    // Only cache standard "active" requests (dashboard view)
    if (!isSearch && !req.query.closed) {
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

  // Auth simple via en-tête x-api-key (optionnel pour usage public avec rate limit)
  const clientApiKey = req.headers['x-api-key'];
  const isAuthenticated = API_AUTH_TOKEN && clientApiKey === API_AUTH_TOKEN;

  // Si pas authentifié par token, on applique un rate limit strict par IP
    if (!isAuthenticated) {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      // Limite plus stricte pour les anonymes : 25 requêtes / minute (demandé par user)
      const PUBLIC_RATE_LIMIT_MAX = 25; 
      if (hitRateLimit(ip, PUBLIC_RATE_LIMIT_MAX)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }
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
    
    const prompt = `Model: google/gemma-2-9b-it. Role: "Meta-Oracle" superforecaster (Tetlock/Nate Silver style). Goal: produce CALIBRATED probabilities. Anchor to market; only move with real evidence. Prefer "no-bet" to overconfidence.

Context
- Date: ${today}
- Market: "${title}"
- Outcomes: ${outcomes.join(" vs ")}
- Market odds: ${currentOdds}
- Volume: $${(volume || 0).toLocaleString()}

Protocol (keep it lean)
0) Hard rule: start from market odds as your prior. If you lack strong evidence, stay within ±3 points of market.
1) Rules check: flag traps/ambiguities, unclear resolution, or missing info.
2) Signals (one short line each; factual, not vibes):
   - Data: base rates/stats/polls.
   - Sentiment: crowd/media momentum.
   - Contrarian: hidden risks/why consensus fails.
3) Synthesis: output aiProbability as the probability of "${outcomeA}" ONLY (0-1). Your recommended prediction MUST be one of the two outcomes.
4) Discipline:
   - If market odds are extreme (<=5% or >=95%), set kellyPercentage=0 (micro-edge + tiny payout => unstable).
   - If your edge vs market is < 2 points, set kellyPercentage=0.
   - If the question is short-horizon/noisy (sports, crypto <24h, rumor-based announcements), default to market odds and kellyPercentage=0 unless a confirmed catalyst exists.

Specific Rules for Accuracy:
- SPORTS: Never output implied confidence above 70% unless there is deterministic information (injury news, lineup lock, etc). Upsets happen constantly.
- CRYPTO/FINANCE (Short Term < 24h): Assume near 50/50 randomness ("Random Walk") unless there is a massive, confirmed catalyst. If no catalyst, default to market odds or 50/50 with Kelly% = 0.
- NEWS/ANNOUNCEMENTS: If asking "Will X happen by [Date]?" and no news yet, default to "No" (Status Quo) with high confidence. Do not bet "Yes" on rumors alone.

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
    
    const aiProbability = parsed.aiProbability ?? marketProb;
    const prediction = parsed.prediction ?? outcomeA;
    const confidence = parsed.confidence ?? 5;

    const payload = {
      aiProbability,
      prediction,
      reasoning: parsed.reasoning ?? "Analysis based on market trends.",
      category: parsed.category ?? "Other",
      // Kelly recalculé (Option A) avec garde-fous
      kellyPercentage: computeKellyPercentage({
        aiProbabilityForOutcomeA: aiProbability,
        prediction,
        outcomes,
        marketProbOutcomeA: marketProb,
        confidence
      }),
      confidence,
      riskFactor: parsed.riskFactor ?? "Market volatility",
      edge: (aiProbability ?? marketProb) - marketProb
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
  index: 'index.html', // Ensure index.html is served for root
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
  console.log(`Serving static files from: ${join(__dirname, 'dist')}`);
});
