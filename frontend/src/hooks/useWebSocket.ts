import { useEffect, useRef, useState, useCallback } from "react";
import type { SSSEvent } from "../api/types";

interface UseWebSocketOptions {
  mint: string;
  maxEvents?: number;
  enabled?: boolean;
}

interface WebSocketState {
  events: SSSEvent[];
  connected: boolean;
  reconnecting: boolean;
}

export function useWebSocket({
  mint,
  maxEvents = 100,
  enabled = true,
}: UseWebSocketOptions): WebSocketState {
  const [events, setEvents] = useState<SSSEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);

  const connect = useCallback(() => {
    if (!enabled || !mint) return;

    const wsUrl =
      localStorage.getItem("sss_ws_url") ?? "ws://localhost:3002";
    const url = `${wsUrl}/ws?mint=${mint}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setReconnecting(false);
        attemptsRef.current = 0;
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        try {
          const event = JSON.parse(e.data) as SSSEvent;
          setEvents((prev) => [event, ...prev].slice(0, maxEvents));
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (enabled) {
          setReconnecting(true);
          const delay = Math.min(1000 * 2 ** attemptsRef.current, 30000);
          attemptsRef.current++;
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available or connection refused
    }
  }, [mint, maxEvents, enabled]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { events, connected, reconnecting };
}
