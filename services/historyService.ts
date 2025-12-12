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
 * Get favorited markets from prediction history
 * Converts PredictionRecord to MarketAnalysis format
 */
export const getFavoritedMarketsFromHistory = async (favoriteIds: string[]): Promise<MarketAnalysis[]> => {
  if (!db || favoriteIds.length === 0) return [];

  try {
    // Get last 30 days of history to find favorited markets
    const history = await getPredictionHistory(30);
    const allPredictions = history.flatMap(h => h.predictions);
    
    // Find predictions that match favorite IDs
    const favoritePredictions = allPredictions.filter(p => favoriteIds.includes(p.marketId));
    
    // Remove duplicates (keep most recent)
    const uniqueMap = new Map<string, PredictionRecord>();
    favoritePredictions.forEach(p => {
      if (!uniqueMap.has(p.marketId) || p.date > uniqueMap.get(p.marketId)!.date) {
        uniqueMap.set(p.marketId, p);
      }
    });

    // Convert to MarketAnalysis format
    return Array.from(uniqueMap.values()).map(p => ({
      id: p.marketId,
      slug: p.slug || p.marketId,
      title: p.title,
      category: 'Other',
      imageUrl: '',
      marketProb: p.marketProb,
      aiProb: p.aiProb,
      edge: p.edge,
      reasoning: p.reasoning || 'Historical prediction',
      volume: 0,
      outcomes: p.outcomes || ['Yes', 'No'],
      prediction: p.aiPrediction,
      confidence: p.confidence || 5,
      kellyPercentage: p.kellyPercentage,
      riskFactor: p.riskFactor || 'N/A',
      endDate: p.resolvedAt || '',
      isFromHistory: true // Flag to identify historical markets
    } as MarketAnalysis & { isFromHistory?: boolean }));
  } catch (error) {
    console.error('Error fetching favorited markets from history:', error);
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

    // 2. Fetch resolved markets from Polymarket and map by marketId
    const resolvedMarkets = await getResolvedMarkets(limitCount);
    const resolvedMap = new Map<string, string>();
    resolvedMarkets.forEach(m => {
      if (m.id && m.resolvedOutcome) {
        resolvedMap.set(m.id, m.resolvedOutcome);
      }
    });

    // 3. Build resolved predictions with proper probability alignment
    const resolvedPredictions: ResolvedPrediction[] = allPredictions
      .map(p => {
        const outcomes = p.outcomes && p.outcomes.length >= 2 ? p.outcomes : ['Yes', 'No'];
        const resolvedOutcomeRaw = (resolvedMap.get(p.marketId) || p.resolvedOutcome || '').toString();
        if (!resolvedOutcomeRaw) return null;

        const predictedOutcome = p.aiPrediction || outcomes[0];
        const isPredFirst = predictedOutcome === outcomes[0];

        // Normalise kellyPercentage from history record (stored as percent, e.g. 12.5 for 12.5%)
        // Option A: bankroll compounding sans levier.
        // On borne la mise Kelly à [0%, 100%] pour éviter une perte > 100% (levier).
        const kellyPctRaw =
          typeof p.kellyPercentage === 'number' && Number.isFinite(p.kellyPercentage)
            ? p.kellyPercentage
            : 0;
        const kellyPct = Math.max(0, Math.min(100, kellyPctRaw));
        
        // entryPrice est le prix payé pour l'outcome prédit au moment de la prédiction
        const entryPrice = isPredFirst ? p.marketProb : (1 - p.marketProb);
        const safeEntryPrice = Math.max(0.01, Math.min(0.99, entryPrice)); // Bornes de sécurité

        // aiProb stocke la probabilité de outcomes[0]; si on a prédit outcomes[1], on inverse
        const predictedProb = isPredFirst ? p.aiProb : 1 - p.aiProb;

        // Normalisation des chaînes pour comparaison
        const norm = (s: string) => s.trim().toLowerCase();
        const resolvedOutcomeNorm = norm(resolvedOutcomeRaw);
        const outcomeFirstNorm = norm(outcomes[0]);
        const predictedOutcomeNorm = norm(predictedOutcome);

        // Gestion du cas "Other" : si prédiction = Other, on considère correct si le winner n'est pas outcome[0]
        let actualProb = 0;
        if (predictedOutcomeNorm === 'other') {
          actualProb = resolvedOutcomeNorm !== outcomeFirstNorm ? 1 : 0;
        } else {
          actualProb = resolvedOutcomeNorm === predictedOutcomeNorm ? 1 : 0;
        }

        const brierError = Math.pow(predictedProb - actualProb, 2);

        // ROI Kelly Réel (Compound Growth)
        const wasCorrect = actualProb === 1;
        const kellyFrac = kellyPct / 100;
        
        let kellyReturn = 0;
        if (wasCorrect) {
            // Gain net = (Payout - Cost) / Cost = (1 - Price) / Price
            // Impact Bankroll = KellyFraction * GainNet
            const profitMargin = (1 - safeEntryPrice) / safeEntryPrice;
            kellyReturn = kellyFrac * profitMargin;
        } else {
            // Perte nette = -100% de la mise
            // Impact Bankroll = -KellyFraction
            kellyReturn = -kellyFrac;
        }

        // Sécurité: en modèle sans levier, le retour d'un trade ne doit jamais être <= -100%.
        // (Avec notre clamp kellyFrac <= 1 ça ne devrait pas arriver, mais on protège les données.)
        if (!Number.isFinite(kellyReturn)) kellyReturn = 0;
        kellyReturn = Math.max(-0.99, kellyReturn);

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
          outcomes,
          prediction: predictedOutcome,
          confidence: p.confidence || 0,
          kellyPercentage: kellyPct,
          riskFactor: p.riskFactor || "Risk factor not archived.",
          resolvedOutcome: resolvedOutcomeRaw as 'Yes' | 'No' | string,
          wasCorrect,
          brierError,
          kellyReturn
        };
      })
      .filter((p): p is ResolvedPrediction => p !== null);

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
  
  // Calcul ROI composé (Cumulative Bankroll Growth)
  // Bankroll_fin = Bankroll_init * product(1 + return_i)
  // ROI = (Bankroll_fin / Bankroll_init) - 1
  // On trie par date pour simuler l'évolution chronologique (important si on voulait faire un stop-loss, ici mathématiquement le produit est commutatif mais bon)
  const sortedResolved = [...resolved].sort((a, b) => new Date((a as any).date).getTime() - new Date((b as any).date).getTime());
  
  let bankrollMultiplier = 1.0;
  sortedResolved.forEach(p => {
      // Protection contre faillite totale (si kellyReturn <= -1, on est mort)
      // Kelly fractional est sensé éviter ça, mais on cap à -99% par trade au cas où
      const safeReturn = Math.max(-0.99, p.kellyReturn);
      bankrollMultiplier *= (1 + safeReturn);
  });
  
  const kellyROI = bankrollMultiplier - 1; // Ex: 1.5 -> +0.5 (+50%)

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