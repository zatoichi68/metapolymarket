import { MarketAnalysis } from '../types';

/**
 * Analyzes a market using the secure backend API
 */
export const analyzeMarket = async (
  id: string,
  slug: string,
  title: string,
  marketProb: number,
  volume: number,
  imageUrl: string,
  outcomes: string[] = ["Yes", "No"],
  endDate?: string
): Promise<MarketAnalysis> => {

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, outcomes, marketProb, volume })
  });

  if (!response.ok) {
    throw new Error('AI service unavailable');
  }

  const result = await response.json();
  
  const aiProb = result.aiProbability ?? marketProb;
  const prediction = result.prediction ?? outcomes[0];
  const reasoning = result.reasoning ?? "Analysis based on market trends.";
  const category = result.category ?? "Other";
  const kellyPercentage = result.kellyPercentage ?? 0;
  const confidence = prediction === outcomes[0] ? aiProb : (1 - aiProb);

  return {
    id,
    slug,
    title,
    category,
    imageUrl,
    marketProb,
    aiProb,
    edge: aiProb - marketProb,
    reasoning,
    volume,
    outcomes,
    prediction,
    confidence,
    kellyPercentage,
    endDate
  };
};
