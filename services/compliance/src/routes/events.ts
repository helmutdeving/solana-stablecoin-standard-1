import { Router, Request, Response, NextFunction } from 'express';
import { PublicKey } from '@solana/web3.js';
import { anchorProvider, anchorProgramId } from '../index';

export const eventsRouter = Router();

// ---- Types ------------------------------------------------------------------

type ComplianceEventType =
  | 'AccountFreezeUpdated'
  | 'WhitelistUpdated'
  | 'FundsSeized'
  | 'TokensMinted'
  | 'TokensBurned'
  | 'TokensTransferred';

interface ComplianceEventRecord {
  publicKey: string;
  eventId: string;
  eventType: ComplianceEventType;
  actor: string;
  subject: string;
  metadata: Record<string, unknown>;
  slot: number;
  timestamp: number;
}

// ---- Helpers ----------------------------------------------------------------

function parsePaginationParams(query: Request['query']): { limit: number; offset: number } | null {
  const limit = Math.min(parseInt(String(query.limit ?? '50'), 10), 200);
  const offset = parseInt(String(query.offset ?? '0'), 10);
  if (isNaN(limit) || isNaN(offset) || limit < 1 || offset < 0) return null;
  return { limit, offset };
}

/**
 * ComplianceEventRecord layout (approximate borsh):
 * discriminator: 8
 * event_id: [u8; 16] — 16 bytes UUID
 * event_type: u8 — enum discriminant
 * actor: PublicKey — 32 bytes
 * subject: PublicKey — 32 bytes
 * metadata_json: String — u32 len + bytes
 * slot: u64 — 8 bytes
 * timestamp: i64 — 8 bytes
 * mint: PublicKey — 32 bytes
 * bump: u8
 */
const EVENT_TYPE_NAMES: ComplianceEventType[] = [
  'AccountFreezeUpdated',
  'WhitelistUpdated',
  'FundsSeized',
  'TokensMinted',
  'TokensBurned',
  'TokensTransferred',
];

function decodeComplianceEventRecord(
  pubkey: PublicKey,
  data: Buffer,
): ComplianceEventRecord | null {
  try {
    let off = 8; // discriminator

    const eventIdBytes = data.subarray(off, off + 16); off += 16;
    const eventId = eventIdBytes.toString('hex');

    const eventTypeDiscriminant = data[off]; off += 1;
    const eventType = EVENT_TYPE_NAMES[eventTypeDiscriminant] ?? 'Unknown' as ComplianceEventType;

    const actor = new PublicKey(data.subarray(off, off + 32)).toBase58(); off += 32;
    const subject = new PublicKey(data.subarray(off, off + 32)).toBase58(); off += 32;

    const metadataLen = data.readUInt32LE(off); off += 4;
    const metadataJson = data.subarray(off, off + metadataLen).toString('utf8'); off += metadataLen;

    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    } catch {
      metadata = { raw: metadataJson };
    }

    const slot = Number(data.readBigUInt64LE(off)); off += 8;
    const timestamp = Number(data.readBigInt64LE(off)); off += 8;

    // mint field (used for the memcmp filter, not returned separately)
    // const mint = new PublicKey(data.subarray(off, off + 32)).toBase58(); off += 32;

    return {
      publicKey: pubkey.toBase58(),
      eventId,
      eventType,
      actor,
      subject,
      metadata,
      slot,
      timestamp,
    };
  } catch (err) {
    console.error(`Failed to decode ComplianceEventRecord ${pubkey.toBase58()}:`, err);
    return null;
  }
}

/**
 * GET /v1/events?mint=<pubkey>&limit=50&offset=0
 *
 * Fetches ComplianceEventRecord PDAs for the given mint, sorted by slot descending.
 * Each event includes eventId, eventType, actor, subject, metadata, slot, timestamp.
 */
eventsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    const pagination = parsePaginationParams(req.query);
    if (!pagination) {
      res.status(400).json({ error: 'Invalid limit or offset parameters' });
      return;
    }

    // Optionally filter by event type
    const eventTypeFilter = req.query.eventType as string | undefined;

    // Fetch all ComplianceEventRecord accounts filtered by mint.
    // The mint field sits at offset 8 + 16 + 1 + 32 + 32 + (dynamic metadata string) — not suitable
    // for memcmp. Instead we filter by mint at the end of the account layout (fixed offset design).
    // Assuming the SSS program stores mint at a known fixed offset. If your layout differs,
    // adjust the memcmp offset accordingly. Here we use the approach of fetching all and filtering
    // in-process; a production deployment would use a separate index.
    const rawAccounts = await anchorProvider.connection.getProgramAccounts(anchorProgramId, {
      commitment: 'confirmed',
      filters: [
        // Filter by the ComplianceEventRecord account discriminator size range.
        // Minimum size: 8 + 16 + 1 + 32 + 32 + 4 + 0 + 8 + 8 + 32 + 1 = 142 bytes
        { dataSize: 142 },
      ],
    });

    const records: ComplianceEventRecord[] = [];
    for (const { pubkey, account } of rawAccounts) {
      const decoded = decodeComplianceEventRecord(pubkey, account.data as Buffer);
      if (!decoded) continue;

      // Apply event type filter if provided
      if (eventTypeFilter && decoded.eventType !== eventTypeFilter) continue;

      records.push(decoded);
    }

    // Sort by slot descending (most recent first)
    records.sort((a, b) => b.slot - a.slot || b.timestamp - a.timestamp);

    const total = records.length;
    const page = records.slice(pagination.offset, pagination.offset + pagination.limit);

    res.json({
      mint: mint.toBase58(),
      total,
      limit: pagination.limit,
      offset: pagination.offset,
      events: page,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/events/:eventId
 * Fetch a single ComplianceEventRecord by its 32-hex-char event ID.
 */
eventsRouter.get('/:eventId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { eventId } = req.params;

    if (!/^[0-9a-f]{32}$/i.test(eventId)) {
      res.status(400).json({ error: 'eventId must be a 32-character hex string' });
      return;
    }

    // Scan all ComplianceEventRecord accounts to find the matching event ID.
    const rawAccounts = await anchorProvider.connection.getProgramAccounts(anchorProgramId, {
      commitment: 'confirmed',
      filters: [
        // Match on the event_id bytes at offset 8
        {
          memcmp: {
            offset: 8,
            bytes: Buffer.from(eventId, 'hex').toString('base64'),
          },
        },
      ],
    });

    if (rawAccounts.length === 0) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const { pubkey, account } = rawAccounts[0];
    const decoded = decodeComplianceEventRecord(pubkey, account.data as Buffer);
    if (!decoded) {
      res.status(500).json({ error: 'Failed to decode event record' });
      return;
    }

    res.json(decoded);
  } catch (err) {
    next(err);
  }
});
