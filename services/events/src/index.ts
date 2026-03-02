import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import { SSSEventListener } from './listener';
import { WebSocketHandler } from './websocket';
import { WebhookManager } from './webhooks';

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID;

if (!PROGRAM_ID) {
  console.error('PROGRAM_ID environment variable is required');
  process.exit(1);
}

async function main(): Promise<void> {
  const programId = new PublicKey(PROGRAM_ID!);
  const connection = new Connection(RPC_URL, { commitment: 'confirmed' });

  const app = express();
  app.use(express.json());

  const webhookManager = new WebhookManager();
  const listener = new SSSEventListener(connection, programId);
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  const wsHandler = new WebSocketHandler(wss);

  // Forward events from the listener to WebSocket clients and webhooks
  listener.on('event', (eventType: string, data: object, mint?: string) => {
    wsHandler.broadcast(eventType, data, mint);
    webhookManager.deliver(eventType, data, mint);
  });

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'events',
      uptime: process.uptime(),
      rpcUrl: RPC_URL,
      programId: PROGRAM_ID,
    });
  });

  // List registered webhooks (returns sanitized list without secrets)
  app.get('/webhooks', (_req: Request, res: Response) => {
    res.json({ webhooks: webhookManager.list() });
  });

  // Register a new webhook
  app.post('/webhooks', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url, secret, events, mint } = req.body as {
        url?: unknown;
        secret?: unknown;
        events?: unknown;
        mint?: unknown;
      };

      if (typeof url !== 'string' || !url.startsWith('http')) {
        res.status(400).json({ error: 'url must be a valid HTTP/HTTPS URL' });
        return;
      }
      if (typeof secret !== 'string' || secret.length < 8) {
        res.status(400).json({ error: 'secret must be a string of at least 8 characters' });
        return;
      }
      if (!Array.isArray(events) || events.length === 0) {
        res.status(400).json({ error: 'events must be a non-empty array of event type strings' });
        return;
      }
      if (mint !== undefined && typeof mint !== 'string') {
        res.status(400).json({ error: 'mint must be a base58 pubkey string when provided' });
        return;
      }

      // Validate mint pubkey format if provided
      if (mint) {
        try {
          new PublicKey(mint as string);
        } catch {
          res.status(400).json({ error: 'mint is not a valid Solana pubkey' });
          return;
        }
      }

      const webhook = webhookManager.register({
        url,
        secret,
        events: events as string[],
        mint: mint as string | undefined,
      });

      res.status(201).json({ id: webhook.id, url: webhook.url, events: webhook.events, mint: webhook.mint });
    } catch (err) {
      next(err);
    }
  });

  // Delete a webhook
  app.delete('/webhooks/:id', (req: Request, res: Response) => {
    const removed = webhookManager.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'webhook not found' });
      return;
    }
    res.status(204).send();
  });

  // Generic error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Start listener
  await listener.start();
  console.log(`SSS event listener started, watching program ${PROGRAM_ID}`);

  httpServer.listen(PORT, () => {
    console.log(`Events service listening on port ${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down...`);
    listener.stop();
    wsHandler.closeAll();
    httpServer.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
