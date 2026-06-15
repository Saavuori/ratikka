import { useEffect, useRef, useState } from 'react';
import type { PositionsMessage } from '../types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface UseWebSocketOptions {
  onMessage: (data: PositionsMessage) => void;
}

export function useWebSocket({ onMessage }: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectDelayRef = useRef<number>(1000); // Start reconnect delay at 1s

  const connect = () => {
    if (socketRef.current) return;

    setStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/stream`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus('connected');
      reconnectDelayRef.current = 1000; // Reset backoff delay
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as PositionsMessage;
        if (data && data.type === 'positions') {
          onMessage(data);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    socket.onclose = () => {
      socketRef.current = null;
      setStatus('disconnected');
      triggerReconnect();
    };

    socket.onerror = (err) => {
      console.error('WebSocket error:', err);
      socket.close();
    };
  };

  const triggerReconnect = () => {
    if (reconnectTimeoutRef.current) return;

    // Exponential backoff capped at 30 seconds
    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 1.5, 30000);

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connect();
    }, delay);
  };

  useEffect(() => {
    connect();

    return () => {
      if (socketRef.current) {
        // Remove close listener to prevent auto-reconnect on deliberate unmount
        socketRef.current.onclose = null;
        socketRef.current.close();
        socketRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return { status };
}
