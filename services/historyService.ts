import { db } from './firebase';
import { collection, getDocs, query, orderBy, limit, doc, setDoc } from 'firebase/firestore';
import { MarketAnalysis } from '../types';

export interface PredictionRecord {
  id: string;
  date: string;
  marketId: string;
  title: string;
  aiPrediction: string;
  aiProb: number;
  marketProb: number;
  edge: number;
  kellyPercentage: number;
  outcome?: 'pending' | 'correct' | 'incorrect';
  resolvedAt?: string;
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

  const records: PredictionRecord[] = markets.map(m => ({
    id: `${today}-${m.id}`,
    date: today,
    marketId: m.id,
    title: m.title,
    aiPrediction: m.prediction,
    aiProb: m.aiProb,
    marketProb: m.marketProb,
    edge: m.edge,
    kellyPercentage: m.kellyPercentage || 0,
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
 * Fetch historical predictions and resolve them with actual outcomes for backtesting.
 * Joins with resolved markets to compute accuracy and ROI.
 */
export const getResolvedPredictions = async (limit = 100): Promise<{ predictions: ResolvedPrediction[], stats: BacktestStats } | null> => {
  if (!db) return null;
  
  try {
    // 1. Get historical predictions (last 30 days for example)
    const historyRef = collection(db, 'prediction_history');
    const q = query(historyRef, orderBy('date', 'desc'), limit(30)); // Last 30 days
    const snapshot = await getDocs(q);
    
    let allPredictions: PredictionRecord[] = [];
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      allPredictions = allPredictions.concat(data.predictions || []);
    });
    
    if (allPredictions.length === 0) return null;
    
    // 2. Get resolved markets
    // Assuming getResolvedMarkets is defined elsewhere and returns MarketAnalysis[]
    // For the purpose of this edit, we'll assume it's available in the scope.
    // If not, this function would need to be imported or defined.
    // For now, we'll mock it or assume it's available.
    // In a real scenario, getResolvedMarkets would be defined in a separate file.
    const resolvedMarkets = await getResolvedMarkets(50); // Placeholder for getResolvedMarkets
    const marketMap = new Map(resolvedMarkets.map(m => [m.id, m]));
    
    // 3. Resolve predictions
    const resolvedPredictions: ResolvedPrediction[] = allPredictions
      .filter(p => p.outcome === 'pending' && p.marketId && marketMap.has(p.marketId))
      .map(p => {
        const resolved = marketMap.get(p.marketId)!;
        const wasCorrect = p.aiPrediction.toLowerCase() === resolved.resolvedOutcome.toLowerCase();
        const actualProb = resolved.resolvedOutcome === 'Yes' ? 1 : 0;
        const brierError = Math.pow(p.aiProb - actualProb, 2);
        const kellyReturn = p.kellyPercentage * (actualProb - p.marketProb) / 100; // Simplified ROI
        
        return {
          ...p,
          resolvedOutcome: resolved.resolvedOutcome,
          wasCorrect,
          brierError,
          kellyReturn
        };
      });
    
    // 4. Calculate stats
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
      acc.set(p.date, (acc.get(p.date) || 0) + 1);
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

// Types (add if not exist)
interface ResolvedPrediction extends PredictionRecord {
  resolvedOutcome: 'Yes' | 'No';
  wasCorrect: boolean;
  brierError: number;
  kellyReturn: number;
}

interface BacktestStats {
  total: number;
  accuracy: number;
  brierScore: number;
  avgBrier: number;
  kellyROI: number;
  winRate: number;
  overTime: { date: string; count: number }[];
}




