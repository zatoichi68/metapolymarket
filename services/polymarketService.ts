import { PolymarketEvent, MarketAnalysis, ResolvedMarket } from '../types';
import { analyzeMarket } from './aiService';
import { db } from './firebase';
import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

// Note: Gamma API (Public Data) does not generally require an API Key.
// Providing a key (e.g. via headers) can sometimes help with rate limits, 
// but often causes CORS issues when using proxies. 
// We proceed without the key for maximum compatibility with the public endpoint.
const BASE_API_URL = 'https://gamma-api.polymarket.com/events?limit=200&active=true&closed=false&order=volume24hr&ascending=false';
const PROXY_URL = 'https://corsproxy.io/?';
const API_URL = `${PROXY_URL}${encodeURIComponent(BASE_API_URL)}`;

// In-memory cache (client-side) to throttle Polymarket fetch + AI analyses
const MARKET_CACHE_TTL_MS = 30_000; // 30s
let marketCache: { data: MarketAnalysis[]; fetchedAt: number } | null = null;

/**
 * Fetches fresh data from Polymarket and runs AI analysis.
 * (This is the expensive operation we want to minimize)
 */
const fetchAndAnalyzeFreshMarkets = async (): Promise<MarketAnalysis[]> => {
  if (marketCache && Date.now() - marketCache.fetchedAt < MARKET_CACHE_TTL_MS) {
    return marketCache.data;
  }
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

    const filtered = analyzedMarkets.filter((item): item is MarketAnalysis => item !== null);
    marketCache = { data: filtered, fetchedAt: Date.now() };
    return filtered;

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
        // 2. Query for TODAY's cache specifically (using UTC Date to match Cloud Function)
        const todayKey = new Date().toISOString().split('T')[0];
        const docRef = doc(db, "daily_picks", todayKey);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            // Validate data integrity
            if (Array.isArray(data.markets) && data.markets.length > 0) {
                const timestamp = data.timestamp || data.updatedAt || new Date().toISOString();
                console.log(`Loading cached data for today: ${data.date} (timestamp: ${timestamp})`);
                const markets = data.markets as MarketAnalysis[];
                return { markets, timestamp };
            }
        }

        // 3. No cache for today: Fetch & Analyze fresh
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
            return { markets: sanitizedData, timestamp: now };
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

/**
 * Get resolved markets from Polymarket API (closed markets)
 * Used for backtesting purposes.
 */
export const getResolvedMarkets = async (limitCount = 100): Promise<ResolvedMarket[]> => {
    try {
        const url = `${PROXY_URL}${encodeURIComponent(`https://gamma-api.polymarket.com/events?limit=${limitCount}&closed=true&order=volume&ascending=false`)}`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        
        if (!Array.isArray(data)) return [];

        return data.map((event: any) => {
             const market = event.markets?.[0];
             if (!market || !market.outcomePrices || !market.outcomes) return null;

             try {
                 const prices = typeof market.outcomePrices === 'string' 
                    ? JSON.parse(market.outcomePrices)
                    : market.outcomePrices;
                    
                 const outcomes = typeof market.outcomes === 'string'
                    ? JSON.parse(market.outcomes)
                    : market.outcomes;
                 
                 // Find winning index (price > 0.95)
                 // Note: Polymarket outcomePrices are strings, need to parse floats
                 const winningIndex = prices.findIndex((p: string | number) => parseFloat(String(p)) > 0.95);
                 
                 if (winningIndex === -1) return null; // Not clearly resolved yet

                 const resolvedOutcome = outcomes[winningIndex];
                 
                 return {
                     id: event.id,
                     title: event.title,
                     resolvedOutcome
                 };
             } catch (e) {
                 return null;
             }
        }).filter((m: any): m is ResolvedMarket => m !== null);
    } catch (e) {
        console.error("Error fetching resolved markets:", e);
        return [];
    }
};