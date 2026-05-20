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
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.3';
// Token simple pour protéger /api/analyze (à définir dans l'env : API_AUTH_TOKEN)
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || '';
const APP_VERSION = process.env.npm_package_version || '0.0.0';
const STARTED_AT = Date.now();
const FIRESTORE_PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'metapolymarket';
const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || '';
const FUNCTION_URLS = {
  sendPremiumVerificationCode: process.env.SEND_PREMIUM_CODE_URL || `${FUNCTIONS_BASE_URL}/sendPremiumVerificationCode`,
  validatePremiumCode: process.env.VALIDATE_PREMIUM_CODE_URL || `${FUNCTIONS_BASE_URL}/validatePremiumCode`,
  checkPremiumStatus: process.env.CHECK_PREMIUM_STATUS_URL || `${FUNCTIONS_BASE_URL}/checkPremiumStatus`
};

if (!FUNCTIONS_BASE_URL && (!process.env.SEND_PREMIUM_CODE_URL || !process.env.VALIDATE_PREMIUM_CODE_URL || !process.env.CHECK_PREMIUM_STATUS_URL)) {
  FUNCTION_URLS.sendPremiumVerificationCode = 'https://sendpremiumverificationcode-krtdefxoka-uc.a.run.app';
  FUNCTION_URLS.validatePremiumCode = 'https://validatepremiumcode-krtdefxoka-uc.a.run.app';
  FUNCTION_URLS.checkPremiumStatus = 'https://checkpremiumstatus-krtdefxoka-uc.a.run.app';
}

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

  // AJUSTEMENT: Fractional Kelly (0.3x) pour réduire la volatilité et protéger contre l'incertitude du modèle
  // Full Kelly est trop agressif quand "p" est une estimation IA imparfaite.
  f = f * 0.3;

  // Option A sans levier: clamp [0, 1] => [0%, 100%]
  f = Math.max(0, Math.min(1, f));
  return Math.round(f * 10000) / 100; // 2 décimales
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const firestoreValueToJson = (val) => {
  if (!val) return null;
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return Number(val.integerValue);
  if (val.doubleValue !== undefined) return Number(val.doubleValue);
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.timestampValue !== undefined) return val.timestampValue;
  if (val.arrayValue !== undefined) return (val.arrayValue.values || []).map(firestoreValueToJson);
  if (val.mapValue !== undefined) {
    const obj = {};
    for (const [key, child] of Object.entries(val.mapValue.fields || {})) {
      obj[key] = firestoreValueToJson(child);
    }
    return obj;
  }
  return null;
};

const firestoreDocToJson = (doc) => {
  const obj = {};
  for (const [key, value] of Object.entries(doc?.fields || {})) {
    obj[key] = firestoreValueToJson(value);
  }
  return obj;
};

const annotateMarkets = (markets, status, timestamp) =>
  (Array.isArray(markets) ? markets : []).map((market) => ({
    ...market,
    analysisStatus: market.analysisStatus || status,
    lastAnalyzedAt: market.lastAnalyzedAt || timestamp || null
  }));

const isDailyStale = (date, timestamp) => {
  const today = new Date().toISOString().split('T')[0];
  if (!date || date !== today) return true;
  const updated = timestamp ? new Date(timestamp).getTime() : 0;
  return !Number.isFinite(updated) || Date.now() - updated > 26 * 60 * 60 * 1000;
};

const isHourlyStale = (timestamp) => {
  const updated = timestamp ? new Date(timestamp).getTime() : 0;
  return !Number.isFinite(updated) || Date.now() - updated > 2 * 60 * 60 * 1000;
};

const fetchFirestoreDocument = async (collectionName, docId) => {
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${collectionName}/${docId}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return firestoreDocToJson(await response.json());
};

const fetchLatestFirestoreDocument = async (collectionName, orderBy) => {
  const params = new URLSearchParams({ pageSize: '1', orderBy });
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${collectionName}?${params}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const body = await response.json();
  const doc = body.documents?.[0];
  return doc ? firestoreDocToJson(doc) : null;
};

const readDailyPicks = async () => {
  const today = new Date().toISOString().split('T')[0];
  const todaysDoc = await fetchFirestoreDocument('daily_picks', today);
  const data = Array.isArray(todaysDoc?.markets) && todaysDoc.markets.length > 0
    ? todaysDoc
    : await fetchLatestFirestoreDocument('daily_picks', 'date desc');

  const date = data?.date || today;
  const timestamp = data?.timestamp || data?.updatedAt || null;
  return {
    source: 'daily',
    date,
    timestamp,
    stale: isDailyStale(date, timestamp),
    markets: annotateMarkets(data?.markets, 'cached', timestamp),
    message: data ? undefined : 'No daily picks found'
  };
};

const readHourlyPicks = async () => {
  const data = await fetchLatestFirestoreDocument('hourly_picks', 'timestamp desc');
  const timestamp = data?.timestamp || data?.updatedAt || null;
  return {
    source: 'hourly',
    date: data?.hour,
    timestamp,
    stale: isHourlyStale(timestamp),
    markets: annotateMarkets(data?.markets, 'cached', timestamp),
    message: data ? undefined : 'No hourly picks found'
  };
};

const proxyFunctionJson = async (functionName, payload) => {
  const url = FUNCTION_URLS[functionName];
  if (!url || url === `/${functionName}`) {
    return { status: 503, body: { success: false, error: 'Function URL not configured' } };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = { success: false, error: await response.text() };
  }

  return { status: response.status, body };
};

const parseModelJson = (text) => {
  if (!text || typeof text !== 'string') {
    throw new Error('Empty model response');
  }

  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Model response was not valid JSON');
  }
};

const fallbackAnalysisPayload = ({ outcomes, marketProb, reason = 'AI unavailable, using market odds.' }) => ({
  aiProbability: marketProb,
  prediction: outcomes?.[0] || 'Yes',
  reasoning: reason,
  category: 'Other',
  kellyPercentage: 0,
  confidence: 3,
  riskFactor: 'Model throttled/unavailable',
  edge: 0,
  analysisStatus: 'fallback',
  lastAnalyzedAt: new Date().toISOString()
});

app.get('/api/picks/latest', async (req, res) => {
  try {
    const requestedSource = String(req.query.source || 'auto');
    let data;

    if (requestedSource === 'hourly') {
      data = await readHourlyPicks();
    } else if (requestedSource === 'auto') {
      const hourly = await readHourlyPicks();
      data = hourly.markets.length > 0 && !hourly.stale ? hourly : await readDailyPicks();
    } else {
      data = await readDailyPicks();
    }

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(data);
  } catch (error) {
    console.error('Latest picks failed:', error);
    res.status(503).json({
      source: req.query.source === 'hourly' ? 'hourly' : 'daily',
      timestamp: null,
      stale: true,
      markets: [],
      message: 'Latest picks unavailable'
    });
  }
});

app.get('/api/health', async (_req, res) => {
  const [daily, hourly, poly] = await Promise.allSettled([
    readDailyPicks(),
    readHourlyPicks(),
    fetch('https://gamma-api.polymarket.com/events?limit=1&active=true&closed=false', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MetaPolymarket/1.0; +https://metapolymarket.com)' },
      signal: AbortSignal.timeout(5000)
    })
  ]);

  res.json({
    ok: true,
    version: APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    model: OPENROUTER_MODEL,
    firestoreProjectId: FIRESTORE_PROJECT_ID,
    openRouterConfigured: Boolean(OPENROUTER_API_KEY),
    daily: daily.status === 'fulfilled'
      ? { timestamp: daily.value.timestamp, date: daily.value.date, stale: daily.value.stale, count: daily.value.markets.length }
      : { stale: true, error: 'daily_unavailable' },
    hourly: hourly.status === 'fulfilled'
      ? { timestamp: hourly.value.timestamp, hour: hourly.value.date, stale: hourly.value.stale, count: hourly.value.markets.length }
      : { stale: true, error: 'hourly_unavailable' },
    polymarket: poly.status === 'fulfilled' && poly.value.ok ? 'ok' : 'degraded'
  });
});

app.post('/api/premium/send-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }
  const result = await proxyFunctionJson('sendPremiumVerificationCode', {
    email,
    referralCode: req.body?.referralCode || null
  });
  res.status(result.status).json(result.body);
});

app.post('/api/premium/validate-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  if (!email || !code) {
    return res.status(400).json({ success: false, error: 'Email and code are required' });
  }
  const result = await proxyFunctionJson('validatePremiumCode', {
    email,
    code,
    referralCode: req.body?.referralCode || null
  });
  res.status(result.status).json(result.body);
});

app.post('/api/premium/status', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ isPremium: false });
  }
  const result = await proxyFunctionJson('checkPremiumStatus', { email });
  res.status(result.status).json(result.body);
});

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
  try {
    const data = await readDailyPicks();
    res.json({ date: data.date, timestamp: data.timestamp, stale: data.stale, markets: data.markets });
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
    const { outcomes = ['Yes', 'No'], marketProb = 0.5 } = req.body || {};
    return res.json(fallbackAnalysisPayload({
      outcomes,
      marketProb: Number(marketProb) || 0.5,
      reason: 'AI key unavailable, using market odds.'
    }));
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

    const prompt = `Model: ${OPENROUTER_MODEL}. Role: "Meta-Oracle" superforecaster (Tetlock/Nate Silver style). Goal: produce CALIBRATED probabilities. Anchor to market; only move with real evidence.

Context
- Date: ${today}
- Market: "${title}"
- Outcomes: ${outcomes.join(" vs ")}
- Market odds: ${currentOdds}
- Volume: $${(volume || 0).toLocaleString()}

Protocol (Critical for Brier Score)
1) Anchoring: Start at market odds. Only deviate if you have a CLEAR, DOCUMENTED reason.
2) Conservative Bias: If evidence is mixed, stay WITHIN ±2% of market odds.
3) No Extremes: Never exceed 90% or go below 10% unless the event is virtually certain (e.g., historical fact).
4) Synthesis: Output aiProbability for "${outcomeA}". 

Return ONLY raw JSON:
- aiProbability: number 0-1 (calibrated)
- prediction: "${outcomeA}" or "${outcomeB}"
- reasoning: 2 sentences max
- category: Politics | Crypto | Sports | Business | Other
- kellyPercentage: 0-100 (keep it low for safety)
- confidence: 1-10
- riskFactor: main risk`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://metapolymarket.com',
        'X-Title': 'MetaPolyMarket',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', errorText);
      return res.json(fallbackAnalysisPayload({
        outcomes,
        marketProb,
        reason: 'AI service degraded, using market odds.'
      }));
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;

    if (!text) {
      throw new Error('No response from OpenRouter');
    }

    const parsed = parseModelJson(text);

    let aiProbability = parsed.aiProbability ?? marketProb;
    const prediction = parsed.prediction ?? outcomeA;
    const confidence = parsed.confidence ?? 5;

    // AMÉLIORATION BRIER SCORE : Calibration par lissage (Shrinkage)
    // On mélange la prédiction IA avec celle du marché (30% IA / 70% Marché)
    // Cela réduit drastiquement l'erreur quadratique quand l'IA est sur-confiante.
    aiProbability = (aiProbability * 0.3) + (marketProb * 0.7);

    // Clamping supplémentaire pour éviter les probabilités extrêmes
    aiProbability = Math.max(0.08, Math.min(0.92, aiProbability));

    const edge = Math.abs(aiProbability - marketProb);
    const outcomes_arr = outcomes || ["Yes", "No"];

    // Calcul de Kelly conservateur (Quarter-Kelly)
    // f = (bp - q) / b
    // b = payout (net odds) = (1/price) - 1
    const p_kelly = aiProbability >= 0.5 ? aiProbability : (1 - aiProbability);
    const price_kelly = aiProbability >= 0.5 ? marketProb : (1 - marketProb);

    let kellyPercentage = 0;
    if (edge > 0.035 && confidence >= 5) { // Seuil d'edge et confiance plus élevé
      const b = (1 / price_kelly) - 1;
      const q = 1 - p_kelly;
      if (b > 0) {
        const fullKelly = (b * p_kelly - q) / b;
        // On utilise Quarter-Kelly (0.25) et on cap à 10% max du bankroll
        kellyPercentage = Math.max(0, Math.min(0.1, fullKelly * 0.25)) * 100;
      }
    }

    const payload = {
      aiProbability,
      prediction,
      reasoning: parsed.reasoning ?? "Analysis based on market trends.",
      category: parsed.category ?? "Other",
      kellyPercentage,
      confidence,
      riskFactor: parsed.riskFactor ?? "Market volatility",
      edge: aiProbability - marketProb,
      analysisStatus: 'fresh',
      lastAnalyzedAt: new Date().toISOString()
    };

    analysisCache.set(cacheKey, { data: payload, expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS });
    res.json(payload);

  } catch (error) {
    console.error('AI Analysis error:', error);
    const { outcomes = ['Yes', 'No'], marketProb = 0.5 } = req.body || {};
    res.json(fallbackAnalysisPayload({
      outcomes,
      marketProb: Number(marketProb) || 0.5,
      reason: 'AI parsing failed, using market odds.'
    }));
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
