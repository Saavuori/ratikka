import { useEffect, useRef, useState } from 'react';
import type { PositionsMessage } from '../types';
import { OPTIONAL_MODES, type ModeFlags, type OptionalMode } from '../lib/modes';
import { useSyncRef } from './useSyncRef';

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
  // The socket's handlers outlive the render that opened it, so they read the
  // caller's current callback and mode preferences through refs.
  const onMessageRef = useRef(onMessage);
  useSyncRef(onMessageRef, onMessage);
  const wantsModesRef = useRef<ModeFlags>(wantsModes);

  // Push preference changes to the backend live (e.g. user toggles buses or the
  // metro on/off while connected). onopen handles the initial announcement
  // after (re)connect. The caller memoizes `wantsModes`, so this only fires when
  // a toggle actually changes.
  useEffect(() => {
    wantsModesRef.current = wantsModes;
    sendModePrefs(socketRef.current, wantsModes);
  }, [wantsModes]);

  useEffect(() => {
    let reconnectTimeout: number | null = null;
    let reconnectDelay = 1000; // Start reconnect delay at 1s

    const connect = () => {
      if (socketRef.current) return;

      setStatus('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/stream`);
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('connected');
        reconnectDelay = 1000; // Reset backoff delay
        sendModePrefs(socket, wantsModesRef.current); // Announce current mode preferences
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as PositionsMessage;
          if (data && data.type === 'positions') {
            onMessageRef.current(data);
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        setStatus('disconnected');
        scheduleReconnect();
      };

      socket.onerror = (err) => {
        console.error('WebSocket error:', err);
        socket.close();
      };
    };

    const scheduleReconnect = () => {
      if (reconnectTimeout !== null) return;

      // Exponential backoff capped at 30 seconds
      const delay = reconnectDelay;
      reconnectDelay = Math.min(delay * 1.5, 30000);

      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, delay);
    };

    connect();

    return () => {
      const socket = socketRef.current;
      if (socket) {
        // Remove close listener to prevent auto-reconnect on deliberate unmount
        socket.onclose = null;
        socket.close();
        socketRef.current = null;
      }
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
      }
    };
  }, []);

  return { status };
}

function sendModePrefs(socket: WebSocket | null, wanted: ModeFlags) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    const modes = Object.fromEntries(
      OPTIONAL_MODES.map((mode) => [mode, wanted[mode]])
    ) as Record<OptionalMode, boolean>;
    socket.send(JSON.stringify({ modes }));
  }
}
