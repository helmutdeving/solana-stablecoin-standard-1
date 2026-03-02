import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosError } from 'axios';

const REGISTRY_PATH = '/tmp/webhooks.json';
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

export interface WebhookConfig {
  url: string;
  secret: string;
  events: string[];
  mint?: string;
}

export interface WebhookRecord extends WebhookConfig {
  id: string;
  createdAt: number;
}

export interface PublicWebhookRecord {
  id: string;
  url: string;
  events: string[];
  mint?: string;
  createdAt: number;
}

function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function computeSignature(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WebhookManager {
  private registry: Map<string, WebhookRecord> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  register(config: WebhookConfig): PublicWebhookRecord {
    const record: WebhookRecord = {
      ...config,
      id: generateId(),
      createdAt: Date.now(),
    };
    this.registry.set(record.id, record);
    this.persistToDisk();
    return this.sanitize(record);
  }

  remove(id: string): boolean {
    const existed = this.registry.has(id);
    if (existed) {
      this.registry.delete(id);
      this.persistToDisk();
    }
    return existed;
  }

  list(): PublicWebhookRecord[] {
    return Array.from(this.registry.values()).map((r) => this.sanitize(r));
  }

  /**
   * Deliver an event to all matching webhooks asynchronously (fire-and-forget with retries).
   */
  deliver(eventType: string, data: object, mint?: string): void {
    for (const record of this.registry.values()) {
      // Filter by event type subscription
      if (!record.events.includes(eventType) && !record.events.includes('*')) continue;

      // Filter by mint
      if (record.mint && mint && record.mint !== mint) continue;

      const payload = {
        id: generateId(),
        type: eventType,
        data,
        mint: mint ?? null,
        timestamp: Date.now(),
      };

      // Run delivery in background without blocking
      void this.deliverWithRetry(record, payload);
    }
  }

  private async deliverWithRetry(
    record: WebhookRecord,
    payload: object,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = computeSignature(record.secret, body);

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await axios.post(record.url, body, {
          headers: {
            'Content-Type': 'application/json',
            'X-SSS-Signature': signature,
            'X-SSS-Event': (payload as { type: string }).type,
            'X-SSS-Delivery': (payload as { id: string }).id,
          },
          timeout: 10_000,
          validateStatus: (status) => status >= 200 && status < 300,
        });

        console.log(
          `Webhook delivered to ${record.url} [${response.status}] (attempt ${attempt})`,
        );
        return;
      } catch (err) {
        const isLast = attempt === RETRY_ATTEMPTS;
        const statusCode = err instanceof AxiosError ? err.response?.status : undefined;

        console.error(
          `Webhook delivery failed for ${record.url} (attempt ${attempt}/${RETRY_ATTEMPTS})` +
            (statusCode ? ` [HTTP ${statusCode}]` : '') +
            (err instanceof Error ? `: ${err.message}` : ''),
        );

        if (!isLast) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    console.error(
      `Webhook permanently failed after ${RETRY_ATTEMPTS} attempts: ${record.url}`,
    );
  }

  private sanitize(record: WebhookRecord): PublicWebhookRecord {
    return {
      id: record.id,
      url: record.url,
      events: record.events,
      mint: record.mint,
      createdAt: record.createdAt,
    };
  }

  private persistToDisk(): void {
    try {
      const data = JSON.stringify(Array.from(this.registry.values()), null, 2);
      const dir = path.dirname(REGISTRY_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(REGISTRY_PATH, data, 'utf8');
    } catch (err) {
      console.error('Failed to persist webhook registry:', err);
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(REGISTRY_PATH)) return;
      const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
      const records = JSON.parse(raw) as WebhookRecord[];
      for (const record of records) {
        this.registry.set(record.id, record);
      }
      console.log(`Loaded ${this.registry.size} webhook(s) from disk`);
    } catch (err) {
      console.error('Failed to load webhook registry from disk:', err);
    }
  }
}
