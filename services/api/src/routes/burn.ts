import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createBurnInstruction,
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

const BurnBodySchema = z.object({
  mint: z.string().min(32, "mint must be a valid base58 public key"),
  holder: z.string().min(32, "holder must be a valid base58 public key"),
  amount: z
    .string()
    .regex(
      /^\d+(\.\d+)?$/,
      "amount must be a non-negative decimal string, e.g. '500.00'"
    ),
});

type BurnBody = z.infer<typeof BurnBodySchema>;

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function burnHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = BurnBodySchema.safeParse(req.body);
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

    const body: BurnBody = parseResult.data;
    const operatorKeypair = getOperatorKeypair();

    const mintPubkey = parsePubkey(body.mint, "mint");
    const holderPubkey = parsePubkey(body.holder, "holder");

    // Fetch on-chain mint info
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

    // Derive the holder's associated token account
    const holderAta = await getAssociatedTokenAddress(
      mintPubkey,
      holderPubkey,
      false
    );

    // Verify the token account exists and has sufficient balance
    let tokenAccount: Awaited<ReturnType<typeof getAccount>>;
    try {
      tokenAccount = await getAccount(connection, holderAta, "confirmed");
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("could not find account") ||
          err.message.includes("TokenAccountNotFoundError"))
      ) {
        next(
          createApiError(
            `Token account for holder ${body.holder} and mint ${body.mint} does not exist`,
            404,
            "TOKEN_ACCOUNT_NOT_FOUND"
          )
        );
        return;
      }
      throw err;
    }

    const currentBalance = tokenAccount.amount;
    if (rawAmount > currentBalance) {
      next(
        createApiError(
          `Insufficient balance: holder has ${formatTokenAmount(
            currentBalance,
            decimals
          )} but burn requests ${body.amount}`,
          400,
          "INSUFFICIENT_BALANCE"
        )
      );
      return;
    }

    // The operator must be the freeze authority OR the holder must have delegated to the operator.
    // In this standard, the operator (as freeze authority / burn delegate) signs the burn.
    // For a direct burn, the token account owner must sign. We build the instruction with
    // the operator as authority — this works when the operator is the token account's delegate
    // or when the holder is the operator itself.
    const burnIx = createBurnInstruction(
      holderAta,
      mintPubkey,
      operatorKeypair.publicKey,
      rawAmount
    );

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const transaction = new Transaction({
      feePayer: operatorKeypair.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(burnIx);

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
      holder: holderPubkey.toBase58(),
      holderAta: holderAta.toBase58(),
      amount: body.amount,
      rawAmount: rawAmount.toString(),
      decimals,
      balanceBefore: formatTokenAmount(currentBalance, decimals),
      balanceAfter: formatTokenAmount(currentBalance - rawAmount, decimals),
    });
  } catch (err) {
    next(err);
  }
}

export { BurnBodySchema };
