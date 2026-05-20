import { MarketAnalysis } from '../types';

export type SignalLevel = 'ended' | 'avoid' | 'watch' | 'small' | 'standard' | 'strong';

export interface MarketSignal {
  displayMarketProb: number;
  displayAiProb: number;
  edge: number;
  edgePercent: number;
  suggestedStake: number;
  level: SignalLevel;
  label: string;
  isActionable: boolean;
  isEnded: boolean;
  sortScore: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const getMarketSignal = (market: MarketAnalysis): MarketSignal => {
  const outcomeA = market.outcomes?.[0] || 'Yes';
  const prediction = market.prediction || outcomeA;
  const isPredictionA = prediction === outcomeA;

  const marketProbA = clamp(Number(market.marketProb) || 0.5, 0, 1);
  const aiProbA = clamp(Number(market.aiProb) || marketProbA, 0, 1);
  const displayMarketProb = isPredictionA ? marketProbA : 1 - marketProbA;
  const displayAiProb = isPredictionA ? aiProbA : 1 - aiProbA;
  const edge = displayAiProb - displayMarketProb;
  const confidence = Number(market.confidence) || 0;
  const volume = Number(market.volume) || 0;
  const endTime = market.endDate ? new Date(market.endDate).getTime() : Number.POSITIVE_INFINITY;
  const isEnded = Number.isFinite(endTime) && endTime < Date.now();
  const isFallback = market.analysisStatus === 'fallback' || Boolean((market as any).fallback);

  if (isEnded) {
    return {
      displayMarketProb,
      displayAiProb,
      edge,
      edgePercent: edge * 100,
      suggestedStake: 0,
      level: 'ended',
      label: 'Ended',
      isActionable: false,
      isEnded: true,
      sortScore: -1000
    };
  }

  if (isFallback || edge <= 0) {
    return {
      displayMarketProb,
      displayAiProb,
      edge,
      edgePercent: edge * 100,
      suggestedStake: 0,
      level: edge > -0.015 ? 'watch' : 'avoid',
      label: edge > -0.015 ? 'Watch' : 'Pass',
      isActionable: false,
      isEnded: false,
      sortScore: edge * 100
    };
  }

  const confidenceFactor = clamp((confidence - 3) / 5, 0, 1);
  const liquidityFactor = volume >= 100000 ? 1 : volume >= 10000 ? 0.7 : 0.35;
  const pricePenalty = displayMarketProb <= 0.06 || displayMarketProb >= 0.94 ? 0.45 : 1;
  const modelStake = edge * 100 * 0.45 * confidenceFactor * liquidityFactor * pricePenalty;
  const backendStake = Number(market.kellyPercentage) || 0;
  const suggestedStake = clamp(Math.max(backendStake, modelStake), 0, 5);

  const isActionable = suggestedStake >= 0.25 && confidence >= 5 && edge >= 0.015;
  const level: SignalLevel = !isActionable
    ? 'watch'
    : suggestedStake >= 2.5
      ? 'strong'
      : suggestedStake >= 1
        ? 'standard'
        : 'small';

  const label = level === 'strong'
    ? 'Strong'
    : level === 'standard'
      ? 'Action'
      : level === 'small'
        ? 'Small'
        : 'Watch';

  return {
    displayMarketProb,
    displayAiProb,
    edge,
    edgePercent: edge * 100,
    suggestedStake,
    level,
    label,
    isActionable,
    isEnded: false,
    sortScore: (isActionable ? 100 : 0) + suggestedStake * 10 + edge * 100 + Math.log10(volume + 1)
  };
};
