import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';

interface SubscribedClient {
  ws: WebSocket;
  mint: string | null; // null = subscribe to all mints
  isAlive: boolean;
}

interface OutboundMessage {
  type: string;
  data: object;
  timestamp: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export class WebSocketHandler {
  private clients: Set<SubscribedClient> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(wss: WebSocketServer) {
    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.startHeartbeat();
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // Parse ?mint= query param from the upgrade request URL
    let mint: string | null = null;
    try {
      const reqUrl = req.url ?? '/';
      // req.url is a path+query, so we need a base to parse it
      const parsed = new URL(reqUrl, 'http://localhost');
      const mintParam = parsed.searchParams.get('mint');
      if (mintParam) {
        mint = mintParam;
      }
    } catch {
      // If URL parsing fails we just treat as no filter
    }

    const client: SubscribedClient = { ws, mint, isAlive: true };
    this.clients.add(client);

    console.log(`WebSocket client connected (mint filter: ${mint ?? 'all'}), total: ${this.clients.size}`);

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', (data) => {
      // Clients can send { type: 'subscribe', mint: '<pubkey>' } to change their filter at runtime
      try {
        const msg = JSON.parse(data.toString()) as { type?: unknown; mint?: unknown };
        if (msg.type === 'subscribe') {
          client.mint = typeof msg.mint === 'string' ? msg.mint : null;
          ws.send(JSON.stringify({ type: 'subscribed', mint: client.mint, timestamp: Date.now() }));
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      this.clients.delete(client);
      console.log(`WebSocket client disconnected, total: ${this.clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', err);
      this.clients.delete(client);
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.terminate();
      }
    });

    // Send welcome message with subscription info
    ws.send(
      JSON.stringify({
        type: 'connected',
        mint: client.mint,
        timestamp: Date.now(),
      }),
    );
  }

  /**
   * Broadcast an event to all connected clients that have a matching mint filter.
   * @param eventType - The SSS event type name (e.g. "TokensMinted")
   * @param data - The event data object
   * @param mint - The mint pubkey associated with this event (used for filtering)
   */
  broadcast(eventType: string, data: object, mint?: string): void {
    const message: OutboundMessage = {
      type: eventType,
      data,
      timestamp: Date.now(),
    };
    const payload = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      // Apply mint filter: client.mint === null means "all mints"
      if (client.mint !== null && mint !== undefined && client.mint !== mint) continue;

      try {
        client.ws.send(payload);
      } catch (err) {
        console.error('Error sending to WebSocket client:', err);
      }
    }
  }

  /**
   * Terminate all open WebSocket connections (used during graceful shutdown).
   */
  closeAll(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.clients) {
      client.ws.terminate();
    }
    this.clients.clear();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const dead: SubscribedClient[] = [];

      for (const client of this.clients) {
        if (!client.isAlive) {
          // No pong received since last ping — consider connection dead
          dead.push(client);
          client.ws.terminate();
          continue;
        }
        // Mark as not alive until pong is received
        client.isAlive = false;
        try {
          client.ws.ping();
        } catch {
          dead.push(client);
        }
      }

      for (const client of dead) {
        this.clients.delete(client);
      }

      if (dead.length > 0) {
        console.log(`Heartbeat: removed ${dead.length} dead connection(s), total: ${this.clients.size}`);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Don't keep the process alive just for the heartbeat
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }
}
