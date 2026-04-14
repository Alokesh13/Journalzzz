import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";

// Types
type Side = "long" | "short";
type Outcome = "Win" | "Loss" | "Break Even";
type RuleFollowed = "YES" | "NO";
type TradeType = "Market" | "Limit" | "Stop";

type Trade = {
  id: string;
  datetime: string; // Start Date & Time
  exitDatetime: string; // End Date & Time
  symbol: string;
  timeframe: string;
  side: Side;
  outcome: Outcome;
  result: number; // P&L ($)
  roi: number; // ROI (%)
  size: number; // Lot Size
  tradeType: TradeType;
  ruleFollowed: RuleFollowed;
  emotionalState: string;
  rating: number; // 1-5
  notes: string;
  mistakes: string;
  lessons: string;
  screenshots: string[];
  // Legacy/Internal
  entry: number;
  exit: number;
  fees: number;
  strategy?: string;
  tags: string[];
};

type Metrics = {
  totalPnL: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  bestTrade: number;
  worstTrade: number;
  avgRR: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  grossProfit: number;
  grossLoss: number;
  avgHoldingMinutes: number;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: number;
  sharpe: number;
};

const STORAGE_KEY = "trading_journal_v1";
const THEME_KEY = "trading_journal_theme_v1";

// Start with an empty trades array (no demo data)
const initialTrades: Trade[] = [];

function cn(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

function formatCurrency(n: number) {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return `${sign}$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toYMD(d: Date) {
  return d.toISOString().slice(0, 10);
}

function computeTradePnL(t: Trade) {
  return t.result;
}



function calcMetrics(trades: Trade[]): Metrics {
  const sorted = [...trades].sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let maxDDPct = 0;
  const pnls = sorted.map((t) => {
    const pnl = t.result;
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    const ddPct = peak > 0 ? dd / peak : 0;
    if (dd > maxDD) maxDD = dd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;
    return pnl;
  });

  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const totalPnL = pnls.reduce((a, b) => a + b, 0);
  const winRate = pnls.length ? wins.length / pnls.length : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const expectancy = pnls.length ? totalPnL / pnls.length : 0;

  let best = -Infinity;
  let worst = Infinity;
  pnls.forEach((p) => {
    if (p > best) best = p;
    if (p < worst) worst = p;
  });

  // holding time: diff between start and end
  const holdTimes = sorted.map(t => (new Date(t.exitDatetime).getTime() - new Date(t.datetime).getTime()) / (1000 * 60));
  const avgHoldingMinutes = holdTimes.length ? holdTimes.reduce((a,b) => a+b, 0) / holdTimes.length : 0;

  // streaks
  let wStreak = 0;
  let lStreak = 0;
  let curW = 0;
  let curL = 0;
  let maxW = 0;
  let maxL = 0;
  for (const p of pnls) {
    if (p > 0) {
      curW += 1;
      curL = 0;
      if (curW > maxW) maxW = curW;
      wStreak = curW;
      lStreak = 0;
    } else if (p < 0) {
      curL += 1;
      curW = 0;
      if (curL > maxL) maxL = curL;
      lStreak = curL;
      wStreak = 0;
    } else {
      curW = 0;
      curL = 0;
    }
  }
  const currentStreak = wStreak > 0 ? wStreak : -lStreak;

  // RR average (approx)
  const rrList = sorted.map((t) => t.roi / 2); // simplistic proxy for RR if entry/exit not used
  const avgRR = rrList.length ? rrList.reduce((a, b) => a + b, 0) / rrList.length : 0;

  // Sharpe approx (daily returns)
  const byDay = new Map<string, number>();
  sorted.forEach((t) => {
    const ymd = toYMD(new Date(t.datetime));
    const pnl = t.result;
    byDay.set(ymd, (byDay.get(ymd) ?? 0) + pnl);
  });
  const dailyReturns = Array.from(byDay.values()).map((d) => d);
  const mean = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length > 1 ? dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (dailyReturns.length - 1) : 0;
  const stdev = Math.sqrt(variance);
  const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(252) : 0;

  return {
    totalPnL,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    bestTrade: isFinite(best) ? best : 0,
    worstTrade: isFinite(worst) ? worst : 0,
    avgRR,
    totalTrades: pnls.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    grossProfit,
    grossLoss,
    avgHoldingMinutes,
    longestWinStreak: maxW,
    longestLossStreak: maxL,
    currentStreak,
    sharpe,
  };
}

// Small Sparkline / Area chart
function AreaChart({ data, width = 600, height = 160, color = "#6366f1" }: { data: number[]; width?: number; height?: number; color?: string }) {
  const padding = 12;
  const w = width - padding * 2;
  const h = height - padding * 2;
  if (!data.length) {
    return <svg width={width} height={height} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const points = data.map((d, i) => {
    const x = padding + i * step;
    const y = padding + h - ((d - min) / range) * h;
    return [x, y] as const;
  });
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const area = `${line} L ${points[points.length - 1][0].toFixed(2)} ${padding + h} L ${points[0][0].toFixed(2)} ${padding + h} Z`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.15" />
        </filter>
      </defs>
      <path d={area} fill="url(#g)" />
      <path d={line} fill="none" stroke={color} strokeWidth={2.25} filter="url(#shadow)" strokeLinecap="round" strokeLinejoin="round" />
      {/* latest dot */}
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={3.5} fill={color} stroke="white" strokeWidth={1.5} />
    </svg>
  );
}

function BarPnlByMonth({ trades }: { trades: Trade[] }) {
  const byMonth = new Map<string, number>();
  trades.forEach((t) => {
    const d = new Date(t.datetime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const pnl = t.result ?? computeTradePnL(t);
    byMonth.set(key, (byMonth.get(key) ?? 0) + pnl);
  });
  const entries = Array.from(byMonth.entries()).sort((a, b) => (a[0] > b[0] ? 1 : -1));
  const labels = entries.map(([k]) => k.slice(5));
  const values = entries.map(([, v]) => v);
  const width = 600;
  const height = 180;
  const padding = 16;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const barW = values.length ? w / values.length - 8 : 0;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <line x1={padding} y1={padding + h / 2} x2={padding + w} y2={padding + h / 2} stroke="#e5e7eb" strokeDasharray="3 3" />
      {values.map((v, i) => {
        const x = padding + i * (barW + 8) + 4;
        const normalized = v / max;
        const barH = Math.abs(normalized) * (h / 2 - 6);
        const y = v >= 0 ? padding + h / 2 - barH : padding + h / 2;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(2, barH)} rx={6} fill={v >= 0 ? "#10b981" : "#ef4444"} opacity={0.9} />
            <text x={x + barW / 2} y={height - 4} textAnchor="middle" fontSize="10" fill="#6b7280">
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ win, loss }: { win: number; loss: number }) {
  const total = win + loss || 1;
  const winAngle = (win / total) * 2 * Math.PI;
  const r = 46;
  const cx = 60;
  const cy = 60;
  const x1 = cx + r * Math.cos(-Math.PI / 2);
  const y1 = cy + r * Math.sin(-Math.PI / 2);
  const x2 = cx + r * Math.cos(-Math.PI / 2 + winAngle);
  const y2 = cy + r * Math.sin(-Math.PI / 2 + winAngle);
  const largeArc = winAngle > Math.PI ? 1 : 0;
  const winPath = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  return (
    <svg width={120} height={120} className="block">
      <circle cx={cx} cy={cy} r={r} fill="#fee2e2" />
      <path d={winPath} fill="#10b981" />
      <circle cx={cx} cy={cy} r={r - 16} fill="white" />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontWeight={700} fill="#111827">
        {(win / (win + loss || 1) * 100).toFixed(0)}%
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="#6b7280">
        Win Rate
      </text>
    </svg>
  );
}

function CalendarHeatmap({ trades }: { trades: Trade[] }) {
  const byDay = new Map<string, number>();
  trades.forEach((t) => {
    const key = toYMD(new Date(t.datetime));
    const pnl = t.result ?? computeTradePnL(t);
    byDay.set(key, (byDay.get(key) ?? 0) + pnl);
  });
  const today = startOfDay(new Date("2026-03-31T12:00:00Z"));
  const start = new Date(today);
  start.setDate(start.getDate() - 83); // ~12 weeks
  const days: { date: Date; pnl: number }[] = [];
  const d = new Date(start);
  while (d <= today) {
    const key = toYMD(d);
    days.push({ date: new Date(d), pnl: byDay.get(key) ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  const cell = 14;
  const gap = 3;
  const cols = Math.ceil(days.length / 7);
  const width = cols * (cell + gap) + 20;
  const height = 7 * (cell + gap) + 20;
  const maxAbs = Math.max(1, ...days.map((x) => Math.abs(x.pnl)));
  function color(p: number) {
    if (p === 0) return "#f3f4f6";
    const t = Math.min(1, Math.abs(p) / maxAbs);
    if (p > 0) {
      const base = 200 + Math.round(40 * t);
      return `rgb(${255 - base}, ${255 - Math.round(30 * t)}, ${255 - base})`;
    } else {
      const base = 200 + Math.round(40 * t);
      return `rgb(${255 - Math.round(20 * t)}, ${255 - base}, ${255 - base})`;
    }
  }
  // Group into weeks
  const weeks: { date: Date; pnl: number }[][] = [];
  for (let i = 0; i < cols; i++) weeks.push([]);
  days.forEach((day, idx) => {
    const weekIdx = Math.floor(idx / 7);
    weeks[weekIdx].push(day);
  });

  return (
    <svg width={width} height={height} className="overflow-visible">
      {weeks.map((week, wi) =>
        week.map((day, di) => {
          const x = 10 + wi * (cell + gap);
          const y = 10 + di * (cell + gap);
          return <rect key={`${wi}-${di}`} x={x} y={y} width={cell} height={cell} rx={3} fill={color(day.pnl)} />;
        })
      )}
      <g fontSize="10" fill="#9ca3af">
        <text x={10} y={8}>Mon</text>
        <text x={10} y={8 + 6 * (cell + gap)}>Sun</text>
      </g>
    </svg>
  );
}

function useLocalTrades() {
  const [trades, setTrades] = useState<Trade[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Trade[];
        return parsed.map((t) => ({ ...t, result: t.result ?? computeTradePnL(t) }));
      }
    } catch {}
    return initialTrades;
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
    } catch {}
  }, [trades]);
  return { trades, setTrades };
}

function Chip({ children, color = "gray" }: { children: React.ReactNode; color?: "gray" | "green" | "red" | "indigo" | "amber" }) {
  const map: Record<string, string> = {
    gray: "bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    red: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    indigo: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", map[color])}>{children}</span>;
}

export default function App() {
  const { trades, setTrades } = useLocalTrades();
  const [query, setQuery] = useState("");
  const [symbolFilter, setSymbolFilter] = useState<string>("ALL");
  const [sideFilter, setSideFilter] = useState<"ALL" | Side>("ALL");
  const [strategyFilter, setStrategyFilter] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    // Check localStorage first, then fall back to system preference
    const stored = localStorage.getItem(THEME_KEY);
    if (stored !== null) {
      return stored === "dark";
    }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    // Save theme preference to localStorage
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  const symbols = useMemo(() => Array.from(new Set(trades.map((t) => t.symbol))).sort(), [trades]);
  const strategies = useMemo(() => Array.from(new Set(trades.map((t) => t.strategy).filter(Boolean) as string[])).sort(), [trades]);

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (symbolFilter !== "ALL" && t.symbol !== symbolFilter) return false;
      if (sideFilter !== "ALL" && t.side !== sideFilter) return false;
      if (strategyFilter !== "ALL" && t.strategy !== strategyFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = `${t.symbol} ${t.strategy ?? ""} ${t.tags.join(" ")} ${t.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const ts = +new Date(t.datetime);
      if (dateFrom && ts < +new Date(dateFrom)) return false;
      if (dateTo && ts > +new Date(dateTo + "T23:59:59")) return false;
      return true;
    });
  }, [trades, symbolFilter, sideFilter, strategyFilter, query, dateFrom, dateTo]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => +new Date(b.datetime) - +new Date(a.datetime)), [filtered]);

  const metrics = useMemo(() => calcMetrics(filtered), [filtered]);

  const equityCurve = useMemo(() => {
    const s = [...filtered].sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
    let eq = 0;
    const pts = [eq];
    for (const t of s) {
      eq += t.result ?? computeTradePnL(t);
      pts.push(+eq.toFixed(2));
    }
    return pts;
  }, [filtered]);

  const onAddTrade = useCallback((t: Omit<Trade, "id">) => {
    const trade: Trade = { ...t, id: Math.random().toString(36).slice(2) };
    setTrades((prev) => [trade, ...prev]);
  }, [setTrades]);

  const onUpdateTrade = useCallback((id: string, patch: Partial<Trade>) => {
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch, result: computeTradePnL({ ...t, ...patch }) } : t)));
  }, [setTrades]);

  const onDelete = useCallback((id: string) => {
    setTrades((prev) => prev.filter((t) => t.id !== id));
  }, [setTrades]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ trades }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trading-journal-${toYMD(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed)) {
          setTrades(parsed.map((t: Trade) => ({ ...t, result: computeTradePnL(t) })));
        } else if (parsed.trades) {
          setTrades(parsed.trades.map((t: Trade) => ({ ...t, result: computeTradePnL(t) })));
        }
      } catch {}
    };
    reader.readAsText(file);
    ev.target.value = "";
  }

  return (
    <div className={cn("min-h-screen bg-[#fafafa] text-zinc-900 antialiased dark:bg-[#0b0b0f] dark:text-zinc-100", "selection:bg-indigo-500/20 selection:text-indigo-900 dark:selection:text-white")}>
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <header className="sticky top-0 z-30 border-b border-zinc-200/60 bg-white/70 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 shadow-lg shadow-indigo-600/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M7 14l3-3 4 4 5-6" />
              </svg>
            </div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight">Trade Ledger</h1>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 -mt-1">Discipline, tracked</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setDark((d) => !d)}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 shadow-sm transition hover:bg-zinc-50 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              title="Toggle theme"
            >
              <span className="hidden sm:inline">{dark ? "Light" : "Dark"}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {dark ? (
                  <path d="M12 3v2M12 19v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41M12 8a4 4 0 100 8 4 4 0 000-8z" />
                ) : (
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                )}
              </svg>
            </button>

            <button
              onClick={exportJSON}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 shadow-sm hover:bg-zinc-50 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Export
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 shadow-sm hover:bg-zinc-50 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Import
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M19 12l-7-7-7 7" />
              </svg>
            </button>
            <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={importJSON} />

            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 px-4 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 transition hover:opacity-95 active:scale-[0.99]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Trade
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1240px] grid-cols-12 gap-4 px-4 py-6 sm:px-6 lg:px-8 lg:gap-6">
        {/* Controls */}
        <section className="col-span-12">
          <div className="flex flex-wrap items-end gap-3 rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Search</label>
              <div className="relative">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Symbol, strategy, tag, notes…"
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:bg-zinc-900"
                />
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Symbol</label>
              <select
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <option value="ALL">All</option>
                {symbols.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Side</label>
              <div className="flex overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                {(["ALL", "long", "short"] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setSideFilter(opt as any)}
                    className={cn(
                      "h-10 px-3 text-sm transition",
                      sideFilter === opt
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    )}
                  >
                    {opt[0].toUpperCase() + opt.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Strategy</label>
              <select
                value={strategyFilter}
                onChange={(e) => setStrategyFilter(e.target.value)}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <option value="ALL">All</option>
                {strategies.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
            </div>


          </div>
        </section>

        {/* Metrics grid */}
        <section className="col-span-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Net P&L" value={formatCurrency(metrics.totalPnL)} sub={`${metrics.totalTrades} trades`} positive={metrics.totalPnL >= 0} />
          <MetricCard label="Win rate" value={formatPercent(metrics.winRate)} sub={`${metrics.winningTrades}W / ${metrics.losingTrades}L`} />
          <MetricCard label="Profit factor" value={metrics.profitFactor === Infinity ? "∞" : metrics.profitFactor.toFixed(2)} sub={`Avg W ${formatCurrency(metrics.avgWin)}`} />
          <MetricCard label="Expectancy" value={formatCurrency(metrics.expectancy)} sub="Per trade" accent />
          <MetricCard label="Max drawdown" value={`${formatCurrency(metrics.maxDrawdown)} (${(metrics.maxDrawdownPct * 100).toFixed(1)}%)`} sub="From peak" negative />
          <MetricCard label="Sharpe (approx)" value={metrics.sharpe.toFixed(2)} sub="Daily, 252d" />
        </section>

        {/* Equity curve + donut */}
        <section className="col-span-12 grid grid-cols-12 gap-4 lg:gap-6">
          <div className="col-span-12 rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:col-span-8">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Equity Curve</h2>
              <Chip color={metrics.totalPnL >= 0 ? "green" : "red"}>{metrics.totalPnL >= 0 ? "Up" : "Down"} {formatCurrency(Math.abs(metrics.totalPnL))}</Chip>
              <div className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">Total P&L: {formatCurrency(metrics.totalPnL)}</div>
            </div>
            <div className="overflow-x-auto">
              <AreaChart data={equityCurve} width={Math.max(600, equityCurve.length * 18)} height={210} color={metrics.totalPnL >= 0 ? "#10b981" : "#ef4444"} />
            </div>
          </div>

          <div className="col-span-12 flex flex-col gap-4 lg:col-span-4">
            <div className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center gap-4">
                <Donut win={metrics.winningTrades} loss={metrics.losingTrades} />
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Performance</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
                      <div className="text-zinc-500 dark:text-zinc-400">Avg win</div>
                      <div className="font-semibold">{formatCurrency(metrics.avgWin)}</div>
                    </div>
                    <div className="rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
                      <div className="text-zinc-500 dark:text-zinc-400">Avg loss</div>
                      <div className="font-semibold">{formatCurrency(metrics.avgLoss)}</div>
                    </div>
                    <div className="rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
                      <div className="text-zinc-500 dark:text-zinc-400">Best</div>
                      <div className="font-semibold text-emerald-600">{formatCurrency(metrics.bestTrade)}</div>
                    </div>
                    <div className="rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
                      <div className="text-zinc-500 dark:text-zinc-400">Worst</div>
                      <div className="font-semibold text-rose-600">{formatCurrency(metrics.worstTrade)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold">Streaks</h3>
                <Chip color="amber">Current {metrics.currentStreak}</Chip>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Longest wins</div>
                  <div className="mt-1 text-lg font-semibold">{metrics.longestWinStreak}</div>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Longest losses</div>
                  <div className="mt-1 text-lg font-semibold">{metrics.longestLossStreak}</div>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Avg hold</div>
                  <div className="mt-1 text-lg font-semibold">{metrics.avgHoldingMinutes.toFixed(0)}m</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Monthly bars and calendar */}
        <section className="col-span-12 grid grid-cols-12 gap-4 lg:gap-6">
          <div className="col-span-12 rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:col-span-7">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold">P&L by Month</h3>
              <Chip color="gray">All strategies</Chip>
            </div>
            <div className="overflow-x-auto">
              <BarPnlByMonth trades={filtered} />
            </div>
          </div>

          <div className="col-span-12 rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:col-span-5">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold">Daily Activity</h3>
              <Chip color="gray">Last 12 weeks</Chip>
            </div>
            <div className="overflow-x-auto">
              <CalendarHeatmap trades={filtered} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex h-3 w-3 rounded-sm bg-zinc-100 dark:bg-zinc-800" /> 0
              <span className="mx-2">•</span>
              <span className="inline-flex h-3 w-3 rounded-sm bg-emerald-200" /> gains
              <span className="mx-2">•</span>
              <span className="inline-flex h-3 w-3 rounded-sm bg-rose-200" /> losses
            </div>
          </div>
        </section>

        {/* Trade table */}
        <section className="col-span-12 rounded-[28px] border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-3 px-3 py-3">
            <h3 className="text-sm font-semibold">Trades</h3>
            <Chip color="indigo">{sorted.length} shown</Chip>
            <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>Click a row to edit • Esc to close</span>
            </div>
          </div>
          <div className="overflow-auto rounded-2xl">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  {["Date", "Asset", "TF", "Side", "Outcome", "P&L", "ROI", "Size", "Emotion", "Rating", "Tags", ""].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {sorted.map((t) => {
                  const pnl = t.result;
                  const isOpen = editingId === t.id;
                  return (
                    <React.Fragment key={t.id}>
                      <tr className={cn("cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60", isOpen && "bg-indigo-50/50 dark:bg-indigo-500/10")} onClick={() => setEditingId((id) => (id === t.id ? null : t.id))}>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="text-[13px] font-medium">{new Date(t.datetime).toLocaleDateString()}</div>
                          <div className="text-[11px] text-zinc-500">{new Date(t.datetime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{t.symbol.slice(0, 3)}</div>
                            <span className="font-medium">{t.symbol}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-semibold text-zinc-500">{t.timeframe}</td>
                        <td className="px-3 py-2.5">
                          <Chip color={t.side === "long" ? "green" : "red"}>{t.side.toUpperCase()}</Chip>
                        </td>
                        <td className="px-3 py-2.5">
                          <Chip color={t.outcome === "Win" ? "green" : t.outcome === "Loss" ? "red" : "gray"}>{t.outcome}</Chip>
                        </td>
                        <td className={cn("px-3 py-2.5 font-semibold", pnl >= 0 ? "text-emerald-600" : "text-rose-600")}>{formatCurrency(pnl)}</td>
                        <td className={cn("px-3 py-2.5 text-xs font-medium", pnl >= 0 ? "text-emerald-600" : "text-rose-600")}>{t.roi}%</td>
                        <td className="px-3 py-2.5 font-medium">{t.size}</td>
                        <td className="px-3 py-2.5 text-xs text-zinc-500">{t.emotionalState}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex text-amber-400">
                            {Array.from({ length: t.rating }).map((_, i) => <span key={i}>★</span>)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {t.tags.slice(0, 2).map((tag) => (
                              <Chip key={tag}>{tag}</Chip>
                            ))}
                            {t.tags.length > 2 && <Chip color="gray">+{t.tags.length - 2}</Chip>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                            className="inline-flex h-8 items-center rounded-lg border border-zinc-200 px-2 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-indigo-50/30 dark:bg-indigo-500/5">
                          <td colSpan={12} className="px-3 py-3">
                            <EditRow trade={t} onSave={(patch) => onUpdateTrade(t.id, patch)} onClose={() => setEditingId(null)} onDelete={() => onDelete(t.id)} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-16 text-center text-zinc-500">No trades match your filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Tag list and notes */}
        <section className="col-span-12 grid grid-cols-12 gap-4 lg:gap-6">
          <div className="col-span-12 rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:col-span-5">
            <h3 className="mb-3 text-sm font-semibold">Top Symbols</h3>
            <div className="space-y-2">
              {Array.from(
                filtered.reduce((m, t) => {
                  const pnl = t.result;
                  const entry = m.get(t.symbol) ?? { pnl: 0, count: 0 };
                  m.set(t.symbol, { pnl: entry.pnl + pnl, count: entry.count + 1 });
                  return m;
                }, new Map<string, { pnl: number; count: number }>())
              )
                .sort((a, b) => b[1].pnl - a[1].pnl)
                .slice(0, 6)
                .map(([sym, { pnl, count }]) => (
                  <div key={sym} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{sym.slice(0,3)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium">{sym}</div>
                        <Chip color="gray">{count} trades</Chip>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className={cn("h-full rounded-full", pnl >= 0 ? "bg-emerald-500" : "bg-rose-500")} style={{ width: `${Math.min(100, Math.abs(pnl) / 1000 * 100 + 10)}%` }} />
                      </div>
                    </div>
                    <div className={cn("text-sm font-semibold", pnl >= 0 ? "text-emerald-600" : "text-rose-600")}>{formatCurrency(pnl)}</div>
                  </div>
                ))}
              {filtered.length === 0 && <div className="text-sm text-zinc-500">No data.</div>}
            </div>
          </div>

          <div className="col-span-12 rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:col-span-7">
            <h3 className="mb-3 text-sm font-semibold">Strategy Breakdown</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from(
                filtered.reduce((m, t) => {
                  const key = t.strategy ?? "Unspecified";
                  const pnl = t.result;
                  const entry = m.get(key) ?? { pnl: 0, count: 0, wins: 0 };
                  m.set(key, { pnl: entry.pnl + pnl, count: entry.count + 1, wins: entry.wins + (pnl > 0 ? 1 : 0) });
                  return m;
                }, new Map<string, { pnl: number; count: number; wins: number }>())
              )
                .sort((a, b) => b[1].pnl - a[1].pnl)
                .slice(0, 6)
                .map(([name, { pnl, count, wins }]) => (
                  <div key={name} className="rounded-2xl border border-zinc-100 p-3 dark:border-zinc-900">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold">{name}</div>
                      <Chip color="indigo">{count} trades</Chip>
                      <Chip color="gray">{formatPercent(count ? wins / count : 0)} win</Chip>
                    </div>
                    <div className="mt-1 text-sm">
                      <span className={cn("font-semibold", pnl >= 0 ? "text-emerald-600" : "text-rose-600")}>{formatCurrency(pnl)}</span>
                      <span className="text-zinc-500 dark:text-zinc-400"> total</span>
                    </div>
                  </div>
                ))}
              {filtered.length === 0 && <div className="text-sm text-zinc-500">No data.</div>}
            </div>
          </div>
        </section>
      </main>

      {/* Add Trade Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-[28px] border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div>
                <div className="text-[15px] font-semibold">Add trade</div>
                <div className="text-xs text-zinc-500">Log your execution details</div>
              </div>
              <button onClick={() => setShowAdd(false)} className="ml-auto rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <TradeForm
              onSubmit={(t) => {
                onAddTrade(t);
                setShowAdd(false);
              }}
            />
          </div>
        </div>
      )}

      <footer className="mx-auto max-w-[1240px] px-4 pb-10 pt-2 text-center text-[11px] text-zinc-500 dark:text-zinc-500 sm:px-6 lg:px-8">
        Built for deliberate practice. Not financial advice.
      </footer>
    </div>
  );
}

function MetricCard({ label, value, sub, positive, negative, accent }: { label: string; value: string; sub?: string; positive?: boolean; negative?: boolean; accent?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-[22px] font-semibold tracking-tight", positive && "text-emerald-600", negative && "text-rose-600", accent && "text-indigo-600")}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{sub}</div>}
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-indigo-500/10 to-fuchsia-500/10 blur-2xl" />
    </div>
  );
}

function EditRow({ trade, onSave, onClose, onDelete }: {
  trade: Trade;
  onSave: (patch: Partial<Trade>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState<Trade>({ ...trade });
  useEffect(() => { setLocal({ ...trade }); }, [trade.id]);
  function update<K extends keyof Trade>(k: K, v: Trade[K]) { setLocal((s) => ({ ...s, [k]: v })); }
  
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Asset</label>
          <input value={local.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase())} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">TF</label>
          <select value={local.timeframe} onChange={(e) => update("timeframe", e.target.value)} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"].map(tf => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Side</label>
          <select value={local.side} onChange={(e) => update("side", e.target.value as Side)} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Outcome</label>
          <select value={local.outcome} onChange={(e) => update("outcome", e.target.value as Outcome)} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <option value="Win">Win</option>
            <option value="Loss">Loss</option>
            <option value="Break Even">Break Even</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">P&L ($)</label>
          <input type="number" value={local.result} onChange={(e) => update("result", +e.target.value)} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">ROI (%)</label>
          <input type="number" step="0.01" value={local.roi} onChange={(e) => update("roi", +e.target.value)} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Size</label>
          <input type="number" step="0.01" value={local.size} onChange={(e) => update("size", +e.target.value)} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Emotion</label>
          <select value={local.emotionalState} onChange={(e) => update("emotionalState", e.target.value)} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
             {["Focused", "Calm", "Anxious", "Greedy", "Fearful", "Revenge", "Confident"].map(em => <option key={em} value={em}>{em}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Rating</label>
          <select value={local.rating} onChange={(e) => update("rating", +e.target.value)} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {[1, 2, 3, 4, 5].map(r => <option key={r} value={r}>{r} Star{r > 1 ? "s" : ""}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Date/Time</label>
          <input type="datetime-local" value={local.datetime.slice(0, 16)} onChange={(e) => update("datetime", new Date(e.target.value).toISOString())} className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
      </div>
      
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Notes</label>
          <textarea value={local.notes} onChange={(e) => update("notes", e.target.value)} rows={2} className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Mistakes</label>
          <textarea value={local.mistakes} onChange={(e) => update("mistakes", e.target.value)} rows={2} className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">Lessons</label>
          <textarea value={local.lessons} onChange={(e) => update("lessons", e.target.value)} rows={2} className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-200/50 pt-3 dark:border-zinc-800">
        <button onClick={() => onSave(local)} className="inline-flex h-9 items-center rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500">Save Changes</button>
        <button onClick={onClose} className="inline-flex h-9 items-center rounded-xl border border-zinc-200 bg-white px-4 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800">Cancel</button>
        <div className="ml-auto" />
        <button onClick={onDelete} className="text-sm font-medium text-rose-600 hover:text-rose-500">Delete Trade</button>
      </div>
    </div>
  );
}

function TradeForm({ onSubmit }: { onSubmit: (t: Omit<Trade, "id">) => void }) {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState("1m");
  const [side, setSide] = useState<Side>("long");
  const [outcome, setOutcome] = useState<Outcome>("Win");
  const [pnl, setPnl] = useState<number | "">("");
  const [roi, setRoi] = useState<number | "">("");
  const [size, setSize] = useState<number | "">("");
  const [tradeType, setTradeType] = useState<TradeType>("Market");
  const [ruleFollowed, setRuleFollowed] = useState<RuleFollowed>("YES");
  const [emotionalState, setEmotionalState] = useState<string>("Focused");
  const [rating, setRating] = useState<number>(5);
  const [datetime, setDatetime] = useState(() => {
    const now = new Date();
    const estStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const estDate = new Date(estStr);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${estDate.getFullYear()}-${pad(estDate.getMonth() + 1)}-${pad(estDate.getDate())}T${pad(estDate.getHours())}:${pad(estDate.getMinutes())}`;
  });
  const [exitDatetime, setExitDatetime] = useState(() => {
    const now = new Date();
    const estStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const estDate = new Date(estStr);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${estDate.getFullYear()}-${pad(estDate.getMonth() + 1)}-${pad(estDate.getDate())}T${pad(estDate.getHours())}:${pad(estDate.getMinutes())}`;
  });
  
  const [notes, setNotes] = useState("");
  const [mistakes, setMistakes] = useState("");
  const [lessons, setLessons] = useState("");
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  function processFiles(files: FileList | File[]) {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        setScreenshots((prev) => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    });
  }

  function handleScreenshotUpload(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = ev.target.files;
    if (!files) return;
    processFiles(files);
    ev.target.value = "";
  }

  function removeScreenshot(index: number) {
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          datetime: new Date(datetime).toISOString(),
          exitDatetime: new Date(exitDatetime).toISOString(),
          symbol: symbol.toUpperCase(),
          timeframe,
          side,
          outcome,
          result: pnl === "" ? 0 : pnl,
          roi: roi === "" ? 0 : roi,
          size: size === "" ? 0 : size,
          tradeType,
          ruleFollowed,
          emotionalState,
          rating,
          notes,
          mistakes,
          lessons,
          screenshots,
          // Internal compatibility
          entry: 0,
          exit: 0,
          fees: 0,
          strategy: "Manual",
          tags: [],
        });
      }}
    >
      {/* Trade Details Section */}
      <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900/50">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-400">Trade Details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Asset *</label>
            <input 
              value={symbol} 
              onChange={(e) => setSymbol(e.target.value)} 
              placeholder="e.g. XAUUSD"
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" 
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Timeframe</label>
            <select 
              value={timeframe} 
              onChange={(e) => setTimeframe(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"].map(tf => <option key={tf} value={tf}>{tf}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Direction</label>
            <select 
              value={side} 
              onChange={(e) => setSide(e.target.value as Side)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <option value="long">LONG</option>
              <option value="short">SHORT</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Outcome</label>
            <select 
              value={outcome} 
              onChange={(e) => {
                const val = e.target.value as Outcome;
                setOutcome(val);
                if (val === "Loss") {
                  if (pnl !== "" && pnl > 0) setPnl(-Math.abs(pnl));
                  if (roi !== "" && roi > 0) setRoi(-Math.abs(roi));
                } else if (val === "Win") {
                  if (pnl !== "" && pnl < 0) setPnl(Math.abs(pnl));
                  if (roi !== "" && roi < 0) setRoi(Math.abs(roi));
                } else {
                  setPnl(0);
                  setRoi(0);
                }
              }}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <option value="Win">Win</option>
              <option value="Loss">Loss</option>
              <option value="Break Even">Break Even</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">P&L ($)</label>
            <input 
              type="number" 
              value={pnl} 
              onChange={(e) => {
                if (e.target.value === "") { setPnl(""); return; }
                let v = +e.target.value;
                if (outcome === "Loss") v = -Math.abs(v);
                else if (outcome === "Win") v = Math.abs(v);
                else v = 0;
                setPnl(v);
              }} 
              placeholder="e.g. 250 or -150"
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" 
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">ROI (%)</label>
            <input 
              type="number" 
              step="0.01"
              value={roi} 
              onChange={(e) => {
                if (e.target.value === "") { setRoi(""); return; }
                let v = +e.target.value;
                if (outcome === "Loss") v = -Math.abs(v);
                else if (outcome === "Win") v = Math.abs(v);
                else v = 0;
                setRoi(v);
              }} 
              placeholder="e.g. 2.5"
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" 
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Lot Size</label>
            <input 
              type="number" 
              step="0.01"
              value={size} 
              onChange={(e) => setSize(e.target.value === "" ? "" : +e.target.value)} 
              placeholder="e.g. 0.10"
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" 
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Trade Type</label>
            <select 
              value={tradeType} 
              onChange={(e) => setTradeType(e.target.value as TradeType)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <option value="Market">Market</option>
              <option value="Limit">Limit</option>
              <option value="Stop">Stop</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Rule Followed</label>
            <select 
              value={ruleFollowed} 
              onChange={(e) => setRuleFollowed(e.target.value as RuleFollowed)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <option value="YES">YES</option>
              <option value="NO">NO</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Emotion</label>
            <select 
              value={emotionalState} 
              onChange={(e) => setEmotionalState(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {["Focused", "Calm", "Anxious", "Greedy", "Fearful", "Revenge", "Confident"].map(em => <option key={em} value={em}>{em}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Rating</label>
            <select 
              value={rating} 
              onChange={(e) => setRating(+e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {[1, 2, 3, 4, 5].map(r => <option key={r} value={r}>{r} Star{r > 1 ? "s" : ""}</option>)}
            </select>
          </div>
          <div className="hidden sm:block"></div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Start Date & Time</label>
            <input 
              type="datetime-local" 
              value={datetime} 
              onChange={(e) => { setDatetime(e.target.value); setExitDatetime(e.target.value); }}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" 
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">End Date & Time</label>
            <input 
              type="datetime-local" 
              value={exitDatetime} 
              onChange={(e) => setExitDatetime(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" 
            />
          </div>
        </div>
        <div className="mt-1.5 text-right text-[10px] leading-none text-zinc-300 dark:text-zinc-700 select-none">EST (UTC−5)</div>
      </div>

      {/* Journal Notes Section */}
      <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900/50">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-400">Journal Notes</h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Notes</label>
            <textarea 
              value={notes} 
              onChange={(e) => setNotes(e.target.value)} 
              placeholder="Trade notes, observations, market conditions..."
              rows={3}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" 
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Mistakes</label>
            <textarea 
              value={mistakes} 
              onChange={(e) => setMistakes(e.target.value)} 
              placeholder="What went wrong? What would you do differently?"
              rows={2}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" 
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Lessons Learned</label>
            <textarea 
              value={lessons} 
              onChange={(e) => setLessons(e.target.value)} 
              placeholder="Key takeaways from this trade..."
              rows={2}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" 
            />
          </div>
        </div>
      </div>

      {/* Screenshots Section */}
      <div
        className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900/50"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={screenshotInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={handleScreenshotUpload}
        />
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Screenshots</h3>
          <button
            type="button"
            onClick={() => screenshotInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Screenshot
          </button>
        </div>

        {/* Drag overlay */}
        {isDragging && (
          <div className="mb-3 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-100/60 py-10 dark:bg-indigo-500/10">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2 text-indigo-500"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Drop your screenshots here</div>
            <div className="mt-1 text-[10px] text-indigo-400">PNG, JPG, WebP supported</div>
          </div>
        )}

        {!isDragging && screenshots.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {screenshots.map((src, i) => (
              <div key={i} className="group relative overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <img src={src} alt={`Screenshot ${i + 1}`} className="h-40 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeScreenshot(i)}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100 hover:bg-red-600"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent px-3 py-2">
                  <span className="text-[10px] font-semibold text-white">Screenshot {i + 1}</span>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => screenshotInputRef.current?.click()}
              className="flex h-40 flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-zinc-700 dark:hover:border-indigo-500 dark:hover:bg-indigo-500/5"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-1 text-zinc-400"><path d="M12 5v14M5 12h14"/></svg>
              <span className="text-xs font-medium text-zinc-500">Add more</span>
            </button>
          </div>
        ) : !isDragging && (
          <button
            type="button"
            onClick={() => screenshotInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 py-10 transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-zinc-800 dark:hover:border-indigo-500 dark:hover:bg-indigo-500/5"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2 text-zinc-400"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <div className="text-xs font-medium text-zinc-500">Click or drag & drop to upload screenshots</div>
            <div className="mt-1 text-[10px] text-zinc-400">PNG, JPG, WebP supported</div>
          </button>
        )}
      </div>

      <div className="flex justify-end gap-3 border-t border-zinc-100 pt-6 dark:border-zinc-800">
        <button 
          type="submit" 
          className="h-12 rounded-xl bg-indigo-600 px-8 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 active:scale-[0.98]"
        >
          Save Trade
        </button>
      </div>
    </form>
  );
}
