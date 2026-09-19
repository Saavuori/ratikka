import { useEffect, useRef, useState } from 'react';
import type { PositionsMessage } from '../types';
import { OPTIONAL_MODES, type ModeFlags, type OptionalMode } from '../lib/modes';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface UseWebSocketOptions {
  onMessage: (data: PositionsMessage) => void;
  // Which modes this client wants streamed. Sent to the backend on connect and
  // whenever the user toggles one; trams always stream, so only the optional
  // feeds go on the wire.
  wantsModes: ModeFlags;
}

export function useWebSocket({ onMessage, wantsModes }: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectDelayRef = useRef<number>(1000); // Start reconnect delay at 1s
  const wantsModesRef = useRef<ModeFlags>(wantsModes);

  const sendModePrefs = (wanted: ModeFlags) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const modes = Object.fromEntries(
        OPTIONAL_MODES.map((mode) => [mode, wanted[mode]])
      ) as Record<OptionalMode, boolean>;
      socket.send(JSON.stringify({ modes }));
    }
  };

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
      sendModePrefs(wantsModesRef.current); // Announce current mode preferences
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

  // Push preference changes to the backend live (e.g. user toggles buses or the
  // metro on/off while connected). onopen handles the initial announcement
  // after (re)connect. The caller memoizes `wantsModes`, so this only fires when
  // a toggle actually changes.
  useEffect(() => {
    wantsModesRef.current = wantsModes;
    sendModePrefs(wantsModes);
  }, [wantsModes]);

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
