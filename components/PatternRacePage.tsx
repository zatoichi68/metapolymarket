import React from 'react';
import { ArrowUpRight, BrainCircuit, ExternalLink, GitBranch, ShieldAlert, Target, TrendingUp, Users } from 'lucide-react';
import { MarketAnalysis } from '../types';
import { getPolymarketUrl } from '../services/linkService';
import { getMarketSignal, MarketSignal } from '../services/marketSignals';

type PatternToken = 'H' | 'T';
type PatternKey = `${PatternToken}${PatternToken}${PatternToken}`;

interface PatternRacePageProps {
  markets: MarketAnalysis[];
  timestamp: string | null;
  stale: boolean;
  onMarketClick: (market: MarketAnalysis) => void;
  onBet: (url: string) => void;
}

interface PatternRow {
  market: MarketAnalysis;
  signal: MarketSignal;
  pattern: PatternKey;
  tokens: {
    alpha: PatternToken;
    price: PatternToken;
    tape: PatternToken;
  };
  score: number;
  thesis: string;
  action: string;
}

const formatPercent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

const formatMoney = (value: number) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
};

const tokenClass = (token: PatternToken) =>
  token === 'H'
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : 'bg-sky-500/15 text-sky-300 border-sky-500/30';

const getPatternRow = (market: MarketAnalysis): PatternRow => {
  const signal = getMarketSignal(market);
  const confidence = Number(market.confidence) || 0;
  const probChange = Number(market.probChange) || 0;

  const alpha: PatternToken = signal.edge >= 0.015 && confidence >= 5 ? 'H' : 'T';
  const price: PatternToken = signal.displayMarketProb <= 0.5 ? 'T' : 'H';
  const tape: PatternToken = probChange > 0.01 ? 'H' : 'T';
  const pattern = `${alpha}${price}${tape}` as PatternKey;

  const liquidity = Math.log10((Number(market.volume) || 0) + 10);
  const patternBoost = pattern === 'HTT' ? 25 : pattern === 'TTH' ? -12 : 0;
  const score = patternBoost
    + signal.edgePercent * 2.2
    + signal.suggestedStake * 8
    + confidence * 1.5
    + liquidity;

  const thesis = pattern === 'HTT'
    ? 'Swarm alpha exists before the crowd has repriced the outcome.'
    : pattern === 'TTH'
      ? 'Price and tape move before the Swarm confirms the edge.'
      : 'Neutral race state: monitor until alpha, price, and tape align.';

  const action = pattern === 'HTT' && signal.suggestedStake > 0
    ? `Consider ${market.prediction} with a ${signal.suggestedStake.toFixed(1)}% capped stake.`
    : pattern === 'HTT'
      ? `Watch ${market.prediction}; wait for stake sizing to clear.`
      : pattern === 'TTH'
        ? 'Avoid chasing; wait for a confirmed Swarm edge.'
        : signal.isActionable
          ? `Actionable, but not HTT: size at ${signal.suggestedStake.toFixed(1)}%.`
          : 'No trade signal yet.';

  return { market, signal, pattern, tokens: { alpha, price, tape }, score, thesis, action };
};

const PatternBadge: React.FC<{ pattern: PatternKey }> = ({ pattern }) => (
  <div className="flex items-center gap-1" aria-label={`Pattern ${pattern}`}>
    {pattern.split('').map((token, index) => (
      <span
        key={`${token}-${index}`}
        className={`w-8 h-8 rounded-md border text-sm font-black flex items-center justify-center ${tokenClass(token as PatternToken)}`}
      >
        {token}
      </span>
    ))}
  </div>
);

const PatternMarketRow: React.FC<{
  row: PatternRow;
  rank: number;
  onMarketClick: (market: MarketAnalysis) => void;
  onBet: (url: string) => void;
}> = ({ row, rank, onMarketClick, onBet }) => {
  const { market, signal } = row;
  const drift = Number(market.probChange) || 0;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 hover:border-slate-600 transition-colors">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-lg overflow-hidden border border-slate-700 bg-slate-800 flex-shrink-0">
            {market.imageUrl ? (
              <img src={market.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-slate-800" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-xs text-slate-500 font-mono">#{rank}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {market.category}
              </span>
              <span className="text-xs text-slate-500">{market.analysisStatus || 'fresh'}</span>
            </div>
            <button
              onClick={() => onMarketClick(market)}
              className="text-left text-white font-semibold leading-snug hover:text-blue-300 transition-colors line-clamp-2"
            >
              {market.title}
            </button>
            <p className="text-sm text-slate-400 mt-1 line-clamp-2">{row.thesis}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 lg:w-[620px]">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Pattern</div>
            <PatternBadge pattern={row.pattern} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Pick</div>
            <div className="text-sm font-bold text-white truncate">{market.prediction}</div>
            <div className="text-xs text-slate-500">{market.confidence}/10 conf.</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Price / Swarm</div>
            <div className="text-sm font-mono text-slate-200">
              {formatPercent(signal.displayMarketProb, 0)} / {formatPercent(signal.displayAiProb, 0)}
            </div>
            <div className={signal.edge >= 0 ? 'text-xs font-bold text-emerald-400' : 'text-xs font-bold text-orange-400'}>
              {signal.edge >= 0 ? '+' : ''}{formatPercent(signal.edge)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Tape / Vol.</div>
            <div className={drift >= 0 ? 'text-sm font-mono text-emerald-300' : 'text-sm font-mono text-orange-300'}>
              {drift >= 0 ? '+' : ''}{formatPercent(drift)}
            </div>
            <div className="text-xs text-slate-500">{formatMoney(Number(market.volume) || 0)}</div>
          </div>
          <div className="col-span-2 sm:col-span-4 lg:col-span-1 flex lg:flex-col gap-2 lg:items-stretch">
            <button
              onClick={() => onMarketClick(market)}
              className="flex-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs font-bold transition-colors"
            >
              Reasoning
            </button>
            <button
              onClick={() => onBet(getPolymarketUrl(market.slug))}
              className="flex-1 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded-md text-xs font-bold transition-colors flex items-center justify-center gap-1"
            >
              Trade <ExternalLink size={12} />
            </button>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs">
        <span className="text-slate-300">{row.action}</span>
        <span className="text-slate-500">Score {row.score.toFixed(1)}</span>
      </div>
    </div>
  );
};

export const PatternRacePage: React.FC<PatternRacePageProps> = ({
  markets,
  timestamp,
  stale,
  onMarketClick,
  onBet
}) => {
  const rows = React.useMemo(
    () => markets.map(getPatternRow).sort((a, b) => b.score - a.score),
    [markets]
  );

  const httRows = rows.filter(row => row.pattern === 'HTT');
  const tthRows = rows.filter(row => row.pattern === 'TTH');
  const actionRows = httRows.filter(row => row.signal.suggestedStake > 0).slice(0, 8);
  const trapRows = tthRows.slice(0, 5);
  const displayedRows = actionRows.length > 0 ? actionRows : httRows.slice(0, 8);

  const avgHttEdge = httRows.length
    ? httRows.reduce((sum, row) => sum + row.signal.edge, 0) / httRows.length
    : 0;

  return (
    <div className="space-y-8">
      <section className="border border-slate-800 bg-slate-950/40 rounded-xl overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-2 text-sky-300 font-bold text-sm uppercase tracking-wide mb-4">
              <GitBranch size={18} />
              Pattern Race Scanner
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight max-w-3xl">
              HTT beats TTH. Scan Polymarket for the same structural edge.
            </h2>
            <p className="mt-4 text-slate-400 max-w-2xl leading-relaxed">
              A fair coin gives both patterns the same standalone odds, but HTT appears before TTH 75% of the time.
              This page maps that overlap advantage onto live market picks: alpha first, then two uncrowded entry tests.
            </p>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">HTT candidates</div>
                <div className="text-3xl font-black text-emerald-300">{httRows.length}</div>
                <div className="text-xs text-slate-500 mt-1">Avg edge {formatPercent(avgHttEdge)}</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">TTH traps</div>
                <div className="text-3xl font-black text-orange-300">{tthRows.length}</div>
                <div className="text-xs text-slate-500 mt-1">Momentum before alpha</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Structural prior</div>
                <div className="text-3xl font-black text-sky-300">75%</div>
                <div className="text-xs text-slate-500 mt-1">P(HTT before TTH)</div>
              </div>
            </div>
          </div>

          <div className="relative min-h-[360px] bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 p-6 sm:p-8 flex flex-col justify-between">
            <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_30%_20%,rgba(14,165,233,0.28),transparent_32%),radial-gradient(circle_at_75%_65%,rgba(16,185,129,0.18),transparent_35%)]" />
            <div className="relative">
              <div className="flex items-center justify-between mb-6">
                <PatternBadge pattern="HTT" />
                <ArrowUpRight className="text-emerald-300" size={28} />
                <PatternBadge pattern="TTH" />
              </div>
              <div className="h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                <div className="h-full w-3/4 bg-gradient-to-r from-emerald-500 to-sky-400 rounded-full" />
              </div>
              <div className="mt-3 flex justify-between text-xs text-slate-400">
                <span>HTT: 3/4</span>
                <span>TTH: 1/4</span>
              </div>
            </div>

            <div className="relative grid grid-cols-1 gap-3 mt-8">
              <div className="flex items-start gap-3 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                <BrainCircuit className="text-emerald-300 mt-0.5" size={18} />
                <div>
                  <div className="text-sm font-bold text-white">H = Swarm hit</div>
                  <div className="text-xs text-slate-400">Positive alpha with usable confidence.</div>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                <Users className="text-sky-300 mt-0.5" size={18} />
                <div>
                  <div className="text-sm font-bold text-white">T = uncrowded test</div>
                  <div className="text-xs text-slate-400">Price below 50% or tape not yet chasing.</div>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                <ShieldAlert className="text-orange-300 mt-0.5" size={18} />
                <div>
                  <div className="text-sm font-bold text-white">TTH = chase risk</div>
                  <div className="text-xs text-slate-400">Cheap and moving before the model confirms the trade.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Target className="text-emerald-300" size={20} />
              HTT Action Queue
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Data from {timestamp ? new Date(timestamp).toLocaleString('fr-FR') : 'cache'}{stale ? ' · stale cache' : ' · fresh cache'}
            </p>
          </div>
          <div className="text-xs text-slate-500">
            Sorted by overlap boost, alpha, stake, confidence, and volume.
          </div>
        </div>

        {displayedRows.length > 0 ? (
          <div className="space-y-3">
            {displayedRows.map((row, index) => (
              <PatternMarketRow
                key={row.market.id}
                row={row}
                rank={index + 1}
                onMarketClick={onMarketClick}
                onBet={onBet}
              />
            ))}
          </div>
        ) : (
          <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-10 text-center">
            <TrendingUp className="mx-auto text-slate-600 mb-3" size={40} />
            <div className="text-white font-bold">No HTT setup in the current cache.</div>
            <p className="text-slate-500 text-sm mt-1">The scanner will surface candidates as soon as alpha appears before crowd repricing.</p>
          </div>
        )}
      </section>

      {trapRows.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <ShieldAlert className="text-orange-300" size={20} />
            <h3 className="text-xl font-bold text-white">TTH Watchlist</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {trapRows.map((row, index) => (
              <div key={row.market.id} className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-orange-300 font-mono">#{index + 1}</span>
                      <PatternBadge pattern={row.pattern} />
                    </div>
                    <button
                      onClick={() => onMarketClick(row.market)}
                      className="text-left text-white font-semibold hover:text-orange-200 line-clamp-2"
                    >
                      {row.market.title}
                    </button>
                    <p className="text-xs text-slate-400 mt-2">{row.action}</p>
                  </div>
                  <button
                    onClick={() => onMarketClick(row.market)}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs font-bold flex-shrink-0"
                  >
                    Check
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
