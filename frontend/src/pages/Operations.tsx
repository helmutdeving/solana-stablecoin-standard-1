import { useState, useCallback } from "react";
import { Flame, Coins, ArrowRightLeft, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { mintTokens, burnTokens, transferTokens } from "../api/client";
import type { TxResponse } from "../api/types";

type Tab = "mint" | "burn" | "transfer";

interface TxResult {
  ok: boolean;
  signature?: string;
  error?: string;
}

function TxFeedback({ result }: { result: TxResult | null }) {
  if (!result) return null;
  if (result.ok) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm">
        <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-emerald-400 font-medium">Transaction submitted</p>
          <p className="mono text-emerald-400/70 break-all">{result.signature}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm">
      <AlertCircle size={15} className="text-red-400 mt-0.5 flex-shrink-0" />
      <p className="text-red-400">{result.error}</p>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}

function Field({ label, value, onChange, placeholder, type = "text" }: FieldProps) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input font-mono"
      />
    </div>
  );
}

export function Operations({ mint }: { mint: string }) {
  const [tab, setTab] = useState<Tab>("mint");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TxResult | null>(null);

  // Mint form
  const [mintForm, setMintForm] = useState({ recipient: "", amount: "", signer: "" });
  // Burn form
  const [burnForm, setBurnForm] = useState({ owner: "", amount: "", signer: "" });
  // Transfer form
  const [transferForm, setTransferForm] = useState({ from: "", to: "", amount: "", signer: "" });

  const submit = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      let res: TxResponse;
      if (tab === "mint") {
        res = await mintTokens({ mint, ...mintForm });
      } else if (tab === "burn") {
        res = await burnTokens({ mint, ...burnForm });
      } else {
        res = await transferTokens({ mint, ...transferForm });
      }
      setResult({ ok: true, signature: res.signature });
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }, [tab, mint, mintForm, burnForm, transferForm]);

  const tabs: { id: Tab; label: string; icon: typeof Coins }[] = [
    { id: "mint", label: "Mint", icon: Coins },
    { id: "burn", label: "Burn", icon: Flame },
    { id: "transfer", label: "Transfer", icon: ArrowRightLeft },
  ];

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h1 className="text-lg font-semibold text-white">Operations</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Execute mint, burn, and transfer operations on the selected stablecoin.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-700 rounded-lg w-fit">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => { setTab(id); setResult(null); }}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === id
                ? "bg-surface-800 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="card space-y-4">
        {/* Mint form */}
        {tab === "mint" && (
          <>
            <Field
              label="Mint Address"
              value={mint}
              onChange={() => {}}
              placeholder="Loaded from header"
            />
            <Field
              label="Recipient Address"
              value={mintForm.recipient}
              onChange={(v) => setMintForm((p) => ({ ...p, recipient: v }))}
              placeholder="Base58 recipient public key"
            />
            <Field
              label="Amount (in base units)"
              value={mintForm.amount}
              onChange={(v) => setMintForm((p) => ({ ...p, amount: v }))}
              placeholder="e.g. 1000000 = 1 USDC (6 decimals)"
              type="text"
            />
            <Field
              label="Signer Authority"
              value={mintForm.signer}
              onChange={(v) => setMintForm((p) => ({ ...p, signer: v }))}
              placeholder="Mint authority base58 key"
            />
          </>
        )}

        {/* Burn form */}
        {tab === "burn" && (
          <>
            <Field
              label="Mint Address"
              value={mint}
              onChange={() => {}}
              placeholder="Loaded from header"
            />
            <Field
              label="Token Account Owner"
              value={burnForm.owner}
              onChange={(v) => setBurnForm((p) => ({ ...p, owner: v }))}
              placeholder="Account holder public key"
            />
            <Field
              label="Amount (in base units)"
              value={burnForm.amount}
              onChange={(v) => setBurnForm((p) => ({ ...p, amount: v }))}
              placeholder="e.g. 1000000 = 1 token"
              type="text"
            />
            <Field
              label="Signer Authority"
              value={burnForm.signer}
              onChange={(v) => setBurnForm((p) => ({ ...p, signer: v }))}
              placeholder="Burn authority base58 key"
            />
          </>
        )}

        {/* Transfer form */}
        {tab === "transfer" && (
          <>
            <Field
              label="Mint Address"
              value={mint}
              onChange={() => {}}
              placeholder="Loaded from header"
            />
            <Field
              label="From Address"
              value={transferForm.from}
              onChange={(v) => setTransferForm((p) => ({ ...p, from: v }))}
              placeholder="Source token account"
            />
            <Field
              label="To Address"
              value={transferForm.to}
              onChange={(v) => setTransferForm((p) => ({ ...p, to: v }))}
              placeholder="Destination token account"
            />
            <Field
              label="Amount (in base units)"
              value={transferForm.amount}
              onChange={(v) => setTransferForm((p) => ({ ...p, amount: v }))}
              placeholder="Transfer amount in base units"
              type="text"
            />
            <Field
              label="Signer"
              value={transferForm.signer}
              onChange={(v) => setTransferForm((p) => ({ ...p, signer: v }))}
              placeholder="Wallet / authority base58 key"
            />
          </>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {loading ? "Submitting…" : `Submit ${tab.charAt(0).toUpperCase() + tab.slice(1)}`}
        </button>

        <TxFeedback result={result} />
      </div>

      <div className="card text-xs text-slate-500 space-y-1">
        <p className="font-medium text-slate-400">Notes</p>
        <p>• Amounts are in raw base units. Multiply by 10^decimals for human-readable amounts.</p>
        <p>• Signing is handled server-side. The backend must hold the keypair for the provided signer.</p>
        <p>• SSS-2 tokens enforce compliance checks: frozen accounts cannot receive or send.</p>
        <p>• SSS-3 tokens additionally validate against the allowlist before any operation.</p>
      </div>
    </div>
  );
}
