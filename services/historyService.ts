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

