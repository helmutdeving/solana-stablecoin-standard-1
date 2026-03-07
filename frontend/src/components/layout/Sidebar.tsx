import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Zap,
  ShieldCheck,
  Radio,
  LineChart,
  Settings,
  ExternalLink,
} from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/operations", icon: Zap, label: "Operations" },
  { to: "/compliance", icon: ShieldCheck, label: "Compliance" },
  { to: "/events", icon: Radio, label: "Events" },
  { to: "/oracle", icon: LineChart, label: "Oracle" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="w-56 flex-shrink-0 bg-surface-800 border-r border-border flex flex-col">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-solana-purple to-solana-blue flex items-center justify-center text-white font-bold text-xs">
            S³
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">SSS Admin</div>
            <div className="text-slate-500 text-xs leading-tight">Stablecoin Standard</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-solana-purple/15 text-white"
                  : "text-slate-400 hover:text-white hover:bg-surface-700"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={16}
                  className={isActive ? "text-solana-purple" : ""}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border space-y-1">
        <a
          href="https://github.com/helmutdeving/solana-stablecoin-standard"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 hover:bg-surface-700 transition-colors"
        >
          <ExternalLink size={12} />
          GitHub
        </a>
        <div className="px-3 py-1 text-xs text-slate-600">
          v1.0.0 · Solana Devnet
        </div>
      </div>
    </aside>
  );
}
