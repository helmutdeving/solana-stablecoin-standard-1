import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  mintTo as splMintTo,
  getMint,
} from "@solana/spl-token";
import BN from "bn.js";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface CreateTestMintOptions {
  decimals?: number;
  supplyCap?: BN;
  admin?: Keypair;
}

export interface Sss1MintResult {
  mint: Keypair;
  configPda: PublicKey;
  configBump: number;
  admin: Keypair;
}

export interface Sss2InitResult extends Sss1MintResult {
  complianceConfigPda: PublicKey;
  complianceBump: number;
  complianceOfficer: Keypair;
  complianceVault: PublicKey;
}

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------

export function findSss1ConfigPda(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sss1"), mint.toBuffer()],
    programId
  );
}

export function findSss2ConfigPda(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sss2"), mint.toBuffer()],
    programId
  );
}

export function findWhitelistRecordPda(
  mint: PublicKey,
  wallet: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), mint.toBuffer(), wallet.toBuffer()],
    programId
  );
}

export function findFreezeRecordPda(
  mint: PublicKey,
  wallet: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("freeze"), mint.toBuffer(), wallet.toBuffer()],
    programId
  );
}

export function findComplianceEventRecordPda(
  mint: PublicKey,
  eventIndex: BN,
  programId: PublicKey
): [PublicKey, number] {
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(eventIndex.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("event"), mint.toBuffer(), indexBuf],
    programId
  );
}

// ---------------------------------------------------------------------------
// createTestMint
// ---------------------------------------------------------------------------

/**
 * Creates a new mint keypair and initializes an SSS-1 stablecoin via the
 * reference program. Returns the mint, config PDA, and admin keypair.
 */
export async function createTestMint(
  provider: anchor.AnchorProvider,
  program: anchor.Program,
  options: CreateTestMintOptions = {}
): Promise<Sss1MintResult> {
  const decimals = options.decimals ?? 6;
  const supplyCap = options.supplyCap ?? new BN(0);
  const admin = options.admin ?? Keypair.generate();

  // Airdrop SOL to admin if needed.
  await airdrop(provider, admin.publicKey, 2 * LAMPORTS_PER_SOL);

  const mint = Keypair.generate();
  await airdrop(provider, mint.publicKey, 0); // no-op, mint is a signer

  const [configPda, configBump] = findSss1ConfigPda(
    mint.publicKey,
    program.programId
  );

  await program.methods
    .initializeSss1(decimals, supplyCap)
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

  return { mint, configPda, configBump, admin };
}

// ---------------------------------------------------------------------------
// mintTo
// ---------------------------------------------------------------------------

/**
 * Mints `amount` tokens from an SSS-1 config to a recipient's ATA.
 * The recipient ATA must already exist (use createAssociatedTokenAccount first).
 */
export async function mintTo(
  program: anchor.Program,
  mint: PublicKey,
  configPda: PublicKey,
  recipientAta: PublicKey,
  admin: Keypair,
  amount: BN
): Promise<string> {
  return program.methods
    .mintTokens(amount)
    .accounts({
      config: configPda,
      mint,
      recipientAta,
      admin: admin.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([admin])
    .rpc();
}

// ---------------------------------------------------------------------------
// createAssociatedTokenAccount
// ---------------------------------------------------------------------------

/**
 * Creates an Associated Token Account for `owner` under the given mint.
 * Uses Token-2022. Returns the ATA public key.
 */
export async function createAssociatedTokenAccount(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    // payer
    (provider.wallet as anchor.Wallet).payer,
    mint,
    owner,
    false,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  return ata.address;
}

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------

/**
 * Returns the raw token balance (in base units) for `wallet`'s ATA for the
 * given `mint`. Returns 0 if the ATA does not exist.
 */
export async function getBalance(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  wallet: PublicKey
): Promise<BN> {
  try {
    const [ata] = PublicKey.findProgramAddressSync(
      [
        wallet.toBuffer(),
        TOKEN_2022_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      // ATA program ID
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bV8")
    );
    const account = await getAccount(
      provider.connection,
      ata,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    return new BN(account.amount.toString());
  } catch {
    return new BN(0);
  }
}

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

/**
 * Returns a promise that resolves after `ms` milliseconds. Useful for
 * waiting on validator clock progression in expiry tests.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// expectError
// ---------------------------------------------------------------------------

/**
 * Asserts that calling `fn` throws an Anchor error with the given error code.
 * Accepts either a numeric error code or a string error name.
 *
 * Usage:
 *   await expectError(
 *     () => program.methods.mintTokens(...).rpc(),
 *     "SupplyCapExceeded"
 *   );
 */
export async function expectError(
  fn: () => Promise<unknown>,
  errorCode: string | number
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (err: unknown) {
    threw = true;
    const errMsg = JSON.stringify(err);

    if (typeof errorCode === "string") {
      // Check for the error name in the logs or error message.
      if (!errMsg.includes(errorCode)) {
        throw new Error(
          `Expected error "${errorCode}" but got: ${errMsg.slice(0, 500)}`
        );
      }
    } else {
      // Numeric error code — look for it in the error message.
      if (!errMsg.includes(String(errorCode))) {
        throw new Error(
          `Expected error code ${errorCode} but got: ${errMsg.slice(0, 500)}`
        );
      }
    }
  }

  if (!threw) {
    throw new Error(
      `Expected instruction to fail with "${errorCode}" but it succeeded.`
    );
  }
}

// ---------------------------------------------------------------------------
// airdrop
// ---------------------------------------------------------------------------

/**
 * Airdrops `lamports` SOL to `wallet` and waits for confirmation.
 */
export async function airdrop(
  provider: anchor.AnchorProvider,
  wallet: PublicKey,
  lamports: number
): Promise<void> {
  if (lamports === 0) return;
  const sig = await provider.connection.requestAirdrop(wallet, lamports);
  const latestBlockhash = await provider.connection.getLatestBlockhash();
  await provider.connection.confirmTransaction({
    signature: sig,
    ...latestBlockhash,
  });
}

// ---------------------------------------------------------------------------
// padKycReference
// ---------------------------------------------------------------------------

/**
 * Converts a string KYC reference into a 128-byte zero-padded Uint8Array
 * as expected by the whitelist_add instruction.
 */
export function padKycReference(ref: string): number[] {
  const buf = Buffer.alloc(128, 0);
  const encoded = Buffer.from(ref, "utf8");
  encoded.copy(buf, 0, 0, Math.min(encoded.length, 128));
  return Array.from(buf);
}

// ---------------------------------------------------------------------------
// padFreezeReason
// ---------------------------------------------------------------------------

/**
 * Converts a string freeze reason into a 64-byte zero-padded number array
 * as expected by the freeze_account instruction.
 */
export function padFreezeReason(reason: string): number[] {
  const buf = Buffer.alloc(64, 0);
  const encoded = Buffer.from(reason, "utf8");
  encoded.copy(buf, 0, 0, Math.min(encoded.length, 64));
  return Array.from(buf);
}

// ---------------------------------------------------------------------------
// getCurrentTimestamp
// ---------------------------------------------------------------------------

/**
 * Returns the current Solana cluster unix timestamp (from Clock sysvar).
 * Falls back to local system time if the RPC call fails.
 */
export async function getCurrentTimestamp(
  provider: anchor.AnchorProvider
): Promise<number> {
  const slot = await provider.connection.getSlot();
  const ts = await provider.connection.getBlockTime(slot);
  return ts ?? Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// fetchStablecoinConfig
// ---------------------------------------------------------------------------

/**
 * Fetches and decodes the StablecoinConfig account from the chain.
 */
export async function fetchStablecoinConfig(
  program: anchor.Program,
  configPda: PublicKey
): Promise<{
  version: number;
  mint: PublicKey;
  admin: PublicKey;
  supplyCap: BN;
  totalSupply: BN;
  decimals: number;
  isPaused: boolean;
  upgradedTo: PublicKey | null;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account = await (program.account as any).stablecoinConfig.fetch(
    configPda
  );
  return account;
}

// ---------------------------------------------------------------------------
// fetchComplianceConfig
// ---------------------------------------------------------------------------

/**
 * Fetches and decodes the ComplianceConfig account from the chain.
 */
export async function fetchComplianceConfig(
  program: anchor.Program,
  compliancePda: PublicKey
): Promise<{
  version: number;
  mint: PublicKey;
  admin: PublicKey;
  complianceOfficer: PublicKey;
  supplyCap: BN;
  totalSupply: BN;
  whitelistEnabled: boolean;
  complianceVault: PublicKey;
  eventCount: BN;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account = await (program.account as any).complianceConfig.fetch(
    compliancePda
  );
  return account;
}
