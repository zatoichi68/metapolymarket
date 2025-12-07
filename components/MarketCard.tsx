import React, { useState, useEffect } from 'react';
import { MarketAnalysis } from '../types';
import { ArrowUpRight, Bookmark, Sparkles, ExternalLink, BrainCircuit } from 'lucide-react';

interface MarketCardProps {
  market: MarketAnalysis;
  onAnalyze: (market: MarketAnalysis) => void;
  onBet: (url: string) => void;
  onFavoriteToggle?: (marketId: string, isFavorite: boolean) => void;
}

// Helper to get favorites from localStorage
const getFavorites = (): string[] => {
  try {
    const stored = localStorage.getItem('metapolymarket_favorites');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

// Helper to save favorites to localStorage
const saveFavorites = (favorites: string[]) => {
  localStorage.setItem('metapolymarket_favorites', JSON.stringify(favorites));
};

export const MarketCard: React.FC<MarketCardProps> = ({ market, onAnalyze, onBet, onFavoriteToggle }) => {
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    const favorites = getFavorites();
    setIsFavorite(favorites.includes(market.id));
  }, [market.id]);

  const toggleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const favorites = getFavorites();
    let newFavorites: string[];
    
    if (isFavorite) {
      newFavorites = favorites.filter(id => id !== market.id);
    } else {
      newFavorites = [...favorites, market.id];
    }
    
    saveFavorites(newFavorites);
    setIsFavorite(!isFavorite);
    onFavoriteToggle?.(market.id, !isFavorite);
  };
  const outcomeA = market.outcomes[0] || "Yes";
  const outcomeB = market.outcomes[1] || "No";
  
  // Probabilities for Outcome A
  const marketProbA = market.marketProb;

  // Resolution info (if provided)
  const resolvedOutcome = market.resolvedOutcome;
  const wasCorrect = typeof market.wasCorrect === 'boolean'
    ? market.wasCorrect
    : (resolvedOutcome ? resolvedOutcome === market.prediction : undefined);

  // Calculate Edge for the PREDICTED outcome
  const isPredictedA = market.prediction === outcomeA;
  
  // Get market probability for the predicted outcome
  const marketProbForPrediction = isPredictedA ? market.marketProb : (1 - market.marketProb);
  
  // Validate backend edge: AI prob = marketProb + edge must be between 0 and 1
  let calculatedEdge = market.edge || 0;
  const impliedAiProb = marketProbForPrediction + calculatedEdge;
  
  if (impliedAiProb < 0 || impliedAiProb > 1) {
    // Backend edge is invalid - recalculate from aiProb
    const aiProbForPrediction = isPredictedA ? market.aiProb : (1 - market.aiProb);
    calculatedEdge = aiProbForPrediction - marketProbForPrediction;
  }

  // For displaying edge on Outcome A row (only relevant if A is predicted)
  const edgeA = calculatedEdge; 

  // Probabilities for Outcome B (Inverse)
  const marketProbB = 1 - marketProbA;
  // For displaying edge on Outcome B row (only relevant if B is predicted)
  const edgeB = calculatedEdge; 

  const renderRow = (name: string, marketProb: number, edge: number, isPredicted: boolean) => {
    const percentage = Math.round(marketProb * 100);
    const edgePercent = (edge * 100).toFixed(1);
    const edgeColor = edge >= 0 ? 'text-emerald-400' : 'text-orange-400';
    
    // Determine colors based on prediction status
    const rowBg = isPredicted ? 'bg-white/5' : 'bg-transparent';
    const nameColor = isPredicted ? 'text-white' : 'text-slate-200'; // Made non-predicted lighter (slate-200) for better name visibility
    const percentColor = isPredicted ? 'text-white' : 'text-slate-400';
    
    const buttonClass = isPredicted 
      ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-[0_0_10px_rgba(16,185,129,0.4)] border-emerald-400' 
      : 'bg-slate-700/50 text-slate-500 border-transparent cursor-not-allowed hover:bg-slate-700/70';

    return (
      <div className={`flex items-center justify-between py-2.5 px-3 rounded-lg mb-1 transition-all ${rowBg}`}>
        
        {/* Left: Name */}
        <div className="flex-1 min-w-0 pr-4 flex flex-col justify-center">
          <span className={`text-[15px] font-semibold truncate block leading-tight ${nameColor}`}>
            {name}
          </span>
           {isPredicted && (
             <div className="flex items-center gap-2 mt-0.5">
                 <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                    <Sparkles size={8} /> Swarm Pick
                 </span>
                 {market.kellyPercentage > 0 && (
                   <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold">
                     Kelly {market.kellyPercentage.toFixed(1)}%
                   </span>
                 )}
                 <button 
                    onClick={(e) => { e.preventDefault(); onAnalyze(market); }}
                    className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded flex items-center gap-1 hover:bg-purple-500/30 transition-colors"
                 >
                     <BrainCircuit size={8} /> Why?
                 </button>
             </div>
           )}
        </div>

        {/* Right: Stats & Button */}
        <div className="flex items-center gap-3 flex-shrink-0">
            
            {/* Probability & Alpha */}
            <div className="flex flex-col items-end min-w-[3rem]">
                <span className={`text-sm font-bold ${percentColor}`}>
                    {percentage}%
                </span>
                {isPredicted && (
                    <button
                        onClick={(e) => { e.preventDefault(); onAnalyze(market); }} 
                        className={`text-[10px] font-mono font-bold ${edgeColor} flex items-center hover:underline cursor-pointer`}
                        title="View Analysis"
                    >
                        {edge >= 0 ? '+' : ''}{edgePercent}% <ArrowUpRight size={10} className="ml-px" />
                    </button>
                )}
            </div>

            {/* BET Button */}
            <button 
              onClick={(e) => { e.preventDefault(); onBet(`https://polymarket.com/event/${market.slug}`); }}
              className={`h-9 px-5 rounded-md text-xs font-bold uppercase tracking-wide border transition-all active:scale-95 flex items-center justify-center ${buttonClass}`}
            >
                BET
            </button>
        </div>
      </div>
    );
  };

  const isAPredicted = market.prediction === outcomeA;

  return (
    <div className="bg-poly-card border border-slate-700/60 rounded-xl overflow-hidden shadow-lg hover:border-slate-600 hover:shadow-2xl transition-all duration-300 flex flex-col h-full group relative">
      
      {/* Resolved badge */}
      {resolvedOutcome && (
        <div className={`absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border
          ${wasCorrect ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/60' : 'bg-rose-500/15 text-rose-300 border-rose-400/50'}`}>
          Resolved · {wasCorrect ? 'AI Win' : 'AI Lost'}
        </div>
      )}
      
      {/* Header Area */}
      <div className="p-4 pb-2">
        <div className="flex items-start gap-3">
            {/* Square Image */}
            <div className="w-12 h-12 rounded-lg bg-white overflow-hidden flex-shrink-0 border border-slate-700 relative">
                {market.imageUrl ? (
                    <img src={market.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-slate-800" />
                )}
                {/* Category Badge overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-[2px] text-[8px] text-center text-white font-bold py-0.5 uppercase tracking-wider">
                  {market.category}
                </div>
            </div>
            
            {/* Title - Linked */}
            <a 
              href={`https://polymarket.com/event/${market.slug}`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex-1 group/title"
            >
              <h3 className="text-[15px] font-medium text-white leading-snug line-clamp-3 pt-0.5 group-hover/title:text-blue-400 group-hover/title:underline transition-all decoration-blue-400/50 underline-offset-2">
                  {market.title}
                  <ExternalLink size={12} className="inline ml-1 opacity-0 group-hover/title:opacity-100 transition-opacity mb-0.5" />
              </h3>
            </a>
        </div>
      </div>

      {/* List of Outcomes */}
      <div className="px-2 pb-2 flex-grow flex flex-col justify-center">
        {renderRow(outcomeA, marketProbA, edgeA, isAPredicted)}
        {renderRow(outcomeB, marketProbB, edgeB, !isAPredicted)}
      </div>

      {/* Footer: Volume & Favorite */}
      <div className="px-4 py-3 border-t border-slate-800/50 flex items-center justify-between text-slate-500 mt-auto bg-slate-900/20">
         <div className="text-xs font-medium flex items-center gap-1 text-slate-400">
             ${(market.volume / 1000000).toFixed(1)}m Vol.
         </div>
         <button 
           onClick={toggleFavorite}
           className="group/fav"
           title={isFavorite ? "Remove from favorites" : "Add to favorites"}
         >
           <Bookmark 
             size={18} 
             className={`transition-all ${
               isFavorite 
                 ? 'fill-amber-400 text-amber-400' 
                 : 'text-slate-500 hover:text-amber-400 group-hover/fav:scale-110'
             }`} 
           />
         </button>
      </div>

    </div>
  );
};