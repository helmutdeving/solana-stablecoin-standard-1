#!/usr/bin/env node
/**
 * SSS Admin CLI
 *
 * Usage:
 *   sss init-sss1   --name "My USD" --symbol "MUSD" --decimals 6 --cap 1000000
 *   sss init-sss2   --name "Reg USD" --symbol "RUSD" --decimals 6 --cap 1000000 \
 *                   --officer <pubkey> --whitelist-transfers
 *   sss mint        --mint <pubkey> --recipient <pubkey> --amount 100
 *   sss burn        --mint <pubkey> --holder <pubkey> --amount 50
 *   sss info        --mint <pubkey>
 *   sss whitelist   add --mint <pubkey> --wallet <pubkey> --kyc-ref <ref>
 *   sss whitelist   remove --mint <pubkey> --wallet <pubkey>
 *   sss freeze      --mint <pubkey> --wallet <pubkey> --reason "Suspicious activity"
 *   sss unfreeze    --mint <pubkey> --wallet <pubkey>
 *   sss seize       --mint <pubkey> --wallet <pubkey> --amount 500
 *   sss supply-cap  --mint <pubkey> --cap 2000000
 *   sss upgrade     --mint <pubkey> --officer <pubkey>
 */

import { Command } from "commander";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import chalk from "chalk";

import { SSSClient, parseAmount, formatAmount, encodeKycRef } from "@solana-stablecoin-standard/sdk";
import IDL from "../idl/solana_stablecoin_standard.json";

const program = new Command();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadKeypair(keyPath?: string): Keypair {
  const p = keyPath ?? path.join(os.homedir(), ".config/solana/id.json");
  const raw = fs.readFileSync(p, "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function getClient(opts: { rpc?: string; keypair?: string }): SSSClient {
  const rpc = opts.rpc ?? process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
  const keypair = loadKeypair(opts.keypair);
  const connection = new Connection(rpc, "confirmed");
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new SSSClient(provider, IDL as any);
}

function ok(msg: string) {
  console.log(chalk.green("✓"), msg);
}

function info(msg: string) {
  console.log(chalk.cyan("→"), msg);
}

function err(msg: string) {
  console.error(chalk.red("✗"), msg);
  process.exit(1);
}

// ─── Global Options ───────────────────────────────────────────────────────────

program
  .name("sss")
  .description("Solana Stablecoin Standard admin CLI")
  .version("0.1.0")
  .option("--rpc <url>", "Solana RPC endpoint")
  .option("--keypair <path>", "Path to authority keypair JSON");

// ─── info command ─────────────────────────────────────────────────────────────

program
  .command("info")
  .description("Show stablecoin info")
  .requiredOption("--mint <pubkey>", "Stablecoin mint address")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent.opts();
    const client = getClient(globalOpts);
    const mint = new PublicKey(opts.mint);

    try {
      const stablecoin = await client.getStablecoin(mint);
      const supply = await client.getSupply(mint);

      console.log("\n" + chalk.bold("Stablecoin Info"));
      console.log("─────────────────────────────────────────");
      console.log(`Name:        ${stablecoin.name}`);
      console.log(`Symbol:      ${stablecoin.symbol}`);
      console.log(`Mint:        ${mint.toBase58()}`);
      console.log(`Preset:      ${stablecoin.preset.toUpperCase()}`);
      console.log(`Decimals:    ${stablecoin.decimals}`);
      console.log(`Supply:      ${formatAmount(supply.circulating, stablecoin.decimals)}`);
      console.log(`Cap:         ${supply.capped ? formatAmount(supply.cap, stablecoin.decimals) : "uncapped"}`);
      if (supply.capped) {
        console.log(`Utilization: ${supply.utilizationPct}%`);
      }
      console.log(`Paused:      ${stablecoin.paused ? chalk.red("YES") : chalk.green("no")}`);
      console.log(`Admin:       ${stablecoin.admin.toBase58()}`);

      if (stablecoin.isSSS2 && stablecoin.compliance) {
        const c = stablecoin.compliance;
        console.log("\n" + chalk.bold("SSS-2 Compliance"));
        console.log("─────────────────────────────────────────");
        console.log(`Officer:     ${c.complianceOfficer.toBase58()}`);
        console.log(`WL Transfers:${c.whitelistTransfers}`);
        console.log(`WL Mints:    ${c.whitelistMints}`);
        console.log(`WL Burns:    ${c.whitelistBurns}`);
        console.log(`Whitelist:   ${c.whitelistCount} entries`);
        console.log(`Events:      ${c.eventCount.toString()}`);
      }
      console.log();
    } catch (e: any) {
      err(`Failed to fetch info: ${e.message}`);
    }
  });

// ─── init-sss1 command ────────────────────────────────────────────────────────

program
  .command("init-sss1")
  .description("Initialize a new SSS-1 (minimal) stablecoin")
  .requiredOption("--name <string>", "Token name (max 32 chars)")
  .requiredOption("--symbol <string>", "Token symbol (max 8 chars)")
  .option("--decimals <number>", "Decimal places", "6")
  .option("--cap <number>", "Supply cap (0 = uncapped)", "0")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent.opts();
    const client = getClient(globalOpts);
    const mintKeypair = Keypair.generate();

    info(`Creating SSS-1 stablecoin: ${opts.name} (${opts.symbol})`);
    info(`Mint keypair: ${mintKeypair.publicKey.toBase58()}`);

    try {
      const sig = await client.initializeSss1(mintKeypair, {
        name: opts.name,
        symbol: opts.symbol,
        decimals: parseInt(opts.decimals),
        supplyCap: new BN(opts.cap),
      });
      ok(`Initialized! Signature: ${sig}`);
      ok(`Mint address: ${mintKeypair.publicKey.toBase58()}`);
    } catch (e: any) {
      err(`Failed: ${e.message}`);
    }
  });

// ─── init-sss2 command ────────────────────────────────────────────────────────

program
  .command("init-sss2")
  .description("Initialize a new SSS-2 (compliant) stablecoin")
  .requiredOption("--name <string>", "Token name (max 32 chars)")
  .requiredOption("--symbol <string>", "Token symbol (max 8 chars)")
  .requiredOption("--officer <pubkey>", "Compliance officer address")
  .option("--decimals <number>", "Decimal places", "6")
  .option("--cap <number>", "Supply cap (0 = uncapped)", "0")
  .option("--whitelist-transfers", "Require whitelist for transfers")
  .option("--whitelist-mints", "Require whitelist for mints")
  .option("--whitelist-burns", "Require whitelist for burns")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent.opts();
    const client = getClient(globalOpts);
    const mintKeypair = Keypair.generate();

    info(`Creating SSS-2 stablecoin: ${opts.name} (${opts.symbol})`);

    try {
      const sig = await client.initializeSss2(mintKeypair, {
        name: opts.name,
        symbol: opts.symbol,
        decimals: parseInt(opts.decimals),
        supplyCap: new BN(opts.cap),
        compliance: {
          complianceOfficer: new PublicKey(opts.officer),
          whitelistTransfers: !!opts.whitelistTransfers,
          whitelistMints: !!opts.whitelistMints,
          whitelistBurns: !!opts.whitelistBurns,
        },
      });
      ok(`Initialized! Signature: ${sig}`);
      ok(`Mint address: ${mintKeypair.publicKey.toBase58()}`);
    } catch (e: any) {
      err(`Failed: ${e.message}`);
    }
  });

// ─── mint command ─────────────────────────────────────────────────────────────

program
  .command("mint")
  .description("Mint tokens to a recipient")
  .requiredOption("--mint <pubkey>", "Stablecoin mint")
  .requiredOption("--recipient <pubkey>", "Recipient wallet")
  .requiredOption("--amount <number>", "Amount (human-readable, e.g. 100.50)")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent.opts();
    const client = getClient(globalOpts);
    const mint = new PublicKey(opts.mint);
    const recipient = new PublicKey(opts.recipient);

    const stablecoin = await client.getStablecoin(mint);
    const amount = parseAmount(opts.amount, stablecoin.decimals);

    info(`Minting ${opts.amount} ${stablecoin.symbol} to ${recipient.toBase58()}`);

    try {
      const sig = await client.mint(mint, recipient, amount);
      ok(`Minted! Signature: ${sig}`);
    } catch (e: any) {
      err(`Failed: ${e.message}`);
    }
  });

// ─── whitelist subcommand ─────────────────────────────────────────────────────

const whitelist = program.command("whitelist").description("Manage whitelist (SSS-2)");

whitelist
  .command("add")
  .requiredOption("--mint <pubkey>", "Stablecoin mint")
  .requiredOption("--wallet <pubkey>", "Wallet to whitelist")
  .requiredOption("--kyc-ref <string>", "KYC reference identifier")
  .option("--expires <timestamp>", "Expiry Unix timestamp (0 = no expiry)", "0")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const client = getClient(globalOpts);

    info(`Whitelisting ${opts.wallet}`);

    try {
      const sig = await client.whitelistAdd(
        new PublicKey(opts.mint),
        new PublicKey(opts.wallet),
        {
          kycRef: encodeKycRef(opts.kycRef),
          expiresAt: new BN(opts.expires),
        }
      );
      ok(`Whitelisted! Signature: ${sig}`);
    } catch (e: any) {
      err(`Failed: ${e.message}`);
    }
  });

whitelist
  .command("remove")
  .requiredOption("--mint <pubkey>", "Stablecoin mint")
  .requiredOption("--wallet <pubkey>", "Wallet to remove")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const client = getClient(globalOpts);

    try {
      const sig = await client.whitelistRemove(
        new PublicKey(opts.mint),
        new PublicKey(opts.wallet)
      );
      ok(`Removed from whitelist! Signature: ${sig}`);
    } catch (e: any) {
      err(`Failed: ${e.message}`);
    }
  });

// ─── freeze/unfreeze commands ─────────────────────────────────────────────────

program
  .command("freeze")
  .description("Freeze an account (SSS-2)")
  .requiredOption("--mint <pubkey>", "Stablecoin mint")
  .requiredOption("--wallet <pubkey>", "Wallet to freeze")
  .requiredOption("--reason <string>", "Reason for freeze")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent.opts();
    const client = getClient(globalOpts);

    try {
      const sig = await client.freeze(
        new PublicKey(opts.mint),
        new PublicKey(opts.wallet),
        opts.reason
      );
      ok(`Account frozen! Signature: ${sig}`);
    } catch (e: any) {
      err(`Failed: ${e.message}`);
    }
  });

program
  .command("unfreeze")
  .description("Unfreeze an account (SSS-2)")
  .requiredOption("--mint <pubkey>", "Stablecoin mint")
  .requiredOption("--wallet <pubkey>", "Wallet to unfreeze")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent.opts();
    const client = getClient(globalOpts);

    try {
      const sig = await client.unfreeze(
        new PublicKey(opts.mint),
        new PublicKey(opts.wallet)
      );
      ok(`Account unfrozen! Signature: ${sig}`);
    } catch (e: any) {
      err(`Failed: ${e.message}`);
    }
  });

program.parse();
