import { useState, useCallback } from "react";
import {
  ShieldCheck,
  ShieldOff,
  ShieldBan,
  ListChecks,
  ListX,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { getComplianceStatus, freezeAccount, updateWhitelist } from "../api/client";
import type { ComplianceStatus, TxResponse } from "../api/types";

interface TxResult {
  ok: boolean;
  signature?: string;
  error?: string;
}

function TxFeedback({ result }: { result: TxResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm">
      <CheckCircle2 size={15} className="text-emerald-400 mt-0.5" />
      <div>
        <p className="text-emerald-400 font-medium">Transaction submitted</p>
        <p className="mono text-emerald-400/70 break-all">{result.signature}</p>
      </div>
    </div>
  ) : (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm">
      <AlertCircle size={15} className="text-red-400 mt-0.5" />
      <p className="text-red-400">{result.error}</p>
    </div>
  );
}

export function Compliance({ mint }: { mint: string }) {
  const [lookupAddr, setLookupAddr] = useState("");
  const [complianceData, setComplianceData] = useState<ComplianceStatus | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [authority, setAuthority] = useState("");
  const [txLoading, setTxLoading] = useState(false);
  const [txResult, setTxResult] = useState<TxResult | null>(null);

  const lookup = useCallback(async () => {
    if (!lookupAddr.trim()) return;
    setLookupLoading(true);
    setLookupError(null);
    try {
      const data = await getComplianceStatus(mint, lookupAddr.trim());
      setComplianceData(data);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "Lookup failed");
      setComplianceData(null);
    } finally {
      setLookupLoading(false);
    }
  }, [mint, lookupAddr]);

  const doFreeze = useCallback(
    async (freeze: boolean) => {
      if (!lookupAddr.trim() || !authority.trim()) return;
      setTxLoading(true);
      setTxResult(null);
      try {
        const res: TxResponse = await freezeAccount({
          mint,
          account: lookupAddr.trim(),
          freeze,
          authority: authority.trim(),
        });
        setTxResult({ ok: true, signature: res.signature });
        await lookup();
      } catch (e) {
        setTxResult({ ok: false, error: e instanceof Error ? e.message : "Error" });
      } finally {
        setTxLoading(false);
      }
    },
    [mint, lookupAddr, authority, lookup],
  );

  const doWhitelist = useCallback(
    async (add: boolean) => {
      if (!lookupAddr.trim() || !authority.trim()) return;
      setTxLoading(true);
      setTxResult(null);
      try {
        const res: TxResponse = await updateWhitelist({
          mint,
          account: lookupAddr.trim(),
          add,
          authority: authority.trim(),
        });
        setTxResult({ ok: true, signature: res.signature });
        await lookup();
      } catch (e) {
        setTxResult({ ok: false, error: e instanceof Error ? e.message : "Error" });
      } finally {
        setTxLoading(false);
      }
    },
    [mint, lookupAddr, authority, lookup],
  );

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h1 className="text-lg font-semibold text-white">Compliance</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Freeze accounts, manage the whitelist, and inspect compliance status.
        </p>
      </div>

      {/* Lookup */}
      <div className="card space-y-4">
        <h2 className="text-sm font-medium text-white">Account Lookup</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={lookupAddr}
            onChange={(e) => setLookupAddr(e.target.value)}
            placeholder="Account public key (Base58)…"
            className="input flex-1 font-mono"
            onKeyDown={(e) => e.key === "Enter" && void lookup()}
          />
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={lookupLoading}
            className="btn-secondary"
          >
            {lookupLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )}
            Lookup
          </button>
        </div>

        {lookupError && (
          <div className="text-sm text-red-400 flex items-center gap-1.5">
            <AlertCircle size={13} /> {lookupError}
          </div>
        )}

        {complianceData && (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-3 gap-px bg-border">
              {[
                {
                  label: "Status",
                  value: complianceData.frozen ? "Frozen" : "Active",
                  className: complianceData.frozen ? "text-red-400" : "text-emerald-400",
                },
                {
                  label: "Whitelist",
                  value: complianceData.whitelisted ? "Yes" : "No",
                  className: complianceData.whitelisted ? "text-emerald-400" : "text-slate-400",
                },
                {
                  label: "Balance",
                  value: complianceData.balance,
                  className: "text-white",
                },
              ].map(({ label, value, className }) => (
                <div key={label} className="bg-surface-700 p-3">
                  <div className="text-xs text-slate-500 mb-1">{label}</div>
                  <div className={`text-sm font-medium ${className}`}>{value}</div>
                </div>
              ))}
            </div>
            <div className="bg-surface-700 px-3 py-2 border-t border-border">
              <span className="mono text-slate-500">{complianceData.address}</span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="card space-y-4">
        <h2 className="text-sm font-medium text-white">Actions</h2>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Compliance Authority</label>
          <input
            type="text"
            value={authority}
            onChange={(e) => setAuthority(e.target.value)}
            placeholder="Freeze/whitelist authority public key"
            className="input font-mono"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void doFreeze(true)}
            disabled={txLoading || !lookupAddr || !authority}
            className="btn-danger"
          >
            {txLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ShieldBan size={13} />
            )}
            Freeze
          </button>
          <button
            type="button"
            onClick={() => void doFreeze(false)}
            disabled={txLoading || !lookupAddr || !authority}
            className="btn-secondary"
          >
            {txLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ShieldOff size={13} />
            )}
            Unfreeze
          </button>
          <button
            type="button"
            onClick={() => void doWhitelist(true)}
            disabled={txLoading || !lookupAddr || !authority}
            className="btn-primary"
          >
            {txLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ListChecks size={13} />
            )}
            Add to Whitelist
          </button>
          <button
            type="button"
            onClick={() => void doWhitelist(false)}
            disabled={txLoading || !lookupAddr || !authority}
            className="btn-secondary"
          >
            {txLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ListX size={13} />
            )}
            Remove from Whitelist
          </button>
        </div>

        <TxFeedback result={txResult} />
      </div>

      <div className="card text-xs text-slate-500 space-y-1">
        <p className="flex items-center gap-1">
          <ShieldCheck size={11} className="text-slate-400" />
          <span className="text-slate-400 font-medium">SSS-2 Compliance</span>
        </p>
        <p>Freeze/unfreeze halts all token movement for the account. Works with Token-2022 freeze authority.</p>
        <p>Whitelist is an allowlist enforced at the program level — only whitelisted addresses can hold/receive SSS-2/SSS-3 tokens.</p>
        <p>Transfer Hook (SSS-3) validates compliance on every token transfer at the program level, even in DEX swaps.</p>
      </div>
    </div>
  );
}
