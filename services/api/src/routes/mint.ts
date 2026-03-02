import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SimulatedTransactionResponse,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createMintToInstruction,
  getMint,
} from "@solana/spl-token";
import {
  connection,
  getOperatorKeypair,
  parsePubkey,
  parseTokenAmount,
  explorerTxUrl,
} from "../solana";
import { createApiError } from "../middleware";

// ─── Schema ───────────────────────────────────────────────────────────────────

const MintBodySchema = z.object({
  mint: z.string().min(32, "mint must be a valid base58 public key"),
  recipient: z.string().min(32, "recipient must be a valid base58 public key"),
  amount: z
    .string()
    .regex(
      /^\d+(\.\d+)?$/,
      "amount must be a non-negative decimal string, e.g. '1000.00'"
    ),
  decimals: z.number().int().min(0).max(9).optional(),
});

type MintBody = z.infer<typeof MintBodySchema>;

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function mintHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = MintBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      next(
        createApiError(
          parseResult.error.errors.map((e) => e.message).join("; "),
          400,
          "VALIDATION_ERROR"
        )
      );
      return;
    }

    const body: MintBody = parseResult.data;
    const simulateOnly = req.query["simulateOnly"] === "true";

    const mintPubkey = parsePubkey(body.mint, "mint");
    const recipientPubkey = parsePubkey(body.recipient, "recipient");
    const operatorKeypair = getOperatorKeypair();

    // Fetch on-chain mint info to get decimals if not provided
    let decimals: number;
    try {
      const mintInfo = await getMint(connection, mintPubkey, "confirmed");
      decimals = body.decimals !== undefined ? body.decimals : mintInfo.decimals;

      // Verify the operator is the mint authority
      if (
        mintInfo.mintAuthority === null ||
        !mintInfo.mintAuthority.equals(operatorKeypair.publicKey)
      ) {
        next(
          createApiError(
            `Operator ${operatorKeypair.publicKey.toBase58()} is not the mint authority for ${body.mint}`,
            403,
            "NOT_MINT_AUTHORITY"
          )
        );
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("could not find mint")) {
        next(createApiError(`Mint account not found: ${body.mint}`, 404, "MINT_NOT_FOUND"));
        return;
      }
      throw err;
    }

    const rawAmount = parseTokenAmount(body.amount, decimals);
    if (rawAmount === 0n) {
      next(createApiError("Amount must be greater than zero", 400, "INVALID_AMOUNT"));
      return;
    }

    // Get or create the recipient's associated token account
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      operatorKeypair,
      mintPubkey,
      recipientPubkey,
      false,
      "confirmed"
    );

    // Build the mint-to instruction
    const mintToIx = createMintToInstruction(
      mintPubkey,
      recipientAta.address,
      operatorKeypair.publicKey,
      rawAmount
    );

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const transaction = new Transaction({
      feePayer: operatorKeypair.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(mintToIx);

    if (simulateOnly) {
      const simulation = await connection.simulateTransaction(transaction, [
        operatorKeypair,
      ]);
      const simResult: SimulatedTransactionResponse = simulation.value;

      res.status(200).json({
        simulated: true,
        success: simResult.err === null,
        error: simResult.err ?? null,
        logs: simResult.logs ?? [],
        unitsConsumed: simResult.unitsConsumed ?? null,
        mint: mintPubkey.toBase58(),
        recipient: recipientPubkey.toBase58(),
        recipientAta: recipientAta.address.toBase58(),
        amount: body.amount,
        rawAmount: rawAmount.toString(),
        decimals,
      });
      return;
    }

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [operatorKeypair],
      { commitment: "confirmed" }
    );

    res.status(200).json({
      signature,
      txUrl: explorerTxUrl(signature),
      mint: mintPubkey.toBase58(),
      recipient: recipientPubkey.toBase58(),
      recipientAta: recipientAta.address.toBase58(),
      amount: body.amount,
      rawAmount: rawAmount.toString(),
      decimals,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Helpers exported for testing ─────────────────────────────────────────────

export { MintBodySchema };
