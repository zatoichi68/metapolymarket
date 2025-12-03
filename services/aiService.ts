import { GoogleGenAI, Type } from "@google/genai";
import { MarketAnalysis } from '../types';

// Initialize Gemini Client
// Note: In a production app, these calls should be proxied through a backend to protect the API Key.
// Using Vite's environment variable injection (VITE_ prefix required for client-side access)
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

/**
 * Fallback simulation in case API fails or key is missing
 */
const fallbackSimulation = (
  id: string, slug: string, title: string, marketProb: number, volume: number, imageUrl: string, outcomes: string[], endDate?: string
): MarketAnalysis => {
  const variance = 0.15;
  const deviation = (Math.random() * (variance * 2)) - variance;
  let aiProb = Math.max(0.01, Math.min(0.99, marketProb + deviation));
  
  const isSettled = marketProb > 0.85 || marketProb < 0.15;
  if (!isSettled && Math.random() < 0.30) {
      aiProb = marketProb >= 0.5 ? 0.42 : 0.58; // Contrarian flip
  }

  const prediction = aiProb >= 0.5 ? outcomes[0] : outcomes[1];
  
  return {
    id, slug, title, category: 'General', imageUrl,
    marketProb, aiProb, edge: aiProb - marketProb,
    reasoning: "AI services unavailable. Using fallback probabilistic simulation based on historical volatility.",
    volume, outcomes, prediction, confidence: aiProb >= 0.5 ? aiProb : 1 - aiProb, endDate
  };
};

/**
 * Analyzes a market using Gemini 3 Pro.
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

  // If no API key configured, use fallback simulation
  if (!ai) {
    return fallbackSimulation(id, slug, title, marketProb, volume, imageUrl, outcomes, endDate);
  }

  try {
    const outcomeA = outcomes[0];
    const outcomeB = outcomes[1] || "Other";
    const currentOdds = `${outcomeA}: ${Math.round(marketProb * 100)}%, ${outcomeB}: ${Math.round((1 - marketProb) * 100)}%`;

    const prompt = `
      You are a Superforecaster AI analyzing a prediction market.
      
      Market: "${title}"
      Outcomes: ${outcomes.join(" vs ")}
      Current Crowd Odds: ${currentOdds}
      Volume: $${volume.toLocaleString()}
      Date: ${new Date().toISOString()}

      Task:
      1. Analyze the real-world probability of "${outcomeA}" occurring based on current news, sentiment, and facts.
      2. Compare your calculated probability with the Crowd Odds.
      3. If you disagree significantly, explain why (finding the edge).
      4. Determine the category (Politics, Crypto, Sports, Business, Other).

      Return JSON.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            aiProbability: { type: Type.NUMBER, description: "Your calculated probability for the first outcome (0.0 to 1.0)" },
            prediction: { type: Type.STRING, description: "The outcome you predict is most likely (must be one of the provided outcomes)" },
            reasoning: { type: Type.STRING, description: "Concise financial reasoning (max 2 sentences). Focus on why the crowd is wrong." },
            category: { type: Type.STRING, description: "One of: Politics, Crypto, Sports, Business, Other" }
          },
          required: ["aiProbability", "prediction", "reasoning", "category"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    
    // Validate result
    const aiProb = result.aiProbability ?? marketProb;
    const prediction = result.prediction ?? outcomeA;
    const reasoning = result.reasoning ?? "Analysis generated based on market trends.";
    const category = result.category ?? "Other";

    // Calculate confidence relative to the prediction
    // If aiProb is 0.8 for "Yes", confidence is 0.8.
    // If aiProb is 0.2 for "Yes" (meaning 0.8 for "No"), confidence is 0.8.
    const confidence = prediction === outcomeA ? aiProb : (1 - aiProb);

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
      endDate
    };

  } catch (error) {
    console.error(`Gemini Analysis Failed for ${title}:`, error);
    return fallbackSimulation(id, slug, title, marketProb, volume, imageUrl, outcomes, endDate);
  }
};