import React, { useEffect, useState } from 'react';
import { getDailyMarkets, getHourlyMarkets } from './services/polymarketService';
import { savePredictionsToHistory, getFavoritedMarketsFromHistory } from './services/historyService';
import { trackPageView, trackPremiumSignup, trackMarketView, trackBetClick } from './services/firebase';
import { PredictionHistory } from './components/PredictionHistory';
import { EdgeAlerts, getHighEdgeMarkets } from './components/EdgeAlerts';
import { MarketAnalysis, Category } from './types';
import { MarketCard } from './components/MarketCard';
import { MarketDetailModal } from './components/MarketDetailModal';
import { PremiumAccessModal } from './components/PremiumAccessModal';
import { Activity, BarChart3, Filter, RefreshCw, Zap, Swords, Clock, AlertTriangle, HelpCircle, X, ExternalLink, Search, ArrowUpDown, TrendingUp, DollarSign, Target, Calendar, History, Flame, Crown, Sparkles, Bookmark, Droplets, Timer, GitBranch } from 'lucide-react';

const App: React.FC = () => {
  const [markets, setMarkets] = useState<MarketAnalysis[]>([]);
  const [dailyTimestamp, setDailyTimestamp] = useState<string | null>(null);
  const [hourlyMarkets, setHourlyMarkets] = useState<MarketAnalysis[]>([]);
  const [hourlyTimestamp, setHourlyTimestamp] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>(Category.ALL);
  const [showContrarian, setShowContrarian] = useState<boolean>(false);
  const [showFavorites, setShowFavorites] = useState<boolean>(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('metapolymarket_favorites');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [timeFilter, setTimeFilter] = useState<string>('all'); // 'all', '1d', '1w', '1m'
  const [statusFilter, setStatusFilter] = useState<string>('all'); // 'all', 'active', 'resolved'
  const [selectedMarket, setSelectedMarket] = useState<MarketAnalysis | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState<boolean>(false);
  const [showPremiumModal, setShowPremiumModal] = useState<boolean>(false);
  const [pendingBetUrl, setPendingBetUrl] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('edge'); // Default sort by Edge
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showAlerts, setShowAlerts] = useState<boolean>(false);
  const [isPremium, setIsPremium] = useState<boolean>(() => {
    // Persist premium status in localStorage
    return localStorage.getItem('metapolymarket_premium') === 'true';
  });
  const [dataSource, setDataSource] = useState<'daily' | 'hourly'>('daily');
  const [historicalFavorites, setHistoricalFavorites] = useState<MarketAnalysis[]>([]);

  // Fetch favorited markets from history when favorites change
  useEffect(() => {
    const fetchHistoricalFavorites = async () => {
      if (favorites.length > 0) {
        const histFavs = await getFavoritedMarketsFromHistory(favorites);
        setHistoricalFavorites(histFavs);
      } else {
        setHistoricalFavorites([]);
      }
    };
    fetchHistoricalFavorites();
  }, [favorites]);

  // Backend verification of premium status on mount
  useEffect(() => {
    const checkStatus = async () => {
        const storedEmail = localStorage.getItem('metapolymarket_email');
        const storedPremium = localStorage.getItem('metapolymarket_premium') === 'true';

        if (storedPremium && storedEmail) {
            try {
                 // Determine API URL
                 let apiUrl: string;
                 const PROJECT_ID = (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || 'demo-project';
                 if ((import.meta as any).env?.DEV) {
                    apiUrl = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/checkPremiumStatus`;
                 } else {
                    // Cloud Run URL for Firebase Functions v2
                    apiUrl = 'https://checkpremiumstatus-krtdefxoka-uc.a.run.app';
                 }

                 const response = await fetch(apiUrl, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ email: storedEmail })
                 });
                 
                 if (response.ok) {
                     const data = await response.json();
                     if (!data.isPremium) {
                         console.log("Premium status revoked by backend.");
                         setIsPremium(false);
                         localStorage.setItem('metapolymarket_premium', 'false');
                         setDataSource('daily');
                     } else {
                         console.log("Premium status confirmed.");
                     }
                 }
            } catch (err) {
                console.error("Failed to verify premium status:", err);
                // On error (e.g. offline), we maintain the current local state
            }
        }
    };
    
    checkStatus();
  }, []);

  const handlePremiumClick = () => {
    if (isPremium) {
      // If already premium, maybe show settings or just toggle off (optional)
      // For now, let's keep it simple: if premium, it's just active.
      // If user wants to toggle OFF for testing, we could add a debug option, 
      // but usually you don't "turn off" premium.
      // However, to respect the previous toggle behavior for testing:
      const confirmDeactivate = window.confirm("Deactivate Premium mode?");
      if (confirmDeactivate) {
         setIsPremium(false);
         localStorage.setItem('metapolymarket_premium', 'false');
         setDataSource('daily');
      }
    } else {
      setShowPremiumModal(true);
    }
  };

  const onPremiumSuccess = () => {
      setIsPremium(true);
      localStorage.setItem('metapolymarket_premium', 'true');
      setDataSource('hourly'); // Switch to hourly immediately upon success
      // Track premium signup
      const email = localStorage.getItem('metapolymarket_email') || '';
      trackPremiumSignup(email);
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load daily markets (always)
      const dailyData = await getDailyMarkets();
      if (dailyData) {
        setMarkets(dailyData.markets);
        setDailyTimestamp(dailyData.timestamp);
        
        // Save to prediction history
        if (dailyData.markets.length > 0) {
          savePredictionsToHistory(dailyData.markets).catch(console.error);
        }
      } else {
        setMarkets([]);
        setDailyTimestamp(null);
      }
      
      // Load hourly markets if premium
      if (isPremium) {
        const hourlyData = await getHourlyMarkets();
        if (hourlyData) {
          setHourlyMarkets(hourlyData.markets);
          setHourlyTimestamp(hourlyData.timestamp);
        } else {
          setHourlyMarkets([]);
          setHourlyTimestamp(null);
        }
      }
    } catch (err) {
      console.error(err);
      setError("Market data is currently unavailable.");
      setMarkets([]);
      setDailyTimestamp(null);
      setHourlyMarkets([]);
      setHourlyTimestamp(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Track page view on initial load
    trackPageView('Home');
  }, [isPremium]);

  // Use hourly data if premium and selected, otherwise daily
  const activeMarkets = (isPremium && dataSource === 'hourly' && hourlyMarkets.length > 0) 
    ? hourlyMarkets 
    : markets;

  // Get active timestamp
  const activeTimestamp = (isPremium && dataSource === 'hourly' && hourlyTimestamp) 
    ? hourlyTimestamp 
    : dailyTimestamp;

  // Format timestamp to local DD/MM/YYYY HH:MM:SS
  const formatTimestamp = (ts: string | null) => {
    if (!ts) return 'Data loading...';
    const date = new Date(ts);
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(',', '');
  };

  // When favorites filter is on, merge current markets with historical favorites
  const marketsToFilter = React.useMemo(() => {
    if (showFavorites && historicalFavorites.length > 0) {
      // Get IDs of current markets
      const currentIds = new Set(activeMarkets.map(m => m.id));
      // Add historical favorites that aren't in current markets
      const missingFavorites = historicalFavorites.filter(hf => !currentIds.has(hf.id));
      return [...activeMarkets, ...missingFavorites];
    }
    return activeMarkets;
  }, [activeMarkets, historicalFavorites, showFavorites]);

  const filteredMarkets = marketsToFilter.filter(m => {
    // Search Filter
    const matchesSearch = searchQuery === '' 
      ? true 
      : m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.outcomes.some(o => o.toLowerCase().includes(searchQuery.toLowerCase()));

    // Category Filter
    const matchesCategory = selectedCategory === Category.ALL
      ? true
      : (m.category.toLowerCase().includes(selectedCategory.toLowerCase()) || (selectedCategory === 'Other' && !['Politics', 'Crypto', 'Sports', 'Business'].includes(m.category)));
    
    // Contrarian Filter (AI disagrees with Crowd)
    const isContrarian = (m.marketProb >= 0.5 && m.aiProb < 0.5) || (m.marketProb < 0.5 && m.aiProb >= 0.5);
    const matchesContrarian = showContrarian ? isContrarian : true;

    // Favorites Filter
    const matchesFavorites = showFavorites ? favorites.includes(m.id) : true;

    // Frequency Filter (based on resolution timeframe)
    let matchesTime = true;
    if (timeFilter !== 'all' && m.endDate) {
        const end = new Date(m.endDate).getTime();
        const now = Date.now();
        const diff = end - now;
        
        if (diff > 0) {
            if (timeFilter === 'daily') matchesTime = diff <= 24 * 60 * 60 * 1000;
            else if (timeFilter === 'weekly') matchesTime = diff <= 7 * 24 * 60 * 60 * 1000;
            else if (timeFilter === 'monthly') matchesTime = diff <= 30 * 24 * 60 * 60 * 1000;
        } else {
            matchesTime = false;
        }
    }

    // Status Filter (active vs resolved)
    let matchesStatus = true;
    if (statusFilter !== 'all') {
        if (m.endDate) {
            const isResolved = new Date(m.endDate).getTime() < Date.now();
            if (statusFilter === 'active') matchesStatus = !isResolved;
            else if (statusFilter === 'resolved') matchesStatus = isResolved;
        } else {
            // No end date = assume active
            matchesStatus = statusFilter === 'active';
        }
    }

    return matchesSearch && matchesCategory && matchesContrarian && matchesTime && matchesFavorites && matchesStatus;
  }).sort((a, b) => {
    // Sort logic (matching Polymarket options)
    switch (sortBy) {
      case 'volume24h':
        // Use volume as proxy for 24h volume (we don't have separate 24h data)
        return b.volume - a.volume;
      case 'volume':
        return b.volume - a.volume;
      case 'liquidity':
        // Use volume as proxy for liquidity
        return b.volume - a.volume;
      case 'newest':
        // Sort by most recently added (we don't have created date, use ID as proxy)
        return b.id.localeCompare(a.id);
      case 'ending':
        // Ending Soon - closest end date first
        if (!a.endDate) return 1;
        if (!b.endDate) return -1;
        return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
      case 'competitive':
        // Most competitive = closest to 50/50 odds
        const aCompetitive = Math.abs(a.marketProb - 0.5);
        const bCompetitive = Math.abs(b.marketProb - 0.5);
        return aCompetitive - bCompetitive;
      case 'edge':
        // Sort by edge value (highest positive edge first)
        return b.edge - a.edge;
      default:
        return b.volume - a.volume;
    }
  });

  const categories = Object.values(Category);

  const handleBetClick = (url: string) => {
    setPendingBetUrl(url);
  };

  const confirmBet = () => {
    if (pendingBetUrl) {
      // Track bet click if we have market info
      if (selectedMarket) {
        trackBetClick(selectedMarket.id, selectedMarket.title);
      }
      window.open(pendingBetUrl, '_blank', 'noopener,noreferrer');
      setPendingBetUrl(null);
    }
  };

  const handleMarketSelect = (market: MarketAnalysis) => {
    setSelectedMarket(market);
    trackMarketView(market.id, market.title);
  };
  
  const frequencyFilters = [
    { id: 'all', label: 'All' },
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
  ];

  const statusFilters = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    // "Resolved" here means end date passée (marché terminé), pas l'issue officielle
    { id: 'resolved', label: 'Ended (by date)' },
  ];

  const sortOptions = [
    { id: 'edge', label: 'Highest Edge', icon: Zap },
    { id: 'volume24h', label: '24hr Volume', icon: TrendingUp },
    { id: 'volume', label: 'Total Volume', icon: DollarSign },
    { id: 'liquidity', label: 'Liquidity', icon: Droplets },
    { id: 'newest', label: 'Newest', icon: GitBranch },
    { id: 'ending', label: 'Ending Soon', icon: Timer },
    { id: 'competitive', label: 'Competitive', icon: Swords },
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
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                    MetaPolymarket
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 tracking-wider">
                    BETA
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
               {/* Premium Toggle */}
               {isPremium && (
                 <span className="text-xs text-slate-400 hidden md:inline-block">
                   Welcome, <span className="text-amber-400 font-medium">{localStorage.getItem('metapolymarket_email') || 'Premium User'}</span>
                 </span>
               )}
               <button 
                onClick={handlePremiumClick}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-all border ${
                  isPremium 
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold shadow-lg shadow-amber-500/25 border-transparent' 
                    : 'bg-slate-800/50 text-amber-400 hover:text-white hover:bg-slate-800 border-amber-500/30'
                }`}
                title={isPremium ? "Premium Active" : "Activate Premium - Free for a limited time"}
               >
                 <Crown size={16} className={isPremium ? "text-white" : "text-amber-400"} />
                 <div className="flex flex-col items-start leading-none">
                    <span className="font-bold">{isPremium ? "Premium" : "Go Premium"}</span>
                    {!isPremium && <span className="text-[10px] text-amber-200/80 font-medium hidden sm:inline-block">Free for a limited time</span>}
                 </div>
               </button>

               {/* Alerts Button with Badge */}
               <button 
                onClick={() => setShowAlerts(true)}
                className="relative flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
               >
                 <Flame size={16} className={getHighEdgeMarkets(activeMarkets).length > 0 ? "text-orange-400" : ""} />
                 <span className="hidden sm:inline">Alerts</span>
                 {getHighEdgeMarkets(activeMarkets).length > 0 && (
                   <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                     {getHighEdgeMarkets(activeMarkets).length}
                   </span>
                 )}
               </button>
               <button 
                onClick={() => {
                  setShowHistory(true);
                  // Focus on accuracy tab
                  // Note: Since state is internal, we'll add a prop to PredictionHistory for initial tab
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
               >
                 <BarChart3 size={16} />
                 <span className="hidden sm:inline">Backtest</span>
               </button>
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
             Crowd Wisdom <span className="text-slate-500 text-2xl">vs</span> Swarm AI <span className="text-xs text-slate-600 ml-2 font-normal border border-slate-700 rounded px-1.5 py-0.5">v1.1.0</span>
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl">
            Detect arbitrage opportunities where AI disagrees with the Polymarket prediction market.
          </p>
        </div>

        {/* Data Source Info */}
        <div className="mb-6 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Activity className="text-blue-400" size={20} />
              <div>
                <h3 className="text-white font-semibold flex items-center gap-2">
                  {dataSource === 'hourly' ? 'Hourly Update' : 'Daily Update'}
                  {dataSource === 'hourly' && <span className="text-xs bg-amber-500 text-black px-2 py-0.5 rounded-full font-bold">LIVE</span>}
                </h3>
                <p className="text-slate-400 text-sm">
                  Last update: {formatTimestamp(activeTimestamp)}
                </p>
              </div>
            </div>
            {isPremium && (
              <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg p-1">
                <button
                  onClick={() => setDataSource('daily')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    dataSource === 'daily'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Daily (6AM UTC)
                </button>
                <button
                  onClick={() => setDataSource('hourly')}
                  disabled={hourlyMarkets.length === 0}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    dataSource === 'hourly'
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
                      : hourlyMarkets.length === 0 
                        ? 'text-slate-600 cursor-not-allowed'
                        : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Clock size={14} />
                  Hourly
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
          <input
            type="text"
            placeholder="Search markets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-900/50 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Dashboard Controls */}
        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 mb-8 space-y-4">
          
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

                {/* Sort By (like Polymarket) */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">Sort by:</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      {sortOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                </div>

                <div className="hidden sm:block w-px h-6 bg-slate-700 mx-1"></div>

                {/* Frequency (like Polymarket) */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">Frequency:</span>
                    <select
                      value={timeFilter}
                      onChange={(e) => setTimeFilter(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      {frequencyFilters.map((f) => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                      ))}
                    </select>
                </div>

                <div className="hidden sm:block w-px h-6 bg-slate-700 mx-1"></div>

                {/* Status Filter */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">Status:</span>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      {statusFilters.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                </div>
            </div>

            {/* Right Side: Contrarian & Count */}
            <div className="flex flex-wrap items-center gap-4 xl:justify-end border-t xl:border-t-0 border-slate-800 pt-4 xl:pt-0">
                {/* Favorites Toggle */}
                <button
                    onClick={() => setShowFavorites(!showFavorites)}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wide transition-all border ${
                        showFavorites
                        ? 'bg-amber-500/10 border-amber-500 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                    <Bookmark size={14} className={showFavorites ? 'fill-amber-400' : ''} />
                    Favorites {favorites.length > 0 && `(${favorites.length})`}
                </button>

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
                  onAnalyze={handleMarketSelect}
                  onBet={handleBetClick}
                  onFavoriteToggle={(id, isFav) => {
                    setFavorites(prev => isFav ? [...prev, id] : prev.filter(f => f !== id));
                  }}
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

        <PredictionHistory 
            isOpen={showHistory} 
            onClose={() => setShowHistory(false)}
            initialTab="accuracy"
            onSelectMarket={handleMarketSelect}
        />

        <MarketDetailModal 
            market={selectedMarket} 
            isOpen={!!selectedMarket} 
            onClose={() => setSelectedMarket(null)} 
            onBet={handleBetClick}
        />

        <EdgeAlerts 
            isOpen={showAlerts} 
            onClose={() => setShowAlerts(false)}
            markets={activeMarkets}
            onMarketClick={handleMarketSelect}
            onBet={handleBetClick}
        />

        <PremiumAccessModal 
            isOpen={showPremiumModal} 
            onClose={() => setShowPremiumModal(false)}
            onSuccess={onPremiumSuccess}
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

      {/* Footer SEO & Links */}
      <footer className="border-t border-slate-800 bg-slate-900/50 mt-12 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="text-blue-400 h-6 w-6" />
                <span className="text-xl font-bold text-white">MetaPolymarket</span>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed max-w-md">
                MetaPolymarket provides advanced AI-driven analysis for prediction markets. 
                Our Meta-Oracle engine analyzes Polymarket events to identify arbitrage opportunities, 
                assess true probabilities, and calculate Kelly Criterion stake sizing for data-driven betting strategies.
              </p>
            </div>
            
            <div>
              <h4 className="text-white font-bold mb-4">Market Categories</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><button onClick={() => setSelectedCategory(Category.POLITICS)} className="hover:text-blue-400 transition-colors">Politics Predictions</button></li>
                <li><button onClick={() => setSelectedCategory(Category.CRYPTO)} className="hover:text-blue-400 transition-colors">Crypto Markets</button></li>
                <li><button onClick={() => setSelectedCategory(Category.SPORTS)} className="hover:text-blue-400 transition-colors">Sports Betting</button></li>
                <li><button onClick={() => setSelectedCategory(Category.BUSINESS)} className="hover:text-blue-400 transition-colors">Business & Tech</button></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><button onClick={() => setShowHowItWorks(true)} className="hover:text-blue-400 transition-colors">How AI Analysis Works</button></li>
                <li><button onClick={() => setShowHistory(true)} className="hover:text-blue-400 transition-colors">Prediction History</button></li>
                <li><button onClick={() => setShowPremiumModal(true)} className="hover:text-amber-400 transition-colors">Premium Access</button></li>
                <li><a href="https://polymarket.com?via=steve-rioux" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">Visit Polymarket</a></li>
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-500">
            <p>&copy; {new Date().getFullYear()} MetaPolymarket. All rights reserved.</p>
            <div className="flex gap-6">
              <span>Not Financial Advice</span>
              <span>Prediction Markets Analysis</span>
              <span>AI Forecasting</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;