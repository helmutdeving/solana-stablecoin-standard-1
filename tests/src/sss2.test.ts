import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

import {
  createTestMint,
  mintTo,
  createAssociatedTokenAccount,
  getBalance,
  expectError,
  airdrop,
  findSss1ConfigPda,
  findSss2ConfigPda,
  findWhitelistRecordPda,
  findFreezeRecordPda,
  findComplianceEventRecordPda,
  fetchStablecoinConfig,
  fetchComplianceConfig,
  padKycReference,
  padFreezeReason,
  getCurrentTimestamp,
  sleep,
} from "./helpers";

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sss1Idl = require("../../target/idl/sss1.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sss2Idl = require("../../target/idl/sss2.json");

const SSS1_PROGRAM_ID = new PublicKey(
  process.env.SSS1_PROGRAM_ID ?? sss1Idl.metadata.address
);
const SSS2_PROGRAM_ID = new PublicKey(
  process.env.SSS2_PROGRAM_ID ?? sss2Idl.metadata.address
);

// ---------------------------------------------------------------------------
// Shared fixture factory
// ---------------------------------------------------------------------------

interface Sss2Fixture {
  mint: Keypair;
  sss1ConfigPda: PublicKey;
  complianceConfigPda: PublicKey;
  admin: Keypair;
  complianceOfficer: Keypair;
  complianceVault: PublicKey;
  sss1Program: Program;
  sss2Program: Program;
}

async function buildSss2Fixture(
  provider: anchor.AnchorProvider,
  whitelistEnabled = false
): Promise<Sss2Fixture> {
  const sss1Program = new anchor.Program(sss1Idl, SSS1_PROGRAM_ID, provider) as Program;
  const sss2Program = new anchor.Program(sss2Idl, SSS2_PROGRAM_ID, provider) as Program;

  // Initialize SSS-1 base.
  const sss1Result = await createTestMint(provider, sss1Program, {
    decimals: 6,
    supplyCap: new BN(0),
  });

  const admin = sss1Result.admin;
  const mint = sss1Result.mint;
  const sss1ConfigPda = sss1Result.configPda;

  const complianceOfficer = Keypair.generate();
  await airdrop(provider, complianceOfficer.publicKey, 2 * LAMPORTS_PER_SOL);

  const [complianceConfigPda] = findSss2ConfigPda(mint.publicKey, SSS2_PROGRAM_ID);

  // Compliance vault = admin's own ATA (for test simplicity).
  const complianceVault = await createAssociatedTokenAccount(
    provider,
    mint.publicKey,
    admin.publicKey
  );

  await sss2Program.methods
    .initializeSss2(whitelistEnabled)
    .accounts({
      complianceConfig: complianceConfigPda,
      mint: mint.publicKey,
      sss1Config: sss1ConfigPda,
      complianceVault,
      admin: admin.publicKey,
      complianceOfficer: complianceOfficer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();

  // Complete upgrade on SSS-1 side.
  await sss1Program.methods
    .upgradeToSss2()
    .accounts({
      config: sss1ConfigPda,
      complianceConfig: complianceConfigPda,
      admin: admin.publicKey,
    })
    .signers([admin])
    .rpc();

  return {
    mint,
    sss1ConfigPda,
    complianceConfigPda,
    admin,
    complianceOfficer,
    complianceVault,
    sss1Program,
    sss2Program,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SSS-2", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // ---------------------------------------------------------------------------
  // initialize_sss2
  // ---------------------------------------------------------------------------

  describe("initialize_sss2", () => {
    it("happy path: creates compliance config with correct fields", async () => {
      const sss1Program = new anchor.Program(sss1Idl, SSS1_PROGRAM_ID, provider) as Program;
      const sss2Program = new anchor.Program(sss2Idl, SSS2_PROGRAM_ID, provider) as Program;

      const sss1Result = await createTestMint(provider, sss1Program, {
        decimals: 6,
        supplyCap: new BN(5_000_000),
      });

      const complianceOfficer = Keypair.generate();
      await airdrop(provider, complianceOfficer.publicKey, LAMPORTS_PER_SOL);

      const [complianceConfigPda] = findSss2ConfigPda(
        sss1Result.mint.publicKey,
        SSS2_PROGRAM_ID
      );

      const complianceVault = await createAssociatedTokenAccount(
        provider,
        sss1Result.mint.publicKey,
        sss1Result.admin.publicKey
      );

      await sss2Program.methods
        .initializeSss2(true)
        .accounts({
          complianceConfig: complianceConfigPda,
          mint: sss1Result.mint.publicKey,
          sss1Config: sss1Result.configPda,
          complianceVault,
          admin: sss1Result.admin.publicKey,
          complianceOfficer: complianceOfficer.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sss1Result.admin])
        .rpc();

      const config = await fetchComplianceConfig(sss2Program, complianceConfigPda);

      expect(config.version).to.equal(2);
      expect(config.mint.toBase58()).to.equal(sss1Result.mint.publicKey.toBase58());
      expect(config.admin.toBase58()).to.equal(sss1Result.admin.publicKey.toBase58());
      expect(config.complianceOfficer.toBase58()).to.equal(
        complianceOfficer.publicKey.toBase58()
      );
      expect(config.whitelistEnabled).to.be.true;
      expect(config.eventCount.eq(new BN(0))).to.be.true;
      expect(config.totalSupply.eq(new BN(0))).to.be.true;
    });

    it("fails when admin signer does not match sss1_config admin", async () => {
      const sss1Program = new anchor.Program(sss1Idl, SSS1_PROGRAM_ID, provider) as Program;
      const sss2Program = new anchor.Program(sss2Idl, SSS2_PROGRAM_ID, provider) as Program;

      const sss1Result = await createTestMint(provider, sss1Program, {
        decimals: 6,
        supplyCap: new BN(0),
      });

      const impostor = Keypair.generate();
      await airdrop(provider, impostor.publicKey, LAMPORTS_PER_SOL);

      const [complianceConfigPda] = findSss2ConfigPda(
        sss1Result.mint.publicKey,
        SSS2_PROGRAM_ID
      );
      const vault = await createAssociatedTokenAccount(
        provider,
        sss1Result.mint.publicKey,
        impostor.publicKey
      );

      await expectError(
        () =>
          sss2Program.methods
            .initializeSss2(false)
            .accounts({
              complianceConfig: complianceConfigPda,
              mint: sss1Result.mint.publicKey,
              sss1Config: sss1Result.configPda,
              complianceVault: vault,
              admin: impostor.publicKey,
              complianceOfficer: impostor.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([impostor])
            .rpc(),
        "Unauthorized"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // whitelist_add
  // ---------------------------------------------------------------------------

  describe("whitelist_add", () => {
    let fixture: Sss2Fixture;
    const wallet = Keypair.generate();

    before(async () => {
      fixture = await buildSss2Fixture(provider, true);
      await airdrop(provider, wallet.publicKey, LAMPORTS_PER_SOL);
    });

    it("admin can add an address to the whitelist", async () => {
      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        wallet.publicKey,
        SSS2_PROGRAM_ID
      );
      const kycRef = padKycReference("KYC-UUID-1234-5678");

      await fixture.sss2Program.methods
        .whitelistAdd(kycRef, new BN(0))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          whitelistRecord: whitelistPda,
          wallet: wallet.publicKey,
          authority: fixture.admin.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.admin])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await (fixture.sss2Program.account as any).whitelistRecord.fetch(
        whitelistPda
      );
      expect(record.isActive).to.be.true;
      expect(record.wallet.toBase58()).to.equal(wallet.publicKey.toBase58());
    });

    it("compliance officer can add an address to the whitelist", async () => {
      const newWallet = Keypair.generate();
      await airdrop(provider, newWallet.publicKey, LAMPORTS_PER_SOL);

      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        newWallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await fixture.sss2Program.methods
        .whitelistAdd(padKycReference("KYC-OFFICER-ADDED"), new BN(0))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          whitelistRecord: whitelistPda,
          wallet: newWallet.publicKey,
          authority: fixture.complianceOfficer.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.complianceOfficer])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await (fixture.sss2Program.account as any).whitelistRecord.fetch(
        whitelistPda
      );
      expect(record.isActive).to.be.true;
    });

    it("whitelist is enforced on mint: non-whitelisted recipient fails", async () => {
      const unwhitelisted = Keypair.generate();
      await airdrop(provider, unwhitelisted.publicKey, LAMPORTS_PER_SOL);
      const unwhitelistedAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        unwhitelisted.publicKey
      );

      // SSS-2 mint instruction (not SSS-1).
      await expectError(
        () =>
          fixture.sss2Program.methods
            .mintTokens(new BN(1_000))
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              mint: fixture.mint.publicKey,
              recipientAta: unwhitelistedAta,
              admin: fixture.admin.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([fixture.admin])
            .rpc(),
        "NotWhitelisted"
      );
    });

    it("whitelisted recipient can receive minted tokens", async () => {
      // `wallet` was whitelisted in the first test.
      const walletAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        wallet.publicKey
      );

      await fixture.sss2Program.methods
        .mintTokens(new BN(500_000))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          mint: fixture.mint.publicKey,
          recipientAta: walletAta,
          admin: fixture.admin.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fixture.admin])
        .rpc();

      const balance = await getBalance(provider, fixture.mint.publicKey, wallet.publicKey);
      expect(balance.eq(new BN(500_000))).to.be.true;
    });

    it("fails when unauthorized signer tries to add", async () => {
      const rando = Keypair.generate();
      await airdrop(provider, rando.publicKey, LAMPORTS_PER_SOL);
      const target = Keypair.generate();
      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        target.publicKey,
        SSS2_PROGRAM_ID
      );

      await expectError(
        () =>
          fixture.sss2Program.methods
            .whitelistAdd(padKycReference("BAD"), new BN(0))
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              whitelistRecord: whitelistPda,
              wallet: target.publicKey,
              authority: rando.publicKey,
              payer: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([rando])
            .rpc(),
        "Unauthorized"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // whitelist_remove
  // ---------------------------------------------------------------------------

  describe("whitelist_remove", () => {
    let fixture: Sss2Fixture;
    const wallet = Keypair.generate();

    before(async () => {
      fixture = await buildSss2Fixture(provider, true);
      await airdrop(provider, wallet.publicKey, LAMPORTS_PER_SOL);

      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        wallet.publicKey,
        SSS2_PROGRAM_ID
      );
      await fixture.sss2Program.methods
        .whitelistAdd(padKycReference("KYC-REMOVE-TEST"), new BN(0))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          whitelistRecord: whitelistPda,
          wallet: wallet.publicKey,
          authority: fixture.admin.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.admin])
        .rpc();
    });

    it("removes whitelist entry, setting is_active to false", async () => {
      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        wallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await fixture.sss2Program.methods
        .whitelistRemove()
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          whitelistRecord: whitelistPda,
          wallet: wallet.publicKey,
          authority: fixture.admin.publicKey,
        })
        .signers([fixture.admin])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await (fixture.sss2Program.account as any).whitelistRecord.fetch(
        whitelistPda
      );
      expect(record.isActive).to.be.false;
    });

    it("subsequent mint to de-whitelisted address fails", async () => {
      const walletAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        wallet.publicKey
      );

      await expectError(
        () =>
          fixture.sss2Program.methods
            .mintTokens(new BN(1))
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              mint: fixture.mint.publicKey,
              recipientAta: walletAta,
              admin: fixture.admin.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([fixture.admin])
            .rpc(),
        "NotWhitelisted"
      );
    });

    it("fails to remove an already-inactive record", async () => {
      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        wallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await expectError(
        () =>
          fixture.sss2Program.methods
            .whitelistRemove()
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              whitelistRecord: whitelistPda,
              wallet: wallet.publicKey,
              authority: fixture.admin.publicKey,
            })
            .signers([fixture.admin])
            .rpc(),
        "NotWhitelisted"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // whitelist expiry
  // ---------------------------------------------------------------------------

  describe("whitelist_expiry", () => {
    let fixture: Sss2Fixture;
    const wallet = Keypair.generate();

    before(async () => {
      fixture = await buildSss2Fixture(provider, true);
      await airdrop(provider, wallet.publicKey, LAMPORTS_PER_SOL);
    });

    it("expired whitelist entry is rejected on mint", async () => {
      const now = await getCurrentTimestamp(provider);
      // Set expiry 2 seconds in the future.
      const expiresAt = new BN(now + 2);

      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        wallet.publicKey,
        SSS2_PROGRAM_ID
      );
      await fixture.sss2Program.methods
        .whitelistAdd(padKycReference("KYC-EXPIRY-TEST"), expiresAt)
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          whitelistRecord: whitelistPda,
          wallet: wallet.publicKey,
          authority: fixture.admin.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.admin])
        .rpc();

      const walletAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        wallet.publicKey
      );

      // Mint while still valid.
      await fixture.sss2Program.methods
        .mintTokens(new BN(100))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          mint: fixture.mint.publicKey,
          recipientAta: walletAta,
          admin: fixture.admin.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fixture.admin])
        .rpc();

      // Wait for expiry.
      await sleep(3000);

      // Mint should now fail.
      await expectError(
        () =>
          fixture.sss2Program.methods
            .mintTokens(new BN(100))
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              mint: fixture.mint.publicKey,
              recipientAta: walletAta,
              admin: fixture.admin.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([fixture.admin])
            .rpc(),
        "WhitelistExpired"
      );
    });

    it("adding whitelist with past expiry fails immediately", async () => {
      const now = await getCurrentTimestamp(provider);
      const pastExpiry = new BN(now - 100);
      const newWallet = Keypair.generate();

      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        newWallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await expectError(
        () =>
          fixture.sss2Program.methods
            .whitelistAdd(padKycReference("KYC-PAST"), pastExpiry)
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              whitelistRecord: whitelistPda,
              wallet: newWallet.publicKey,
              authority: fixture.admin.publicKey,
              payer: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([fixture.admin])
            .rpc(),
        "InvalidExpiry"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // freeze_account
  // ---------------------------------------------------------------------------

  describe("freeze_account", () => {
    let fixture: Sss2Fixture;
    const targetWallet = Keypair.generate();
    let targetAta: PublicKey;

    before(async () => {
      fixture = await buildSss2Fixture(provider, false);
      await airdrop(provider, targetWallet.publicKey, LAMPORTS_PER_SOL);
      targetAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        targetWallet.publicKey
      );

      // Mint some tokens to the target.
      await fixture.sss2Program.methods
        .mintTokens(new BN(200_000))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          mint: fixture.mint.publicKey,
          recipientAta: targetAta,
          admin: fixture.admin.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fixture.admin])
        .rpc();
    });

    it("freeze_account creates a freeze record", async () => {
      const [freezePda] = findFreezeRecordPda(
        fixture.mint.publicKey,
        targetWallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await fixture.sss2Program.methods
        .freezeAccount(padFreezeReason("OFAC_SDN_MATCH:12345"))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          freezeRecord: freezePda,
          targetAta,
          wallet: targetWallet.publicKey,
          mint: fixture.mint.publicKey,
          authority: fixture.complianceOfficer.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.complianceOfficer])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await (fixture.sss2Program.account as any).freezeRecord.fetch(
        freezePda
      );
      expect(record.isFrozen).to.be.true;
      expect(record.fundsSeized).to.be.false;
      expect(record.wallet.toBase58()).to.equal(targetWallet.publicKey.toBase58());
    });

    it("frozen account cannot send a transfer", async () => {
      const recipient = Keypair.generate();
      await airdrop(provider, recipient.publicKey, LAMPORTS_PER_SOL);
      const recipientAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        recipient.publicKey
      );

      await expectError(
        () =>
          fixture.sss2Program.methods
            .transferTokens(new BN(1))
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              mint: fixture.mint.publicKey,
              sourceAta: targetAta,
              destAta: recipientAta,
              sender: targetWallet.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([targetWallet])
            .rpc(),
        "AlreadyFrozen"
      );
    });

    it("frozen account cannot receive a mint", async () => {
      await expectError(
        () =>
          fixture.sss2Program.methods
            .mintTokens(new BN(1))
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              mint: fixture.mint.publicKey,
              recipientAta: targetAta,
              admin: fixture.admin.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([fixture.admin])
            .rpc(),
        "AlreadyFrozen"
      );
    });

    it("fails to freeze an already-frozen address", async () => {
      const [freezePda] = findFreezeRecordPda(
        fixture.mint.publicKey,
        targetWallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await expectError(
        () =>
          fixture.sss2Program.methods
            .freezeAccount(padFreezeReason("DOUBLE_FREEZE"))
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              freezeRecord: freezePda,
              targetAta,
              wallet: targetWallet.publicKey,
              mint: fixture.mint.publicKey,
              authority: fixture.admin.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              payer: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([fixture.admin])
            .rpc(),
        "AlreadyFrozen"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // unfreeze_account
  // ---------------------------------------------------------------------------

  describe("unfreeze_account", () => {
    let fixture: Sss2Fixture;
    const targetWallet = Keypair.generate();
    let targetAta: PublicKey;
    let freezePda: PublicKey;

    before(async () => {
      fixture = await buildSss2Fixture(provider, false);
      await airdrop(provider, targetWallet.publicKey, LAMPORTS_PER_SOL);
      targetAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        targetWallet.publicKey
      );

      // Mint some tokens, then freeze.
      await fixture.sss2Program.methods
        .mintTokens(new BN(100_000))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          mint: fixture.mint.publicKey,
          recipientAta: targetAta,
          admin: fixture.admin.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fixture.admin])
        .rpc();

      [freezePda] = findFreezeRecordPda(
        fixture.mint.publicKey,
        targetWallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await fixture.sss2Program.methods
        .freezeAccount(padFreezeReason("TEST_FREEZE_FOR_UNFREEZE"))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          freezeRecord: freezePda,
          targetAta,
          wallet: targetWallet.publicKey,
          mint: fixture.mint.publicKey,
          authority: fixture.admin.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.admin])
        .rpc();
    });

    it("unfreeze_account restores access", async () => {
      await fixture.sss2Program.methods
        .unfreezeAccount()
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          freezeRecord: freezePda,
          targetAta,
          wallet: targetWallet.publicKey,
          mint: fixture.mint.publicKey,
          authority: fixture.complianceOfficer.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fixture.complianceOfficer])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await (fixture.sss2Program.account as any).freezeRecord.fetch(
        freezePda
      );
      expect(record.isFrozen).to.be.false;
    });

    it("address can transfer after unfreeze", async () => {
      const recipient = Keypair.generate();
      await airdrop(provider, recipient.publicKey, LAMPORTS_PER_SOL);
      const recipientAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        recipient.publicKey
      );

      await fixture.sss2Program.methods
        .transferTokens(new BN(10_000))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          mint: fixture.mint.publicKey,
          sourceAta: targetAta,
          destAta: recipientAta,
          sender: targetWallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([targetWallet])
        .rpc();

      const balance = await getBalance(
        provider,
        fixture.mint.publicKey,
        recipient.publicKey
      );
      expect(balance.eq(new BN(10_000))).to.be.true;
    });

    it("fails to unfreeze an already-unfrozen address", async () => {
      await expectError(
        () =>
          fixture.sss2Program.methods
            .unfreezeAccount()
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              freezeRecord: freezePda,
              targetAta,
              wallet: targetWallet.publicKey,
              mint: fixture.mint.publicKey,
              authority: fixture.admin.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([fixture.admin])
            .rpc(),
        "NotFrozen"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // seize_funds
  // ---------------------------------------------------------------------------

  describe("seize_funds", () => {
    let fixture: Sss2Fixture;
    const targetWallet = Keypair.generate();
    let targetAta: PublicKey;
    let freezePda: PublicKey;
    const MINTED_AMOUNT = new BN(750_000);

    before(async () => {
      fixture = await buildSss2Fixture(provider, false);
      await airdrop(provider, targetWallet.publicKey, LAMPORTS_PER_SOL);
      targetAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        targetWallet.publicKey
      );

      await fixture.sss2Program.methods
        .mintTokens(MINTED_AMOUNT)
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          mint: fixture.mint.publicKey,
          recipientAta: targetAta,
          admin: fixture.admin.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fixture.admin])
        .rpc();

      [freezePda] = findFreezeRecordPda(
        fixture.mint.publicKey,
        targetWallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await fixture.sss2Program.methods
        .freezeAccount(padFreezeReason("PRE_SEIZE_FREEZE"))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          freezeRecord: freezePda,
          targetAta,
          wallet: targetWallet.publicKey,
          mint: fixture.mint.publicKey,
          authority: fixture.admin.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.admin])
        .rpc();
    });

    it("seize_funds moves full balance to compliance vault", async () => {
      const vaultBefore = await getBalance(
        provider,
        fixture.mint.publicKey,
        fixture.admin.publicKey
      );

      await fixture.sss2Program.methods
        .seizeFunds()
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          freezeRecord: freezePda,
          sourceAta: targetAta,
          complianceVault: fixture.complianceVault,
          wallet: targetWallet.publicKey,
          mint: fixture.mint.publicKey,
          authority: fixture.complianceOfficer.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fixture.complianceOfficer])
        .rpc();

      const targetBalance = await getBalance(
        provider,
        fixture.mint.publicKey,
        targetWallet.publicKey
      );
      const vaultAfter = await getBalance(
        provider,
        fixture.mint.publicKey,
        fixture.admin.publicKey
      );

      expect(targetBalance.eq(new BN(0))).to.be.true;
      expect(vaultAfter.sub(vaultBefore).eq(MINTED_AMOUNT)).to.be.true;
    });

    it("funds_seized flag is set after seizure", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await (fixture.sss2Program.account as any).freezeRecord.fetch(
        freezePda
      );
      expect(record.fundsSeized).to.be.true;
    });

    it("cannot seize twice (FundsAlreadySeized)", async () => {
      await expectError(
        () =>
          fixture.sss2Program.methods
            .seizeFunds()
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              freezeRecord: freezePda,
              sourceAta: targetAta,
              complianceVault: fixture.complianceVault,
              wallet: targetWallet.publicKey,
              mint: fixture.mint.publicKey,
              authority: fixture.admin.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([fixture.admin])
            .rpc(),
        "FundsAlreadySeized"
      );
    });

    it("cannot seize from a non-frozen address", async () => {
      const unfrozenWallet = Keypair.generate();
      await airdrop(provider, unfrozenWallet.publicKey, LAMPORTS_PER_SOL);
      const unfrozenAta = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        unfrozenWallet.publicKey
      );
      await fixture.sss2Program.methods
        .mintTokens(new BN(1_000))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          mint: fixture.mint.publicKey,
          recipientAta: unfrozenAta,
          admin: fixture.admin.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fixture.admin])
        .rpc();

      // No freeze record exists for this wallet — the PDA will be uninitialized.
      const [nonexistentFreezePda] = findFreezeRecordPda(
        fixture.mint.publicKey,
        unfrozenWallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await expectError(
        () =>
          fixture.sss2Program.methods
            .seizeFunds()
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              freezeRecord: nonexistentFreezePda,
              sourceAta: unfrozenAta,
              complianceVault: fixture.complianceVault,
              wallet: unfrozenWallet.publicKey,
              mint: fixture.mint.publicKey,
              authority: fixture.admin.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([fixture.admin])
            .rpc(),
        "NotFrozen"
      );
    });

    it("cannot unfreeze after seizure (FundsAlreadySeized)", async () => {
      await expectError(
        () =>
          fixture.sss2Program.methods
            .unfreezeAccount()
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              freezeRecord: freezePda,
              targetAta,
              wallet: targetWallet.publicKey,
              mint: fixture.mint.publicKey,
              authority: fixture.admin.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([fixture.admin])
            .rpc(),
        "FundsAlreadySeized"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // compliance_events
  // ---------------------------------------------------------------------------

  describe("compliance_events", () => {
    let fixture: Sss2Fixture;

    before(async () => {
      fixture = await buildSss2Fixture(provider, false);
    });

    it("record_compliance_event creates an event record with correct index", async () => {
      const configBefore = await fetchComplianceConfig(
        fixture.sss2Program,
        fixture.complianceConfigPda
      );
      const eventIndex = configBefore.eventCount;

      const [eventPda] = findComplianceEventRecordPda(
        fixture.mint.publicKey,
        eventIndex,
        SSS2_PROGRAM_ID
      );
      const subject = Keypair.generate();
      const metadata = Buffer.alloc(128, 0);
      Buffer.from("OFAC_REVIEW:case-id-9999").copy(metadata);

      await fixture.sss2Program.methods
        .recordComplianceEvent(Array.from(metadata))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          eventRecord: eventPda,
          subject: subject.publicKey,
          authority: fixture.complianceOfficer.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.complianceOfficer])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = await (fixture.sss2Program.account as any).complianceEventRecord.fetch(
        eventPda
      );
      expect(event.eventIndex.eq(eventIndex)).to.be.true;
      expect(event.eventType).to.equal(7); // Custom
      expect(event.subject.toBase58()).to.equal(subject.publicKey.toBase58());
    });

    it("event_count increments after each event", async () => {
      const configBefore = await fetchComplianceConfig(
        fixture.sss2Program,
        fixture.complianceConfigPda
      );
      const countBefore = configBefore.eventCount;

      // Record a second event.
      const [eventPda] = findComplianceEventRecordPda(
        fixture.mint.publicKey,
        countBefore,
        SSS2_PROGRAM_ID
      );
      const subject2 = Keypair.generate();
      const metadata2 = Buffer.alloc(128, 0);

      await fixture.sss2Program.methods
        .recordComplianceEvent(Array.from(metadata2))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          eventRecord: eventPda,
          subject: subject2.publicKey,
          authority: fixture.admin.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.admin])
        .rpc();

      const configAfter = await fetchComplianceConfig(
        fixture.sss2Program,
        fixture.complianceConfigPda
      );
      expect(configAfter.eventCount.eq(countBefore.add(new BN(1)))).to.be.true;
    });

    it("whitelist operations also emit compliance events", async () => {
      const configBefore = await fetchComplianceConfig(
        fixture.sss2Program,
        fixture.complianceConfigPda
      );
      const countBefore = configBefore.eventCount;

      const newWallet = Keypair.generate();
      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        newWallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await fixture.sss2Program.methods
        .whitelistAdd(padKycReference("KYC-EVENT-COUNT-TEST"), new BN(0))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          whitelistRecord: whitelistPda,
          wallet: newWallet.publicKey,
          authority: fixture.admin.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.admin])
        .rpc();

      const configAfter = await fetchComplianceConfig(
        fixture.sss2Program,
        fixture.complianceConfigPda
      );
      expect(configAfter.eventCount.eq(countBefore.add(new BN(1)))).to.be.true;
    });

    it("events can be fetched in order by iterating event_index", async () => {
      const config = await fetchComplianceConfig(
        fixture.sss2Program,
        fixture.complianceConfigPda
      );
      const totalEvents = config.eventCount.toNumber();
      expect(totalEvents).to.be.greaterThan(0);

      for (let i = 0; i < totalEvents; i++) {
        const [eventPda] = findComplianceEventRecordPda(
          fixture.mint.publicKey,
          new BN(i),
          SSS2_PROGRAM_ID
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const event = await (fixture.sss2Program.account as any).complianceEventRecord.fetch(
          eventPda
        );
        expect(event.eventIndex.toNumber()).to.equal(i);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Role separation
  // ---------------------------------------------------------------------------

  describe("role separation", () => {
    let fixture: Sss2Fixture;

    before(async () => {
      fixture = await buildSss2Fixture(provider, false);
    });

    it("compliance officer can whitelist addresses", async () => {
      const wallet = Keypair.generate();
      const [whitelistPda] = findWhitelistRecordPda(
        fixture.mint.publicKey,
        wallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await fixture.sss2Program.methods
        .whitelistAdd(padKycReference("KYC-OFFICER-ROLE-TEST"), new BN(0))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          whitelistRecord: whitelistPda,
          wallet: wallet.publicKey,
          authority: fixture.complianceOfficer.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.complianceOfficer])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await (fixture.sss2Program.account as any).whitelistRecord.fetch(
        whitelistPda
      );
      expect(record.isActive).to.be.true;
    });

    it("compliance officer can freeze an address", async () => {
      const wallet = Keypair.generate();
      await airdrop(provider, wallet.publicKey, LAMPORTS_PER_SOL);
      const ata = await createAssociatedTokenAccount(
        provider,
        fixture.mint.publicKey,
        wallet.publicKey
      );

      const [freezePda] = findFreezeRecordPda(
        fixture.mint.publicKey,
        wallet.publicKey,
        SSS2_PROGRAM_ID
      );

      await fixture.sss2Program.methods
        .freezeAccount(padFreezeReason("COMPLIANCE_OFFICER_FREEZE"))
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          freezeRecord: freezePda,
          targetAta: ata,
          wallet: wallet.publicKey,
          mint: fixture.mint.publicKey,
          authority: fixture.complianceOfficer.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([fixture.complianceOfficer])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await (fixture.sss2Program.account as any).freezeRecord.fetch(
        freezePda
      );
      expect(record.isFrozen).to.be.true;
    });

    it("compliance officer CANNOT transfer admin", async () => {
      const newAdmin = Keypair.generate();

      await expectError(
        () =>
          fixture.sss2Program.methods
            .transferAdmin(newAdmin.publicKey)
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              admin: fixture.complianceOfficer.publicKey,
            })
            .signers([fixture.complianceOfficer])
            .rpc(),
        "Unauthorized"
      );
    });

    it("compliance officer CANNOT update supply cap", async () => {
      await expectError(
        () =>
          fixture.sss2Program.methods
            .updateSupplyCap(new BN(999_999_999))
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              admin: fixture.complianceOfficer.publicKey,
            })
            .signers([fixture.complianceOfficer])
            .rpc(),
        "Unauthorized"
      );
    });

    it("compliance officer CANNOT change their own role", async () => {
      const newOfficer = Keypair.generate();

      await expectError(
        () =>
          fixture.sss2Program.methods
            .updateComplianceOfficer(newOfficer.publicKey)
            .accounts({
              complianceConfig: fixture.complianceConfigPda,
              admin: fixture.complianceOfficer.publicKey,
            })
            .signers([fixture.complianceOfficer])
            .rpc(),
        "Unauthorized"
      );
    });

    it("admin CAN change the compliance officer", async () => {
      const newOfficer = Keypair.generate();
      await airdrop(provider, newOfficer.publicKey, LAMPORTS_PER_SOL);

      await fixture.sss2Program.methods
        .updateComplianceOfficer(newOfficer.publicKey)
        .accounts({
          complianceConfig: fixture.complianceConfigPda,
          admin: fixture.admin.publicKey,
        })
        .signers([fixture.admin])
        .rpc();

      const config = await fetchComplianceConfig(
        fixture.sss2Program,
        fixture.complianceConfigPda
      );
      expect(config.complianceOfficer.toBase58()).to.equal(
        newOfficer.publicKey.toBase58()
      );
    });
  });
});
