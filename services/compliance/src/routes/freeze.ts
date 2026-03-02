import { Router, Request, Response, NextFunction } from 'express';
import { PublicKey } from '@solana/web3.js';
import { anchorProvider, anchorProgramId } from '../index';

export const freezeRouter = Router();

// ---- Types ------------------------------------------------------------------

interface FreezeRecordResponse {
  publicKey: string;
  wallet: string;
  frozen: boolean;
  reason: string;
  frozenAt: number;
  frozenBy: string;
  mint: string;
}

// ---- Helpers ----------------------------------------------------------------

/**
 * FreezeRecord layout (borsh):
 * discriminator: 8 bytes
 * mint: PublicKey — 32 bytes
 * wallet: PublicKey — 32 bytes
 * frozen: bool — 1 byte
 * reason: String — u32 len + bytes
 * frozen_at: i64 — 8 bytes
 * frozen_by: PublicKey — 32 bytes
 * bump: u8 — 1 byte
 */
function decodeFreezeRecord(
  pubkey: PublicKey,
  data: Buffer,
): FreezeRecordResponse | null {
  try {
    let off = 8; // skip discriminator

    const mint = new PublicKey(data.subarray(off, off + 32)).toBase58(); off += 32;
    const wallet = new PublicKey(data.subarray(off, off + 32)).toBase58(); off += 32;
    const frozen = data[off] !== 0; off += 1;

    const reasonLen = data.readUInt32LE(off); off += 4;
    const reason = data.subarray(off, off + reasonLen).toString('utf8'); off += reasonLen;

    const frozenAt = Number(data.readBigInt64LE(off)); off += 8;
    const frozenBy = new PublicKey(data.subarray(off, off + 32)).toBase58(); off += 32;

    // bump — not exposed in response
    off += 1;
    void off;

    return {
      publicKey: pubkey.toBase58(),
      wallet,
      frozen,
      reason,
      frozenAt,
      frozenBy,
      mint,
    };
  } catch (err) {
    console.error(`Failed to decode FreezeRecord ${pubkey.toBase58()}:`, err);
    return null;
  }
}

/**
 * Build memcmp filter on the mint field.
 * FreezeRecord: discriminator (8) + mint (32) — mint starts at offset 8.
 */
function mintMemcmpFilter(mint: PublicKey): { memcmp: { offset: number; bytes: string } } {
  return {
    memcmp: {
      offset: 8,
      bytes: mint.toBase58(),
    },
  };
}

// ---- Routes -----------------------------------------------------------------

/**
 * GET /v1/freeze-list?mint=<pubkey>
 *
 * Returns all FreezeRecord PDAs for the given mint.
 * Response: { mint, total, records: [{ wallet, frozen, reason, frozenAt, frozenBy }] }
 */
freezeRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const mintStr = req.query.mint as string | undefined;
    if (!mintStr) {
      res.status(400).json({ error: 'mint query parameter is required' });
      return;
    }

    let mint: PublicKey;
    try {
      mint = new PublicKey(mintStr);
    } catch {
      res.status(400).json({ error: 'mint is not a valid Solana pubkey' });
      return;
    }

    // Optionally filter to only active freezes
    const activeOnly = req.query.activeOnly === 'true';

    const rawAccounts = await anchorProvider.connection.getProgramAccounts(anchorProgramId, {
      commitment: 'confirmed',
      filters: [
        mintMemcmpFilter(mint),
        // Minimum account size: 8 + 32 + 32 + 1 + 4 + 0 + 8 + 32 + 1 = 118 bytes
        // We don't use dataSize filter because reason string is variable length.
        // Instead we rely on the mint memcmp to narrow results.
      ],
    });

    const records: FreezeRecordResponse[] = [];
    for (const { pubkey, account } of rawAccounts) {
      const decoded = decodeFreezeRecord(pubkey, account.data as Buffer);
      if (!decoded) continue;
      if (activeOnly && !decoded.frozen) continue;
      records.push(decoded);
    }

    // Sort by frozenAt descending (most recently frozen first)
    records.sort((a, b) => b.frozenAt - a.frozenAt);

    res.json({
      mint: mint.toBase58(),
      total: records.length,
      records,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/freeze-list/check?mint=<pubkey>&wallet=<pubkey>
 *
 * Checks whether a specific wallet is currently frozen for a given mint.
 * Derives the FreezeRecord PDA directly rather than scanning all accounts.
 */
freezeRouter.get('/check', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const mintStr = req.query.mint as string | undefined;
    const walletStr = req.query.wallet as string | undefined;

    if (!mintStr) {
      res.status(400).json({ error: 'mint query parameter is required' });
      return;
    }
    if (!walletStr) {
      res.status(400).json({ error: 'wallet query parameter is required' });
      return;
    }

    let mintKey: PublicKey;
    let walletKey: PublicKey;
    try {
      mintKey = new PublicKey(mintStr);
    } catch {
      res.status(400).json({ error: 'mint is not a valid Solana pubkey' });
      return;
    }
    try {
      walletKey = new PublicKey(walletStr);
    } catch {
      res.status(400).json({ error: 'wallet is not a valid Solana pubkey' });
      return;
    }

    // Derive PDA: seeds = ["freeze", mint, wallet]
    const [freezePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('freeze'), mintKey.toBuffer(), walletKey.toBuffer()],
      anchorProgramId,
    );

    const accountInfo = await anchorProvider.connection.getAccountInfo(freezePda, 'confirmed');

    if (!accountInfo) {
      res.json({
        frozen: false,
        wallet: walletStr,
        mint: mintStr,
        pda: freezePda.toBase58(),
      });
      return;
    }

    const decoded = decodeFreezeRecord(freezePda, accountInfo.data as Buffer);
    if (!decoded) {
      res.status(500).json({ error: 'Failed to decode FreezeRecord' });
      return;
    }

    res.json({
      frozen: decoded.frozen,
      wallet: decoded.wallet,
      mint: decoded.mint,
      reason: decoded.reason || undefined,
      frozenAt: decoded.frozenAt || undefined,
      frozenBy: decoded.frozenBy,
      pda: freezePda.toBase58(),
    });
  } catch (err) {
    next(err);
  }
});
