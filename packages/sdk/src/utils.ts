import BN from "bn.js";

/** Encode a name string to a fixed 32-byte array */
export function encodeName(name: string): number[] {
  const bytes = Buffer.alloc(32);
  const nameBytes = Buffer.from(name, "utf8").slice(0, 32);
  nameBytes.copy(bytes);
  return Array.from(bytes);
}

/** Encode a symbol string to a fixed 8-byte array */
export function encodeSymbol(symbol: string): number[] {
  const bytes = Buffer.alloc(8);
  const symbolBytes = Buffer.from(symbol, "utf8").slice(0, 8);
  symbolBytes.copy(bytes);
  return Array.from(bytes);
}

/** Decode a null-padded byte array to string */
export function decodeString(bytes: Uint8Array | number[]): string {
  const buf = Buffer.from(bytes);
  const nullIdx = buf.indexOf(0);
  return buf.slice(0, nullIdx === -1 ? buf.length : nullIdx).toString("utf8");
}

/** Format a token amount with decimals */
export function formatAmount(amount: BN, decimals: number): string {
  const divisor = new BN(10).pow(new BN(decimals));
  const whole = amount.div(divisor);
  const frac = amount.mod(divisor).toString().padStart(decimals, "0");
  return `${whole.toString()}.${frac}`;
}

/** Parse a human-readable amount to BN */
export function parseAmount(amount: string, decimals: number): BN {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  return new BN(`${whole}${fracPadded}`);
}

/** Encode a KYC reference string to 64-byte hex buffer */
export function encodeKycRef(ref: string): string {
  return Buffer.from(ref, "utf8").slice(0, 64).toString("hex").padEnd(128, "0");
}
