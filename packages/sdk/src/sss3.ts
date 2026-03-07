/**
 * SSS-3 SDK Module — Private Stablecoin Helpers
 *
 * Provides typed client methods for the SSS-3 preset:
 *   - Allowlist-gated transfers
 *   - Token-2022 ConfidentialTransfer extension scaffold
 *   - Auditor ElGamal pubkey management
 *
 * Usage:
 *   import { SSS3Client } from '@sss/sdk/sss3';
 *   const client = new SSS3Client(provider, idl);
 */

import {
  AnchorProvider,
  Program,
  BN,
  Idl,
} from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeConfidentialTransferMintInstruction,
} from "@solana/spl-token";
import crypto from "crypto";

import {
  Sss3Params,
  Sss3Config,
  Sss3AllowlistRecord,
  AllowlistEntryParams,
  Sss3Info,
  AllowlistStatus,
} from "./types";
import { PDAs } from "./pdas";
import { encodeName, encodeSymbol, decodeString } from "./utils";
import { PROGRAM_ID } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ElGamalPubkey = Uint8Array; // 32 bytes

export interface ConfidentialMintProof {
  commitmentHash: Uint8Array; // SHA-256(recipient || amount || nonce)
  nonce: Uint8Array;          // 32-byte random nonce
}

export interface ConfidentialTransferProof {
  ciphertext: Uint8Array;     // ElGamal ciphertext bundle
  proof: Uint8Array;          // ZK range proof
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class SSS3Client {
  readonly program: Program;
  readonly provider: AnchorProvider;
  readonly pdas: PDAs;

  constructor(provider: AnchorProvider, idl: Idl, programId?: PublicKey) {
    this.provider = provider;
    this.program = new Program(idl, programId ?? PROGRAM_ID, provider);
    this.pdas = new PDAs(programId ?? PROGRAM_ID);
  }

  get connection(): Connection {
    return this.provider.connection;
  }

  get wallet(): PublicKey {
    return this.provider.wallet.publicKey;
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  /**
   * Initialize a new Token-2022 mint with the ConfidentialTransfer extension.
   *
   * MUST be called before `initializeSss3()`. The mint account is pre-created
   * with the CT extension so that Anchor can validate the mint in the same
   * transaction as the program instruction.
   *
   * @param auditorElgamalPubkey - Optional 32-byte auditor ElGamal pubkey.
   *   When set, all confidential transfers include a secondary ciphertext
   *   encrypted to the auditor for regulatory visibility.
   * @returns The mint keypair and transaction signature
   */
  async initializeConfidentialMint(
    auditorElgamalPubkey?: ElGamalPubkey
  ): Promise<{ mint: Keypair; txSig: string }> {
    const mint = Keypair.generate();
    const extensions = [ExtensionType.ConfidentialTransferMint];
    const mintLen = getMintLen(extensions);
    const lamports =
      await this.connection.getMinimumBalanceForRentExemption(mintLen);

    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: this.wallet,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    });

    const initCtMintIx = createInitializeConfidentialTransferMintInstruction(
      mint.publicKey,
      null,           // authority — null means immutable after init
      true,           // auto_approve_new_accounts
      auditorElgamalPubkey ?? null,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(createAccountIx, initCtMintIx);
    const txSig = await this.provider.sendAndConfirm(tx, [mint]);

    return { mint, txSig };
  }

  /**
   * Initialize a new SSS-3 stablecoin.
   *
   * Call `initializeConfidentialMint()` first if `params.confidentialTransfersEnabled = true`
   * to pre-initialize the Token-2022 CT extension on the mint account.
   *
   * @param mintKeypair - Pre-generated mint keypair (or from initializeConfidentialMint)
   * @param params - SSS-3 initialization parameters
   */
  async initializeSss3(
    mintKeypair: Keypair,
    params: Sss3Params
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mintKeypair.publicKey);
    const [sss3ConfigPDA] = this.pdas.sss3Config(mintKeypair.publicKey);

    const auditorPubkeyArg = params.auditorPubkey
      ? { some: Array.from(params.auditorPubkey) }
      : { none: {} };

    return await this.program.methods
      .initializeSss3({
        name: encodeName(params.name),
        symbol: encodeSymbol(params.symbol),
        decimals: params.decimals,
        supplyCap: params.supplyCap,
        allowlistAuthority: params.allowlistAuthority,
        requireAllowlistForReceive: params.requireAllowlistForReceive,
        requireAllowlistForSend: params.requireAllowlistForSend,
        confidentialTransfersEnabled: params.confidentialTransfersEnabled,
        autoApproveNewAccounts: params.autoApproveNewAccounts,
        auditorPubkey: auditorPubkeyArg,
      })
      .accounts({
        payer: this.wallet,
        mint: mintKeypair.publicKey,
        config: configPDA,
        sss3Config: sss3ConfigPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();
  }

  // ─── Allowlist Management ─────────────────────────────────────────────────────

  /**
   * Add a wallet to the SSS-3 allowlist.
   * Only callable by the `allowlist_authority` set during initialization.
   */
  async allowlistAdd(
    mint: PublicKey,
    wallet: PublicKey,
    params: AllowlistEntryParams
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const [sss3ConfigPDA] = this.pdas.sss3Config(mint);
    const [allowlistPDA] = this.pdas.sss3Allowlist(mint, wallet);

    // Encode note to 64-byte fixed buffer
    const noteBytes = Buffer.alloc(64);
    Buffer.from(params.note, "utf8").copy(noteBytes, 0, 0, Math.min(64, Buffer.byteLength(params.note, "utf8")));

    return await this.program.methods
      .allowlistAdd(params.expiry, Array.from(noteBytes))
      .accounts({
        allowlistAuthority: this.wallet,
        config: configPDA,
        sss3Config: sss3ConfigPDA,
        wallet,
        allowlistRecord: allowlistPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Remove a wallet from the SSS-3 allowlist.
   * Sets `active = false` without closing the account (preserves audit trail).
   */
  async allowlistRemove(
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const [sss3ConfigPDA] = this.pdas.sss3Config(mint);
    const [allowlistPDA] = this.pdas.sss3Allowlist(mint, wallet);

    return await this.program.methods
      .allowlistRemove()
      .accounts({
        allowlistAuthority: this.wallet,
        config: configPDA,
        sss3Config: sss3ConfigPDA,
        wallet,
        allowlistRecord: allowlistPDA,
      })
      .rpc();
  }

  // ─── Transfer ────────────────────────────────────────────────────────────────

  /**
   * Transfer tokens with SSS-3 allowlist enforcement.
   *
   * Automatically includes sender/recipient allowlist record accounts based on
   * the `require_allowlist_for_send` / `require_allowlist_for_receive` flags.
   */
  async transferSss3(
    mint: PublicKey,
    from: PublicKey,
    to: PublicKey,
    amount: BN
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const [sss3ConfigPDA] = this.pdas.sss3Config(mint);
    const fromTokenAccount = getAssociatedTokenAddressSync(
      mint, from, false, TOKEN_2022_PROGRAM_ID
    );
    const toTokenAccount = getAssociatedTokenAddressSync(
      mint, to, false, TOKEN_2022_PROGRAM_ID
    );
    const [senderAllowlist] = this.pdas.sss3Allowlist(mint, from);
    const [recipientAllowlist] = this.pdas.sss3Allowlist(mint, to);

    return await this.program.methods
      .transferSss3(amount)
      .accounts({
        signer: this.wallet,
        config: configPDA,
        sss3Config: sss3ConfigPDA,
        mint,
        senderTokenAccount: fromTokenAccount,
        recipientTokenAccount: toTokenAccount,
        senderAllowlistRecord: senderAllowlist,
        recipientAllowlistRecord: recipientAllowlist,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // ─── Confidential Mint ────────────────────────────────────────────────────────

  /**
   * Generate a commitment hash for a confidential mint operation.
   *
   * commitment_hash = SHA-256(recipient_pubkey || amount_le_8 || nonce_32)
   *
   * This hash is recorded on-chain by `confidentialMintSss3()` to create an
   * auditable link between the authorization event and the actual token minting.
   */
  generateCommitmentHash(
    recipient: PublicKey,
    amount: BN,
    nonce?: Uint8Array
  ): ConfidentialMintProof {
    const resolvedNonce = nonce ?? crypto.randomBytes(32);
    const amountBuf = amount.toArrayLike(Buffer, "le", 8);

    const hash = crypto.createHash("sha256")
      .update(recipient.toBuffer())
      .update(amountBuf)
      .update(resolvedNonce)
      .digest();

    return {
      commitmentHash: new Uint8Array(hash),
      nonce: new Uint8Array(resolvedNonce),
    };
  }

  /**
   * Initiate a confidential mint:
   *  1. Validates the mint authority signature
   *  2. Validates recipient is on allowlist (active, non-expired)
   *  3. Records commitment_hash on-chain for auditor decryption
   *
   * After this instruction succeeds, call the Token-2022 `confidentialTransferMint`
   * instruction with the ElGamal ciphertext to complete the actual minting.
   */
  async confidentialMintSss3(
    mint: PublicKey,
    recipient: PublicKey,
    commitmentHash: Uint8Array
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const [sss3ConfigPDA] = this.pdas.sss3Config(mint);
    const [recipientAllowlist] = this.pdas.sss3Allowlist(mint, recipient);
    const recipientTokenAccount = getAssociatedTokenAddressSync(
      mint, recipient, false, TOKEN_2022_PROGRAM_ID
    );

    return await this.program.methods
      .confidentialMintSss3(Array.from(commitmentHash))
      .accounts({
        mintAuthority: this.wallet,
        config: configPDA,
        sss3Config: sss3ConfigPDA,
        mint,
        recipient,
        recipientAllowlistRecord: recipientAllowlist,
        recipientTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // ─── Read Methods ─────────────────────────────────────────────────────────────

  /**
   * Fetch the SSS-3 configuration for a mint.
   */
  async getSss3Config(mint: PublicKey): Promise<Sss3Config> {
    const [sss3ConfigPDA] = this.pdas.sss3Config(mint);
    const raw = await this.program.account.sss3Config.fetch(sss3ConfigPDA);

    return {
      mint: raw.mint as PublicKey,
      allowlistAuthority: raw.allowlistAuthority as PublicKey,
      requireAllowlistForReceive: raw.requireAllowlistForReceive as boolean,
      requireAllowlistForSend: raw.requireAllowlistForSend as boolean,
      confidentialTransfersEnabled: raw.confidentialTransfersEnabled as boolean,
      autoApproveNewAccounts: raw.autoApproveNewAccounts as boolean,
      auditorPubkey: raw.auditorPubkey
        ? new Uint8Array(raw.auditorPubkey as number[])
        : null,
      allowlistCount: raw.allowlistCount as number,
      bump: raw.bump as number,
    };
  }

  /**
   * Fetch full SSS-3 info (base config + SSS-3 config).
   */
  async getSss3Info(mint: PublicKey): Promise<Sss3Info> {
    const [sss3ConfigPDA] = this.pdas.sss3Config(mint);
    const config = await this.getSss3Config(mint);

    return {
      address: sss3ConfigPDA,
      mint,
      config,
      allowlistCount: config.allowlistCount,
    };
  }

  /**
   * Fetch an allowlist record for a wallet.
   * Returns null if the wallet has never been allowlisted.
   */
  async getAllowlistRecord(
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<Sss3AllowlistRecord | null> {
    const [allowlistPDA] = this.pdas.sss3Allowlist(mint, wallet);
    try {
      const raw = await this.program.account.allowlistRecord.fetch(allowlistPDA);
      const noteBytes = Buffer.from(raw.note as number[]);
      // Trim null bytes from fixed-size note field
      const noteStr = noteBytes.toString("utf8").replace(/\0+$/, "");

      return {
        mint: raw.mint as PublicKey,
        wallet: raw.wallet as PublicKey,
        addedAt: raw.addedAt as BN,
        expiresAt: raw.expiresAt as BN,
        addedBy: raw.addedBy as PublicKey,
        active: raw.active as boolean,
        note: noteStr,
        bump: raw.bump as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check the allowlist status for a wallet, including expiry validation.
   */
  async getAllowlistStatus(
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<AllowlistStatus> {
    const record = await this.getAllowlistRecord(mint, wallet);

    if (!record || !record.active) {
      return { wallet, isAllowlisted: false, record, isExpired: false };
    }

    const now = Math.floor(Date.now() / 1000);
    const isExpired =
      !record.expiresAt.isZero() && record.expiresAt.toNumber() < now;

    return {
      wallet,
      isAllowlisted: !isExpired,
      record,
      isExpired,
    };
  }

  /**
   * Batch-check allowlist status for multiple wallets.
   */
  async batchGetAllowlistStatus(
    mint: PublicKey,
    wallets: PublicKey[]
  ): Promise<AllowlistStatus[]> {
    return Promise.all(wallets.map((w) => this.getAllowlistStatus(mint, w)));
  }
}

// ─── Standalone Helpers ───────────────────────────────────────────────────────

/**
 * Derive the SSS-3 config PDA without instantiating a full client.
 */
export function deriveSss3ConfigPDA(
  mint: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sss3-config"), mint.toBuffer()],
    programId
  );
}

/**
 * Derive the SSS-3 allowlist record PDA for a wallet.
 */
export function deriveSss3AllowlistPDA(
  mint: PublicKey,
  wallet: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sss3-allowlist"), mint.toBuffer(), wallet.toBuffer()],
    programId
  );
}

/**
 * Generate a commitment hash for confidential mint verification.
 * Pure function — no network calls required.
 *
 * @example
 * const { commitmentHash, nonce } = generateCommitmentHash(recipient, amount);
 * // pass commitmentHash to confidentialMintSss3()
 * // store nonce off-chain for verification
 */
export function generateCommitmentHash(
  recipient: PublicKey,
  amount: BN,
  nonce?: Buffer
): ConfidentialMintProof {
  const resolvedNonce = nonce ?? crypto.randomBytes(32);
  const amountBuf = amount.toArrayLike(Buffer, "le", 8);

  const hash = crypto.createHash("sha256")
    .update(recipient.toBuffer())
    .update(amountBuf)
    .update(resolvedNonce)
    .digest();

  return {
    commitmentHash: new Uint8Array(hash),
    nonce: new Uint8Array(resolvedNonce),
  };
}

/**
 * Verify a commitment hash against its components.
 * Used by auditors to validate on-chain commitment records.
 */
export function verifyCommitmentHash(
  commitmentHash: Uint8Array,
  recipient: PublicKey,
  amount: BN,
  nonce: Uint8Array
): boolean {
  const amountBuf = amount.toArrayLike(Buffer, "le", 8);
  const expected = crypto.createHash("sha256")
    .update(recipient.toBuffer())
    .update(amountBuf)
    .update(Buffer.from(nonce))
    .digest();

  return Buffer.from(commitmentHash).equals(expected);
}
