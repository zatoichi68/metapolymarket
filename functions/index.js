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
async function sendEmail(to, subject, html, user, pass) {
  if (user && pass) {
    // Use a validated Brevo sender if provided, fallback to auth user
    const fromAddress = process.env.SMTP_FROM || user;
    const fromName = process.env.SMTP_FROM_NAME || 'MetaPolymarket';

    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      replyTo: fromAddress,
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

/**
 * Cloud Function: Send Premium Verification Code
 * Expects body: { email: string }
 */
export const sendPremiumVerificationCode = onRequest({
  cors: ALLOWED_ORIGINS,
  invoker: 'public',
  secrets: [smtpUser, smtpPass]
}, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const { email } = req.body;
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
    const code = generateCode();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    await db.collection('premium_verifications').doc(email).set({
      code,
      expiresAt,
      createdAt: new Date().toISOString()
    });

    // 3. Send Email (pass secrets as parameters)
    const user = smtpUser.value();
    const pass = smtpPass.value();
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
      pass
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

  const { email, code } = req.body;

  try {
    // 1. Get stored code
    const docRef = db.collection('premium_verifications').doc(email);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(400).json({ success: false, error: 'No verification code found for this email' });
      return;
    }

    const data = doc.data();

    // 2. Validate
    if (Date.now() > data.expiresAt) {
      res.status(400).json({ success: false, error: 'Code expired. Please request a new one.' });
      return;
    }

    if (data.code !== code) {
      res.status(400).json({ success: false, error: 'Invalid code' });
      return;
    }

    // 3. Mark user as verified in persistent collection
    await db.collection('premium_users').doc(email).set({
      email,
      verified: true,
      joinedAt: new Date().toISOString(),
      plan: 'free_trial' // "Free for a limited time" logic
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

  const { email } = req.body;
  
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
async function analyzeMarket(title, outcomes, marketProb, volume, apiKey) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const outcomeA = outcomes[0];
  const outcomeB = outcomes[1] || "Other";
  const currentOdds = `${outcomeA}: ${Math.round(marketProb * 100)}%, ${outcomeB}: ${Math.round((1 - marketProb) * 100)}%`;

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
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'x-ai/grok-4.1-fast',
      messages: [{ role: 'user', content: prompt }],
      reasoning: { enabled: true }
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

  // Clean potential markdown code blocks
  const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleanText);
}

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

  // Process in parallel batches of 10
  const BATCH_SIZE = 10;
  const analyzedMarkets = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < marketsToAnalyze.length; i += BATCH_SIZE) {
    const batch = marketsToAnalyze.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(marketsToAnalyze.length / BATCH_SIZE)} (${batch.length} markets)`);

    const batchPromises = batch.map(async ({ event, market, prob, outcomes }) => {
      try {
        const analysis = await analyzeMarket(
          event.title,
          outcomes,
          prob,
          parseFloat(market.volume || "0"),
          apiKey
        );

        const aiProb = analysis.aiProbability ?? prob;
        const prediction = analysis.prediction ?? outcomes[0];
        
        // Calculate edge correctly based on which outcome is predicted
        // aiProb is ALWAYS for outcomes[0] (first outcome)
        // If predicting outcomes[0]: edge = aiProb - prob
        // If predicting outcomes[1]: edge = (1 - aiProb) - (1 - prob) = prob - aiProb
        let calculatedEdge = 0;
        if (prediction === outcomes[0]) {
          calculatedEdge = aiProb - prob;
        } else {
          // For second outcome, both AI and market probs need to be inverted
          calculatedEdge = (1 - aiProb) - (1 - prob);
        }

        return {
          success: true,
          data: {
            id: event.id,
            slug: event.slug || "",
            title: event.title,
            category: analysis.category ?? "Other",
            imageUrl: event.image,
            marketProb: prob,
            aiProb,
            edge: calculatedEdge,
            reasoning: analysis.reasoning ?? "Analysis based on market trends.",
            volume: parseFloat(market.volume || "0"),
            outcomes,
            prediction,
            confidence: analysis.confidence ?? 5,
            kellyPercentage: analysis.kellyPercentage ?? 0,
            riskFactor: analysis.riskFactor ?? "Market volatility",
            endDate: event.endDate
          }
        };
      } catch (error) {
        console.error(`Error analyzing ${event.title}:`, error.message);
        return { success: false, title: event.title };
      }
    });

    const results = await Promise.all(batchPromises);
    
    for (const result of results) {
      if (result.success) {
        analyzedMarkets.push(result.data);
        successCount++;
      } else {
        errorCount++;
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < marketsToAnalyze.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`Analysis complete: ${successCount} success, ${errorCount} errors`);
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
      return cleanMarket;
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
      return cleanMarket;
    }),
    updatedAt: now.toISOString()
  });

  console.log(`Saved ${markets.length} hourly markets to Firestore for ${hourKey}`);

  // === MERGE INTO HISTORY ===
  // Also add NEW unique markets to the daily prediction_history to ensure they are tracked for backtesting
  const today = now.toISOString().split('T')[0];
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

    // Filter only pending items to avoid re-checking everything
    const pendingItems = predictions.filter(p => p.outcome === 'pending');
    
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
                    
                    // Normalize strings for comparison
                    const cleanPrediction = item.aiPrediction?.trim().toLowerCase();
                    const cleanWinner = winningOutcome?.trim().toLowerCase();

                    // Update Item
                    const isWin = cleanPrediction === cleanWinner;
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
                    
                    hasUpdates = true;
                    resolvedCount++;
                    console.log(`Resolved ${item.title}: ${item.outcome} (Winner: ${winningOutcome})`);
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

        // Brier Score = (Prob - Outcome)^2
        // Win=1, Loss=0.
        // If Win: (AI_Prob - 1)^2
        // If Loss: (AI_Prob - 0)^2
        const brierSum = resolvedPreds.reduce((sum, p) => {
            const outcomeVal = p.outcome === 'win' ? 1 : 0;
            return sum + Math.pow(p.aiProb - outcomeVal, 2);
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
