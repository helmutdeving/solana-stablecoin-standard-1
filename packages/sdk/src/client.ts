import {
  AnchorProvider,
  Program,
  BN,
  web3,
  Idl,
} from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionSignature,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  StablecoinInfo,
  Sss1Params,
  Sss2Params,
  WhitelistEntryParams,
  SupplyInfo,
  ComplianceConfig,
  WhitelistRecord,
  FreezeRecord,
} from "./types";
import { PDAs } from "./pdas";
import { encodeName, encodeSymbol, decodeString } from "./utils";

export const PROGRAM_ID = new PublicKey(
  // Placeholder — replace with actual deployed program ID
  "SSSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
);

export class SSSClient {
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

  // ─── Read Methods ────────────────────────────────────────────────────────────

  /** Fetch full stablecoin info including optional compliance config */
  async getStablecoin(mint: PublicKey): Promise<StablecoinInfo> {
    const [configPDA] = this.pdas.config(mint);
    const config = await this.program.account.stablecoinConfig.fetch(configPDA);

    const isSSS2 = "sss2" in config.preset;
    let compliance: ComplianceConfig | undefined;

    if (isSSS2) {
      const [compliancePDA] = this.pdas.compliance(mint);
      try {
        compliance = await this.program.account.complianceConfig.fetch(
          compliancePDA
        ) as ComplianceConfig;
      } catch {
        // ignore if not found
      }
    }

    return {
      address: configPDA,
      mint,
      preset: isSSS2 ? "sss2" as any : "sss1" as any,
      circulatingSupply: config.circulatingSupply as BN,
      supplyCap: config.supplyCap as BN,
      mintAuthority: config.mintAuthority as PublicKey,
      burnAuthority: config.burnAuthority as PublicKey,
      admin: config.admin as PublicKey,
      pendingAdmin: config.pendingAdmin as PublicKey | null,
      paused: config.paused as boolean,
      decimals: config.decimals as number,
      name: decodeString(config.name as Uint8Array),
      symbol: decodeString(config.symbol as Uint8Array),
      createdAt: config.createdAt as BN,
      totalMinted: config.totalMinted as BN,
      totalBurned: config.totalBurned as BN,
      bump: config.bump as number,
      compliance,
      isSSS2,
    };
  }

  /** Get supply information */
  async getSupply(mint: PublicKey): Promise<SupplyInfo> {
    const info = await this.getStablecoin(mint);
    const cap = info.supplyCap;
    const capped = !cap.isZero();
    const utilizationPct =
      capped
        ? info.circulatingSupply.muln(100).div(cap).toNumber()
        : 0;

    return {
      circulating: info.circulatingSupply,
      cap,
      capped,
      utilizationPct,
    };
  }

  /** Check if a wallet is whitelisted (SSS-2 only) */
  async getWhitelistRecord(
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<WhitelistRecord | null> {
    const [wlPDA] = this.pdas.whitelist(mint, wallet);
    try {
      return await this.program.account.whitelistRecord.fetch(wlPDA) as WhitelistRecord;
    } catch {
      return null;
    }
  }

  /** Check if a wallet is frozen (SSS-2 only) */
  async getFreezeRecord(
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<FreezeRecord | null> {
    const [freezePDA] = this.pdas.freeze(mint, wallet);
    try {
      return await this.program.account.freezeRecord.fetch(freezePDA) as FreezeRecord;
    } catch {
      return null;
    }
  }

  // ─── SSS-1 Initialization ────────────────────────────────────────────────────

  /** Initialize a new SSS-1 stablecoin */
  async initializeSss1(
    mintKeypair: Keypair,
    params: Sss1Params
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mintKeypair.publicKey);

    return await this.program.methods
      .initializeSss1({
        name: encodeName(params.name),
        symbol: encodeSymbol(params.symbol),
        decimals: params.decimals,
        supplyCap: params.supplyCap,
      })
      .accounts({
        payer: this.wallet,
        mint: mintKeypair.publicKey,
        config: configPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();
  }

  // ─── SSS-2 Initialization ────────────────────────────────────────────────────

  /** Initialize a new SSS-2 stablecoin */
  async initializeSss2(
    mintKeypair: Keypair,
    params: Sss2Params
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mintKeypair.publicKey);
    const [compliancePDA] = this.pdas.compliance(mintKeypair.publicKey);
    const complianceVault = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      params.compliance.complianceOfficer,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    return await this.program.methods
      .initializeSss2({
        name: encodeName(params.name),
        symbol: encodeSymbol(params.symbol),
        decimals: params.decimals,
        supplyCap: params.supplyCap,
        compliance: {
          complianceOfficer: params.compliance.complianceOfficer,
          whitelistTransfers: params.compliance.whitelistTransfers,
          whitelistMints: params.compliance.whitelistMints,
          whitelistBurns: params.compliance.whitelistBurns,
        },
      })
      .accounts({
        payer: this.wallet,
        mint: mintKeypair.publicKey,
        config: configPDA,
        compliance: compliancePDA,
        complianceVault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();
  }

  // ─── Mint ────────────────────────────────────────────────────────────────────

  /** Mint tokens to a recipient */
  async mint(
    mint: PublicKey,
    recipient: PublicKey,
    amount: BN
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const recipientTokenAccount = getAssociatedTokenAddressSync(
      mint,
      recipient,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Fetch config to check if SSS-2 compliance accounts are needed
    const config = await this.getStablecoin(mint);

    const remainingAccounts = [];
    if (config.isSSS2) {
      const [wlPDA] = this.pdas.whitelist(mint, recipient);
      const [freezePDA] = this.pdas.freeze(mint, recipient);
      remainingAccounts.push(
        { pubkey: wlPDA, isSigner: false, isWritable: false },
        { pubkey: freezePDA, isSigner: false, isWritable: false }
      );
    }

    return await this.program.methods
      .mintTokens(amount)
      .accounts({
        mintAuthority: this.wallet,
        config: configPDA,
        mint,
        recipientTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();
  }

  // ─── Burn ─────────────────────────────────────────────────────────────────────

  /** Burn tokens from a holder */
  async burn(
    mint: PublicKey,
    holder: PublicKey,
    amount: BN
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const holderTokenAccount = getAssociatedTokenAddressSync(
      mint,
      holder,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    return await this.program.methods
      .burnTokens(amount)
      .accounts({
        burnAuthority: this.wallet,
        config: configPDA,
        mint,
        holderTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  // ─── Whitelist (SSS-2) ───────────────────────────────────────────────────────

  /** Add a wallet to the KYC whitelist */
  async whitelistAdd(
    mint: PublicKey,
    wallet: PublicKey,
    params: WhitelistEntryParams
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const [compliancePDA] = this.pdas.compliance(mint);
    const [wlPDA] = this.pdas.whitelist(mint, wallet);

    const kycRefBytes = Buffer.alloc(64);
    Buffer.from(params.kycRef, "hex").copy(kycRefBytes);

    return await this.program.methods
      .whitelistAdd({
        kycRef: Array.from(kycRefBytes),
        expiresAt: params.expiresAt ?? new BN(0),
      })
      .accounts({
        complianceOfficer: this.wallet,
        config: configPDA,
        compliance: compliancePDA,
        wallet,
        whitelistRecord: wlPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Remove a wallet from the whitelist */
  async whitelistRemove(
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const [compliancePDA] = this.pdas.compliance(mint);
    const [wlPDA] = this.pdas.whitelist(mint, wallet);

    return await this.program.methods
      .whitelistRemove()
      .accounts({
        complianceOfficer: this.wallet,
        config: configPDA,
        compliance: compliancePDA,
        wallet,
        whitelistRecord: wlPDA,
      })
      .rpc();
  }

  // ─── Freeze/Unfreeze (SSS-2) ─────────────────────────────────────────────────

  /** Freeze an account */
  async freeze(
    mint: PublicKey,
    wallet: PublicKey,
    reason: string
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const [compliancePDA] = this.pdas.compliance(mint);
    const [freezePDA] = this.pdas.freeze(mint, wallet);
    const walletTokenAccount = getAssociatedTokenAddressSync(
      mint, wallet, false, TOKEN_2022_PROGRAM_ID
    );

    return await this.program.methods
      .freezeAccount(reason)
      .accounts({
        complianceOfficer: this.wallet,
        config: configPDA,
        compliance: compliancePDA,
        wallet,
        walletTokenAccount,
        mint,
        freezeRecord: freezePDA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Unfreeze an account */
  async unfreeze(
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const [compliancePDA] = this.pdas.compliance(mint);
    const [freezePDA] = this.pdas.freeze(mint, wallet);
    const walletTokenAccount = getAssociatedTokenAddressSync(
      mint, wallet, false, TOKEN_2022_PROGRAM_ID
    );

    return await this.program.methods
      .unfreezeAccount()
      .accounts({
        complianceOfficer: this.wallet,
        config: configPDA,
        compliance: compliancePDA,
        wallet,
        walletTokenAccount,
        mint,
        freezeRecord: freezePDA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  /** Seize funds from a frozen account */
  async seize(
    mint: PublicKey,
    wallet: PublicKey,
    amount: BN
  ): Promise<TransactionSignature> {
    const [configPDA] = this.pdas.config(mint);
    const [compliancePDA] = this.pdas.compliance(mint);
    const complianceInfo = await this.program.account.complianceConfig.fetch(compliancePDA);
    const [freezePDA] = this.pdas.freeze(mint, wallet);

    const walletTokenAccount = getAssociatedTokenAddressSync(
      mint, wallet, false, TOKEN_2022_PROGRAM_ID
    );
    const vaultTokenAccount = getAssociatedTokenAddressSync(
      mint, (complianceInfo as any).complianceVault, false, TOKEN_2022_PROGRAM_ID
    );

    return await this.program.methods
      .seizeFunds(amount)
      .accounts({
        complianceOfficer: this.wallet,
        config: configPDA,
        compliance: compliancePDA,
        wallet,
        walletTokenAccount,
        complianceVaultTokenAccount: vaultTokenAccount,
        freezeRecord: freezePDA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }
}
