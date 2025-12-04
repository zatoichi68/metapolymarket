import React from 'react';
import { MarketAnalysis } from '../types';
import { X, BrainCircuit, Users, TrendingUp, ExternalLink, AlertCircle, Target } from 'lucide-react';

interface MarketDetailModalProps {
  market: MarketAnalysis | null;
  isOpen: boolean;
  onClose: () => void;
  onBet: (url: string) => void;
}

export const MarketDetailModal: React.FC<MarketDetailModalProps> = ({ market, isOpen, onClose, onBet }) => {
  if (!isOpen || !market) return null;

  const marketPercent = Math.round(market.marketProb * 100);
  const aiPercent = Math.round(market.aiProb * 100);
  const isContrarian = (market.marketProb >= 0.5 && market.aiProb < 0.5) || (market.marketProb < 0.5 && market.aiProb >= 0.5);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-start justify-between bg-slate-900/50">
           <div>
             <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                Analysis Report
             </span>
             <h2 className="text-xl font-bold text-white leading-tight pr-4">
               {market.title}
             </h2>
           </div>
           <button 
             onClick={onClose}
             className="text-slate-500 hover:text-white transition-colors p-1"
           >
             <X size={24} />
           </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar space-y-8">
            
            {/* The Choice */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
                        <BrainCircuit size={24} />
                    </div>
                    <div>
                        <div className="text-sm text-slate-400">Swarm AI Prediction</div>
                        <div className="text-xl font-bold text-white flex items-center gap-2">
                            {market.prediction}
                            <span className="text-sm font-normal text-slate-400 px-2 py-0.5 bg-slate-800 rounded-full border border-slate-700">
                                {market.confidence}/10 Confidence
                            </span>
                        </div>
                    </div>
                </div>

                {/* Bars Comparison */}
                <div className="space-y-4">
                    {/* Market Bar */}
                    <div>
                        <div className="flex justify-between text-sm mb-1.5">
                            <span className="flex items-center gap-1.5 text-slate-400">
                                <Users size={14} /> Crowd Wisdom (Polymarket)
                            </span>
                            <span className="font-mono font-bold text-slate-300">{marketPercent}%</span>
                        </div>
                        <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                            <div 
                                className="h-full bg-blue-600 rounded-full" 
                                style={{ width: `${marketPercent}%` }}
                            />
                        </div>
                    </div>

                    {/* AI Bar */}
                    <div>
                        <div className="flex justify-between text-sm mb-1.5">
                            <span className="flex items-center gap-1.5 text-purple-400 font-medium">
                                <BrainCircuit size={14} /> Swarm AI Model
                            </span>
                            <span className="font-mono font-bold text-purple-400">{aiPercent}%</span>
                        </div>
                        <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                            <div 
                                className="h-full bg-purple-500 rounded-full shadow-[0_0_10px_rgba(168,85,247,0.4)]" 
                                style={{ width: `${aiPercent}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* The Reasoning */}
            <div>
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <AlertCircle size={16} className="text-slate-500" />
                    Reasoning & Alpha
                </h3>
                <div className="bg-slate-800/30 rounded-lg p-4 border-l-2 border-purple-500 text-slate-300 text-base leading-relaxed">
                    "{market.reasoning}"
                </div>
                {isContrarian && (
                    <div className="mt-3 text-xs text-yellow-500/80 flex items-center gap-1.5 bg-yellow-500/5 p-2 rounded border border-yellow-500/10">
                        <TrendingUp size={12} />
                        High-Edge Contrarian Opportunity detected.
                    </div>
                )}
            </div>

            {/* Kelly Criterion */}
            {market.kellyPercentage > 0 && (
              <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-xl p-4 border border-amber-500/30">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400">
                    <Target size={24} />
                  </div>
                  <div>
                    <div className="text-sm text-amber-300/80">Kelly Criterion - Optimal Bet Size</div>
                    <div className="text-2xl font-bold text-amber-400">
                      {market.kellyPercentage.toFixed(1)}% <span className="text-base font-normal text-amber-300/60">of bankroll</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-amber-300/60 mt-3">
                  Based on the edge detected, this is the mathematically optimal percentage of your capital to allocate to this bet for maximum long-term growth.
                </p>
              </div>
            )}

            {/* Risk Factor */}
            {market.riskFactor && (
              <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/30">
                <h3 className="text-sm font-bold text-red-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                    <AlertCircle size={16} />
                    ⚠️ Risk Factor
                </h3>
                <p className="text-slate-300 text-sm">
                    {market.riskFactor}
                </p>
              </div>
            )}

        </div>

        {/* Footer Action */}
        <div className="p-5 border-t border-slate-800 bg-slate-900/50">
            <button 
              onClick={() => { onClose(); onBet(`https://polymarket.com/event/${market.slug}`); }}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-purple-900/20"
            >
                Execute Trade on Polymarket <ExternalLink size={18} />
            </button>
        </div>

      </div>
    </div>
  );
};