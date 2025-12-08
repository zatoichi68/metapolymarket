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

  const apiKey = import.meta.env.VITE_API_AUTH_TOKEN;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers,
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
  const confidence = result.confidence ?? 5; // Meta-Oracle confidence 1-10
  const riskFactor = result.riskFactor ?? "Market volatility";

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
    riskFactor,
      endDate
    };
};
