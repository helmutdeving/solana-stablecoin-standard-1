import { Request, Response, NextFunction } from "express";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { Program, Idl } from "@coral-xyz/anchor";
import {
  connection,
  getProvider,
  parsePubkey,
  formatTokenAmount,
} from "../solana";
import { createApiError } from "../middleware";

// ─── Stablecoin Config PDA ────────────────────────────────────────────────────
//
// The on-chain StablecoinConfig PDA is derived from:
//   seeds = [b"stablecoin_config", mint.key().as_ref()]
//   program = STABLECOIN_PROGRAM_ID
//
// The account layout (Anchor-serialized) contains:
//   - mint:         PublicKey  (32 bytes)
//   - authority:    PublicKey  (32 bytes)
//   - supply_cap:   u64        (8 bytes)
//   - preset:       u8         (1 byte, enum index)
//   - bump:         u8         (1 byte)
//
// We decode manually to avoid needing the full IDL at runtime.
// Offset after 8-byte Anchor discriminator:
//   mint      @ 8
//   authority @ 40
//   supply_cap@ 72
//   preset    @ 80
//   bump      @ 81

const STABLECOIN_PROGRAM_ID_RAW =
  process.env["STABLECOIN_PROGRAM_ID"] ??
  "StbLcnSTANDARD1111111111111111111111111111111";

const CONFIG_ACCOUNT_SIZE = 82; // 8 disc + 74 fields

const PRESET_NAMES: Record<number, string> = {
  0: "USD",
  1: "EUR",
  2: "GBP",
  3: "Custom",
};

function deriveConfigPda(
  mintPubkey: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin_config"), mintPubkey.toBuffer()],
    programId
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function supplyHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const mintParam = req.query["mint"];
    if (!mintParam || typeof mintParam !== "string") {
      next(
        createApiError(
          "Query parameter 'mint' is required",
          400,
          "VALIDATION_ERROR"
        )
      );
      return;
    }

    const mintPubkey = parsePubkey(mintParam, "mint");

    let programId: PublicKey;
    try {
      programId = new PublicKey(STABLECOIN_PROGRAM_ID_RAW);
    } catch {
      next(
        createApiError(
          "Server misconfiguration: invalid STABLECOIN_PROGRAM_ID",
          500,
          "SERVER_MISCONFIGURATION"
        )
      );
      return;
    }

    // Fetch on-chain SPL mint (gives us totalSupply and decimals)
    let mintInfo: Awaited<ReturnType<typeof getMint>>;
    try {
      mintInfo = await getMint(connection, mintPubkey, "confirmed");
    } catch (err) {
      if (err instanceof Error && err.message.includes("could not find mint")) {
        next(
          createApiError(
            `Mint account not found: ${mintParam}`,
            404,
            "MINT_NOT_FOUND"
          )
        );
        return;
      }
      throw err;
    }

    const decimals = mintInfo.decimals;
    const totalSupplyRaw = mintInfo.supply;

    // Derive and fetch the StablecoinConfig PDA
    const [configPda] = deriveConfigPda(mintPubkey, programId);

    const configAccount = await connection.getAccountInfo(
      configPda,
      "confirmed"
    );

    if (!configAccount) {
      // No config PDA — return supply data from SPL mint only
      res.status(200).json({
        mint: mintPubkey.toBase58(),
        totalSupply: formatTokenAmount(totalSupplyRaw, decimals),
        totalSupplyRaw: totalSupplyRaw.toString(),
        supplyCap: null,
        supplyCapRaw: null,
        decimals,
        preset: null,
        configPda: configPda.toBase58(),
        configFound: false,
      });
      return;
    }

    // Decode the config account data
    const data = configAccount.data;

    if (data.length < CONFIG_ACCOUNT_SIZE) {
      next(
        createApiError(
          `StablecoinConfig account data is malformed (length ${data.length}, expected >= ${CONFIG_ACCOUNT_SIZE})`,
          500,
          "MALFORMED_ACCOUNT"
        )
      );
      return;
    }

    // supply_cap is a little-endian u64 at offset 72
    const supplyCapRaw = data.readBigUInt64LE(72);
    const presetIndex = data[80] ?? 0;
    const presetName = PRESET_NAMES[presetIndex] ?? `Unknown(${presetIndex})`;

    res.status(200).json({
      mint: mintPubkey.toBase58(),
      totalSupply: formatTokenAmount(totalSupplyRaw, decimals),
      totalSupplyRaw: totalSupplyRaw.toString(),
      supplyCap:
        supplyCapRaw === 0n
          ? null
          : formatTokenAmount(supplyCapRaw, decimals),
      supplyCapRaw: supplyCapRaw === 0n ? null : supplyCapRaw.toString(),
      utilizationPct:
        supplyCapRaw === 0n
          ? null
          : Number((totalSupplyRaw * 10000n) / supplyCapRaw) / 100,
      decimals,
      preset: presetName,
      configPda: configPda.toBase58(),
      configFound: true,
    });
  } catch (err) {
    next(err);
  }
}
