import { useEffect, useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Shield,
  Zap,
  AlertTriangle,
  RefreshCw,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { getSupply } from "../api/client";
import type { SupplyResponse, SSSEvent } from "../api/types";

interface DashboardProps {
  mint: string;
  events: SSSEvent[];
}

// Generate mock supply history for chart demo (real implementation polls API)
function mockHistory(current: number) {
  const now = Date.now();
  return Array.from({ length: 24 }, (_, i) => ({
    time: new Date(now - (23 - i) * 3600000).toLocaleTimeString("en", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    supply: Math.round(current * (0.85 + Math.random() * 0.3)),
  }));
}

function StatCard({
  label,
  value,
  sub,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  icon: React.ComponentType<{ size: number; className?: string }>;
}) {
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        <Icon size={16} className={accent ?? "text-slate-500"} />
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function shortAddr(addr: string) {
  return addr.length > 16 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function Dashboard({ mint, events }: DashboardProps) {
  const [supply, setSupply] = useState<SupplyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<{ time: string; supply: number }[]>([]);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!mint) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getSupply(mint);
      setSupply(data);
      const val = parseInt(data.totalSupply) / 10 ** data.decimals;
      setChartData(mockHistory(val));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load supply");
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10000);
    return () => clearInterval(id);
  }, [load]);

  const copyMint = async () => {
    await navigator.clipboard.writeText(mint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalSupply = supply
    ? (parseInt(supply.totalSupply) / 10 ** supply.decimals).toLocaleString()
    : "—";
  const mintCap = supply
    ? (parseInt(supply.mintCap) / 10 ** supply.decimals).toLocaleString()
    : "—";
  const recentMints = events.filter((e) => e.kind === "Minted").length;
  const recentBurns = events.filter((e) => e.kind === "Burned").length;

  return (
    <div className="space-y-5">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Dashboard</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="mono">{shortAddr(mint || "No mint selected")}</span>
            {mint && (
              <button
                type="button"
                onClick={() => void copyMint()}
                className="text-slate-500 hover:text-slate-300 transition-colors"
                title="Copy mint address"
              >
                {copied ? (
                  <CheckCircle2 size={12} className="text-emerald-400" />
                ) : (
                  <Copy size={12} />
                )}
              </button>
            )}
            {supply && (
              <span
                className={`${supply.preset === "SSS3" ? "badge-purple" : supply.preset === "SSS2" ? "badge-blue" : "badge-green"}`}
              >
                {supply.preset}
              </span>
            )}
            {supply?.paused && (
              <span className="badge-red">
                <AlertTriangle size={10} /> Paused
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-secondary text-xs"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="card border-red-500/20 bg-red-500/5 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total Supply"
          value={totalSupply}
          sub={supply ? `Cap: ${mintCap}` : undefined}
          accent="text-solana-green"
          icon={TrendingUp}
        />
        <StatCard
          label="Cap Used"
          value={supply ? `${supply.mintCapUsedPct.toFixed(1)}%` : "—"}
          sub={supply ? `${100 - supply.mintCapUsedPct.toFixed(1) as unknown as number}% remaining` : undefined}
          accent="text-solana-blue"
          icon={Zap}
        />
        <StatCard
          label="Recent Mints"
          value={String(recentMints)}
          sub="last 100 events"
          accent="text-emerald-400"
          icon={TrendingUp}
        />
        <StatCard
          label="Recent Burns"
          value={String(recentBurns)}
          sub="last 100 events"
          accent="text-amber-400"
          icon={TrendingDown}
        />
      </div>

      {/* Chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-white">Supply (24h)</h2>
          <span className="text-xs text-slate-500">Simulated — connect to devnet for live data</span>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="supplyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#9945FF" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#9945FF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2A2F3E" />
            <XAxis
              dataKey="time"
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) =>
                v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)
              }
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#13161E",
                border: "1px solid #2A2F3E",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#e2e8f0",
              }}
            />
            <Area
              type="monotone"
              dataKey="supply"
              stroke="#9945FF"
              strokeWidth={2}
              fill="url(#supplyGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Metadata */}
      {supply && (
        <div className="card">
          <h2 className="text-sm font-medium text-white mb-3">Token Metadata</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
            {[
              ["Mint", supply.mint],
              ["Program ID", supply.programId],
              ["Mint Authority", supply.mintAuthority],
              ["Freeze Authority", supply.freezeAuthority ?? "None"],
              ["Decimals", String(supply.decimals)],
              ["Slot", supply.slot.toLocaleString()],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <span className="text-slate-500 text-xs">{k}</span>
                <span className="mono text-slate-300 truncate" title={v}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent events */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-white">Recent Events</h2>
          <span className="badge-blue">
            <Shield size={10} />
            Live
          </span>
        </div>
        {events.length === 0 ? (
          <p className="text-slate-500 text-xs py-4 text-center">
            No events yet — connect WebSocket or perform operations to see activity.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-auto">
            {events.slice(0, 10).map((evt) => (
              <div
                key={evt.id}
                className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-surface-700 transition-colors"
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  evt.kind === "Minted" ? "bg-emerald-400" :
                  evt.kind === "Burned" ? "bg-amber-400" :
                  evt.kind === "Frozen" ? "bg-red-400" :
                  "bg-blue-400"
                }`} />
                <span className="text-xs text-white font-medium w-28 flex-shrink-0">{evt.kind}</span>
                <span className="mono text-slate-500 flex-1 truncate">{evt.signature}</span>
                <span className="text-xs text-slate-600 flex-shrink-0">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
