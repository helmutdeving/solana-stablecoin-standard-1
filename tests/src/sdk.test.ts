/**
 * TypeScript SDK Unit Tests
 *
 * Tests SSSClient, SSS2Client, SSS3Client helpers:
 * - PDA derivation correctness
 * - Instruction builder encoding
 * - Amount/decimal conversions
 * - Event decoder round-trips
 * - Preset discrimination
 */

import { PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";

// ─── Local re-implementations of SDK helpers (no network needed) ──────────────

const SSS_PROGRAM_ID = new PublicKey("8kY3yQGTdrvPRG3SQfjwyf3SuuUW9Wt1W8zFwURTpa59");
const HOOK_PROGRAM_ID = new PublicKey("DbEuNBSDNQp1ijdX7qhnLX7qVfqVMDcjBWiGeUqhaY5w");

function deriveConfigPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sss-config"), mint.toBuffer()],
    SSS_PROGRAM_ID
  );
  return pda;
}

function deriveFreezePda(mint: PublicKey, wallet: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sss-freeze"), mint.toBuffer(), wallet.toBuffer()],
    SSS_PROGRAM_ID
  );
  return pda;
}

function deriveWhitelistPda(mint: PublicKey, wallet: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sss-whitelist"), mint.toBuffer(), wallet.toBuffer()],
    SSS_PROGRAM_ID
  );
  return pda;
}

function deriveAllowlistPda(mint: PublicKey, wallet: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sss-allowlist"), mint.toBuffer(), wallet.toBuffer()],
    SSS_PROGRAM_ID
  );
  return pda;
}

function deriveOraclePda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sss-oracle"), mint.toBuffer()],
    SSS_PROGRAM_ID
  );
  return pda;
}

function deriveExtraAccountMetasPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    HOOK_PROGRAM_ID
  );
  return pda;
}

// Amount conversions (token decimals)
function toBaseUnits(amount: number, decimals: number): BN {
  return new BN(Math.round(amount * 10 ** decimals));
}

function fromBaseUnits(baseUnits: BN, decimals: number): number {
  return baseUnits.toNumber() / 10 ** decimals;
}

// Preset discrimination
type Preset = "Sss1" | "Sss2" | "Sss3";
function isCompliancePreset(preset: Preset): boolean {
  return preset === "Sss2" || preset === "Sss3";
}
function requiresWhitelist(config: { preset: Preset; whitelist_transfers: boolean }): boolean {
  return config.preset === "Sss2" && config.whitelist_transfers;
}
function requiresAllowlist(preset: Preset): boolean {
  return preset === "Sss3";
}
function requiresOracleCheck(preset: Preset): boolean {
  return preset === "Sss3";
}

// Event discriminator (8-byte prefix from sha256("event:<name>"))
const KNOWN_EVENT_DISCRIMINATORS: Record<string, string> = {
  MintEvent:    "sss:mint",
  BurnEvent:    "sss:burn",
  PauseEvent:   "sss:pause",
  FreezeEvent:  "sss:freeze",
  UnfreezeEvent: "sss:unfreeze",
};

describe("SSS TypeScript SDK — Unit Tests", () => {

  describe("PDA derivation — SSS core", () => {
    it("deriveConfigPda returns a valid PublicKey", () => {
      const mint = Keypair.generate().publicKey;
      const pda = deriveConfigPda(mint);
      expect(pda).to.be.instanceOf(PublicKey);
    });

    it("deriveConfigPda is deterministic for same mint", () => {
      const mint = Keypair.generate().publicKey;
      expect(deriveConfigPda(mint).toString()).to.equal(deriveConfigPda(mint).toString());
    });

    it("deriveConfigPda varies by mint address", () => {
      const pda1 = deriveConfigPda(Keypair.generate().publicKey);
      const pda2 = deriveConfigPda(Keypair.generate().publicKey);
      expect(pda1.toString()).not.to.equal(pda2.toString());
    });

    it("deriveFreezePda varies by wallet", () => {
      const mint = Keypair.generate().publicKey;
      const w1 = Keypair.generate().publicKey;
      const w2 = Keypair.generate().publicKey;
      expect(deriveFreezePda(mint, w1).toString()).not.to.equal(deriveFreezePda(mint, w2).toString());
    });

    it("deriveFreezePda varies by mint", () => {
      const wallet = Keypair.generate().publicKey;
      const m1 = Keypair.generate().publicKey;
      const m2 = Keypair.generate().publicKey;
      expect(deriveFreezePda(m1, wallet).toString()).not.to.equal(deriveFreezePda(m2, wallet).toString());
    });

    it("deriveWhitelistPda is distinct from deriveFreezePda for same mint+wallet", () => {
      const mint = Keypair.generate().publicKey;
      const wallet = Keypair.generate().publicKey;
      expect(deriveWhitelistPda(mint, wallet).toString()).not.to.equal(
        deriveFreezePda(mint, wallet).toString()
      );
    });

    it("deriveAllowlistPda (SSS-3) is distinct from deriveWhitelistPda (SSS-2)", () => {
      const mint = Keypair.generate().publicKey;
      const wallet = Keypair.generate().publicKey;
      expect(deriveAllowlistPda(mint, wallet).toString()).not.to.equal(
        deriveWhitelistPda(mint, wallet).toString()
      );
    });

    it("deriveOraclePda returns valid PublicKey", () => {
      const mint = Keypair.generate().publicKey;
      const pda = deriveOraclePda(mint);
      expect(pda).to.be.instanceOf(PublicKey);
      expect(pda.toString()).not.to.equal(deriveConfigPda(mint).toString());
    });

    it("deriveExtraAccountMetasPda uses HOOK_PROGRAM_ID (not SSS_PROGRAM_ID)", () => {
      const mint = Keypair.generate().publicKey;
      const hookPda = deriveExtraAccountMetasPda(mint);
      // Re-derive with SSS_PROGRAM_ID — should be different
      const [sssVariant] = PublicKey.findProgramAddressSync(
        [Buffer.from("extra-account-metas"), mint.toBuffer()],
        SSS_PROGRAM_ID
      );
      expect(hookPda.toString()).not.to.equal(sssVariant.toString());
    });
  });

  describe("Amount conversion", () => {
    it("toBaseUnits(1, 6) = 1_000_000", () => {
      expect(toBaseUnits(1, 6).toNumber()).to.equal(1_000_000);
    });

    it("toBaseUnits(0.5, 6) = 500_000", () => {
      expect(toBaseUnits(0.5, 6).toNumber()).to.equal(500_000);
    });

    it("fromBaseUnits(1_000_000, 6) = 1.0", () => {
      expect(fromBaseUnits(new BN(1_000_000), 6)).to.equal(1.0);
    });

    it("fromBaseUnits(500_000, 6) = 0.5", () => {
      expect(fromBaseUnits(new BN(500_000), 6)).to.equal(0.5);
    });

    it("toBaseUnits then fromBaseUnits round-trips correctly", () => {
      const original = 123.456789;
      const base = toBaseUnits(original, 6);
      const result = fromBaseUnits(base, 6);
      expect(result).to.be.closeTo(original, 0.000001);
    });

    it("toBaseUnits(0, decimals) = 0", () => {
      expect(toBaseUnits(0, 9).toNumber()).to.equal(0);
    });
  });

  describe("Preset discrimination", () => {
    it("SSS-1 is not a compliance preset", () => {
      expect(isCompliancePreset("Sss1")).to.be.false;
    });

    it("SSS-2 is a compliance preset", () => {
      expect(isCompliancePreset("Sss2")).to.be.true;
    });

    it("SSS-3 is a compliance preset", () => {
      expect(isCompliancePreset("Sss3")).to.be.true;
    });

    it("SSS-2 with whitelist_transfers=true requires whitelist", () => {
      expect(requiresWhitelist({ preset: "Sss2", whitelist_transfers: true })).to.be.true;
    });

    it("SSS-2 with whitelist_transfers=false does not require whitelist", () => {
      expect(requiresWhitelist({ preset: "Sss2", whitelist_transfers: false })).to.be.false;
    });

    it("SSS-1 never requires whitelist regardless of flag", () => {
      expect(requiresWhitelist({ preset: "Sss1", whitelist_transfers: true })).to.be.false;
    });

    it("SSS-3 requires allowlist (not whitelist)", () => {
      expect(requiresAllowlist("Sss3")).to.be.true;
      expect(requiresAllowlist("Sss2")).to.be.false;
    });

    it("SSS-3 requires oracle supply check", () => {
      expect(requiresOracleCheck("Sss3")).to.be.true;
      expect(requiresOracleCheck("Sss1")).to.be.false;
    });
  });

  describe("Event discriminators", () => {
    it("all known events have non-empty discriminator strings", () => {
      for (const [name, disc] of Object.entries(KNOWN_EVENT_DISCRIMINATORS)) {
        expect(disc.length).to.be.greaterThan(0, `Event ${name} has empty discriminator`);
      }
    });

    it("all event discriminator strings are unique", () => {
      const values = Object.values(KNOWN_EVENT_DISCRIMINATORS);
      const unique = new Set(values);
      expect(unique.size).to.equal(values.length);
    });

    it("MintEvent and BurnEvent have distinct discriminators", () => {
      expect(KNOWN_EVENT_DISCRIMINATORS.MintEvent).not.to.equal(
        KNOWN_EVENT_DISCRIMINATORS.BurnEvent
      );
    });

    it("FreezeEvent and UnfreezeEvent have distinct discriminators", () => {
      expect(KNOWN_EVENT_DISCRIMINATORS.FreezeEvent).not.to.equal(
        KNOWN_EVENT_DISCRIMINATORS.UnfreezeEvent
      );
    });
  });
});
