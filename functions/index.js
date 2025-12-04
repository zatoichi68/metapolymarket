import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

// Define the OpenRouter API key secret
const openrouterApiKey = defineSecret('OPENROUTER_API_KEY');

const POLYMARKET_API_URL = 'https://gamma-api.polymarket.com/events?limit=100&active=true&closed=false&order=volume24hr&ascending=false';

/**
 * Analyze a market using OpenRouter Grok
 */
async function analyzeMarket(title, outcomes, marketProb, volume, apiKey) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const outcomeA = outcomes[0];
  const outcomeB = outcomes[1] || "Other";
  const currentOdds = `${outcomeA}: ${Math.round(marketProb * 100)}%, ${outcomeB}: ${Math.round((1 - marketProb) * 100)}%`;

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
- riskFactor: string (main risk factor that could invalidate the prediction)

Respond ONLY with valid JSON, no markdown.`;

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
      if (market.outcomes) {
        const parsedOutcomes = typeof market.outcomes === 'string'
          ? JSON.parse(market.outcomes)
          : market.outcomes;
        if (Array.isArray(parsedOutcomes) && parsedOutcomes.length >= 2) {
          outcomes = parsedOutcomes;
        }
      }

      if (market.groupItemTitle && outcomes[0] === "Yes") {
        outcomes = [market.groupItemTitle, "Other"];
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
            edge: aiProb - prob,
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
    title: m.title,
    aiPrediction: m.prediction,
    aiProb: m.aiProb,
    marketProb: m.marketProb,
    edge: m.edge,
    kellyPercentage: m.kellyPercentage || 0,
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
 */
export const manualRefresh = onRequest({
  secrets: [openrouterApiKey],
  timeoutSeconds: 540,
  memory: '1GiB',
  cors: true
}, async (req, res) => {
  // Allow GET and POST for easy testing
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  console.log('Starting manual market refresh...');
  
  try {
    const apiKey = openrouterApiKey.value();
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    const markets = await fetchAndAnalyzeMarkets(apiKey);
    
    if (markets.length > 0) {
      await saveToFirestore(markets);
      res.json({ 
        success: true, 
        message: `Refreshed ${markets.length} markets`,
        date: new Date().toISOString().split('T')[0]
      });
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

