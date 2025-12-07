export interface PolymarketEvent {
  id: string;
  slug: string; // URL slug
  title: string;
  description: string;
  image: string;
  endDate?: string; // ISO Date string
  markets: {
    id: string;
    question: string;
    outcomes: string[] | string; // Can be stringified JSON
    outcomePrices: string[] | string; // Can be stringified JSON
    volume: string;
    groupItemTitle?: string; // e.g. "Donald Trump" for group markets
  }[];
}

export interface MarketAnalysis {
  id: string;
  slug: string;
  title: string;
  category: string;
  imageUrl: string;
  marketProb: number; // 0 to 1 (probability of main outcome)
  aiProb: number; // 0 to 1 (probability of main outcome)
  edge: number; // aiProb - marketProb
  reasoning: string;
  volume: number;
  outcomes: string[];
  prediction: string; // The specific outcome the AI thinks is most likely
  confidence: number; // Meta-Oracle confidence level (1-10)
  kellyPercentage: number; // Kelly criterion: optimal bet size as % of bankroll
  riskFactor: string; // Principal risk factor that could invalidate the prediction
  endDate?: string;
  // Optional resolution info (when coming from history/backtest)
  resolvedOutcome?: string;
  wasCorrect?: boolean;
}

export interface ResolvedMarket {
  id: string;
  title: string;
  resolvedOutcome: string;
}

export interface ResolvedPrediction extends MarketAnalysis {
  resolvedOutcome: 'Yes' | 'No';
  wasCorrect: boolean;
  brierError: number;
  kellyReturn: number;
}

export interface BacktestStats {
  total: number;
  accuracy: number;
  brierScore: number;
  avgBrier: number;
  kellyROI: number;
  winRate: number;
  overTime: { date: string; count: number }[];
}

export enum Category {
  ALL = 'All',
  POLITICS = 'Politics',
  CRYPTO = 'Crypto',
  SPORTS = 'Sports',
  BUSINESS = 'Business',
  OTHER = 'Other'
}