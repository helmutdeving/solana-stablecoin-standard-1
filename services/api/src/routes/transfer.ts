import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createTransferCheckedInstruction,
  getMint,
  getAccount,
} from "@solana/spl-token";
import {
  connection,
  getOperatorKeypair,
  parsePubkey,
  parseTokenAmount,
  formatTokenAmount,
  explorerTxUrl,
} from "../solana";
import { createApiError } from "../middleware";

// ─── Schema ───────────────────────────────────────────────────────────────────

const TransferBodySchema = z.object({
  mint: z.string().min(32, "mint must be a valid base58 public key"),
  from: z.string().min(32, "from must be a valid base58 public key"),
  to: z.string().min(32, "to must be a valid base58 public key"),
  amount: z
    .string()
    .regex(
      /^\d+(\.\d+)?$/,
      "amount must be a non-negative decimal string, e.g. '250.00'"
    ),
});

type TransferBody = z.infer<typeof TransferBodySchema>;

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function transferHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = TransferBodySchema.safeParse(req.body);
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

    const body: TransferBody = parseResult.data;
    const operatorKeypair = getOperatorKeypair();

    const mintPubkey = parsePubkey(body.mint, "mint");
    const fromPubkey = parsePubkey(body.from, "from");
    const toPubkey = parsePubkey(body.to, "to");

    if (fromPubkey.equals(toPubkey)) {
      next(
        createApiError(
          "from and to addresses must be different",
          400,
          "INVALID_TRANSFER"
        )
      );
      return;
    }

    // Fetch on-chain mint info for decimals
    let mintInfo: Awaited<ReturnType<typeof getMint>>;
    try {
      mintInfo = await getMint(connection, mintPubkey, "confirmed");
    } catch (err) {
      if (err instanceof Error && err.message.includes("could not find mint")) {
        next(createApiError(`Mint account not found: ${body.mint}`, 404, "MINT_NOT_FOUND"));
        return;
      }
      throw err;
    }

    const decimals = mintInfo.decimals;
    const rawAmount = parseTokenAmount(body.amount, decimals);

    if (rawAmount === 0n) {
      next(createApiError("Amount must be greater than zero", 400, "INVALID_AMOUNT"));
      return;
    }

    // Derive and verify the sender's token account
    const fromAta = await getAssociatedTokenAddress(mintPubkey, fromPubkey, false);

    let fromAccount: Awaited<ReturnType<typeof getAccount>>;
    try {
      fromAccount = await getAccount(connection, fromAta, "confirmed");
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("could not find account") ||
          err.message.includes("TokenAccountNotFoundError"))
      ) {
        next(
          createApiError(
            `Token account for sender ${body.from} and mint ${body.mint} does not exist`,
            404,
            "TOKEN_ACCOUNT_NOT_FOUND"
          )
        );
        return;
      }
      throw err;
    }

    const senderBalance = fromAccount.amount;
    if (rawAmount > senderBalance) {
      next(
        createApiError(
          `Insufficient balance: sender has ${formatTokenAmount(
            senderBalance,
            decimals
          )} but transfer requests ${body.amount}`,
          400,
          "INSUFFICIENT_BALANCE"
        )
      );
      return;
    }

    // Get or create the recipient's associated token account (operator pays for ATA creation)
    const toAtaAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      operatorKeypair,
      mintPubkey,
      toPubkey,
      false,
      "confirmed"
    );

    // Use transfer_checked for safety — validates decimals on-chain
    const transferIx = createTransferCheckedInstruction(
      fromAta,
      mintPubkey,
      toAtaAccount.address,
      operatorKeypair.publicKey, // operator is the delegate/authority
      rawAmount,
      decimals
    );

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const transaction = new Transaction({
      feePayer: operatorKeypair.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(transferIx);

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
      from: fromPubkey.toBase58(),
      fromAta: fromAta.toBase58(),
      to: toPubkey.toBase58(),
      toAta: toAtaAccount.address.toBase58(),
      amount: body.amount,
      rawAmount: rawAmount.toString(),
      decimals,
      senderBalanceBefore: formatTokenAmount(senderBalance, decimals),
      senderBalanceAfter: formatTokenAmount(senderBalance - rawAmount, decimals),
    });
  } catch (err) {
    next(err);
  }
}

export { TransferBodySchema };
