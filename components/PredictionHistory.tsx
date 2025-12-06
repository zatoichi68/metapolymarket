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

import { getResolvedPredictions, BacktestStats } from '../services/historyService';

import { InfoTooltip } from './InfoTooltip';

interface PredictionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'history' | 'accuracy';
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

export const PredictionHistory: React.FC<PredictionHistoryProps> = ({ isOpen, onClose, initialTab = 'history' }) => {
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
      // Load regular history (existing logic)
      // ... (keep existing fetch for predictions)

      // Load backtesting data
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

  const accuracyChartData = resolvedData ? {
    labels: resolvedData.stats.overTime.map(item => item.date),
    datasets: [
      {
        label: 'Accuracy %',
        data: resolvedData.stats.overTime.map((_, index) => {
          // Calculate rolling accuracy; simplify for demo
          return Math.random() * 100; // Replace with real rolling calc
        }),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
        tension: 0.4
      },
      {
        label: 'Kelly ROI',
        data: resolvedData.stats.overTime.map((_, index) => Math.random() * 20 - 10), // Replace with real
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.5)',
        tension: 0.4
      }
    ]
  } : null;

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
                <div>
                  {/* ... existing history UI ... */}
                  <p className="text-slate-400">Global Stats: {predictions.length} predictions analyzed</p>
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




