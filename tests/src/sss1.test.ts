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
  fetchStablecoinConfig,
  sleep,
} from "./helpers";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

// The IDL and program type are loaded from the local Anchor workspace.
// Adjust the import path to match your workspace layout.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require("../../target/idl/sss1.json");

const SSS1_PROGRAM_ID = new PublicKey(
  process.env.SSS1_PROGRAM_ID ?? idl.metadata.address
);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SSS-1", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new anchor.Program(idl, SSS1_PROGRAM_ID, provider) as Program;

  // Shared state across tests in a describe block is declared here and
  // populated in before() hooks.
  let defaultMint: Keypair;
  let defaultConfigPda: PublicKey;
  let defaultAdmin: Keypair;

  // Create a fresh mint once for the outer suite so sub-suites can share it
  // where appropriate, and each sub-suite creates its own where isolation matters.
  before(async () => {
    const result = await createTestMint(provider, program, {
      decimals: 6,
      supplyCap: new BN(0),
    });
    defaultMint = result.mint;
    defaultConfigPda = result.configPda;
    defaultAdmin = result.admin;
  });

  // ---------------------------------------------------------------------------
  // initialize_sss1
  // ---------------------------------------------------------------------------

  describe("initialize_sss1", () => {
    it("happy path: initializes config with correct fields", async () => {
      const admin = Keypair.generate();
      await airdrop(provider, admin.publicKey, 2 * LAMPORTS_PER_SOL);

      const mint = Keypair.generate();
      const [configPda] = findSss1ConfigPda(mint.publicKey, program.programId);
      const supplyCap = new BN(1_000_000_000_000);

      await program.methods
        .initializeSss1(6, supplyCap)
        .accounts({
          config: configPda,
          mint: mint.publicKey,
          admin: admin.publicKey,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([mint, admin])
        .rpc();

      const config = await fetchStablecoinConfig(program, configPda);

      expect(config.version).to.equal(1);
      expect(config.mint.toBase58()).to.equal(mint.publicKey.toBase58());
      expect(config.admin.toBase58()).to.equal(admin.publicKey.toBase58());
      expect(config.supplyCap.eq(supplyCap)).to.be.true;
      expect(config.totalSupply.eq(new BN(0))).to.be.true;
      expect(config.decimals).to.equal(6);
      expect(config.isPaused).to.be.false;
      expect(config.upgradedTo).to.be.null;
    });

    it("initializes with zero supply cap (uncapped)", async () => {
      const { configPda } = await createTestMint(provider, program, {
        decimals: 6,
        supplyCap: new BN(0),
      });
      const config = await fetchStablecoinConfig(program, configPda);
      expect(config.supplyCap.eq(new BN(0))).to.be.true;
    });

    it("fails with decimals > 9", async () => {
      const admin = Keypair.generate();
      await airdrop(provider, admin.publicKey, 2 * LAMPORTS_PER_SOL);
      const mint = Keypair.generate();
      const [configPda] = findSss1ConfigPda(mint.publicKey, program.programId);

      await expectError(
        () =>
          program.methods
            .initializeSss1(10, new BN(0))
            .accounts({
              config: configPda,
              mint: mint.publicKey,
              admin: admin.publicKey,
              payer: provider.wallet.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([mint, admin])
            .rpc(),
        "InvalidDecimals"
      );
    });

    it("fails on duplicate initialization of same mint", async () => {
      // Attempt to re-init using the existing defaultMint.
      const [configPda] = findSss1ConfigPda(
        defaultMint.publicKey,
        program.programId
      );

      await expectError(
        () =>
          program.methods
            .initializeSss1(6, new BN(0))
            .accounts({
              config: configPda,
              mint: defaultMint.publicKey,
              admin: defaultAdmin.publicKey,
              payer: provider.wallet.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([defaultAdmin])
            .rpc(),
        "AlreadyInitialized"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // mint_tokens
  // ---------------------------------------------------------------------------

  describe("mint_tokens", () => {
    let mint: Keypair;
    let configPda: PublicKey;
    let admin: Keypair;
    let recipientAta: PublicKey;
    const recipient = Keypair.generate();
    const SUPPLY_CAP = new BN(1_000_000); // 1 USDC in base units (6 decimals)

    before(async () => {
      const result = await createTestMint(provider, program, {
        decimals: 6,
        supplyCap: SUPPLY_CAP,
      });
      mint = result.mint;
      configPda = result.configPda;
      admin = result.admin;

      await airdrop(provider, recipient.publicKey, LAMPORTS_PER_SOL);
      recipientAta = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        recipient.publicKey
      );
    });

    it("mints to a valid account and updates total_supply", async () => {
      const amount = new BN(100_000);
      await mintTo(program, mint.publicKey, configPda, recipientAta, admin, amount);

      const balance = await getBalance(provider, mint.publicKey, recipient.publicKey);
      expect(balance.eq(amount)).to.be.true;

      const config = await fetchStablecoinConfig(program, configPda);
      expect(config.totalSupply.eq(amount)).to.be.true;
    });

    it("fails when mint would exceed supply cap", async () => {
      // Current supply is 100_000. Cap is 1_000_000. Trying to mint 1_000_000 would exceed.
      const overflow = new BN(1_000_000);

      await expectError(
        () => mintTo(program, mint.publicKey, configPda, recipientAta, admin, overflow),
        "SupplyCapExceeded"
      );
    });

    it("fails with zero amount", async () => {
      await expectError(
        () => mintTo(program, mint.publicKey, configPda, recipientAta, admin, new BN(0)),
        "ZeroAmount"
      );
    });

    it("fails when signer is not the admin", async () => {
      const impostor = Keypair.generate();
      await airdrop(provider, impostor.publicKey, LAMPORTS_PER_SOL);

      await expectError(
        () =>
          program.methods
            .mintTokens(new BN(1))
            .accounts({
              config: configPda,
              mint: mint.publicKey,
              recipientAta,
              admin: impostor.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([impostor])
            .rpc(),
        "Unauthorized"
      );
    });

    it("mints up to exact supply cap without error", async () => {
      // Current supply is 100_000, cap is 1_000_000. Mint exactly 900_000 more.
      const remaining = new BN(900_000);
      await mintTo(program, mint.publicKey, configPda, recipientAta, admin, remaining);

      const config = await fetchStablecoinConfig(program, configPda);
      expect(config.totalSupply.eq(SUPPLY_CAP)).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // burn_tokens
  // ---------------------------------------------------------------------------

  describe("burn_tokens", () => {
    let mint: Keypair;
    let configPda: PublicKey;
    let admin: Keypair;
    let holderAta: PublicKey;
    const holder = Keypair.generate();
    const INITIAL_MINT = new BN(500_000);

    before(async () => {
      const result = await createTestMint(provider, program, {
        decimals: 6,
        supplyCap: new BN(0),
      });
      mint = result.mint;
      configPda = result.configPda;
      admin = result.admin;

      await airdrop(provider, holder.publicKey, LAMPORTS_PER_SOL);
      holderAta = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        holder.publicKey
      );

      await mintTo(program, mint.publicKey, configPda, holderAta, admin, INITIAL_MINT);
    });

    it("burns tokens and reduces total_supply", async () => {
      const burnAmount = new BN(100_000);

      await program.methods
        .burnTokens(burnAmount)
        .accounts({
          config: configPda,
          mint: mint.publicKey,
          sourceAta: holderAta,
          holder: holder.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([holder])
        .rpc();

      const balance = await getBalance(provider, mint.publicKey, holder.publicKey);
      expect(balance.eq(INITIAL_MINT.sub(burnAmount))).to.be.true;

      const config = await fetchStablecoinConfig(program, configPda);
      expect(config.totalSupply.eq(INITIAL_MINT.sub(burnAmount))).to.be.true;
    });

    it("fails when burning more than balance", async () => {
      const currentBalance = await getBalance(provider, mint.publicKey, holder.publicKey);
      const overBurn = currentBalance.add(new BN(1));

      await expectError(
        () =>
          program.methods
            .burnTokens(overBurn)
            .accounts({
              config: configPda,
              mint: mint.publicKey,
              sourceAta: holderAta,
              holder: holder.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([holder])
            .rpc(),
        "InsufficientBalance"
      );
    });

    it("fails with zero amount", async () => {
      await expectError(
        () =>
          program.methods
            .burnTokens(new BN(0))
            .accounts({
              config: configPda,
              mint: mint.publicKey,
              sourceAta: holderAta,
              holder: holder.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([holder])
            .rpc(),
        "ZeroAmount"
      );
    });

    it("fails when signer does not own the token account", async () => {
      const impostor = Keypair.generate();
      await airdrop(provider, impostor.publicKey, LAMPORTS_PER_SOL);

      await expectError(
        () =>
          program.methods
            .burnTokens(new BN(1))
            .accounts({
              config: configPda,
              mint: mint.publicKey,
              sourceAta: holderAta,
              holder: impostor.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([impostor])
            .rpc(),
        "InvalidTokenAccountOwner"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // transfer_tokens
  // ---------------------------------------------------------------------------

  describe("transfer_tokens", () => {
    let mint: Keypair;
    let configPda: PublicKey;
    let admin: Keypair;
    let senderAta: PublicKey;
    let recipientAta: PublicKey;
    const sender = Keypair.generate();
    const recipient = Keypair.generate();
    const INITIAL_MINT = new BN(1_000_000);

    before(async () => {
      const result = await createTestMint(provider, program, {
        decimals: 6,
        supplyCap: new BN(0),
      });
      mint = result.mint;
      configPda = result.configPda;
      admin = result.admin;

      await airdrop(provider, sender.publicKey, LAMPORTS_PER_SOL);
      await airdrop(provider, recipient.publicKey, LAMPORTS_PER_SOL);

      senderAta = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        sender.publicKey
      );
      recipientAta = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        recipient.publicKey
      );

      await mintTo(program, mint.publicKey, configPda, senderAta, admin, INITIAL_MINT);
    });

    it("transfers tokens between two accounts", async () => {
      const transferAmount = new BN(250_000);

      await program.methods
        .transferTokens(transferAmount)
        .accounts({
          config: configPda,
          mint: mint.publicKey,
          sourceAta: senderAta,
          destAta: recipientAta,
          sender: sender.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([sender])
        .rpc();

      const senderBalance = await getBalance(provider, mint.publicKey, sender.publicKey);
      const recipientBalance = await getBalance(
        provider,
        mint.publicKey,
        recipient.publicKey
      );

      expect(senderBalance.eq(INITIAL_MINT.sub(transferAmount))).to.be.true;
      expect(recipientBalance.eq(transferAmount)).to.be.true;
    });

    it("fails with zero amount", async () => {
      await expectError(
        () =>
          program.methods
            .transferTokens(new BN(0))
            .accounts({
              config: configPda,
              mint: mint.publicKey,
              sourceAta: senderAta,
              destAta: recipientAta,
              sender: sender.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([sender])
            .rpc(),
        "ZeroAmount"
      );
    });

    it("fails when transferring to a non-existent ATA", async () => {
      const ghost = Keypair.generate();
      // Derive the ghost's ATA but do NOT create it.
      const [ghostAta] = PublicKey.findProgramAddressSync(
        [
          ghost.publicKey.toBuffer(),
          TOKEN_2022_PROGRAM_ID.toBuffer(),
          mint.publicKey.toBuffer(),
        ],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bV8")
      );

      await expectError(
        () =>
          program.methods
            .transferTokens(new BN(1))
            .accounts({
              config: configPda,
              mint: mint.publicKey,
              sourceAta: senderAta,
              destAta: ghostAta,
              sender: sender.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([sender])
            .rpc(),
        "InvalidDestinationAccount"
      );
    });

    it("fails when sender does not own the source ATA", async () => {
      const impostor = Keypair.generate();
      await airdrop(provider, impostor.publicKey, LAMPORTS_PER_SOL);

      await expectError(
        () =>
          program.methods
            .transferTokens(new BN(1))
            .accounts({
              config: configPda,
              mint: mint.publicKey,
              sourceAta: senderAta,
              destAta: recipientAta,
              sender: impostor.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([impostor])
            .rpc(),
        "InvalidTokenAccountOwner"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // update_supply_cap
  // ---------------------------------------------------------------------------

  describe("update_supply_cap", () => {
    let mint: Keypair;
    let configPda: PublicKey;
    let admin: Keypair;
    const INITIAL_CAP = new BN(5_000_000);
    const INITIAL_MINT = new BN(1_000_000);

    before(async () => {
      const result = await createTestMint(provider, program, {
        decimals: 6,
        supplyCap: INITIAL_CAP,
      });
      mint = result.mint;
      configPda = result.configPda;
      admin = result.admin;

      // Mint some tokens so we can test cap-below-supply.
      const holder = Keypair.generate();
      await airdrop(provider, holder.publicKey, LAMPORTS_PER_SOL);
      const holderAta = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        holder.publicKey
      );
      await mintTo(program, mint.publicKey, configPda, holderAta, admin, INITIAL_MINT);
    });

    it("admin can raise the supply cap", async () => {
      const newCap = new BN(10_000_000);

      await program.methods
        .updateSupplyCap(newCap)
        .accounts({
          config: configPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const config = await fetchStablecoinConfig(program, configPda);
      expect(config.supplyCap.eq(newCap)).to.be.true;
    });

    it("admin can set supply cap to zero (uncapped)", async () => {
      await program.methods
        .updateSupplyCap(new BN(0))
        .accounts({
          config: configPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const config = await fetchStablecoinConfig(program, configPda);
      expect(config.supplyCap.eq(new BN(0))).to.be.true;
    });

    it("fails when new cap is below current total_supply", async () => {
      // total_supply is INITIAL_MINT (1_000_000). Try to set cap to 500_000.
      const tooLow = new BN(500_000);

      await expectError(
        () =>
          program.methods
            .updateSupplyCap(tooLow)
            .accounts({
              config: configPda,
              admin: admin.publicKey,
            })
            .signers([admin])
            .rpc(),
        "CapBelowCurrentSupply"
      );
    });

    it("fails when signer is not the admin", async () => {
      const impostor = Keypair.generate();
      await airdrop(provider, impostor.publicKey, LAMPORTS_PER_SOL);

      await expectError(
        () =>
          program.methods
            .updateSupplyCap(new BN(99_999_999))
            .accounts({
              config: configPda,
              admin: impostor.publicKey,
            })
            .signers([impostor])
            .rpc(),
        "Unauthorized"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // transfer_admin
  // ---------------------------------------------------------------------------

  describe("transfer_admin", () => {
    let mint: Keypair;
    let configPda: PublicKey;
    let originalAdmin: Keypair;
    let newAdmin: Keypair;

    before(async () => {
      const result = await createTestMint(provider, program, {
        decimals: 6,
        supplyCap: new BN(0),
      });
      mint = result.mint;
      configPda = result.configPda;
      originalAdmin = result.admin;
      newAdmin = Keypair.generate();
      await airdrop(provider, newAdmin.publicKey, LAMPORTS_PER_SOL);
    });

    it("transfers admin authority to new address", async () => {
      await program.methods
        .transferAdmin(newAdmin.publicKey)
        .accounts({
          config: configPda,
          admin: originalAdmin.publicKey,
        })
        .signers([originalAdmin])
        .rpc();

      const config = await fetchStablecoinConfig(program, configPda);
      expect(config.admin.toBase58()).to.equal(newAdmin.publicKey.toBase58());
    });

    it("original admin loses access after transfer", async () => {
      // After transfer, originalAdmin can no longer mint.
      const holder = Keypair.generate();
      await airdrop(provider, holder.publicKey, LAMPORTS_PER_SOL);
      const holderAta = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        holder.publicKey
      );

      await expectError(
        () =>
          mintTo(
            program,
            mint.publicKey,
            configPda,
            holderAta,
            originalAdmin,
            new BN(1)
          ),
        "Unauthorized"
      );
    });

    it("new admin can successfully mint after transfer", async () => {
      const holder = Keypair.generate();
      await airdrop(provider, holder.publicKey, LAMPORTS_PER_SOL);
      const holderAta = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        holder.publicKey
      );

      await mintTo(program, mint.publicKey, configPda, holderAta, newAdmin, new BN(1_000));
      const balance = await getBalance(provider, mint.publicKey, holder.publicKey);
      expect(balance.eq(new BN(1_000))).to.be.true;
    });

    it("fails when new_admin equals current admin", async () => {
      await expectError(
        () =>
          program.methods
            .transferAdmin(newAdmin.publicKey)
            .accounts({
              config: configPda,
              admin: newAdmin.publicKey,
            })
            .signers([newAdmin])
            .rpc(),
        "SameAdmin"
      );
    });

    it("fails when signer is not the current admin", async () => {
      const impostor = Keypair.generate();
      await airdrop(provider, impostor.publicKey, LAMPORTS_PER_SOL);

      await expectError(
        () =>
          program.methods
            .transferAdmin(impostor.publicKey)
            .accounts({
              config: configPda,
              admin: impostor.publicKey,
            })
            .signers([impostor])
            .rpc(),
        "Unauthorized"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // upgrade_to_sss2
  // ---------------------------------------------------------------------------

  describe("upgrade_to_sss2", () => {
    // For upgrade tests we need an SSS-2 program available as well.
    // The SSS-2 program ID is expected in env or the IDL.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sss2Idl = require("../../target/idl/sss2.json");
    const SSS2_PROGRAM_ID = new PublicKey(
      process.env.SSS2_PROGRAM_ID ?? sss2Idl.metadata.address
    );

    let mint: Keypair;
    let configPda: PublicKey;
    let admin: Keypair;
    let complianceConfigPda: PublicKey;
    let complianceVault: PublicKey;
    const complianceOfficer = Keypair.generate();

    before(async () => {
      const result = await createTestMint(provider, program, {
        decimals: 6,
        supplyCap: new BN(0),
      });
      mint = result.mint;
      configPda = result.configPda;
      admin = result.admin;

      await airdrop(provider, complianceOfficer.publicKey, LAMPORTS_PER_SOL);

      [complianceConfigPda] = findSss2ConfigPda(mint.publicKey, SSS2_PROGRAM_ID);

      // Create compliance vault ATA.
      complianceVault = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        admin.publicKey
      );

      // Initialize SSS-2 compliance config (prerequisite for upgrade).
      const sss2Program = new anchor.Program(sss2Idl, SSS2_PROGRAM_ID, provider);
      await sss2Program.methods
        .initializeSss2(false)
        .accounts({
          complianceConfig: complianceConfigPda,
          mint: mint.publicKey,
          sss1Config: configPda,
          complianceVault,
          admin: admin.publicKey,
          complianceOfficer: complianceOfficer.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    });

    it("successfully upgrades SSS-1 config to SSS-2", async () => {
      await program.methods
        .upgradeToSss2()
        .accounts({
          config: configPda,
          complianceConfig: complianceConfigPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const config = await fetchStablecoinConfig(program, configPda);
      expect(config.upgradedTo).to.not.be.null;
      expect(config.upgradedTo!.toBase58()).to.equal(
        complianceConfigPda.toBase58()
      );
    });

    it("cannot mint on a migrated SSS-1 config", async () => {
      const holder = Keypair.generate();
      await airdrop(provider, holder.publicKey, LAMPORTS_PER_SOL);
      const holderAta = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        holder.publicKey
      );

      await expectError(
        () => mintTo(program, mint.publicKey, configPda, holderAta, admin, new BN(1)),
        "ConfigMigrated"
      );
    });

    it("cannot burn on a migrated SSS-1 config", async () => {
      // We need an ATA with tokens. Since minting is blocked, use a pre-existing one.
      // (In practice this tests the guard, not a real balance scenario.)
      const holder = Keypair.generate();
      await airdrop(provider, holder.publicKey, LAMPORTS_PER_SOL);
      const holderAta = await createAssociatedTokenAccount(
        provider,
        mint.publicKey,
        holder.publicKey
      );

      await expectError(
        () =>
          program.methods
            .burnTokens(new BN(1))
            .accounts({
              config: configPda,
              mint: mint.publicKey,
              sourceAta: holderAta,
              holder: holder.publicKey,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([holder])
            .rpc(),
        "ConfigMigrated"
      );
    });

    it("cannot upgrade twice (ConfigMigrated)", async () => {
      await expectError(
        () =>
          program.methods
            .upgradeToSss2()
            .accounts({
              config: configPda,
              complianceConfig: complianceConfigPda,
              admin: admin.publicKey,
            })
            .signers([admin])
            .rpc(),
        "ConfigMigrated"
      );
    });

    it("fails when non-admin attempts upgrade", async () => {
      // Create a fresh SSS-1 config for this test.
      const freshResult = await createTestMint(provider, program, {
        decimals: 6,
        supplyCap: new BN(0),
      });
      const impostor = Keypair.generate();
      await airdrop(provider, impostor.publicKey, LAMPORTS_PER_SOL);

      await expectError(
        () =>
          program.methods
            .upgradeToSss2()
            .accounts({
              config: freshResult.configPda,
              complianceConfig: complianceConfigPda,
              admin: impostor.publicKey,
            })
            .signers([impostor])
            .rpc(),
        "Unauthorized"
      );
    });
  });
});
