// Health-probe hook. Polls the active LLM client every PING_INTERVAL_MS
// and updates state via the supplied setter. Each probe carries an
// AbortSignal capped by PING_TIMEOUT_MS so a stalled endpoint doesn't
// pile up requests.

import { useEffect, useRef } from 'react';
import type { Client } from '../llm/client.js';
import { isPinger } from '../llm/client.js';

const PING_INTERVAL_MS = 15_000;
const PING_TIMEOUT_MS = 5_000;

export function usePing(getClient: () => Client, setReady: (ok: boolean) => void): void {
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
      if (!aliveRef.current) return;
      const client = getClient();
      if (!isPinger(client)) {
        setReady(true);
      } else {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), PING_TIMEOUT_MS);
        try {
          await client.ping(ctl.signal);
          if (aliveRef.current) setReady(true);
        } catch {
          if (aliveRef.current) setReady(false);
        } finally {
          clearTimeout(to);
        }
      }
      if (aliveRef.current) {
        timer = setTimeout(tick, PING_INTERVAL_MS);
      }
    };

    // Fire once immediately so the status reflects reality on launch,
    // then settle into the interval cadence.
    void tick();

    return () => {
      aliveRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [getClient, setReady]);
}
