import { useState } from "react";
import { Radio, Wifi, WifiOff, Filter } from "lucide-react";
import type { SSSEvent, EventKind } from "../api/types";

const EVENT_COLORS: Record<EventKind, string> = {
  Minted: "bg-emerald-400",
  Burned: "bg-amber-400",
  Transferred: "bg-blue-400",
  Frozen: "bg-red-400",
  Unfrozen: "bg-green-400",
  WhitelistAdded: "bg-cyan-400",
  WhitelistRemoved: "bg-orange-400",
  Paused: "bg-red-500",
  Unpaused: "bg-green-500",
  OwnershipTransferred: "bg-purple-400",
};

const EVENT_BADGES: Record<EventKind, string> = {
  Minted: "badge-green",
  Burned: "badge-yellow",
  Transferred: "badge-blue",
  Frozen: "badge-red",
  Unfrozen: "badge-green",
  WhitelistAdded: "badge-blue",
  WhitelistRemoved: "badge-red",
  Paused: "badge-red",
  Unpaused: "badge-green",
  OwnershipTransferred: "badge-purple",
};

interface EventsProps {
  events: SSSEvent[];
  wsConnected: boolean;
  wsReconnecting: boolean;
}

export function Events({ events, wsConnected, wsReconnecting }: EventsProps) {
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const [search, setSearch] = useState("");

  const kinds: (EventKind | "all")[] = [
    "all",
    "Minted",
    "Burned",
    "Transferred",
    "Frozen",
    "Unfrozen",
    "WhitelistAdded",
    "WhitelistRemoved",
  ];

  const filtered = events.filter((e) => {
    if (filter !== "all" && e.kind !== filter) return false;
    if (search && !e.signature.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Events</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Real-time program events via WebSocket.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {wsReconnecting ? (
            <span className="badge-yellow">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Reconnecting…
            </span>
          ) : wsConnected ? (
            <span className="badge-green">
              <Wifi size={10} />
              Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <WifiOff size={12} />
              Disconnected
            </span>
          )}
          <span className="badge-blue">
            <Radio size={10} />
            {events.length} total
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              filter === k
                ? "bg-solana-purple text-white"
                : "bg-surface-700 text-slate-400 hover:text-white"
            }`}
          >
            {k === "all" ? "All" : k}
            {k !== "all" && (
              <span className="ml-1 text-xs opacity-60">
                ({events.filter((e) => e.kind === k).length})
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto">
          <div className="relative">
            <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search signature…"
              className="bg-surface-700 border border-border rounded-lg pl-7 pr-3 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-solana-purple font-mono w-48"
            />
          </div>
        </div>
      </div>

      {/* Event list */}
      <div className="card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            {events.length === 0
              ? "No events received yet. Ensure the event-listener service is running and the WebSocket URL is configured in Settings."
              : "No events match the current filter."}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((evt) => (
              <div
                key={evt.id}
                className="flex items-start gap-3 p-3 hover:bg-surface-700 transition-colors"
              >
                <div className="flex-shrink-0 mt-1">
                  <span
                    className={`w-2 h-2 rounded-full block ${EVENT_COLORS[evt.kind] ?? "bg-slate-400"}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={EVENT_BADGES[evt.kind] ?? "badge-blue"}>
                      {evt.kind}
                    </span>
                    <span className="mono text-slate-400 truncate text-xs">
                      {evt.signature}
                    </span>
                  </div>
                  {Object.keys(evt.data).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                      {Object.entries(evt.data).map(([k, v]) => (
                        <span key={k} className="text-xs text-slate-500">
                          <span className="text-slate-400">{k}:</span>{" "}
                          <span className="font-mono">{String(v)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-xs text-slate-500">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </div>
                  <div className="text-xs text-slate-600">
                    slot {evt.slot.toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
