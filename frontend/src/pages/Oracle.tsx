import { useEffect, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, AlertTriangle, RefreshCw, Circle } from "lucide-react";
import { getOraclePrice } from "../api/client";
import type { OraclePrice } from "../api/types";

const SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD", "USDC/USD"];

interface PriceHistory {
  time: string;
  price: number;
}

interface PriceCardProps {
  symbol: string;
  data: OraclePrice | null;
  loading: boolean;
  error: string | null;
  history: PriceHistory[];
}

function PriceCard({ symbol, data, loading, error, history }: PriceCardProps) {
  const sourceColor = {
    pyth: "text-emerald-400",
    switchboard: "text-blue-400",
    coingecko: "text-amber-400",
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{symbol}</span>
        <div className="flex items-center gap-2">
          {data && (
            <span
              className={`text-xs ${sourceColor[data.source] ?? "text-slate-400"}`}
            >
              {data.source}
            </span>
          )}
          {data?.stale && (
            <span className="badge-red">
              <AlertTriangle size={10} /> Stale
            </span>
          )}
          {loading && (
            <Circle size={8} className="text-solana-purple animate-pulse" />
          )}
        </div>
      </div>

      {error ? (
        <div className="text-xs text-red-400 flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </div>
      ) : (
        <>
          <div className="text-2xl font-bold text-white tabular-nums">
            {data ? `$${data.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : "—"}
          </div>
          {data && (
            <div className="text-xs text-slate-500">
              ±${data.confidence.toFixed(4)} · {new Date(data.timestamp).toLocaleTimeString()}
            </div>
          )}
          {history.length > 1 && (
            <ResponsiveContainer width="100%" height={60}>
              <LineChart data={history}>
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#9945FF"
                  strokeWidth={1.5}
                  dot={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#13161E",
                    border: "1px solid #2A2F3E",
                    borderRadius: "6px",
                    fontSize: "10px",
                    color: "#e2e8f0",
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
}

export function Oracle() {
  const [prices, setPrices] = useState<Record<string, OraclePrice | null>>(
    Object.fromEntries(SYMBOLS.map((s) => [s, null])),
  );
  const [errors, setErrors] = useState<Record<string, string | null>>(
    Object.fromEntries(SYMBOLS.map((s) => [s, null])),
  );
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Record<string, PriceHistory[]>>(
    Object.fromEntries(SYMBOLS.map((s) => [s, []])),
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled(
      SYMBOLS.map(async (sym) => {
        try {
          const p = await getOraclePrice(sym);
          setPrices((prev) => ({ ...prev, [sym]: p }));
          setErrors((prev) => ({ ...prev, [sym]: null }));
          setHistory((prev) => {
            const h = prev[sym] ?? [];
            const entry: PriceHistory = {
              time: new Date().toLocaleTimeString("en", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              price: p.price,
            };
            return { ...prev, [sym]: [...h.slice(-29), entry] };
          });
        } catch (e) {
          setErrors((prev) => ({
            ...prev,
            [sym]: e instanceof Error ? e.message : "Fetch error",
          }));
        }
      }),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchAll();
    const id = setInterval(() => void fetchAll(), 30000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Oracle</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Real-time price feeds: Pyth → Switchboard → CoinGecko fallback chain.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchAll()}
          disabled={loading}
          className="btn-secondary text-xs"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SYMBOLS.map((sym) => (
          <PriceCard
            key={sym}
            symbol={sym}
            data={prices[sym] ?? null}
            loading={loading}
            error={errors[sym] ?? null}
            history={history[sym] ?? []}
          />
        ))}
      </div>

      <div className="card text-xs text-slate-500 space-y-1">
        <p className="flex items-center gap-1">
          <TrendingUp size={11} className="text-slate-400" />
          <span className="text-slate-400 font-medium">Oracle Architecture</span>
        </p>
        <p>
          The SSS Oracle service uses a cascading fallback strategy: Pyth Network (primary, 400ms
          update) → Switchboard (secondary, 1s update) → CoinGecko REST (tertiary, 30s rate limited).
        </p>
        <p>
          Prices feed into SSS-3 mint/redeem operations via <code className="text-slate-300">computeMintAmount</code> and{" "}
          <code className="text-slate-300">computeRedeemAmount</code> in the Oracle service.
        </p>
        <p>
          Staleness threshold: 60s for Pyth/Switchboard, 5 min for CoinGecko. Stale prices block
          operations to protect against oracle manipulation attacks.
        </p>
      </div>
    </div>
  );
}
