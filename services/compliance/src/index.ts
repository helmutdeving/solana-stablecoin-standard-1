import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { whitelistRouter } from './routes/whitelist';
import { eventsRouter } from './routes/events';
import { freezeRouter } from './routes/freeze';

const PORT = parseInt(process.env.PORT ?? '3003', 10);
const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID;
const COMPLIANCE_OFFICER_KEYPAIR = process.env.COMPLIANCE_OFFICER_KEYPAIR;

if (!PROGRAM_ID) {
  console.error('PROGRAM_ID environment variable is required');
  process.exit(1);
}
if (!COMPLIANCE_OFFICER_KEYPAIR) {
  console.error('COMPLIANCE_OFFICER_KEYPAIR environment variable is required');
  process.exit(1);
}

let keypair: Keypair;
try {
  keypair = Keypair.fromSecretKey(bs58.decode(COMPLIANCE_OFFICER_KEYPAIR));
} catch (err) {
  console.error('Invalid COMPLIANCE_OFFICER_KEYPAIR — must be base58-encoded secret key:', err);
  process.exit(1);
}

const programId = new PublicKey(PROGRAM_ID);
const connection = new Connection(RPC_URL, { commitment: 'confirmed' });
const wallet = new anchor.Wallet(keypair);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });

// The IDL is loaded at runtime; in production this would be imported from a shared package.
// We use `anchor.Program` with a minimal IDL shape; consumers fill in the real IDL.
// For now we export the provider so routes can construct the program directly.
export const anchorProvider = provider;
export const anchorProgramId = programId;

const app = express();
app.use(express.json());

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'compliance',
    uptime: process.uptime(),
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID,
    complianceOfficer: keypair.publicKey.toBase58(),
  });
});

// Mount routes
app.use('/v1/whitelist', whitelistRouter);
app.use('/v1/events', eventsRouter);
app.use('/v1/freeze-list', freezeRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Generic error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`Compliance service listening on port ${PORT}`);
  console.log(`Compliance officer: ${keypair.publicKey.toBase58()}`);
  console.log(`Program: ${PROGRAM_ID}`);
  console.log(`RPC: ${RPC_URL}`);
});
