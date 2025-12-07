import { db } from './firebase';
import { collection, getDocs, query, orderBy, limit, doc, setDoc } from 'firebase/firestore';
import { MarketAnalysis, ResolvedPrediction, BacktestStats } from '../types';
import { getResolvedMarkets } from './polymarketService';

export interface PredictionRecord {
  id: string;
  date: string;
  marketId: string;
  slug?: string;          // Added for Polymarket URL
  title: string;
  aiPrediction: string;
  aiProb: number;
  marketProb: number;
  edge: number;
  kellyPercentage: number;
  reasoning?: string;
  riskFactor?: string;
  confidence?: number;
  outcomes?: string[];
  outcome?: 'pending' | 'correct' | 'incorrect' | 'win' | 'loss';
  resolvedAt?: string;
  resolvedOutcome?: string;
  roi?: number;
}

export interface DailyStats {
  date: string;
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  avgEdge: number;
  avgKelly: number;
}

/**
 * Save today's predictions to history
 */
export const savePredictionsToHistory = async (markets: MarketAnalysis[]): Promise<void> => {
  if (!db) return;

  const today = new Date().toISOString().split('T')[0];
  const historyRef = doc(db, 'prediction_history', today);

  // Store RAW values (for outcomes[0]) - the modal will handle adjustments
  const records: PredictionRecord[] = markets.map(m => ({
    id: `${today}-${m.id}`,
    date: today,
    marketId: m.id,
    slug: m.slug,               // Store slug for Polymarket URL
    title: m.title,
    aiPrediction: m.prediction,
    aiProb: m.aiProb,           // Raw: probability for outcomes[0]
    marketProb: m.marketProb,   // Raw: probability for outcomes[0]
    edge: m.edge,               // Raw edge (will be recalculated by modal)
    kellyPercentage: m.kellyPercentage || 0,
    reasoning: m.reasoning,
    riskFactor: m.riskFactor,
    confidence: m.confidence,
    outcomes: m.outcomes,
    outcome: 'pending' as const
  }));

  await setDoc(historyRef, {
    date: today,
    predictions: records,
    stats: {
      totalPredictions: records.length,
      avgEdge: records.reduce((sum, r) => sum + Math.abs(r.edge), 0) / records.length,
      avgKelly: records.reduce((sum, r) => sum + r.kellyPercentage, 0) / records.length,
    },
    createdAt: new Date().toISOString()
  });
};

/**
 * Get prediction history for the last N days
 */
export const getPredictionHistory = async (days: number = 7): Promise<{ date: string; predictions: PredictionRecord[]; stats: any }[]> => {
  if (!db) return [];

  try {
    const historyRef = collection(db, 'prediction_history');
    const q = query(historyRef, orderBy('date', 'desc'), limit(days));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => doc.data() as { date: string; predictions: PredictionRecord[]; stats: any });
  } catch (error) {
    console.error('Error fetching prediction history:', error);
    return [];
  }
};

/**
 * Calculate overall stats from history
 */
export const calculateOverallStats = (history: { date: string; predictions: PredictionRecord[]; stats: any }[]): {
  totalDays: number;
  totalPredictions: number;
  avgEdge: number;
  avgKelly: number;
  predictionsByCategory: Record<string, number>;
} => {
  if (history.length === 0) {
    return {
      totalDays: 0,
      totalPredictions: 0,
      avgEdge: 0,
      avgKelly: 0,
      predictionsByCategory: {}
    };
  }

  const allPredictions = history.flatMap(h => h.predictions);
  const totalPredictions = allPredictions.length;

  return {
    totalDays: history.length,
    totalPredictions,
    avgEdge: allPredictions.reduce((sum, p) => sum + Math.abs(p.edge), 0) / totalPredictions * 100,
    avgKelly: allPredictions.reduce((sum, p) => sum + p.kellyPercentage, 0) / totalPredictions,
    predictionsByCategory: {}
  };
};

/**
 * Fetch historical predictions that have been resolved.
 * Now uses the resolved data directly from Firestore (populated by Cloud Functions).
 */
export const getResolvedPredictions = async (limitCount = 100): Promise<{ predictions: ResolvedPrediction[], stats: BacktestStats } | null> => {
  if (!db) return null;
  
  try {
    // 1. Get historical predictions (last 30 days)
    const historyRef = collection(db, 'prediction_history');
    const q = query(historyRef, orderBy('date', 'desc'), limit(30)); 
    const snapshot = await getDocs(q);
    
    let allPredictions: PredictionRecord[] = [];
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      allPredictions = allPredictions.concat(data.predictions || []);
    });
    
    if (allPredictions.length === 0) return null;
    
    // 2. Filter for RESOLVED predictions (outcome is 'win' or 'loss')
    const resolvedPredictions: ResolvedPrediction[] = allPredictions
      .filter(p => p.outcome === 'win' || p.outcome === 'loss')
      .map(p => {
        const wasCorrect = p.outcome === 'win';
        const actualProb = p.outcome === 'win' ? 1 : 0; // Simple approximation
        
        // Brier Score calculation
        // If win: (Prob - 1)^2
        // If loss: (Prob - 0)^2
        const brierError = Math.pow(p.aiProb - actualProb, 2);
        
        // Calculate Kelly Return (Weighted by Kelly %)
        // item.roi from backend is the Unit ROI (e.g., 1.0 for doubling money, -1.0 for loss)
        // Kelly Return = Unit ROI * (Kelly% / 100)
        const unitRoi = (p as any).roi !== undefined ? (p as any).roi : 0;
        const kellyReturn = unitRoi * (p.kellyPercentage / 100);
        
        return {
          ...p,
          id: p.id, 
          slug: "", 
          title: p.title,
          category: "Other", 
          imageUrl: "", 
          marketProb: p.marketProb,
          aiProb: p.aiProb,
          edge: p.edge,
          reasoning: p.reasoning || "Analysis details not archived for this prediction.", 
          volume: 0, 
          outcomes: p.outcomes || ["Yes", "No"], 
          prediction: p.aiPrediction,
          confidence: p.confidence || 0, 
          kellyPercentage: p.kellyPercentage,
          riskFactor: p.riskFactor || "Risk factor not archived.", 
          resolvedOutcome: (p.resolvedOutcome || (wasCorrect ? p.aiPrediction : 'Other')) as 'Yes' | 'No',
          wasCorrect,
          brierError,
          kellyReturn
        };
      });
    
    if (resolvedPredictions.length === 0) return null;

    // 3. Calculate stats
    const stats: BacktestStats = calculateBacktestStats(resolvedPredictions);
    
    return { predictions: resolvedPredictions, stats };
    
  } catch (error) {
    console.error('Error fetching resolved predictions:', error);
    return null;
  }
};

/**
 * Calculate backtesting stats from resolved predictions.
 */
export const calculateBacktestStats = (resolved: ResolvedPrediction[]): BacktestStats => {
  if (resolved.length === 0) {
    return {
      total: 0,
      accuracy: 0,
      brierScore: 0,
      avgBrier: 0,
      kellyROI: 0,
      winRate: 0,
      overTime: []
    };
  }
  
  const total = resolved.length;
  const correct = resolved.filter(p => p.wasCorrect).length;
  const accuracy = (correct / total) * 100;
  const brierScore = resolved.reduce((sum, p) => sum + p.brierError, 0);
  const avgBrier = brierScore / total;
  const kellyROI = resolved.reduce((sum, p) => sum + p.kellyReturn, 0);
  const winRate = (resolved.filter(p => p.kellyReturn > 0).length / total) * 100;
  
  // Over time (group by date)
  const overTime = Array.from(
    resolved.reduce((acc, p) => {
      // Assuming p.date exists on ResolvedPrediction (via PredictionRecord)
      // Use a default date if missing to be safe
      const date = (p as any).date || new Date().toISOString().split('T')[0];
      acc.set(date, (acc.get(date) || 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
  
  return {
    total,
    accuracy,
    brierScore,
    avgBrier,
    kellyROI,
    winRate,
    overTime
  };
};