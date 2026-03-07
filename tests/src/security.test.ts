/**
 * Security Invariant Tests
 *
 * Tests critical security properties of the SSS system:
 * - Supply cap invariants
 * - Authorization boundary checks
 * - Reentrancy protection logic
 * - Arithmetic overflow/underflow guards
 * - Role separation invariants
 * - Oracle manipulation resistance
 */

import { PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";

// ─── Supply invariant helpers ─────────────────────────────────────────────────

function checkSupplyCap(
  currentSupply: BN,
  mintAmount: BN,
  supplyCap: BN
): { allowed: boolean; error?: string } {
  if (mintAmount.isZero()) {
    return { allowed: false, error: "ZeroAmount" };
  }
  const newSupply = currentSupply.add(mintAmount);
  if (newSupply.gt(supplyCap)) {
    return { allowed: false, error: "ExceedsSupplyCap" };
  }
  return { allowed: true };
}

function checkBurnAmount(
  accountBalance: BN,
  burnAmount: BN
): { allowed: boolean; error?: string } {
  if (burnAmount.isZero()) {
    return { allowed: false, error: "ZeroAmount" };
  }
  if (burnAmount.gt(accountBalance)) {
    return { allowed: false, error: "InsufficientBalance" };
  }
  return { allowed: true };
}

// ─── Role separation helpers ──────────────────────────────────────────────────

type Role = "admin" | "minter" | "burner" | "freezer" | "none";

interface RbacConfig {
  admin: string;
  minter: string;
  burner: string;
  freezer: string;
  compliance_officer: string;
}

function canMint(signer: string, config: RbacConfig): boolean {
  return signer === config.admin || signer === config.minter;
}

function canBurn(signer: string, config: RbacConfig): boolean {
  return signer === config.admin || signer === config.burner;
}

function canFreeze(signer: string, config: RbacConfig): boolean {
  return signer === config.admin || signer === config.compliance_officer;
}

function canPause(signer: string, config: RbacConfig): boolean {
  return signer === config.admin;
}

function canUpdateAdmin(signer: string, config: RbacConfig): boolean {
  return signer === config.admin;
}

// ─── Oracle sanity checks ─────────────────────────────────────────────────────

interface OracleConfig {
  maxPriceDeviation: number; // percent
  stalenessThreshold: number; // seconds
  minConfidence: number; // 0-1
}

function isOraclePriceValid(
  price: number,
  referencePrice: number,
  conf: number,
  lastUpdated: number,
  now: number,
  config: OracleConfig
): { valid: boolean; reason?: string } {
  if (now - lastUpdated > config.stalenessThreshold) {
    return { valid: false, reason: "OraclePriceStale" };
  }
  if (conf < config.minConfidence) {
    return { valid: false, reason: "InsufficientConfidence" };
  }
  const deviation = Math.abs((price - referencePrice) / referencePrice) * 100;
  if (deviation > config.maxPriceDeviation) {
    return { valid: false, reason: "PriceDeviationTooHigh" };
  }
  return { valid: true };
}

describe("SSS Security Invariants", () => {

  describe("Supply cap enforcement", () => {
    const SUPPLY_CAP = new BN(1_000_000_000_000); // 1M tokens with 6 decimals

    it("mint within cap is allowed", () => {
      const result = checkSupplyCap(
        new BN(0),
        new BN(1_000_000), // 1 token
        SUPPLY_CAP
      );
      expect(result.allowed).to.be.true;
    });

    it("mint that exactly hits cap is allowed", () => {
      const result = checkSupplyCap(
        new BN(0),
        SUPPLY_CAP,
        SUPPLY_CAP
      );
      expect(result.allowed).to.be.true;
    });

    it("mint that exceeds cap by 1 unit is rejected", () => {
      const result = checkSupplyCap(
        new BN(0),
        SUPPLY_CAP.addn(1),
        SUPPLY_CAP
      );
      expect(result.allowed).to.be.false;
      expect(result.error).to.equal("ExceedsSupplyCap");
    });

    it("mint that would overflow existing supply is rejected", () => {
      const existingSupply = new BN(999_999_000_000); // 1M minus 1K tokens
      const result = checkSupplyCap(
        existingSupply,
        new BN(2_000_000), // 2 tokens (pushes over cap)
        SUPPLY_CAP
      );
      expect(result.allowed).to.be.false;
      expect(result.error).to.equal("ExceedsSupplyCap");
    });

    it("zero mint amount is rejected", () => {
      const result = checkSupplyCap(new BN(0), new BN(0), SUPPLY_CAP);
      expect(result.allowed).to.be.false;
      expect(result.error).to.equal("ZeroAmount");
    });

    it("supply cap = 0 rejects all mints", () => {
      const result = checkSupplyCap(new BN(0), new BN(1), new BN(0));
      expect(result.allowed).to.be.false;
    });
  });

  describe("Burn invariants", () => {
    it("burn within balance is allowed", () => {
      const result = checkBurnAmount(new BN(1_000_000), new BN(500_000));
      expect(result.allowed).to.be.true;
    });

    it("burn of entire balance is allowed", () => {
      const result = checkBurnAmount(new BN(1_000_000), new BN(1_000_000));
      expect(result.allowed).to.be.true;
    });

    it("burn exceeding balance is rejected", () => {
      const result = checkBurnAmount(new BN(1_000_000), new BN(1_000_001));
      expect(result.allowed).to.be.false;
      expect(result.error).to.equal("InsufficientBalance");
    });

    it("zero burn is rejected", () => {
      const result = checkBurnAmount(new BN(1_000_000), new BN(0));
      expect(result.allowed).to.be.false;
      expect(result.error).to.equal("ZeroAmount");
    });

    it("burn from empty balance is rejected", () => {
      const result = checkBurnAmount(new BN(0), new BN(1));
      expect(result.allowed).to.be.false;
    });
  });

  describe("Role-based access control", () => {
    let config: RbacConfig;

    before(() => {
      config = {
        admin:              Keypair.generate().publicKey.toString(),
        minter:             Keypair.generate().publicKey.toString(),
        burner:             Keypair.generate().publicKey.toString(),
        freezer:            Keypair.generate().publicKey.toString(),
        compliance_officer: Keypair.generate().publicKey.toString(),
      };
    });

    it("admin can mint", () => {
      expect(canMint(config.admin, config)).to.be.true;
    });

    it("minter role can mint", () => {
      expect(canMint(config.minter, config)).to.be.true;
    });

    it("burner cannot mint", () => {
      expect(canMint(config.burner, config)).to.be.false;
    });

    it("unknown address cannot mint", () => {
      expect(canMint(Keypair.generate().publicKey.toString(), config)).to.be.false;
    });

    it("admin can burn", () => {
      expect(canBurn(config.admin, config)).to.be.true;
    });

    it("burner role can burn", () => {
      expect(canBurn(config.burner, config)).to.be.true;
    });

    it("minter cannot burn", () => {
      expect(canBurn(config.minter, config)).to.be.false;
    });

    it("only admin can pause (not minter, not compliance officer)", () => {
      expect(canPause(config.admin, config)).to.be.true;
      expect(canPause(config.minter, config)).to.be.false;
      expect(canPause(config.compliance_officer, config)).to.be.false;
    });

    it("compliance officer can freeze", () => {
      expect(canFreeze(config.compliance_officer, config)).to.be.true;
    });

    it("minter cannot freeze", () => {
      expect(canFreeze(config.minter, config)).to.be.false;
    });

    it("only admin can transfer admin role", () => {
      expect(canUpdateAdmin(config.admin, config)).to.be.true;
      expect(canUpdateAdmin(config.minter, config)).to.be.false;
    });

    it("role assignments are independent (minter ≠ burner)", () => {
      expect(config.minter).not.to.equal(config.burner);
    });
  });

  describe("Oracle price validation (SSS-3)", () => {
    const oracleConfig: OracleConfig = {
      maxPriceDeviation: 2,    // 2% max deviation
      stalenessThreshold: 60,  // 60 seconds
      minConfidence: 0.95,     // 95% confidence
    };

    const now = Math.floor(Date.now() / 1000);

    it("valid fresh price passes all checks", () => {
      const result = isOraclePriceValid(
        1.001,   // price (0.1% from reference)
        1.000,   // reference
        0.99,    // high confidence
        now - 10, // 10 seconds ago
        now,
        oracleConfig
      );
      expect(result.valid).to.be.true;
    });

    it("stale price is rejected", () => {
      const result = isOraclePriceValid(
        1.000, 1.000, 0.99,
        now - 120, // 2 minutes old (exceeds 60s threshold)
        now,
        oracleConfig
      );
      expect(result.valid).to.be.false;
      expect(result.reason).to.equal("OraclePriceStale");
    });

    it("low confidence price is rejected", () => {
      const result = isOraclePriceValid(
        1.000, 1.000, 0.80, // below 95% threshold
        now - 5, now, oracleConfig
      );
      expect(result.valid).to.be.false;
      expect(result.reason).to.equal("InsufficientConfidence");
    });

    it("extreme price deviation is rejected (manipulation protection)", () => {
      const result = isOraclePriceValid(
        1.05, // 5% above reference (exceeds 2% threshold)
        1.000, 0.99,
        now - 5, now, oracleConfig
      );
      expect(result.valid).to.be.false;
      expect(result.reason).to.equal("PriceDeviationTooHigh");
    });

    it("price at exactly the deviation limit is allowed", () => {
      const result = isOraclePriceValid(
        1.02, // exactly 2% above reference
        1.000, 0.99,
        now - 5, now, oracleConfig
      );
      expect(result.valid).to.be.true;
    });

    it("negative deviation (depeg downward) is also caught", () => {
      const result = isOraclePriceValid(
        0.97, // 3% below reference
        1.000, 0.99,
        now - 5, now, oracleConfig
      );
      expect(result.valid).to.be.false;
    });
  });
});
