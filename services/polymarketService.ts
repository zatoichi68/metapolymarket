import { PolymarketEvent, MarketAnalysis } from '../types';
import { analyzeMarket } from './aiService';
import { db } from './firebase';
import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

// Note: Gamma API (Public Data) does not generally require an API Key.
// Providing a key (e.g. via headers) can sometimes help with rate limits, 
// but often causes CORS issues when using proxies. 
// We proceed without the key for maximum compatibility with the public endpoint.
const BASE_API_URL = 'https://gamma-api.polymarket.com/events?limit=100&active=true&closed=false&order=volume24hr&ascending=false';
const PROXY_URL = 'https://corsproxy.io/?';
const API_URL = `${PROXY_URL}${encodeURIComponent(BASE_API_URL)}`;

/**
 * Fetches fresh data from Polymarket and runs AI analysis.
 * (This is the expensive operation we want to minimize)
 */
const fetchAndAnalyzeFreshMarkets = async (): Promise<MarketAnalysis[]> => {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`Network response was not ok`);
    }
    const data: PolymarketEvent[] = await response.json();

    if (!Array.isArray(data)) {
        throw new Error('API response is not an array');
    }

    // Process data preparation first
    const preparedData = data.map((event) => {
        const market = event.markets?.[0];
        if (!market || !market.outcomePrices) return null;

        let prob = 0.5;
        let outcomes = ["Yes", "No"]; // Default

        try {
           const prices = typeof market.outcomePrices === 'string' 
             ? JSON.parse(market.outcomePrices) 
             : market.outcomePrices;
             
           prob = parseFloat(prices[0]);
           
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

        } catch (e) {
           return null;
        }

        if (isNaN(prob)) return null;

        return { event, market, prob, outcomes };
    }).filter(item => item !== null && item.prob > 0.01 && item.prob < 0.99);

    // Analyze in parallel - continue even if some fail
    const results = await Promise.allSettled(
        preparedData.map(async (item) => {
            if (!item) return null;
            const { event, market, prob, outcomes } = item;
            
            return await analyzeMarket(
                event.id,
                event.slug || "",
                event.title,
                prob,
                parseFloat(market.volume || "0"),
                event.image,
                outcomes,
                event.endDate
            );
        })
    );

    // Extract successful results, log failures
    const analyzedMarkets = results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            const item = preparedData[index];
            console.warn(`Analysis failed for ${item?.event.title}:`, result.reason);
            return null;
        }
    });

    return analyzedMarkets.filter((item): item is MarketAnalysis => item !== null);

  } catch (error) {
    console.error("Failed to fetch Polymarket data.", error);
    throw error;
  }
};

/**
 * Main entry point.
 * Checks Firestore for the most recent daily cache. If none, runs fresh analysis and saves it.
 */
export const getDailyMarkets = async (): Promise<{ markets: MarketAnalysis[], timestamp: string } | null> => {
    // 1. If Firebase is not configured, fallback to live fetch immediately.
    if (!db) {
        const freshData = await fetchAndAnalyzeFreshMarkets();
        return freshData.length > 0 ? { markets: freshData, timestamp: new Date().toISOString() } : null;
    }

    try {
        // 2. Query the most recent daily_picks document
        const dailyRef = collection(db, "daily_picks");
        const q = query(dailyRef, orderBy("date", "desc"), limit(1));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const latestDoc = querySnapshot.docs[0];
            const data = latestDoc.data();
            console.log(`Loading most recent cached data for ${data.date}`);
            return { markets: data.markets as MarketAnalysis[], timestamp: data.timestamp };
        }

        // 3. No recent cache: Fetch & Analyze fresh
        console.log(`No recent daily cache found. Fetching fresh data...`);
        const freshData = await fetchAndAnalyzeFreshMarkets();

        // 4. Save to Cache for today (if we got data)
        if (freshData.length > 0) {
            // Firestore does not accept 'undefined' values.
            const todayKey = new Date().toISOString().split('T')[0];
            const sanitizedData = freshData.map(item => {
                const cleanItem = { ...item };
                // Remove undefined keys
                Object.keys(cleanItem).forEach(key => {
                    if (cleanItem[key as keyof MarketAnalysis] === undefined) {
                        delete cleanItem[key as keyof MarketAnalysis];
                    }
                });
                return cleanItem;
            });

            const docRef = doc(db, "daily_picks", todayKey);
            const now = new Date().toISOString();
            await setDoc(docRef, {
                date: todayKey,
                markets: sanitizedData,
                updatedAt: now,
                timestamp: now
            });
            console.log(`Saved fresh data to ${todayKey}`);
            return { markets: freshData, timestamp: now };
        }

        return null;

    } catch (error) {
        console.error("Error interacting with Firebase, falling back to live data:", error);
        // Fallback ensures app doesn't crash if Firebase quota exceeded or network error
        const freshData = await fetchAndAnalyzeFreshMarkets();
        return freshData.length > 0 ? { markets: freshData, timestamp: new Date().toISOString() } : null;
    }
};

/**
 * Get the latest hourly markets (Premium feature)
 * Returns the most recent hourly analysis from Firestore
 */
export const getHourlyMarkets = async (): Promise<{ markets: MarketAnalysis[], timestamp: string } | null> => {
    if (!db) {
        console.log("Firebase not configured, hourly markets unavailable");
        return null;
    }

    try {
        // Get the most recent hourly_picks document
        const hourlyRef = collection(db, "hourly_picks");
        const q = query(hourlyRef, orderBy("timestamp", "desc"), limit(1));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.log("No hourly data available yet");
            return null;
        }

        const latestDoc = querySnapshot.docs[0];
        const data = latestDoc.data();
        
        return {
            markets: data.markets as MarketAnalysis[],
            timestamp: data.timestamp
        };
    } catch (error) {
        console.error("Error fetching hourly markets:", error);
        return null;
    }
};