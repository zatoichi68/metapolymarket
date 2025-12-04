import React, { useEffect, useState } from 'react';
import { getDailyMarkets } from './services/polymarketService';
import { MarketAnalysis, Category } from './types';
import { MarketCard } from './components/MarketCard';
import { MarketDetailModal } from './components/MarketDetailModal';
import { Activity, BarChart3, Filter, RefreshCw, Zap, Swords, Clock, AlertTriangle, HelpCircle, X, ExternalLink } from 'lucide-react';

const App: React.FC = () => {
  const [markets, setMarkets] = useState<MarketAnalysis[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>(Category.ALL);
  const [showContrarian, setShowContrarian] = useState<boolean>(false);
  const [timeFilter, setTimeFilter] = useState<string>('all'); // 'all', '1d', '1w', '1m'
  const [selectedMarket, setSelectedMarket] = useState<MarketAnalysis | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState<boolean>(false);
  const [pendingBetUrl, setPendingBetUrl] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // getDailyMarkets handles caching (Firebase) logic internally
      const data = await getDailyMarkets();
      setMarkets(data);
    } catch (err) {
      console.error(err);
      setError("Market data is currently unavailable.");
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredMarkets = markets.filter(m => {
    // Category Filter
    const matchesCategory = selectedCategory === Category.ALL
      ? true
      : (m.category.toLowerCase().includes(selectedCategory.toLowerCase()) || (selectedCategory === 'Other' && !['Politics', 'Crypto', 'Sports', 'Business'].includes(m.category)));
    
    // Contrarian Filter (AI disagrees with Crowd)
    // Crowd pick is Outcomes[0] if marketProb > 0.5, else Outcomes[1]
    // AI pick is Outcomes[0] if aiProb > 0.5, else Outcomes[1]
    // Disagreement means one is >= 0.5 and other is < 0.5
    const isContrarian = (m.marketProb >= 0.5 && m.aiProb < 0.5) || (m.marketProb < 0.5 && m.aiProb >= 0.5);
    const matchesContrarian = showContrarian ? isContrarian : true;

    // Time Filter
    let matchesTime = true;
    if (timeFilter !== 'all' && m.endDate) {
        const end = new Date(m.endDate).getTime();
        const now = Date.now();
        const diff = end - now;
        
        // Ensure event hasn't passed (diff > 0) although active=true in API covers this usually
        if (diff > 0) {
            if (timeFilter === '1d') matchesTime = diff <= 24 * 60 * 60 * 1000;
            else if (timeFilter === '1w') matchesTime = diff <= 7 * 24 * 60 * 60 * 1000;
            else if (timeFilter === '1m') matchesTime = diff <= 30 * 24 * 60 * 60 * 1000;
        } else {
            matchesTime = false;
        }
    }

    return matchesCategory && matchesContrarian && matchesTime;
  });

  const categories = Object.values(Category);

  const handleBetClick = (url: string) => {
    setPendingBetUrl(url);
  };

  const confirmBet = () => {
    if (pendingBetUrl) {
      window.open(pendingBetUrl, '_blank', 'noopener,noreferrer');
      setPendingBetUrl(null);
    }
  };
  
  const timeFilters = [
    { id: 'all', label: 'Any Time' },
    { id: '1d', label: '< 24h' },
    { id: '1w', label: '< 1w' },
    { id: '1m', label: '< 1m' },
  ];

  return (
    <div className="min-h-screen bg-poly-dark text-slate-100 pb-20 font-sans">
      
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-poly-dark/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="bg-gradient-to-tr from-blue-600 to-purple-600 p-2 rounded-lg">
                <Activity className="text-white h-6 w-6" />
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                MetaPolymarket
              </span>
            </div>
            <div className="flex items-center gap-2">
               <button 
                onClick={() => setShowHowItWorks(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
               >
                 <HelpCircle size={16} />
                 <span className="hidden sm:inline">How it works</span>
               </button>
               <button 
                onClick={loadData}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
                title="Refresh data"
               >
                 <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
               </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* Header Section */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2 flex items-center gap-3">
             Crowd Wisdom <span className="text-slate-500 text-2xl">vs</span> Swarm AI
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl">
            Detect arbitrage opportunities where AI disagrees with the Polymarket prediction market.
          </p>
        </div>

        {/* Dashboard Controls */}
        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 mb-8 space-y-4 xl:space-y-0">
          
          <div className="flex flex-col xl:flex-row gap-4 justify-between">
              
            {/* Top Row / Left Side: Categories & Time */}
            <div className="flex flex-wrap gap-4 items-center">
                
                {/* Categories */}
                <div className="flex flex-wrap items-center gap-2">
                    <Filter size={18} className="text-slate-500 mr-2" />
                    {categories.map((cat) => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                        selectedCategory === cat
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                        }`}
                    >
                        {cat}
                    </button>
                    ))}
                </div>

                <div className="hidden sm:block w-px h-6 bg-slate-700 mx-1"></div>

                {/* Time Filters */}
                <div className="flex flex-wrap items-center gap-2">
                    <Clock size={18} className="text-slate-500 mr-2" />
                    {timeFilters.map((tf) => (
                    <button
                        key={tf.id}
                        onClick={() => setTimeFilter(tf.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wide transition-all ${
                        timeFilter === tf.id
                            ? 'bg-slate-600 text-white ring-1 ring-slate-500'
                            : 'bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300'
                        }`}
                    >
                        {tf.label}
                    </button>
                    ))}
                </div>
            </div>

            {/* Right Side: Contrarian & Count */}
            <div className="flex flex-wrap items-center gap-4 xl:justify-end border-t xl:border-t-0 border-slate-800 pt-4 xl:pt-0">
                {/* Contrarian Toggle */}
                <button
                    onClick={() => setShowContrarian(!showContrarian)}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wide transition-all border ${
                        showContrarian
                        ? 'bg-purple-500/10 border-purple-500 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                    <Swords size={16} />
                    Market Mispricing
                </button>

                <div className="text-slate-500 text-sm font-mono flex items-center gap-2">
                    <Zap size={14} className="text-yellow-500"/>
                    {filteredMarkets.length} Active
                </div>
            </div>

          </div>

        </div>

        {/* Grid or Error */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-80 bg-slate-800 rounded-xl border border-slate-700/50"></div>
            ))}
          </div>
        ) : error ? (
            <div className="col-span-full text-center py-20 flex flex-col items-center bg-slate-900/30 rounded-xl border border-red-900/30">
                <div className="bg-red-500/10 p-4 rounded-full mb-4">
                    <AlertTriangle size={48} className="text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-red-400 mb-2">Service Unavailable</h3>
                <p className="text-slate-400 max-w-md mx-auto mb-6">
                    {error}
                </p>
                <button 
                    onClick={loadData}
                    className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors font-medium border border-slate-700"
                >
                    Try Again
                </button>
            </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredMarkets.length > 0 ? (
              filteredMarkets.map((market) => (
                <MarketCard 
                  key={market.id} 
                  market={market} 
                  onAnalyze={setSelectedMarket}
                  onBet={handleBetClick}
                />
              ))
            ) : (
              <div className="col-span-full text-center py-20 text-slate-500 flex flex-col items-center">
                 <BarChart3 size={48} className="mb-4 opacity-50"/>
                 <p className="text-lg">No markets found matching your filters.</p>
                 {showContrarian && (
                     <p className="text-sm text-slate-600 mt-2">The Swarm AI currently agrees with the crowd on all selected markets.</p>
                 )}
              </div>
            )}
          </div>
        )}

        <MarketDetailModal 
            market={selectedMarket} 
            isOpen={!!selectedMarket} 
            onClose={() => setSelectedMarket(null)}
            onBet={handleBetClick}
        />

        {/* How It Works Modal */}
        {showHowItWorks && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowHowItWorks(false)} />
            <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
              
              <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white">How MetaPolymarket Works</h2>
                <button onClick={() => setShowHowItWorks(false)} className="text-slate-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-purple-400 mb-2">🤖 The Meta-Oracle AI</h3>
                  <p className="text-slate-300">
                    Our AI acts as a "Superforecaster" inspired by Philip Tetlock's research. For each market, it simulates a debate between three virtual agents:
                  </p>
                  <ul className="mt-2 space-y-1 text-slate-400 text-sm ml-4">
                    <li>• <strong className="text-blue-400">Agent Data</strong> - Analyzes historical statistics and base rates</li>
                    <li>• <strong className="text-green-400">Agent Sentiment</strong> - Evaluates crowd psychology and media momentum</li>
                    <li>• <strong className="text-red-400">Agent Contrarian</strong> - Searches for "Black Swan" risks the crowd ignores</li>
                  </ul>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold text-amber-400 mb-2">📊 Kelly Criterion</h3>
                  <p className="text-slate-300">
                    When the AI detects an edge (difference between its probability and market odds), it calculates the optimal bet size using the Kelly Criterion - a mathematical formula for maximizing long-term growth while managing risk.
                  </p>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold text-emerald-400 mb-2">⚡ Market Mispricing</h3>
                  <p className="text-slate-300">
                    The "Market Mispricing" filter shows markets where the AI strongly disagrees with the crowd - potential arbitrage opportunities where the market may be wrong.
                  </p>
                </div>
                
                <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                  <p className="text-slate-400 text-sm">
                    <strong className="text-slate-300">⚠️ Disclaimer:</strong> This tool is for informational purposes only. AI predictions are not financial advice. Always do your own research before placing any bets.
                  </p>
                </div>
              </div>
              
            </div>
          </div>
        )}

        {/* Bet Disclaimer Modal */}
        {pendingBetUrl && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setPendingBetUrl(null)} />
            <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
              
              <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <AlertTriangle className="text-amber-400" size={24} />
                  Before You Bet
                </h2>
                <button onClick={() => setPendingBetUrl(null)} className="text-slate-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <p className="text-slate-300">
                  You are about to leave MetaPolymarket and go to <strong className="text-white">Polymarket</strong> to place a bet.
                </p>
                
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-2">
                  <p className="text-amber-300 text-sm font-medium">⚠️ Important Disclaimer:</p>
                  <ul className="text-slate-400 text-sm space-y-1">
                    <li>• AI predictions are <strong className="text-slate-300">not financial advice</strong></li>
                    <li>• Past performance does not guarantee future results</li>
                    <li>• Only bet what you can afford to lose</li>
                    <li>• Prediction markets involve significant risk</li>
                  </ul>
                </div>
                
                <p className="text-slate-500 text-xs">
                  By continuing, you acknowledge that you understand the risks involved in prediction market trading.
                </p>
              </div>
              
              <div className="p-6 border-t border-slate-800 flex gap-3">
                <button 
                  onClick={() => setPendingBetUrl(null)}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmBet}
                  className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                  Continue to Polymarket <ExternalLink size={16} />
                </button>
              </div>
              
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default App;