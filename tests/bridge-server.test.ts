import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '../src/main/database';
import type { EventProcessor } from '../src/main/event-processor';
import type { MalClient } from '../src/main/mal-client';
import { BridgeServer } from '../src/main/bridge-server';

async function getFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a test port.');
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

describe('BridgeServer extension state', () => {
  it('reuses the same pairing code from durable settings', () => {
    const settings = new Map<string, string>([['extensionPairingCode', '246810']]);
    const db = {
      getSetting: (key: string) => settings.get(key) ?? '',
      setSetting: (key: string, value: string) => settings.set(key, value),
    } as unknown as AppDatabase;
    const server = new BridgeServer(0, db, {} as EventProcessor, {} as MalClient, vi.fn(), vi.fn());
    expect(server.pairingCode).toBe('246810');
  });

  it('notifies the desktop immediately when pairing succeeds', async () => {
    const settings = new Map<string, string>();
    const db = {
      getSetting: (key: string) => settings.get(key) ?? '',
      setSetting: (key: string, value: string) => settings.set(key, value),
    } as unknown as AppDatabase;
    const onExtensionStateChange = vi.fn();
    const port = await getFreePort();
    const server = new BridgeServer(
      port,
      db,
      {} as EventProcessor,
      {} as MalClient,
      vi.fn(),
      onExtensionStateChange,
    );
    await server.start();
    try {
      const pairResponse = await fetch(`http://127.0.0.1:${port}/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: server.pairingCode }),
      });
      const pairPayload = await pairResponse.json() as { token: string };
      expect(pairResponse.status).toBe(200);
      expect(pairPayload.token).toBeTruthy();
      expect(onExtensionStateChange).toHaveBeenCalledTimes(1);

      const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { Authorization: `Bearer ${pairPayload.token}` },
      });
      expect(healthResponse.status).toBe(200);
      expect(onExtensionStateChange).toHaveBeenCalledTimes(1);
    } finally {
      await server.stop();
    }
  });

  it('hard-rejects YouTube events before they reach the processor', async () => {
    const settings = new Map<string, string>([
      ['extensionPairingCode', '246810'],
      ['extensionToken', 'test-token'],
    ]);
    const db = {
      getSetting: (key: string) => settings.get(key) ?? '',
      setSetting: (key: string, value: string) => settings.set(key, value),
    } as unknown as AppDatabase;
    const processor = { ingest: vi.fn() } as unknown as EventProcessor;
    const port = await getFreePort();
    const server = new BridgeServer(port, db, processor, {} as MalClient, vi.fn(), vi.fn());
    await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKey: 'browser:youtube.com:test:1',
          title: 'Not anime',
          episode: 1,
          progress: 0.5,
          durationSeconds: 600,
          positionSeconds: 300,
          url: 'https://www.youtube.com/watch?v=abc',
          player: 'Browser',
          detectedMalAnimeId: null,
          observedAt: new Date().toISOString(),
        }),
      });
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: 'YouTube is excluded from Anime Relay.' });
      expect(processor.ingest).not.toHaveBeenCalled();
    } finally {
      await server.stop();
    }
  });
});
