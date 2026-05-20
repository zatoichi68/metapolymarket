import { PicksResponse, PolymarketEvent, ResolvedMarket } from '../types';

const fetchJson = async <T>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
};

const emptyPicks = (source: 'daily' | 'hourly', message: string): PicksResponse => ({
    source,
    timestamp: null,
    stale: true,
    markets: [],
    message
});

/**
 * Reads the canonical dashboard picks from the backend cache endpoint.
 * The browser should not trigger fresh AI analysis or write cache documents.
 */
export const getLatestPicks = async (source: 'daily' | 'hourly' | 'auto' = 'auto'): Promise<PicksResponse> => {
    const data = await fetchJson<PicksResponse>(`/api/picks/latest?source=${source}`);
    return {
        ...data,
        source: data.source || (source === 'hourly' ? 'hourly' : 'daily'),
        markets: Array.isArray(data.markets) ? data.markets : [],
        stale: Boolean(data.stale)
    };
};

export const getDailyMarkets = async (): Promise<PicksResponse | null> => {
    try {
        return await getLatestPicks('daily');
    } catch (error) {
        console.error('Error fetching daily picks:', error);
        return emptyPicks('daily', 'Daily market data is currently unavailable.');
    }
};

export const getHourlyMarkets = async (): Promise<PicksResponse | null> => {
    try {
        return await getLatestPicks('hourly');
    } catch (error) {
        console.error('Error fetching hourly picks:', error);
        return emptyPicks('hourly', 'Hourly market data is currently unavailable.');
    }
};

/**
 * Get resolved markets from Polymarket API (closed markets).
 * Uses the backend proxy so the app does not depend on a third-party CORS proxy.
 */
export const getResolvedMarkets = async (limitCount = 100): Promise<ResolvedMarket[]> => {
    try {
        const data = await fetchJson<PolymarketEvent[]>(
            `/api/polymarket/events?limit=${limitCount}&closed=true&active=false`
        );

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

                const winnerIndex = prices.findIndex((p: string | number) => parseFloat(String(p)) > 0.99);
                if (winnerIndex === -1) return null;

                return {
                    id: event.id,
                    title: event.title,
                    resolvedOutcome: outcomes[winnerIndex]
                };
            } catch {
                return null;
            }
        }).filter((item): item is ResolvedMarket => item !== null);
    } catch (error) {
        console.error('Error fetching resolved markets:', error);
        return [];
    }
};
