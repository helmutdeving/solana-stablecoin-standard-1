import { Router, Request, Response, NextFunction } from 'express';
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { anchorProvider, anchorProgramId } from '../index';

export const whitelistRouter = Router();

// ---- Account layout types --------------------------------------------------

interface WhitelistRecordAccount {
  mint: PublicKey;
  wallet: PublicKey;
  approved: boolean;
  expiresAt: anchor.BN | null;
  kycRef: string;
  authority: PublicKey;
  bump: number;
}

interface WhitelistRecordResponse {
  publicKey: string;
  wallet: string;
  approved: boolean;
  expiresAt: number | null;
  kycRef: string;
  authority: string;
}

// ---- Helpers ----------------------------------------------------------------

function parsePaginationParams(query: Request['query']): { limit: number; offset: number } | null {
  const limit = Math.min(parseInt(String(query.limit ?? '50'), 10), 200);
  const offset = parseInt(String(query.offset ?? '0'), 10);
  if (isNaN(limit) || isNaN(offset) || limit < 1 || offset < 0) return null;
  return { limit, offset };
}

function validateMintParam(mintStr: string | undefined): PublicKey | null {
  if (!mintStr) return null;
  try {
    return new PublicKey(mintStr);
  } catch {
    return null;
  }
}

/**
 * Build the memcmp filter for a given mint pubkey.
 * WhitelistRecord layout starts with: discriminator (8) + mint (32)
 */
function mintMemcmpFilter(mint: PublicKey): anchor.web3.GetProgramAccountsFilter {
  return {
    memcmp: {
      offset: 8, // skip 8-byte discriminator
      bytes: mint.toBase58(),
    },
  };
}

function formatRecord(
  pda: PublicKey,
  account: WhitelistRecordAccount,
): WhitelistRecordResponse {
  return {
    publicKey: pda.toBase58(),
    wallet: account.wallet.toBase58(),
    approved: account.approved,
    expiresAt: account.expiresAt ? account.expiresAt.toNumber() : null,
    kycRef: account.kycRef,
    authority: account.authority.toBase58(),
  };
}

// ---- Routes -----------------------------------------------------------------

/**
 * GET /v1/whitelist?mint=<pubkey>&limit=50&offset=0
 * Returns paginated list of WhitelistRecord PDAs for a given mint.
 */
whitelistRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const mint = validateMintParam(req.query.mint as string | undefined);
    if (!mint) {
      res.status(400).json({ error: 'mint query parameter must be a valid Solana pubkey' });
      return;
    }

    const pagination = parsePaginationParams(req.query);
    if (!pagination) {
      res.status(400).json({ error: 'Invalid limit or offset parameters' });
      return;
    }

    // Use a raw getProgramAccounts call with the IDL discriminator approach.
    // In production this would use `program.account.whitelistRecord.all()` with filters
    // once the IDL is available. We use the provider's connection directly for now.
    const accounts = await anchorProvider.connection.getProgramAccounts(anchorProgramId, {
      commitment: 'confirmed',
      filters: [
        // 8-byte discriminator for whitelistRecord (sha256("account:WhitelistRecord")[0..8])
        { dataSize: 8 + 32 + 32 + 1 + 9 + 4 + 100 + 32 + 1 }, // approximate, adjust per actual layout
        mintMemcmpFilter(mint),
      ],
    });

    // Deserialize accounts using Anchor's BorshAccountsCoder once IDL is available.
    // For now we manually decode the fields in order.
    const records: WhitelistRecordResponse[] = [];
    for (const { pubkey, account } of accounts) {
      try {
        const buf = account.data;
        let off = 8; // skip discriminator

        const mintKey = new PublicKey(buf.subarray(off, off + 32)); off += 32;
        const wallet = new PublicKey(buf.subarray(off, off + 32)); off += 32;
        const approved = buf[off] !== 0; off += 1;

        // Option<i64> — 1 byte some/none + 8 bytes value
        const hasExpiry = buf[off] !== 0; off += 1;
        let expiresAt: number | null = null;
        if (hasExpiry) {
          expiresAt = Number(buf.readBigInt64LE(off));
          off += 8;
        }

        // String: u32 length prefix + bytes
        const kycRefLen = buf.readUInt32LE(off); off += 4;
        const kycRef = buf.subarray(off, off + kycRefLen).toString('utf8'); off += kycRefLen;

        const authority = new PublicKey(buf.subarray(off, off + 32)); off += 32;
        const bump = buf[off]; off += 1;

        void mintKey; void bump; // used only for type safety

        records.push({
          publicKey: pubkey.toBase58(),
          wallet: wallet.toBase58(),
          approved,
          expiresAt,
          kycRef,
          authority: authority.toBase58(),
        });
      } catch (decodeErr) {
        console.error(`Failed to decode WhitelistRecord ${pubkey.toBase58()}:`, decodeErr);
      }
    }

    const total = records.length;
    const page = records.slice(pagination.offset, pagination.offset + pagination.limit);

    res.json({
      mint: mint.toBase58(),
      total,
      limit: pagination.limit,
      offset: pagination.offset,
      records: page,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/whitelist/check
 * Body: { mint: string, wallet: string }
 * Returns: { whitelisted: boolean, expiresAt?: number, kycRef?: string }
 */
whitelistRouter.post('/check', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { mint: mintStr, wallet: walletStr } = req.body as {
      mint?: unknown;
      wallet?: unknown;
    };

    if (typeof mintStr !== 'string') {
      res.status(400).json({ error: 'mint must be a string pubkey' });
      return;
    }
    if (typeof walletStr !== 'string') {
      res.status(400).json({ error: 'wallet must be a string pubkey' });
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

    // Derive the WhitelistRecord PDA: seeds = ["whitelist", mint, wallet]
    const [whitelistPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('whitelist'), mintKey.toBuffer(), walletKey.toBuffer()],
      anchorProgramId,
    );

    const accountInfo = await anchorProvider.connection.getAccountInfo(whitelistPda, 'confirmed');

    if (!accountInfo) {
      res.json({
        whitelisted: false,
        wallet: walletStr,
        mint: mintStr,
      });
      return;
    }

    // Decode the record
    const buf = accountInfo.data;
    let off = 8; // skip discriminator
    off += 32; // mint
    off += 32; // wallet
    const approved = buf[off] !== 0; off += 1;

    const hasExpiry = buf[off] !== 0; off += 1;
    let expiresAt: number | null = null;
    if (hasExpiry) {
      expiresAt = Number(buf.readBigInt64LE(off));
      off += 8;
    }

    const kycRefLen = buf.readUInt32LE(off); off += 4;
    const kycRef = buf.subarray(off, off + kycRefLen).toString('utf8');

    const nowSec = Math.floor(Date.now() / 1000);
    const expired = expiresAt !== null && expiresAt < nowSec;
    const whitelisted = approved && !expired;

    res.json({
      whitelisted,
      wallet: walletStr,
      mint: mintStr,
      approved,
      expired,
      expiresAt,
      kycRef: kycRef || undefined,
      pda: whitelistPda.toBase58(),
    });
  } catch (err) {
    next(err);
  }
});
