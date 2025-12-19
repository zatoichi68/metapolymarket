import React from 'react';
import { MarketAnalysis } from '../types';
import { X, Flame, TrendingUp, Target, ExternalLink, Bell } from 'lucide-react';

interface EdgeAlertsProps {
  isOpen: boolean;
  onClose: () => void;
  markets: MarketAnalysis[];
  onMarketClick: (market: MarketAnalysis) => void;
  onBet: (url: string) => void;
}

const EDGE_THRESHOLD = 0.08; // 8% edge threshold for "high edge" alerts

export const getHighEdgeMarkets = (markets: MarketAnalysis[]): MarketAnalysis[] => {
  return markets
    .filter(m => Math.abs(m.edge) >= EDGE_THRESHOLD)
    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
};

export const EdgeAlerts: React.FC<EdgeAlertsProps> = ({ isOpen, onClose, markets, onMarketClick, onBet }) => {
  const highEdgeMarkets = getHighEdgeMarkets(markets);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between flex-shrink-0 bg-gradient-to-r from-orange-500/10 to-red-500/10">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Flame className="text-orange-400" />
              High Edge Alerts
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Markets with &gt;{Math.round(EDGE_THRESHOLD * 100)}% edge detected
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-grow">
          {highEdgeMarkets.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Bell size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-lg">No high-edge opportunities right now</p>
              <p className="text-sm mt-2">Check back later or lower your threshold</p>
            </div>
          ) : (
            <div className="space-y-4">
              {highEdgeMarkets.map((market) => {
                // Normalize probabilities to the predicted outcome (align with MarketDetailModal)
                const isPredictedOutcomeA = market.prediction === market.outcomes[0];
                const displayMarketProb = isPredictedOutcomeA ? market.marketProb : (1 - market.marketProb);

                let displayEdge = market.edge || 0;
                const impliedAiProb = displayMarketProb + displayEdge;

                if (impliedAiProb < 0 || impliedAiProb > 1) {
                  const aiProbForPrediction = isPredictedOutcomeA ? market.aiProb : (1 - market.aiProb);
                  displayEdge = aiProbForPrediction - displayMarketProb;
                }

                const displayAiProb = Math.min(1, Math.max(0, displayMarketProb + displayEdge));

                const edgePercent = Math.abs(displayEdge) * 100;
                const isHot = edgePercent >= 15;
                
                return (
                  <div 
                    key={market.id}
                    className={`rounded-xl border p-4 transition-all hover:scale-[1.01] ${
                      isHot 
                        ? 'bg-gradient-to-r from-orange-500/10 to-red-500/10 border-orange-500/50' 
                        : 'bg-slate-800/50 border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {isHot && <Flame size={16} className="text-orange-400 animate-pulse" />}
                          <span className={`text-xs font-bold uppercase tracking-wide ${
                            isHot ? 'text-orange-400' : 'text-emerald-400'
                          }`}>
                            +{edgePercent.toFixed(1)}% Edge
                          </span>
                          {market.kellyPercentage > 0 && (
                            <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">
                              Kelly {market.kellyPercentage.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        
                        <h3 
                          className="text-white font-medium mb-2 cursor-pointer hover:text-blue-400 transition-colors"
                          onClick={() => { onMarketClick(market); }}
                        >
                          {market.title}
                        </h3>
                        
                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Target size={14} />
                            AI: <span className="text-white font-mono">{market.prediction}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <TrendingUp size={14} />
                            <span className="text-purple-400 font-mono">{Math.round(displayAiProb * 100)}%</span>
                            vs
                            <span className="text-blue-400 font-mono">{Math.round(displayMarketProb * 100)}%</span>
                          </div>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => onBet(`https://polymarket.com/event/${market.slug}?via=steve-rioux`)}
                        className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-1.5 transition-all ${
                          isHot 
                            ? 'bg-orange-500 hover:bg-orange-400 text-white' 
                            : 'bg-emerald-500 hover:bg-emerald-400 text-white'
                        }`}
                      >
                        BET <ExternalLink size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {highEdgeMarkets.length > 0 && (
          <div className="p-4 border-t border-slate-800 bg-slate-900/50">
            <p className="text-slate-500 text-xs text-center">
              ⚠️ High edge doesn't guarantee profit. Always do your own research.
            </p>
          </div>
        )}

      </div>
    </div>
  );
};






