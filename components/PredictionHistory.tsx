import React, { useState, useEffect } from 'react';
import { X, BarChart3, TrendingUp, Calendar, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  Title, 
  Tooltip, 
  Legend 
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

import { getResolvedPredictions, getPredictionHistory, BacktestStats } from '../services/historyService';
import { InfoTooltip } from './InfoTooltip';
import { MarketAnalysis } from '../types';

interface PredictionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'history' | 'accuracy';
  onSelectMarket?: (market: MarketAnalysis) => void;
}

interface ResolvedPrediction {
  id: string;
  title: string;
  aiPrediction: string;
  aiProb: number;
  marketProb: number;
  edge: number;
  kellyPercentage: number;
  date: string;
  resolvedOutcome: 'Yes' | 'No';
  wasCorrect: boolean;
  brierError: number;
  kellyReturn: number;
}

export const PredictionHistory: React.FC<PredictionHistoryProps> = ({ isOpen, onClose, initialTab = 'history', onSelectMarket }) => {
  const [activeTab, setActiveTab] = useState<'history' | 'accuracy'>('history');
  const [predictions, setPredictions] = useState<any[]>([]);
  const [resolvedData, setResolvedData] = useState<{ predictions: ResolvedPrediction[], stats: BacktestStats } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      loadData();
    }
  }, [isOpen, initialTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load regular history (ALL predictions, pending and resolved)
      const history = await getPredictionHistory(30); // Last 30 days
      const allPreds = history.flatMap(h => h.predictions);
      setPredictions(allPreds);

      // Load backtesting data (Only resolved)
      const resolved = await getResolvedPredictions(50);
      if (resolved) {
        setResolvedData(resolved);
      }
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Calculate Rolling/Cumulative Stats for Chart
  const getChartData = () => {
      if (!resolvedData) return null;

      // Sort all resolved predictions by date
      const sortedPreds = [...resolvedData.predictions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      // Group by date to create daily data points
      const predictionsByDate = new Map<string, ResolvedPrediction[]>();
      sortedPreds.forEach(p => {
          const date = p.date;
          if (!predictionsByDate.has(date)) predictionsByDate.set(date, []);
          predictionsByDate.get(date)?.push(p);
      });

      const dates = Array.from(predictionsByDate.keys()).sort();
      
      // Calculate CUMULATIVE stats over time
      let cumulativeCorrect = 0;
      let cumulativeTotal = 0;
      let cumulativeRoi = 0;

      const accuracyData = [];
      const roiData = [];

      dates.forEach(date => {
          const dayPreds = predictionsByDate.get(date) || [];
          
          dayPreds.forEach(p => {
              cumulativeTotal++;
              if (p.wasCorrect) cumulativeCorrect++;
              cumulativeRoi += p.kellyReturn;
          });

          const currentAccuracy = (cumulativeCorrect / cumulativeTotal) * 100;
          const currentRoi = cumulativeRoi * 100; // Convert to percentage

          accuracyData.push(currentAccuracy);
          roiData.push(currentRoi);
      });

      return {
        labels: dates,
        datasets: [
          {
            label: 'Accuracy %',
            data: accuracyData,
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.5)',
            tension: 0.4
          },
          {
            label: 'Kelly ROI %',
            data: roiData,
            borderColor: 'rgb(34, 197, 94)',
            backgroundColor: 'rgba(34, 197, 94, 0.5)',
            tension: 0.4
          }
        ]
      };
  };

  const accuracyChartData = getChartData();

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Backtesting: Accuracy & ROI Over Time'
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">AI Prediction History & Backtesting</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={24} />
          </button>
        </div>
        
        {/* Tabs */}
        <div className="border-b border-slate-800">
          <nav className="flex space-x-1 px-6">
            <button
              onClick={() => setActiveTab('history')}
              className={`py-2 px-4 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === 'history'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              History
            </button>
            <button
              onClick={() => setActiveTab('accuracy')}
              className={`py-2 px-4 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === 'accuracy'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Accuracy (Backtest)
            </button>
          </nav>
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-6">
          {loading ? (
            <p className="text-slate-400 text-center">Loading history...</p>
          ) : (
            <>
              {activeTab === 'history' && (
                // Existing history content
                <div className="space-y-4">
                  {predictions.length > 0 ? (
                    predictions.map((p, i) => {
                        // Calculate probabilities for the predicted outcome
                        const isPredictedFirst = p.outcomes?.[0] === p.aiPrediction;
                        const displayMarketProb = isPredictedFirst ? p.marketProb : (1 - p.marketProb);
                        
                        // Validate backend edge: AI prob = marketProb + edge must be between 0 and 1
                        let displayEdge = p.edge || 0;
                        const impliedAiProb = displayMarketProb + displayEdge;
                        
                        if (impliedAiProb < 0 || impliedAiProb > 1) {
                            // Backend edge is invalid - recalculate from aiProb
                            const aiProbForPrediction = isPredictedFirst ? p.aiProb : (1 - p.aiProb);
                            displayEdge = aiProbForPrediction - displayMarketProb;
                        }
                        
                        const displayAiProb = Math.min(1, Math.max(0, displayMarketProb + displayEdge));
                        
                        return (
                        <div key={i} className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                            <div className="flex-1">
                                <div className="text-xs text-slate-500 mb-1 font-mono">{p.date}</div>
                                <div className="font-bold text-white text-base mb-2">{p.title}</div>
                                
                                <div className="flex gap-6 text-sm">
                                    <div>
                                        <div className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Swarm AI</div>
                                        <div className="font-bold text-purple-400">
                                            {p.aiPrediction} <span className="text-slate-500 font-normal">({Math.round(displayAiProb * 100)}%)</span>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Crowd</div>
                                        <div className="font-bold text-blue-400">
                                            {Math.round(displayMarketProb * 100)}% <span className="text-slate-500 font-normal">on {p.aiPrediction}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 sm:text-right border-t sm:border-t-0 border-slate-700 pt-3 sm:pt-0 w-full sm:w-auto justify-between sm:justify-end">
                                <div>
                                    <div className="text-xs text-slate-500 mb-0.5">Edge</div>
                                    <div className={`font-mono font-bold ${displayEdge >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
                                        {displayEdge >= 0 ? '+' : ''}{Math.round(displayEdge * 1000) / 10}%
                                    </div>
                                </div>
                                
                                {p.outcome && p.outcome !== 'pending' ? (
                                    <div className="text-right">
                                        <div className="text-xs text-slate-500 mb-0.5">Result</div>
                                        <div className={`font-bold px-2 py-1 rounded text-xs uppercase tracking-wide ${p.outcome === 'win' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                            {p.outcome === 'win' ? 'WON' : 'LOST'}
                                        </div>
                                        {p.resolvedOutcome && (
                                            <div className="text-[10px] text-slate-500 mt-0.5">
                                                Outcome: {p.resolvedOutcome}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (onSelectMarket) {
                                                // Pass data directly - modal will calculate crowdProb = aiProb - edge
                                                const market: MarketAnalysis = {
                                                    id: p.marketId,
                                                    slug: "",
                                                    title: p.title,
                                                    category: "Unknown",
                                                    imageUrl: "",
                                                    marketProb: p.marketProb, // Original value, modal ignores this now
                                                    aiProb: p.aiProb,
                                                    edge: p.edge,
                                                    reasoning: p.reasoning || "Detailed analysis for this historical prediction was not archived.",
                                                    volume: 0,
                                                    outcomes: p.outcomes || ["Yes", "No"],
                                                    prediction: p.aiPrediction,
                                                    confidence: p.confidence || 0,
                                                    kellyPercentage: p.kellyPercentage,
                                                    riskFactor: p.riskFactor || "Risk factor details not available.",
                                                    endDate: ""
                                                };
                                                onSelectMarket(market);
                                            }
                                        }}
                                        className="px-3 py-1 bg-slate-700/50 hover:bg-slate-600 hover:text-white text-slate-400 rounded text-xs font-medium transition-colors flex items-center gap-2 group"
                                        title="View Analysis"
                                    >
                                        PENDING
                                        <Info size={12} className="opacity-50 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                )}
                            </div>
                        </div>
                    )})
                  ) : (
                      <div className="text-center py-12 text-slate-400">
                        <p>No history found.</p>
                      </div>
                  )}
                  <p className="text-slate-400 text-sm text-center pt-4 border-t border-slate-800">
                    Global Stats: {predictions.length} predictions analyzed in the last 30 days
                  </p>
                </div>
              )}
              
              {activeTab === 'accuracy' && (
                <div>
                  {resolvedData ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                        <div className="bg-slate-800 p-4 rounded-lg text-center relative">
                          <div className="absolute top-2 right-2">
                            <InfoTooltip content="Percentage of correct predictions. Note: High accuracy on low odds (favorites) is easier than on high odds (underdogs)." />
                          </div>
                          <CheckCircle className="mx-auto mb-2 text-green-400" size={32} />
                          <h3 className="text-lg font-bold text-white">Accuracy</h3>
                          <p className="text-2xl font-bold text-green-400">{resolvedData.stats.accuracy.toFixed(1)}%</p>
                          <p className="text-sm text-slate-400">{resolvedData.stats.total} resolved predictions</p>
                        </div>
                        <div className="bg-slate-800 p-4 rounded-lg text-center relative">
                          <div className="absolute top-2 right-2">
                            <InfoTooltip content="Theoretical Return on Investment if betting according to Kelly Criterion recommendations. Reflects optimal bankroll growth." />
                          </div>
                          <TrendingUp className="mx-auto mb-2 text-emerald-400" size={32} />
                          <h3 className="text-lg font-bold text-white">Kelly ROI</h3>
                          <p className="text-2xl font-bold text-emerald-400">+{resolvedData.stats.kellyROI.toFixed(2)}%</p>
                          <p className="text-sm text-slate-400">Cumulative return</p>
                        </div>
                        <div className="bg-slate-800 p-4 rounded-lg text-center relative">
                          <div className="absolute top-2 right-2">
                             <InfoTooltip content="Measures the accuracy of probabilistic predictions. 0.00 is perfect, 0.25 is random guessing. Lower is better." />
                          </div>
                          <BarChart3 className="mx-auto mb-2 text-blue-400" size={32} />
                          <h3 className="text-lg font-bold text-white">Brier Score</h3>
                          <p className="text-2xl font-bold text-blue-400">{resolvedData.stats.avgBrier.toFixed(3)}</p>
                          <p className="text-sm text-slate-400">Lower is better (calibration)</p>
                        </div>
                      </div>
                      
                      {/* Chart */}
                      {accuracyChartData && (
                        <div className="bg-slate-800 p-6 rounded-lg">
                          <Line data={accuracyChartData} options={options} />
                        </div>
                      )}
                      
                      {/* Resolved Predictions Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-700">
                            <tr>
                              <th className="p-3 text-left">Date</th>
                              <th className="p-3 text-left">Market</th>
                              <th className="p-3 text-left">AI Prediction</th>
                              <th className="p-3 text-left">Outcome</th>
                              <th className="p-3 text-left">Correct?</th>
                              <th className="p-3 text-right">Kelly Return</th>
                            </tr>
                          </thead>
                          <tbody>
                            {resolvedData.predictions.slice(0, 10).map((p, i) => (
                              <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/50">
                                <td className="p-3">{p.date}</td>
                                <td className="p-3">{p.title}</td>
                                <td className="p-3">{p.aiPrediction} ({(p.aiProb * 100).toFixed(1)}%)</td>
                                <td className="p-3">{p.resolvedOutcome}</td>
                                <td className={p.wasCorrect ? 'p-3 text-green-400' : 'p-3 text-red-400'}>
                                  {p.wasCorrect ? 'Yes' : 'No'}
                                </td>
                                <td className="p-3 text-right">{(p.kellyReturn * 100).toFixed(2)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-slate-400">
                      <BarChart3 size={48} className="mx-auto mb-4 opacity-50" />
                      <p>No resolved predictions available yet for backtesting.</p>
                      <p className="text-sm mt-2">New predictions will be backtested once markets resolve.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};




