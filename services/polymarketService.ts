import { PolymarketEvent, MarketAnalysis } from '../types';
import { analyzeMarket } from './aiService';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Note: Gamma API (Public Data) does not generally require an API Key.
// Providing a key (e.g. via headers) can sometimes help with rate limits, 
// but often causes CORS issues when using proxies. 
// We proceed without the key for maximum compatibility with the public endpoint.
const BASE_API_URL = 'https://gamma-api.polymarket.com/events?limit=50&active=true&closed=false&order=volume24hr&ascending=false';
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

    // Analyze in parallel
    const analyzedMarkets = await Promise.all(
        preparedData.map(async (item) => {
            if (!item) return null;
            const { event, market, prob, outcomes } = item;
            
            try {
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
            } catch (error) {
                console.error(`Analysis failed for ${event.title}:`, error);
                throw error; // Propagate error - no fallback
            }
        })
    );

    return analyzedMarkets.filter((item): item is MarketAnalysis => item !== null);

  } catch (error) {
    console.error("Failed to fetch Polymarket data.", error);
    throw error;
  }
};

/**
 * Main entry point.
 * Checks Firestore for today's cache. If missing, runs fresh analysis and saves it.
 */
export const getDailyMarkets = async (): Promise<MarketAnalysis[]> => {
    // 1. If Firebase is not configured, fallback to live fetch immediately.
    if (!db) {
        return fetchAndAnalyzeFreshMarkets();
    }

    try {
        // 2. Generate a date key (e.g., "2023-10-27")
        const todayKey = new Date().toISOString().split('T')[0];
        const docRef = doc(db, "daily_picks", todayKey);
        
        // 3. Check Cache
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            console.log(`Loading cached data for ${todayKey}`);
            return docSnap.data().markets as MarketAnalysis[];
        }

        // 4. Cache Miss: Fetch & Analyze
        console.log(`No cache for ${todayKey}. Fetching fresh data...`);
        const freshData = await fetchAndAnalyzeFreshMarkets();

        // 5. Save to Cache (if we got data)
        if (freshData.length > 0) {
            // Firestore does not accept 'undefined' values.
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

            await setDoc(docRef, {
                date: todayKey,
                markets: sanitizedData,
                updatedAt: new Date().toISOString()
            });
            console.log(`Saved fresh data to ${todayKey}`);
        }

        return freshData;

    } catch (error) {
        console.error("Error interacting with Firebase, falling back to live data:", error);
        // Fallback ensures app doesn't crash if Firebase quota exceeded or network error
        return fetchAndAnalyzeFreshMarkets();
    }
};