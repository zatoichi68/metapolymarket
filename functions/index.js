import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import nodemailer from 'nodemailer';

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

// Define Secrets
const openrouterApiKey = defineSecret('OPENROUTER_API_KEY');
const smtpUser = defineSecret('SMTP_USER');
const smtpPass = defineSecret('SMTP_PASS');
const smtpFrom = defineSecret('SMTP_FROM');
const smtpFromName = defineSecret('SMTP_FROM_NAME');
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.3';
const OPENROUTER_CHEAP_MODEL = process.env.OPENROUTER_CHEAP_MODEL || 'google/gemini-2.5-flash-lite';
const OPENROUTER_REVIEW_MODEL = process.env.OPENROUTER_REVIEW_MODEL || 'deepseek/deepseek-v3.2';

// CORS Configuration - Restrict to allowed origins
const ALLOWED_ORIGINS = [
  'https://metapolymarket.com',
  'https://www.metapolymarket.com',
  'https://metapolymarket.web.app',
  'https://metapolymarket.firebaseapp.com',
  // Cloud Run container origin (frontend)
  'https://metapolymarket-140799832958.us-east5.run.app',
  /^https:\/\/metapolymarket--.*\.web\.app$/,  // Firebase preview channels
  'http://localhost:3000',  // Dev
  'http://127.0.0.1:3000',  // Dev
  'http://localhost:4173',   // Dev Vite
  'http://127.0.0.1:4173',   // Dev Vite
];

const POLYMARKET_API_URL = 'https://gamma-api.polymarket.com/events?limit=200&active=true&closed=false&order=volume24hr&ascending=false';

/**
 * Helper: Send Email via Nodemailer
 * Receives credentials as parameters to work within secret context
 */
async function sendEmail(to, subject, html, user, pass, fromAddress, fromName) {
  if (user && pass) {
    // Use a validated Brevo sender if provided, fallback to auth user
    const sender = fromAddress || user;
    const senderName = fromName || 'MetaPolymarket';

    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from: `"${senderName}" <${sender}>`,
      replyTo: sender,
      to,
      subject,
      html
    });
    console.log(`Email sent to ${to}`);
  } else {
    console.log('⚠️ SMTP secrets not configured. Simulating email send.');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${html}`);
  }
}

/**
 * Generate a random 6-digit code
 */
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeReferralCode(referralCode) {
  return referralCode ? String(referralCode).trim().toUpperCase() : null;
}

function parseModelJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Empty model response');
  }
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parseJson = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      const repaired = candidate
        .replace(/"kellyPercentage"\s*:\s*[^,\n}]+/g, '"kellyPercentage": 0')
        .replace(/"confidence"\s*:\s*[^,\n}]+/g, '"confidence": 5');
      return JSON.parse(repaired);
    }
  };

  try {
    return parseJson(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return parseJson(cleaned.slice(start, end + 1));
    }
    throw new Error('Model response was not valid JSON');
  }
}

/**
 * Cloud Function: Send Premium Verification Code
 * Expects body: { email: string }
 */
export const sendPremiumVerificationCode = onRequest({
  cors: ALLOWED_ORIGINS,
  invoker: 'public',
  secrets: [smtpUser, smtpPass, smtpFrom, smtpFromName]
}, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const email = normalizeEmail(req.body?.email);
  const referralCode = normalizeReferralCode(req.body?.referralCode);
  if (!email || !email.includes('@')) {
    res.status(400).json({ success: false, error: 'Invalid email address' });
    return;
  }

  try {
    // 1. Check if user is already verified
    const userDoc = await db.collection('premium_users').doc(email).get();
    if (userDoc.exists && userDoc.data().verified) {
      res.json({ success: true, message: 'Already verified', alreadyVerified: true });
      return;
    }

    // 2. Generate and store code
    const verificationRef = db.collection('premium_verifications').doc(email);
    const existingVerification = await verificationRef.get();
    if (existingVerification.exists) {
      const existingData = existingVerification.data();
      const lastSentAt = existingData.lastSentAt || existingData.createdAtMs || 0;
      if (Date.now() - lastSentAt < 60 * 1000) {
        res.status(429).json({ success: false, error: 'Please wait before requesting another code.' });
        return;
      }
    }

    const code = generateCode();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    await verificationRef.set({
      code,
      expiresAt,
      attempts: 0,
      lastSentAt: Date.now(),
      createdAtMs: Date.now(),
      createdAt: new Date().toISOString(),
      referralCode: referralCode || null
    });

    // 3. Send Email (pass secrets as parameters)
    const user = smtpUser.value();
    const pass = smtpPass.value();
    const fromAddr = smtpFrom.value();
    const fromName = smtpFromName.value();
    await sendEmail(
      email,
      'Your MetaPolymarket Verification Code',
      `<div style="font-family: sans-serif; padding: 20px;">
         <h2>Welcome to MetaPolymarket Premium!</h2>
         <p>Your verification code is:</p>
         <h1 style="color: #4F46E5; letter-spacing: 5px;">${code}</h1>
         <p>This code expires in 15 minutes.</p>
         <p>If you didn't request this, please ignore this email.</p>
       </div>`,
      user,
      pass,
      fromAddr,
      fromName
    );

    res.json({ success: true, message: 'Verification code sent' });

  } catch (error) {
    console.error('Error sending code:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Cloud Function: Validate Premium Verification Code
 * Expects body: { email: string, code: string }
 */
export const validatePremiumCode = onRequest({
  cors: ALLOWED_ORIGINS,
  invoker: 'public'
}, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  const referralCode = normalizeReferralCode(req.body?.referralCode);

  if (!email || !code) {
    res.status(400).json({ success: false, error: 'Email and code are required' });
    return;
  }

  try {
    // 1. Get stored code
    const docRef = db.collection('premium_verifications').doc(email);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(400).json({ success: false, error: 'No verification code found for this email' });
      return;
    }

    const data = doc.data();
    const attempts = Number(data.attempts || 0);
    if (attempts >= 5) {
      res.status(429).json({ success: false, error: 'Too many attempts. Please request a new code.' });
      return;
    }

    // 2. Validate
    if (Date.now() > data.expiresAt) {
      res.status(400).json({ success: false, error: 'Code expired. Please request a new one.' });
      return;
    }

    if (data.code !== code) {
      await docRef.set({ attempts: attempts + 1, lastAttemptAt: Date.now() }, { merge: true });
      res.status(400).json({ success: false, error: 'Invalid code' });
      return;
    }

    // 3. Determine plan (referral capped to first 420)
    const effectiveReferral = referralCode || data.referralCode || null;

    let plan = 'free_trial';
    let referralSlot = null;
    if (effectiveReferral === 'METAPMLT') {
      const refDocRef = db.collection('referral_meta').doc('METAPMLT');
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(refDocRef);
        const used = snap.exists ? (snap.data().used || 0) : 0;
        const limit = snap.exists ? (snap.data().limit || 420) : 420;
        if (used >= limit) {
          return { allowed: false };
        }
        tx.set(refDocRef, { used: used + 1, limit }, { merge: true });
        return { allowed: true, slot: used + 1 };
      });
      if (!result.allowed) {
        res.status(400).json({ success: false, error: 'Referral limit reached' });
        return;
      }
      plan = 'premium_referral';
      referralSlot = result.slot || null;
    }

    // 4. Mark user as verified in persistent collection
    await db.collection('premium_users').doc(email).set({
      email,
      verified: true,
      joinedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      plan,
      referralCode: effectiveReferral,
      referralSlot
    });

    // 4. Clean up verification doc
    await docRef.delete();

    res.json({ success: true, message: 'Verified successfully' });

  } catch (error) {
    console.error('Error validating code:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Cloud Function: Check Premium Status
 * Expects body: { email: string }
 */
export const checkPremiumStatus = onRequest({
  cors: ALLOWED_ORIGINS,
  invoker: 'public'
}, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const email = normalizeEmail(req.body?.email);

  if (!email) {
    res.status(400).json({ isPremium: false });
    return;
  }

  try {
    const userDoc = await db.collection('premium_users').doc(email).get();
    const isPremium = userDoc.exists && userDoc.data().verified;

    res.json({ isPremium });
  } catch (error) {
    console.error('Error checking status:', error);
    res.status(500).json({ isPremium: false, error: error.message });
  }
});


// ... Existing functions (keep them) ...

/**
 * Analyze a market using OpenRouter Grok
 */
async function analyzeMarket(title, outcomes, marketProb, volume, apiKey, model = OPENROUTER_MODEL) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const outcomeA = outcomes[0];
  const outcomeB = outcomes[1] || "Other";
  const currentOdds = `${outcomeA}: ${Math.round(marketProb * 100)}%, ${outcomeB}: ${Math.round((1 - marketProb) * 100)}%`;

  const prompt = `Model: ${model}. Role: "Meta-Oracle" superforecaster (Tetlock/Nate Silver style). Goal: produce CALIBRATED but ACTIONABLE probabilities. Anchor to market, then identify whether there is a tradable mispricing.

Context
- Date: ${today}
- Market: "${title}"
- Outcomes: ${outcomes.join(" vs ")}
- Market odds: ${currentOdds}
- Volume: $${(volume || 0).toLocaleString()}

Protocol
1) Start at market odds, then adjust for concrete catalysts: timing, liquidity, injuries, polling, macro/news, rules, and base rates.
2) If evidence is mixed, stay close to market. If evidence is clearly mispriced, move 3-8 percentage points; only move more for very strong evidence.
3) No fake precision: avoid tiny +/-0.1% changes. If there is no tradable edge, return market odds and explicitly say "No trade".
4) Tail calibration: if the market is already below 8% or above 92%, do NOT force it back to 8/92; probabilities of 1-5% or 95-99% are allowed when base rates justify them.
5) Output aiProbability for "${outcomeA}" and make the reasoning explain the alpha direction: buy "${outcomeA}", buy "${outcomeB}", or no trade.

Return ONLY one strict JSON object. No markdown, no comments, no extra text.
All numeric fields must be JSON numbers using digits only.
Schema:
{
  "aiProbability": 0.42,
  "prediction": "${outcomeA}",
  "reasoning": "Two concise sentences max.",
  "category": "Politics",
  "kellyPercentage": 0,
  "confidence": 5,
  "riskFactor": "Main risk"
}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://metapolymarket.com',
      'X-Title': 'MetaPolyMarket',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      ...(model.includes('deepseek') ? { reasoning: { enabled: false } } : {})
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error('No response from OpenRouter');
  }

  return parseModelJson(text);
}

const clamp01 = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
};

const computeKellyPercentage = ({ aiProbabilityForOutcomeA, prediction, outcomes, marketProbOutcomeA, confidence }) => {
  const outcomeA = outcomes?.[0];
  const aiA = clamp01(aiProbabilityForOutcomeA);
  const mpA = clamp01(marketProbOutcomeA);

  const pred =
    prediction === outcomes?.[0] || prediction === outcomes?.[1]
      ? prediction
      : aiA >= 0.5
        ? outcomeA
        : outcomes?.[1] || 'No';

  const predictedProb = pred === outcomeA ? aiA : 1 - aiA;
  const marketSideProb = pred === outcomeA ? mpA : 1 - mpA;

  const conf = Number(confidence);
  if (Number.isFinite(conf) && conf < 4) return 0;
  if (marketSideProb <= 0.03 || marketSideProb >= 0.97) return 0;

  const edgeAbs = Math.max(0, predictedProb - marketSideProb);
  if (edgeAbs < 0.015) return 0;

  const b = (1 / marketSideProb) - 1;
  if (!Number.isFinite(b) || b <= 0) return 0;
  const p = predictedProb;
  const q = 1 - p;

  let f = (b * p - q) / b;
  if (!Number.isFinite(f)) f = 0;

  // Fractional Kelly capped at 5% of bankroll.
  f = Math.max(0, Math.min(0.05, f * 0.35));

  return Math.round(f * 10000) / 100;
};

const finalizeAnalysis = ({ analysis, prob, outcomes }) => {
  let aiProb = analysis.aiProbability ?? prob;
  const prediction = analysis.prediction ?? outcomes[0];
  const confidence = analysis.confidence ?? 5;

  // Calibration by shrinkage: keep market anchoring without erasing tradable edges.
  aiProb = (aiProb * 0.45) + (prob * 0.55);
  aiProb = Math.max(0.01, Math.min(0.99, aiProb));

  const calculatedEdge = prediction === outcomes[0]
    ? aiProb - prob
    : (1 - aiProb) - (1 - prob);

  return {
    aiProb,
    prediction,
    confidence,
    calculatedEdge,
    kellyPercentage: computeKellyPercentage({
      aiProbabilityForOutcomeA: aiProb,
      prediction,
      outcomes,
      marketProbOutcomeA: prob,
      confidence
    })
  };
};

const shouldReviewWithGrok = ({ title, category, prob, finalized }) => {
  const sensitive = /(iran|trump|china|taiwan|election|president|minister|regime|war|invade|nuclear|sanction|hormuz|fed|rate|oil|geopolitic)/i
    .test(`${title} ${category || ''}`);
  const tailMarket = prob <= 0.08 || prob >= 0.92;
  const absoluteEdge = Math.abs(finalized.calculatedEdge);
  const actionablePositiveEdge = finalized.calculatedEdge >= 0.05;
  const weakConfidence = Number(finalized.confidence) < 5;

  return actionablePositiveEdge ||
    (sensitive && absoluteEdge >= 0.02) ||
    (category === 'Politics' && absoluteEdge >= 0.025) ||
    (tailMarket && absoluteEdge >= 0.03) ||
    (weakConfidence && finalized.calculatedEdge >= 0.04);
};

/**
 * Fetch and analyze all markets with parallel processing
 */
async function fetchAndAnalyzeMarkets(apiKey) {
  console.log('Fetching markets from Polymarket...');

  const response = await fetch(POLYMARKET_API_URL);
  if (!response.ok) {
    throw new Error(`Polymarket API error: ${response.status}`);
  }

  const events = await response.json();
  console.log(`Fetched ${events.length} events`);

  // Prepare all valid markets first
  const marketsToAnalyze = [];

  for (const event of events) {
    const market = event.markets?.[0];
    if (!market || !market.outcomePrices) continue;
    if (event.endDate && new Date(event.endDate).getTime() <= Date.now()) continue;

    try {
      const prices = typeof market.outcomePrices === 'string'
        ? JSON.parse(market.outcomePrices)
        : market.outcomePrices;

      const prob = parseFloat(prices[0]);
      if (isNaN(prob) || prob <= 0.01 || prob >= 0.99) continue;

      let outcomes = ["Yes", "No"];

      // For grouped markets (multi-outcome like "Which movie will win?"),
      // ALWAYS use [groupItemTitle, "Other"] to ensure prices[0] aligns with outcomes[0]
      // prices[0] is always the probability of the specific option winning
      if (market.groupItemTitle) {
        outcomes = [market.groupItemTitle, "Other"];
      } else if (market.outcomes) {
        // For regular binary markets, use the provided outcomes
        const parsedOutcomes = typeof market.outcomes === 'string'
          ? JSON.parse(market.outcomes)
          : market.outcomes;
        if (Array.isArray(parsedOutcomes) && parsedOutcomes.length >= 2) {
          outcomes = parsedOutcomes;
        }
      }

      marketsToAnalyze.push({ event, market, prob, outcomes });
    } catch (error) {
      console.error(`Error preparing ${event.title}:`, error.message);
    }
  }

  console.log(`Prepared ${marketsToAnalyze.length} markets for analysis`);

  const MAX_RETRIES = 4;
  const RETRY_DELAY_MS = 1000; // base delay (ms) with jitter
  const PER_CALL_DELAY_MS = 1500; // throttle each call

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const runAnalysisWithRetry = async (args) => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await analyzeMarket(...args);
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          throw error;
        }
        const jitter = 1 + Math.random() * 0.3;
        const delay = Math.round(RETRY_DELAY_MS * (attempt + 1) * jitter);
        console.warn(`Retrying analysis (attempt ${attempt + 1}/${MAX_RETRIES + 1}) after ${delay}ms`);
        await sleep(delay);
      }
    }
  };
  // Limit to top 100 markets to reduce total calls
  const limitedMarkets = marketsToAnalyze.slice(0, 100);

  // Sequential processing to avoid 429 on free tier
  const analyzedMarkets = [];
  let successCount = 0;
  let errorCount = 0;
  let cheapCount = 0;
  let reviewCount = 0;
  let reviewFallbackCount = 0;

  for (const { event, market, prob, outcomes } of limitedMarkets) {
    try {
      let analysis = await runAnalysisWithRetry([
        event.title,
        outcomes,
        prob,
        parseFloat(market.volume || "0"),
        apiKey,
        OPENROUTER_CHEAP_MODEL
      ]);
      cheapCount++;

      let analysisModel = OPENROUTER_CHEAP_MODEL;
      let finalized = finalizeAnalysis({ analysis, prob, outcomes });

      if (
        OPENROUTER_REVIEW_MODEL !== OPENROUTER_CHEAP_MODEL &&
        shouldReviewWithGrok({
          title: event.title,
          category: analysis.category,
          prob,
          finalized
        })
      ) {
        try {
          const review = await runAnalysisWithRetry([
            event.title,
            outcomes,
            prob,
            parseFloat(market.volume || "0"),
            apiKey,
            OPENROUTER_REVIEW_MODEL
          ]);
          analysis = review;
          analysisModel = OPENROUTER_REVIEW_MODEL;
          finalized = finalizeAnalysis({ analysis, prob, outcomes });
          reviewCount++;
        } catch (reviewError) {
          reviewFallbackCount++;
          console.warn(`${OPENROUTER_REVIEW_MODEL} review failed for ${event.title}, keeping cheap analysis:`, reviewError.message);
        }
      }

      analyzedMarkets.push({
        id: event.id,
        slug: event.slug || "",
        title: event.title,
        category: analysis.category ?? "Other",
        imageUrl: event.image,
        marketProb: prob,
        aiProb: finalized.aiProb,
        edge: finalized.calculatedEdge,
        reasoning: analysis.reasoning ?? "Analysis based on market trends.",
        volume: parseFloat(market.volume || "0"),
        outcomes,
        prediction: finalized.prediction,
        confidence: finalized.confidence,
        kellyPercentage: finalized.kellyPercentage,
        riskFactor: analysis.riskFactor ?? "Market volatility",
        analysisStatus: "fresh",
        analysisModel,
        lastAnalyzedAt: new Date().toISOString(),
        endDate: event.endDate
      });
      successCount++;
    } catch (error) {
      console.error(`Error analyzing ${event.title}:`, error.message);
      // Keep market even without AI analysis (fallback to market odds)
      analyzedMarkets.push({
        id: event.id,
        slug: event.slug || "",
        title: event.title,
        category: "Other",
        imageUrl: event.image,
        marketProb: prob,
        aiProb: prob,
        edge: 0,
        reasoning: "AI unavailable, using market odds.",
        volume: parseFloat(market.volume || "0"),
        outcomes,
        prediction: outcomes[0],
        confidence: 3,
        kellyPercentage: 0,
        riskFactor: "Model throttled/unavailable",
        analysisStatus: "fallback",
        lastAnalyzedAt: new Date().toISOString(),
        endDate: event.endDate,
        fallback: true
      });
      errorCount++;
    }
    // Throttle between calls to reduce 429
    await sleep(PER_CALL_DELAY_MS);
  }

  console.log(`Analysis complete: ${successCount} success, ${errorCount} errors, ${cheapCount} cheap passes, ${reviewCount} Grok reviews, ${reviewFallbackCount} review fallbacks`);
  return analyzedMarkets;
}

/**
 * Save markets to Firestore (daily collection)
 */
async function saveToFirestore(markets) {
  const today = new Date().toISOString().split('T')[0];

  // Save to daily_picks
  const dailyPicksRef = db.collection('daily_picks').doc(today);
  await dailyPicksRef.set({
    date: today,
    markets: markets.map(m => {
      // Remove undefined values
      const cleanMarket = { ...m };
      Object.keys(cleanMarket).forEach(key => {
        if (cleanMarket[key] === undefined) {
          delete cleanMarket[key];
        }
      });
      // Initialize trend change to 0 for daily start
      return { ...cleanMarket, probChange: 0 };
    }),
    updatedAt: new Date().toISOString()
  });

  // Save to prediction_history
  const historyRef = db.collection('prediction_history').doc(today);
  const predictions = markets.map(m => ({
    id: `${today}-${m.id}`,
    date: today,
    marketId: m.id,
    slug: m.slug || '',        // Store slug for Polymarket URL
    title: m.title,
    aiPrediction: m.prediction,
    aiProb: m.aiProb,
    marketProb: m.marketProb,
    edge: m.edge,
    kellyPercentage: m.kellyPercentage || 0,
    reasoning: m.reasoning,
    riskFactor: m.riskFactor,
    confidence: m.confidence,
    outcomes: m.outcomes,
    outcome: 'pending'
  }));

  await historyRef.set({
    date: today,
    predictions,
    stats: {
      totalPredictions: predictions.length,
      avgEdge: predictions.reduce((sum, p) => sum + Math.abs(p.edge), 0) / predictions.length,
      avgKelly: predictions.reduce((sum, p) => sum + p.kellyPercentage, 0) / predictions.length,
    },
    createdAt: new Date().toISOString()
  });

  console.log(`Saved ${markets.length} markets to Firestore for ${today}`);
}

/**
 * Save markets to hourly collection (premium)
 */
async function saveToHourlyFirestore(markets) {
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13).replace('T', '-'); // e.g., "2025-12-04-05"
  const today = now.toISOString().split('T')[0];

  // Fetch daily opening prices to calculate intraday trend
  let startPrices = new Map();
  try {
    const dailyRef = db.collection('daily_picks').doc(today);
    const dailySnap = await dailyRef.get();
    if (dailySnap.exists) {
      const dailyData = dailySnap.data();
      (dailyData.markets || []).forEach(m => {
        startPrices.set(m.id, Number(m.marketProb) || 0);
      });
    }
  } catch (e) {
    console.warn("Could not fetch daily picks for trend calculation:", e);
  }

  const hourlyPicksRef = db.collection('hourly_picks').doc(hourKey);
  await hourlyPicksRef.set({
    timestamp: now.toISOString(),
    hour: hourKey,
    markets: markets.map(m => {
      const cleanMarket = { ...m };
      Object.keys(cleanMarket).forEach(key => {
        if (cleanMarket[key] === undefined) {
          delete cleanMarket[key];
        }
      });

      // Calculate intraday probability change
      const startProb = startPrices.get(m.id);
      // If new market today, probChange is 0 (or undefined)
      if (startProb !== undefined) {
        cleanMarket.probChange = m.marketProb - startProb;
      } else {
        cleanMarket.probChange = 0;
      }

      return cleanMarket;
    }),
    updatedAt: now.toISOString()
  });

  console.log(`Saved ${markets.length} hourly markets to Firestore for ${hourKey}`);

  // === MERGE INTO HISTORY ===
  const historyRef = db.collection('prediction_history').doc(today);

  try {
    const historyDoc = await historyRef.get();
    let existingPredictions = [];
    let existingIds = new Set();

    if (historyDoc.exists) {
      const data = historyDoc.data();
      existingPredictions = data.predictions || [];
      existingPredictions.forEach(p => existingIds.add(p.marketId));
    }

    // Find new markets that are NOT in history
    const newMarkets = markets.filter(m => !existingIds.has(m.id));

    if (newMarkets.length > 0) {
      console.log(`Found ${newMarkets.length} NEW markets in hourly update. Merging to history...`);

      const newPredictions = newMarkets.map(m => ({
        id: `${today}-${m.id}`,
        date: today,
        marketId: m.id,
        slug: m.slug || '',        // Store slug for Polymarket URL
        title: m.title,
        aiPrediction: m.prediction,
        aiProb: m.aiProb,
        marketProb: m.marketProb,
        edge: m.edge,
        kellyPercentage: m.kellyPercentage || 0,
        reasoning: m.reasoning,
        riskFactor: m.riskFactor,
        confidence: m.confidence,
        outcomes: m.outcomes,
        outcome: 'pending',
        source: 'hourly'
      }));

      const updatedPredictions = [...existingPredictions, ...newPredictions];

      // Update stats
      const stats = {
        totalPredictions: updatedPredictions.length,
        avgEdge: updatedPredictions.reduce((sum, p) => sum + Math.abs(p.edge), 0) / updatedPredictions.length,
        avgKelly: updatedPredictions.reduce((sum, p) => sum + p.kellyPercentage, 0) / updatedPredictions.length,
      };

      // Use set with merge: true or update if exists
      await historyRef.set({
        date: today,
        predictions: updatedPredictions,
        stats: stats,
        updatedAt: new Date().toISOString() // Update timestamp
      }, { merge: true });

      console.log(`Merged ${newMarkets.length} new markets into daily history.`);
    }
  } catch (error) {
    console.error("Error merging hourly picks into history:", error);
    // Don't fail the whole function if history merge fails
  }
}

/**
 * Scheduled function - runs daily at 6:00 AM UTC
 */
export const dailyRefresh = onSchedule({
  schedule: '0 6 * * *', // Every day at 6:00 AM UTC
  timeZone: 'UTC',
  secrets: [openrouterApiKey],
  timeoutSeconds: 540, // 9 minutes timeout
  memory: '1GiB'
}, async (event) => {
  console.log('Starting daily market refresh...');

  try {
    const apiKey = openrouterApiKey.value();
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    const markets = await fetchAndAnalyzeMarkets(apiKey);

    if (markets.length > 0) {
      await saveToFirestore(markets);
      console.log('Daily refresh completed successfully!');
    } else {
      console.log('No markets analyzed - skipping save');
    }
  } catch (error) {
    console.error('Daily refresh failed:', error);
    throw error;
  }
});

/**
 * HTTP trigger for manual refresh (for testing)
 * Use ?type=hourly to save to hourly_picks instead of daily_picks
 */
export const manualRefresh = onRequest({
  secrets: [openrouterApiKey],
  timeoutSeconds: 540,
  memory: '1GiB',
  cors: ALLOWED_ORIGINS
}, async (req, res) => {
  // Allow GET and POST for easy testing
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  // Auth simple par en-tête ou query (API_AUTH_TOKEN)
  const apiToken = process.env.API_AUTH_TOKEN || '';
  const providedToken = req.headers['x-api-key'] || req.query.token;
  if (apiToken && providedToken !== apiToken) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const refreshType = req.query.type || 'daily'; // 'daily' or 'hourly'
  console.log(`Starting manual ${refreshType} market refresh...`);

  try {
    const apiKey = openrouterApiKey.value();
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    const markets = await fetchAndAnalyzeMarkets(apiKey);

    if (markets.length > 0) {
      if (refreshType === 'hourly') {
        await saveToHourlyFirestore(markets);
        const hourKey = new Date().toISOString().slice(0, 13).replace('T', '-');
        res.json({
          success: true,
          message: `Refreshed ${markets.length} markets (hourly)`,
          hour: hourKey
        });
      } else {
        await saveToFirestore(markets);
        res.json({
          success: true,
          message: `Refreshed ${markets.length} markets (daily)`,
          date: new Date().toISOString().split('T')[0]
        });
      }
    } else {
      res.json({
        success: false,
        message: 'No markets analyzed'
      });
    }
  } catch (error) {
    console.error('Manual refresh failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Scheduled function - runs every hour (PREMIUM)
 */
export const hourlyRefresh = onSchedule({
  schedule: '0 * * * *', // Every hour at minute 0
  timeZone: 'UTC',
  secrets: [openrouterApiKey],
  timeoutSeconds: 540,
  memory: '1GiB'
}, async (event) => {
  console.log('Starting hourly market refresh (premium)...');

  try {
    // Skip the 06:00 UTC run (1AM ET) because daily refresh runs then.
    const currentUtcHour = new Date().getUTCHours();
    if (currentUtcHour === 6) {
      console.log('Skipping hourly refresh at 06:00 UTC to avoid overlap with daily.');
      return;
    }

    const apiKey = openrouterApiKey.value();
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    const markets = await fetchAndAnalyzeMarkets(apiKey);

    if (markets.length > 0) {
      await saveToHourlyFirestore(markets);
      console.log('Hourly refresh completed successfully!');
    } else {
      console.log('No markets analyzed - skipping save');
    }
  } catch (error) {
    console.error('Hourly refresh failed:', error);
    throw error;
  }
});

/**
 * Resolve pending markets
 * Checks Polymarket API for resolved status and updates history
 */
async function resolvePendingMarkets() {
  const pendingSnapshot = await db.collection('prediction_history')
    .where('predictions', '!=', []) // Simple check to ensure doc has data
    .get();

  let resolvedCount = 0;

  for (const doc of pendingSnapshot.docs) {
    const data = doc.data();
    const predictions = data.predictions || [];
    let hasUpdates = false;

    // Filter pending items, plus already-resolved "Other" picks so older records
    // created before the grouped-market fix can be repaired in place.
    const pendingItems = predictions.filter(p =>
      p.outcome === 'pending' ||
      (p.aiPrediction?.trim().toLowerCase() === 'other' && p.resolvedOutcome)
    );

    if (pendingItems.length === 0) continue;

    console.log(`Checking ${pendingItems.length} pending markets for date ${data.date}...`);

    // Batch fetch resolved status from Polymarket (or one by one for simplicity first)
    // Polymarket API: /events?id=...
    for (const item of pendingItems) {
      try {
        // Polymarket Gamma API to get market details
        // We need to find the market by ID. 
        // Note: item.marketId is the Event ID in our current logic (from fetchAndAnalyzeMarkets)
        // But we need to check specific Market status.

        // Ideally, we should query: https://gamma-api.polymarket.com/events?id={item.marketId}
        const response = await fetch(`https://gamma-api.polymarket.com/events?id=${item.marketId}`);
        if (!response.ok) continue;

        const eventData = await response.json();
        // API returns array, take first if matches
        const event = Array.isArray(eventData) ? eventData[0] : eventData;

        if (!event || !event.markets || !event.markets[0]) continue;

        const market = event.markets[0]; // Assuming we tracked the main market

        // Check if resolved
        // Polymarket markets have 'closed' boolean and 'ready' boolean.
        // We look for resolved outcome.
        // BUT: The API response format for resolved markets needs parsing.
        // Often we look at 'question' or 'market' fields. 
        // A simpler way for Gamma API: check if closed=true and volume is finalized.

        if (event.closed) {
          // Market is closed. Who won?
          // We need to parse outcomePrices or a specific "winner" field if available.
          // Gamma API doesn't always make "winner" explicit in the event object easily.
          // We often infer it from prices: the one at "1" (or close to 1) is the winner.

          const prices = JSON.parse(market.outcomePrices);
          const outcomes = JSON.parse(market.outcomes);

          // Find index with price > 0.99 (Winner)
          // Note: Prices are strings "0.05", "0.95"
          const winnerIndex = prices.findIndex(p => parseFloat(p) > 0.99);

          if (winnerIndex !== -1) {
            const winningOutcome = outcomes[winnerIndex];

            // Normalize strings for comparison. For grouped markets we store outcomes as
            // [specific selection, "Other"], while Polymarket may resolve to "No" or a
            // concrete alternate winner. In that case "Other" wins whenever outcome[0]
            // did not win.
            const cleanPrediction = item.aiPrediction?.trim().toLowerCase();
            const cleanWinner = winningOutcome?.trim().toLowerCase();
            const cleanOutcomeA = outcomes[0]?.trim().toLowerCase();
            const isWin = cleanPrediction === 'other'
              ? cleanWinner !== cleanOutcomeA
              : cleanPrediction === cleanWinner;

            const previousOutcome = item.outcome;
            const previousResolvedOutcome = item.resolvedOutcome;

            // Update Item
            item.outcome = isWin ? 'win' : 'loss';
            item.resolvedAt = new Date().toISOString();
            item.resolvedOutcome = winningOutcome;

            // Calculate PnL if win
            // ROI = (1 / BetProb) - 1 for Win, -1 for Loss
            // BetProb = probability of the PREDICTED outcome at entry time
            // If prediction matches outcomes[0], betProb = marketProb
            // If prediction matches outcomes[1], betProb = 1 - marketProb

            let betProb = item.marketProb;
            // Check if prediction was for second outcome
            if (outcomes.length >= 2) {
              const cleanOutcomeA = outcomes[0]?.trim().toLowerCase();
              if (cleanPrediction !== cleanOutcomeA) {
                betProb = 1 - item.marketProb;
              }
            }

            if (item.outcome === 'win') {
              // Avoid division by zero
              const entryProb = Math.max(0.01, betProb);
              item.roi = (1 / entryProb) - 1;
            } else {
              item.roi = -1.0;
            }

            if (
              previousOutcome !== item.outcome ||
              previousResolvedOutcome !== item.resolvedOutcome ||
              previousOutcome === 'pending'
            ) {
              hasUpdates = true;
              resolvedCount++;
              console.log(`Resolved ${item.title}: ${item.outcome} (Winner: ${winningOutcome})`);
            }
          }
        }
      } catch (err) {
        console.error(`Error checking market ${item.marketId}:`, err.message);
      }
    }

    if (hasUpdates) {
      // Recalculate Daily Stats
      const resolvedPreds = predictions.filter(p => p.outcome !== 'pending');
      const wins = resolvedPreds.filter(p => p.outcome === 'win').length;
      const total = resolvedPreds.length;
      const accuracy = total > 0 ? (wins / total) : 0;

      const totalRoi = resolvedPreds.reduce((sum, p) => sum + (p.roi || 0), 0);
      const avgRoi = total > 0 ? (totalRoi / total) : 0;

      // Brier Score = (predicted outcome probability - actual outcome)^2.
      // aiProb is stored for outcomes[0], so invert it when the pick was outcomes[1]/Other.
      const brierSum = resolvedPreds.reduce((sum, p) => {
        const storedOutcomes = Array.isArray(p.outcomes) && p.outcomes.length >= 2 ? p.outcomes : ['Yes', 'No'];
        const cleanPrediction = p.aiPrediction?.trim().toLowerCase();
        const cleanOutcomeA = storedOutcomes[0]?.trim().toLowerCase();
        const predictedProb = cleanPrediction === cleanOutcomeA ? p.aiProb : 1 - p.aiProb;
        const outcomeVal = p.outcome === 'win' ? 1 : 0;
        return sum + Math.pow(predictedProb - outcomeVal, 2);
      }, 0);
      const brierScore = total > 0 ? (brierSum / total) : 0;

      await db.collection('prediction_history').doc(data.date).update({
        predictions: predictions,
        stats: {
          ...data.stats,
          resolvedCount: total,
          accuracy: accuracy,
          avgRoi: avgRoi,
          brierScore: brierScore,
          updatedAt: new Date().toISOString()
        }
      });
    }
  }

  return resolvedCount;
}

/**
 * Scheduled function - Check resolutions daily at 1:00 AM UTC
 */
export const checkResolutions = onSchedule({
  schedule: '0 1 * * *', // Daily at 1 AM UTC
  timeZone: 'UTC',
  timeoutSeconds: 540,
  memory: '512MiB'
}, async (event) => {
  console.log("Starting resolution check...");
  const count = await resolvePendingMarkets();
  console.log(`Resolution check complete. Resolved ${count} markets.`);
});

/**
 * HTTP Trigger for manual resolution check
 */
export const manualResolution = onRequest({
  cors: ALLOWED_ORIGINS,
  invoker: 'public'
}, async (req, res) => {
  try {
    const count = await resolvePendingMarkets();
    res.json({ success: true, resolved: count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});
