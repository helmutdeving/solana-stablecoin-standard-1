import { useState } from "react";
import { Search, Bell, Wifi, WifiOff } from "lucide-react";

interface HeaderProps {
  mint: string;
  onMintChange: (mint: string) => void;
  wsConnected: boolean;
}

export function Header({ mint, onMintChange, wsConnected }: HeaderProps) {
  const [input, setInput] = useState(mint);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim().length >= 32) {
      onMintChange(input.trim());
    }
  };

  return (
    <header className="h-14 flex items-center gap-4 px-4 border-b border-border bg-surface-800">
      {/* Mint selector */}
      <form onSubmit={handleSubmit} className="flex-1 max-w-lg">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter mint address (e.g. USDC devnet)…"
            className="w-full bg-surface-700 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-solana-purple focus:ring-1 focus:ring-solana-purple/30 font-mono"
          />
        </div>
      </form>

      <div className="flex items-center gap-3 ml-auto">
        {/* WebSocket status */}
        <div className="flex items-center gap-1.5 text-xs">
          {wsConnected ? (
            <>
              <Wifi size={12} className="text-emerald-400" />
              <span className="text-emerald-400">Live</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-slate-500" />
              <span className="text-slate-500">Offline</span>
            </>
          )}
        </div>

        {/* Network badge */}
        <span className="badge-yellow">Devnet</span>

        {/* Notifications placeholder */}
        <button
          type="button"
          className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-surface-700 transition-colors"
          title="Notifications"
        >
          <Bell size={15} />
        </button>
      </div>
    </header>
  );
}
