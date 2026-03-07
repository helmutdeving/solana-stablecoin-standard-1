import { useState, useEffect } from "react";
import { Save, CheckCircle2, Eye, EyeOff } from "lucide-react";

interface SettingField {
  key: string;
  label: string;
  placeholder: string;
  description: string;
  secret?: boolean;
}

const FIELDS: SettingField[] = [
  {
    key: "sss_api_url",
    label: "API Service URL",
    placeholder: "http://localhost:3001",
    description: "Backend API for mint/burn/transfer/supply operations.",
  },
  {
    key: "sss_compliance_url",
    label: "Compliance Service URL",
    placeholder: "http://localhost:3003",
    description: "Compliance service for freeze/whitelist/events.",
  },
  {
    key: "sss_ws_url",
    label: "WebSocket URL",
    placeholder: "ws://localhost:3002",
    description: "Event listener WebSocket for real-time event streaming.",
  },
  {
    key: "sss_oracle_url",
    label: "Oracle Service URL",
    placeholder: "http://localhost:3004",
    description: "Oracle price feed service (Pyth → Switchboard → CoinGecko).",
  },
  {
    key: "sss_auth_token",
    label: "Auth Token",
    placeholder: "Bearer secret",
    description: "API authentication token. Passed as Authorization: Bearer <token>.",
    secret: true,
  },
  {
    key: "sss_rpc_url",
    label: "Solana RPC URL",
    placeholder: "https://api.devnet.solana.com",
    description: "Solana RPC endpoint. Used for on-chain reads and explorer links.",
  },
];

export function Settings() {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      FIELDS.map(({ key }) => [key, localStorage.getItem(key) ?? ""]),
    ),
  );
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    FIELDS.forEach(({ key }) => {
      const v = values[key];
      if (v) {
        localStorage.setItem(key, v);
      } else {
        localStorage.removeItem(key);
      }
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h1 className="text-lg font-semibold text-white">Settings</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Configure service endpoints and authentication. Stored in localStorage.
        </p>
      </div>

      <div className="card space-y-5">
        {FIELDS.map(({ key, label, placeholder, description, secret }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-white mb-1">
              {label}
            </label>
            <p className="text-xs text-slate-500 mb-2">{description}</p>
            <div className="relative">
              <input
                type={secret && !showSecret[key] ? "password" : "text"}
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues((p) => ({ ...p, [key]: e.target.value }))
                }
                placeholder={placeholder}
                className="input pr-10"
              />
              {secret && (
                <button
                  type="button"
                  onClick={() =>
                    setShowSecret((p) => ({ ...p, [key]: !p[key] }))
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showSecret[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            className="btn-primary"
          >
            {saved ? (
              <>
                <CheckCircle2 size={14} className="text-emerald-300" />
                Saved!
              </>
            ) : (
              <>
                <Save size={14} />
                Save Settings
              </>
            )}
          </button>
          <span className="text-xs text-slate-500">⌘S / Ctrl+S</span>
        </div>
      </div>

      <div className="card text-xs text-slate-500 space-y-1">
        <p className="text-slate-400 font-medium">Docker Compose Services</p>
        <p>Run the full stack locally:</p>
        <pre className="bg-surface-700 rounded-lg p-3 text-slate-300 font-mono text-xs overflow-x-auto mt-2">
          {`docker compose up -d\n\n# Services:\n# API:         http://localhost:3001\n# Events WS:   ws://localhost:3002\n# Compliance:  http://localhost:3003\n# Oracle:      http://localhost:3004\n# Frontend:    http://localhost:3000`}
        </pre>
      </div>
    </div>
  );
}
