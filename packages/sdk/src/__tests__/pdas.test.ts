import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PDAs } from "../pdas";

// Known stable program ID for deterministic test vectors
const TEST_PROGRAM_ID = new PublicKey(
  "SSSjCmjEaFyspzE1E9C1YEhWwFHyyjS4ZqAaXWsQPY5"
);

describe("PDAs", () => {
  let pdas: PDAs;
  // Known stable public keys (USDC mint + a known wallet)
  const mint = new PublicKey(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  );
  const wallet = new PublicKey(
    "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
  );
  const mint2 = new PublicKey(
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
  );

  beforeEach(() => {
    pdas = new PDAs(TEST_PROGRAM_ID);
  });

  // ─── config PDA ─────────────────────────────────────────────────────────

  describe("config()", () => {
    it("returns a tuple of [PublicKey, number]", () => {
      const [pda, bump] = pdas.config(mint);
      expect(pda instanceof PublicKey).toBe(true);
      expect(typeof bump).toBe("number");
    });

    it("returns a valid off-curve PDA", () => {
      const [pda] = pdas.config(mint);
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    it("bump is in valid range [0, 255]", () => {
      const [, bump] = pdas.config(mint);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it("is deterministic for same mint", () => {
      const [pda1] = pdas.config(mint);
      const [pda2] = pdas.config(mint);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it("is different for different mints", () => {
      const [pda1] = pdas.config(mint);
      const [pda2] = pdas.config(mint2);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it("is program-specific (different program → different PDA)", () => {
      const otherPdas = new PDAs(
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
      );
      const [pda1] = pdas.config(mint);
      const [pda2] = otherPdas.config(mint);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it("PDA is a valid base58 string", () => {
      const [pda] = pdas.config(mint);
      expect(pda.toBase58().length).toBeGreaterThan(30);
    });
  });

  // ─── compliance PDA ─────────────────────────────────────────────────────

  describe("compliance()", () => {
    it("returns a tuple of [PublicKey, number]", () => {
      const [pda, bump] = pdas.compliance(mint);
      expect(pda instanceof PublicKey).toBe(true);
      expect(typeof bump).toBe("number");
    });

    it("returns a valid off-curve PDA", () => {
      const [pda] = pdas.compliance(mint);
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    it("is deterministic for same mint", () => {
      const [pda1] = pdas.compliance(mint);
      const [pda2] = pdas.compliance(mint);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it("is different from config PDA for same mint", () => {
      const [configPda] = pdas.config(mint);
      const [compliancePda] = pdas.compliance(mint);
      expect(configPda.toBase58()).not.toBe(compliancePda.toBase58());
    });

    it("is different for different mints", () => {
      const [pda1] = pdas.compliance(mint);
      const [pda2] = pdas.compliance(mint2);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it("bump is in valid range [0, 255]", () => {
      const [, bump] = pdas.compliance(mint);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });
  });

  // ─── whitelist PDA ──────────────────────────────────────────────────────

  describe("whitelist()", () => {
    it("returns a tuple of [PublicKey, number]", () => {
      const [pda, bump] = pdas.whitelist(mint, wallet);
      expect(pda instanceof PublicKey).toBe(true);
      expect(typeof bump).toBe("number");
    });

    it("returns a valid off-curve PDA", () => {
      const [pda] = pdas.whitelist(mint, wallet);
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    it("is deterministic for same mint+wallet", () => {
      const [pda1] = pdas.whitelist(mint, wallet);
      const [pda2] = pdas.whitelist(mint, wallet);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it("is different for different wallets", () => {
      const wallet2 = new PublicKey(
        "GpMZbSjjg6vFGUpfWAuNwfCCFi2HqfX3xoYjGDavB9g"
      );
      const [pda1] = pdas.whitelist(mint, wallet);
      const [pda2] = pdas.whitelist(mint, wallet2);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it("is different for different mints with same wallet", () => {
      const [pda1] = pdas.whitelist(mint, wallet);
      const [pda2] = pdas.whitelist(mint2, wallet);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it("is different from freeze PDA for same mint+wallet", () => {
      const [whitelistPda] = pdas.whitelist(mint, wallet);
      const [freezePda] = pdas.freeze(mint, wallet);
      expect(whitelistPda.toBase58()).not.toBe(freezePda.toBase58());
    });

    it("is different from config PDA", () => {
      const [whitelist] = pdas.whitelist(mint, wallet);
      const [config] = pdas.config(mint);
      expect(whitelist.toBase58()).not.toBe(config.toBase58());
    });
  });

  // ─── freeze PDA ─────────────────────────────────────────────────────────

  describe("freeze()", () => {
    it("returns a tuple of [PublicKey, number]", () => {
      const [pda, bump] = pdas.freeze(mint, wallet);
      expect(pda instanceof PublicKey).toBe(true);
      expect(typeof bump).toBe("number");
    });

    it("returns a valid off-curve PDA", () => {
      const [pda] = pdas.freeze(mint, wallet);
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    it("is deterministic for same mint+wallet", () => {
      const [pda1] = pdas.freeze(mint, wallet);
      const [pda2] = pdas.freeze(mint, wallet);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it("is different for different wallets", () => {
      const wallet2 = new PublicKey(
        "GpMZbSjjg6vFGUpfWAuNwfCCFi2HqfX3xoYjGDavB9g"
      );
      const [pda1] = pdas.freeze(mint, wallet);
      const [pda2] = pdas.freeze(mint, wallet2);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it("is different for different mints", () => {
      const [pda1] = pdas.freeze(mint, wallet);
      const [pda2] = pdas.freeze(mint2, wallet);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it("bump is in valid range [0, 255]", () => {
      const [, bump] = pdas.freeze(mint, wallet);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });
  });

  // ─── complianceEvent PDA ────────────────────────────────────────────────

  describe("complianceEvent()", () => {
    it("returns a tuple of [PublicKey, number]", () => {
      const [pda, bump] = pdas.complianceEvent(mint, new BN(0));
      expect(pda instanceof PublicKey).toBe(true);
      expect(typeof bump).toBe("number");
    });

    it("returns a valid off-curve PDA", () => {
      const [pda] = pdas.complianceEvent(mint, new BN(0));
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    it("is deterministic for same mint+eventId", () => {
      const eventId = new BN(42);
      const [pda1] = pdas.complianceEvent(mint, eventId);
      const [pda2] = pdas.complianceEvent(mint, eventId);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it("is different for sequential event IDs (0 vs 1)", () => {
      const [pda0] = pdas.complianceEvent(mint, new BN(0));
      const [pda1] = pdas.complianceEvent(mint, new BN(1));
      expect(pda0.toBase58()).not.toBe(pda1.toBase58());
    });

    it("handles large event IDs without error", () => {
      const largeId = new BN("9999999999999");
      const [pda] = pdas.complianceEvent(mint, largeId);
      expect(pda instanceof PublicKey).toBe(true);
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    it("events 0, 1, 100 all produce unique PDAs", () => {
      const [pda0] = pdas.complianceEvent(mint, new BN(0));
      const [pda1] = pdas.complianceEvent(mint, new BN(1));
      const [pda100] = pdas.complianceEvent(mint, new BN(100));
      expect(pda0.toBase58()).not.toBe(pda1.toBase58());
      expect(pda1.toBase58()).not.toBe(pda100.toBase58());
      expect(pda0.toBase58()).not.toBe(pda100.toBase58());
    });

    it("is different from whitelist PDA for event 0", () => {
      const [eventPda] = pdas.complianceEvent(mint, new BN(0));
      const [whitelistPda] = pdas.whitelist(mint, wallet);
      expect(eventPda.toBase58()).not.toBe(whitelistPda.toBase58());
    });

    it("is different for different mints same event", () => {
      const [pda1] = pdas.complianceEvent(mint, new BN(5));
      const [pda2] = pdas.complianceEvent(mint2, new BN(5));
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it("bump is in valid range [0, 255]", () => {
      const [, bump] = pdas.complianceEvent(mint, new BN(0));
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });
  });

  // ─── Cross-PDA uniqueness ────────────────────────────────────────────────

  describe("cross-PDA uniqueness", () => {
    it("all five PDA types produce unique addresses for same inputs", () => {
      const [configPda] = pdas.config(mint);
      const [compliancePda] = pdas.compliance(mint);
      const [whitelistPda] = pdas.whitelist(mint, wallet);
      const [freezePda] = pdas.freeze(mint, wallet);
      const [eventPda] = pdas.complianceEvent(mint, new BN(0));

      const addresses = new Set([
        configPda.toBase58(),
        compliancePda.toBase58(),
        whitelistPda.toBase58(),
        freezePda.toBase58(),
        eventPda.toBase58(),
      ]);

      expect(addresses.size).toBe(5);
    });

    it("PDAs for different mints are all unique", () => {
      const mints = [mint, mint2];
      const pdaAddresses: string[] = [];

      for (const m of mints) {
        const [config] = pdas.config(m);
        const [compliance] = pdas.compliance(m);
        pdaAddresses.push(config.toBase58(), compliance.toBase58());
      }

      const unique = new Set(pdaAddresses);
      expect(unique.size).toBe(pdaAddresses.length);
    });
  });
});
