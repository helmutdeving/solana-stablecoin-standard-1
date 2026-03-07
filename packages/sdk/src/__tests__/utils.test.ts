import BN from "bn.js";
import {
  encodeName,
  encodeSymbol,
  decodeString,
  formatAmount,
  parseAmount,
  encodeKycRef,
} from "../utils";

// ─── encodeName ──────────────────────────────────────────────────────────────

describe("encodeName", () => {
  it("encodes a short name to 32 bytes", () => {
    const result = encodeName("USDC");
    expect(result).toHaveLength(32);
  });

  it("pads short names with zero bytes", () => {
    const result = encodeName("USDC");
    for (let i = 4; i < 32; i++) {
      expect(result[i]).toBe(0);
    }
  });

  it("encodes the correct characters", () => {
    const result = encodeName("USDC");
    expect(result[0]).toBe("U".charCodeAt(0));
    expect(result[1]).toBe("S".charCodeAt(0));
    expect(result[2]).toBe("D".charCodeAt(0));
    expect(result[3]).toBe("C".charCodeAt(0));
  });

  it("truncates names longer than 32 bytes", () => {
    const longName = "A".repeat(40);
    const result = encodeName(longName);
    expect(result).toHaveLength(32);
  });

  it("handles empty string", () => {
    const result = encodeName("");
    expect(result).toHaveLength(32);
    expect(result.every((b) => b === 0)).toBe(true);
  });

  it("handles exactly 32-character names", () => {
    const name = "A".repeat(32);
    const result = encodeName(name);
    expect(result).toHaveLength(32);
    expect(result.every((b) => b === "A".charCodeAt(0))).toBe(true);
  });

  it("handles UTF-8 multi-byte characters without overflow", () => {
    const result = encodeName("USD Coin Stablecoin Protocol XYZ");
    expect(result).toHaveLength(32);
  });

  it("returns an array of numbers", () => {
    const result = encodeName("Test");
    expect(Array.isArray(result)).toBe(true);
    result.forEach((b) => expect(typeof b).toBe("number"));
  });

  it("encodes 'USD Coin' correctly", () => {
    const result = encodeName("USD Coin");
    expect(result[0]).toBe("U".charCodeAt(0));
    expect(result[3]).toBe(" ".charCodeAt(0));
    expect(result[8]).toBe(0);
  });

  it("different names produce different encodings", () => {
    const r1 = encodeName("USDC");
    const r2 = encodeName("USDT");
    expect(r1.join(",")).not.toBe(r2.join(","));
  });
});

// ─── encodeSymbol ────────────────────────────────────────────────────────────

describe("encodeSymbol", () => {
  it("encodes a symbol to 8 bytes", () => {
    const result = encodeSymbol("USDC");
    expect(result).toHaveLength(8);
  });

  it("pads short symbols with zeros", () => {
    const result = encodeSymbol("USD");
    for (let i = 3; i < 8; i++) {
      expect(result[i]).toBe(0);
    }
  });

  it("truncates symbols longer than 8 bytes", () => {
    const result = encodeSymbol("VERYLONGSYMBOL");
    expect(result).toHaveLength(8);
  });

  it("encodes the correct bytes for BTC", () => {
    const result = encodeSymbol("BTC");
    expect(result[0]).toBe("B".charCodeAt(0));
    expect(result[1]).toBe("T".charCodeAt(0));
    expect(result[2]).toBe("C".charCodeAt(0));
    expect(result[3]).toBe(0);
  });

  it("handles empty string", () => {
    const result = encodeSymbol("");
    expect(result).toHaveLength(8);
    expect(result.every((b) => b === 0)).toBe(true);
  });

  it("handles exactly 8-char symbol", () => {
    const sym = "ABCDEFGH";
    const result = encodeSymbol(sym);
    expect(result).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(result[i]).toBe(sym.charCodeAt(i));
    }
  });

  it("USDC encodes correctly", () => {
    const result = encodeSymbol("USDC");
    expect(result[0]).toBe(85); // 'U'
    expect(result[1]).toBe(83); // 'S'
    expect(result[2]).toBe(68); // 'D'
    expect(result[3]).toBe(67); // 'C'
  });
});

// ─── decodeString ────────────────────────────────────────────────────────────

describe("decodeString", () => {
  it("decodes a null-terminated byte array", () => {
    const bytes = [72, 101, 108, 108, 111, 0, 0, 0]; // "Hello\0\0\0"
    expect(decodeString(bytes)).toBe("Hello");
  });

  it("decodes a non-null-terminated array", () => {
    const bytes = [72, 101, 108, 108, 111]; // "Hello"
    expect(decodeString(bytes)).toBe("Hello");
  });

  it("decodes empty bytes", () => {
    expect(decodeString([])).toBe("");
  });

  it("decodes Uint8Array input", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111, 0]);
    expect(decodeString(bytes)).toBe("Hello");
  });

  it("round-trips with encodeName", () => {
    const original = "TestToken";
    const encoded = encodeName(original);
    const decoded = decodeString(encoded);
    expect(decoded).toBe(original);
  });

  it("round-trips with encodeSymbol", () => {
    const original = "TST";
    const encoded = encodeSymbol(original);
    const decoded = decodeString(encoded);
    expect(decoded).toBe(original);
  });

  it("handles all-zero array", () => {
    expect(decodeString([0, 0, 0, 0])).toBe("");
  });

  it("stops at first null byte", () => {
    const bytes = [65, 0, 66, 67]; // "A\0BC"
    expect(decodeString(bytes)).toBe("A");
  });

  it("decodes USDC symbol round-trip", () => {
    const encoded = encodeSymbol("USDC");
    expect(decodeString(encoded)).toBe("USDC");
  });
});

// ─── formatAmount ────────────────────────────────────────────────────────────

describe("formatAmount", () => {
  it("formats zero correctly with 6 decimals", () => {
    expect(formatAmount(new BN(0), 6)).toBe("0.000000");
  });

  it("formats 1 USDC (1_000_000 with 6 decimals)", () => {
    expect(formatAmount(new BN(1_000_000), 6)).toBe("1.000000");
  });

  it("formats 1.5 USDC", () => {
    expect(formatAmount(new BN(1_500_000), 6)).toBe("1.500000");
  });

  it("formats with 0 decimals", () => {
    const result = formatAmount(new BN(1000), 0);
    expect(result).toContain("1000");
  });

  it("formats with 2 decimals", () => {
    expect(formatAmount(new BN(150), 2)).toBe("1.50");
  });

  it("pads fractional zeros correctly", () => {
    expect(formatAmount(new BN(1), 6)).toBe("0.000001");
  });

  it("formats 100 USDC", () => {
    expect(formatAmount(new BN(100_000_000), 6)).toBe("100.000000");
  });

  it("formats 0.5 with 2 decimals", () => {
    expect(formatAmount(new BN(50), 2)).toBe("0.50");
  });

  it("formats large supply (1 billion tokens)", () => {
    const billion = new BN(1_000_000_000).mul(new BN(1_000_000)); // 1B USDC with 6 decimals
    const result = formatAmount(billion, 6);
    expect(result.startsWith("1000000000.")).toBe(true);
  });

  it("returns string type", () => {
    expect(typeof formatAmount(new BN(1000), 6)).toBe("string");
  });
});

// ─── parseAmount ────────────────────────────────────────────────────────────

describe("parseAmount", () => {
  it("parses '1.000000' with 6 decimals", () => {
    expect(parseAmount("1.000000", 6).toString()).toBe("1000000");
  });

  it("parses '0' with 6 decimals", () => {
    expect(parseAmount("0", 6).toString()).toBe("0");
  });

  it("parses '1.5' with 6 decimals", () => {
    expect(parseAmount("1.5", 6).toString()).toBe("1500000");
  });

  it("parses whole numbers without decimal point", () => {
    expect(parseAmount("100", 6).toString()).toBe("100000000");
  });

  it("parses with 2 decimals", () => {
    expect(parseAmount("1.50", 2).toString()).toBe("150");
  });

  it("round-trips with formatAmount", () => {
    const original = new BN(1_234_567);
    const formatted = formatAmount(original, 6);
    const parsed = parseAmount(formatted, 6);
    expect(parsed.toString()).toBe(original.toString());
  });

  it("truncates excess decimal places", () => {
    expect(parseAmount("1.1234567", 6).toString()).toBe("1123456");
  });

  it("returns BN instance", () => {
    const result = parseAmount("1.0", 6);
    expect(result instanceof BN).toBe(true);
  });

  it("parses '0.000001' (minimum USDC)", () => {
    expect(parseAmount("0.000001", 6).toString()).toBe("1");
  });

  it("parses large amounts", () => {
    const result = parseAmount("1000000.0", 6);
    expect(result.toString()).toBe("1000000000000");
  });
});

// ─── encodeKycRef ────────────────────────────────────────────────────────────

describe("encodeKycRef", () => {
  it("returns a hex string", () => {
    const result = encodeKycRef("KYC-12345");
    expect(typeof result).toBe("string");
    expect(/^[0-9a-f]+$/.test(result)).toBe(true);
  });

  it("returns 128 hex chars (64 bytes)", () => {
    const result = encodeKycRef("KYC-12345");
    expect(result.length).toBe(128);
  });

  it("pads to 128 chars with zeros", () => {
    const result = encodeKycRef("A");
    expect(result.length).toBe(128);
    expect(result.endsWith("0".repeat(126))).toBe(true);
  });

  it("handles empty string", () => {
    const result = encodeKycRef("");
    expect(result).toBe("0".repeat(128));
  });

  it("truncates refs longer than 64 chars", () => {
    const longRef = "X".repeat(100);
    const result = encodeKycRef(longRef);
    expect(result.length).toBe(128);
  });

  it("encodes 'A' (0x41) as first two hex chars", () => {
    const result = encodeKycRef("A");
    expect(result.startsWith("41")).toBe(true);
  });

  it("different refs produce different encodings", () => {
    const r1 = encodeKycRef("KYC-001");
    const r2 = encodeKycRef("KYC-002");
    expect(r1).not.toBe(r2);
  });

  it("same ref produces same encoding", () => {
    const ref = "OFAC-SANCTION-REF-12345";
    expect(encodeKycRef(ref)).toBe(encodeKycRef(ref));
  });
});
