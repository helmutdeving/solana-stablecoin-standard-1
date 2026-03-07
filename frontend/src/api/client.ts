import type {
  SupplyResponse,
  MintRequest,
  BurnRequest,
  TransferRequest,
  TxResponse,
  FreezeRequest,
  WhitelistRequest,
  ComplianceStatus,
  SSSEvent,
  OraclePrice,
} from "./types";

const getSettings = () => ({
  apiUrl: localStorage.getItem("sss_api_url") ?? "http://localhost:3001",
  complianceUrl:
    localStorage.getItem("sss_compliance_url") ?? "http://localhost:3003",
  authToken: localStorage.getItem("sss_auth_token") ?? "",
});

async function apiFetch<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { authToken } = getSettings();
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Supply ───────────────────────────────────────────────────────────────────

export const getSupply = (mint: string): Promise<SupplyResponse> => {
  const { apiUrl } = getSettings();
  return apiFetch<SupplyResponse>(apiUrl, `/v1/supply?mint=${mint}`);
};

// ─── Operations ───────────────────────────────────────────────────────────────

export const mintTokens = (req: MintRequest): Promise<TxResponse> => {
  const { apiUrl } = getSettings();
  return apiFetch<TxResponse>(apiUrl, "/v1/mint", {
    method: "POST",
    body: JSON.stringify(req),
  });
};

export const burnTokens = (req: BurnRequest): Promise<TxResponse> => {
  const { apiUrl } = getSettings();
  return apiFetch<TxResponse>(apiUrl, "/v1/burn", {
    method: "POST",
    body: JSON.stringify(req),
  });
};

export const transferTokens = (req: TransferRequest): Promise<TxResponse> => {
  const { apiUrl } = getSettings();
  return apiFetch<TxResponse>(apiUrl, "/v1/transfer", {
    method: "POST",
    body: JSON.stringify(req),
  });
};

// ─── Compliance ───────────────────────────────────────────────────────────────

export const getComplianceStatus = (
  mint: string,
  account: string,
): Promise<ComplianceStatus> => {
  const { complianceUrl } = getSettings();
  return apiFetch<ComplianceStatus>(
    complianceUrl,
    `/v1/compliance/status?mint=${mint}&account=${account}`,
  );
};

export const freezeAccount = (req: FreezeRequest): Promise<TxResponse> => {
  const { complianceUrl } = getSettings();
  return apiFetch<TxResponse>(complianceUrl, "/v1/compliance/freeze", {
    method: "POST",
    body: JSON.stringify(req),
  });
};

export const updateWhitelist = (req: WhitelistRequest): Promise<TxResponse> => {
  const { complianceUrl } = getSettings();
  return apiFetch<TxResponse>(complianceUrl, "/v1/compliance/whitelist", {
    method: "POST",
    body: JSON.stringify(req),
  });
};

// ─── Events ───────────────────────────────────────────────────────────────────

export const getRecentEvents = (
  mint: string,
  limit = 50,
): Promise<SSSEvent[]> => {
  const { complianceUrl } = getSettings();
  return apiFetch<SSSEvent[]>(
    complianceUrl,
    `/v1/events?mint=${mint}&limit=${limit}`,
  );
};

// ─── Oracle ───────────────────────────────────────────────────────────────────

export const getOraclePrice = (symbol: string): Promise<OraclePrice> => {
  const apiUrl = localStorage.getItem("sss_oracle_url") ?? "http://localhost:3004";
  return apiFetch<OraclePrice>(apiUrl, `/v1/oracle/price?symbol=${symbol}`);
};
