import React, { useEffect, useState } from 'react';
import { getPredictionHistory, calculateOverallStats, PredictionRecord } from '../services/historyService';
import { X, TrendingUp, Target, Calendar, BarChart3, Clock } from 'lucide-react';

interface PredictionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PredictionHistory: React.FC<PredictionHistoryProps> = ({ isOpen, onClose }) => {
  const [history, setHistory] = useState<{ date: string; predictions: PredictionRecord[]; stats: any }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const loadHistory = async () => {
    setLoading(true);
    const data = await getPredictionHistory(7);
    setHistory(data);
    setLoading(false);
  };

  if (!isOpen) return null;

  const stats = calculateOverallStats(history);
  const selectedDayData = selectedDay ? history.find(h => h.date === selectedDay) : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="text-purple-400" />
              Prediction History
            </h2>
            <p className="text-slate-400 text-sm mt-1">Track AI prediction performance over time</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-grow">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <Clock size={48} className="mx-auto mb-4 opacity-50" />
              <p>No prediction history yet.</p>
              <p className="text-sm mt-2">History will appear after your first data refresh.</p>
            </div>
          ) : (
            <>
              {/* Overall Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                  <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                    <Calendar size={14} />
                    Days Tracked
                  </div>
                  <div className="text-2xl font-bold text-white">{stats.totalDays}</div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                  <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                    <BarChart3 size={14} />
                    Total Predictions
                  </div>
                  <div className="text-2xl font-bold text-white">{stats.totalPredictions}</div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                  <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                    <TrendingUp size={14} />
                    Avg Edge
                  </div>
                  <div className="text-2xl font-bold text-emerald-400">+{stats.avgEdge.toFixed(1)}%</div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                  <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                    <Target size={14} />
                    Avg Kelly
                  </div>
                  <div className="text-2xl font-bold text-amber-400">{stats.avgKelly.toFixed(1)}%</div>
                </div>
              </div>

              {/* Daily History */}
              <h3 className="text-lg font-semibold text-white mb-4">Daily Breakdown</h3>
              <div className="space-y-3">
                {history.map((day) => (
                  <div 
                    key={day.date}
                    className={`bg-slate-800/30 rounded-xl border transition-all cursor-pointer ${
                      selectedDay === day.date 
                        ? 'border-purple-500 bg-slate-800/50' 
                        : 'border-slate-700 hover:border-slate-600'
                    }`}
                    onClick={() => setSelectedDay(selectedDay === day.date ? null : day.date)}
                  >
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="text-white font-medium">
                          {new Date(day.date).toLocaleDateString('en-US', { 
                            weekday: 'short', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </div>
                        <div className="text-slate-400 text-sm">
                          {day.predictions.length} predictions
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-emerald-400 text-sm font-mono">
                          +{(day.stats?.avgEdge * 100 || 0).toFixed(1)}% edge
                        </div>
                        <div className="text-amber-400 text-sm font-mono">
                          {(day.stats?.avgKelly || 0).toFixed(1)}% kelly
                        </div>
                      </div>
                    </div>

                    {/* Expanded predictions */}
                    {selectedDay === day.date && (
                      <div className="border-t border-slate-700 p-4 space-y-2 max-h-60 overflow-y-auto">
                        {day.predictions.slice(0, 10).map((pred) => (
                          <div 
                            key={pred.id}
                            className="flex items-center justify-between py-2 px-3 bg-slate-900/50 rounded-lg text-sm"
                          >
                            <div className="flex-1 truncate text-slate-300 pr-4">
                              {pred.title}
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="text-slate-500">AI: {Math.round(pred.aiProb * 100)}%</span>
                              <span className="text-slate-500">Mkt: {Math.round(pred.marketProb * 100)}%</span>
                              <span className={`font-mono font-bold ${pred.edge > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {pred.edge > 0 ? '+' : ''}{(pred.edge * 100).toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        ))}
                        {day.predictions.length > 10 && (
                          <div className="text-center text-slate-500 text-sm py-2">
                            +{day.predictions.length - 10} more predictions
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
};

