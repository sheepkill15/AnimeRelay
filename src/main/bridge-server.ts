import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { AppDatabase } from './database.js';
import { EventProcessor } from './event-processor.js';
import { MalClient } from './mal-client.js';
import { isYoutubeUrl } from './source-policy.js';

const eventSchema = z.object({
  sourceKey: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  episode: z.number().int().positive().max(10000).nullable(),
  progress: z.number().min(0).max(1),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  positionSeconds: z.number().nonnegative().nullable().optional(),
  url: z.string().max(3000).nullable().optional(),
  player: z.string().max(200).nullable().optional(),
  detectedMalAnimeId: z.number().int().positive().nullable().optional(),
  observedAt: z.string().datetime(),
});

export class BridgeServer {
  readonly pairingCode: string;
  private extensionSeenAt = 0;
  private server = createServer((request, response) => void this.route(request, response));

  constructor(
    private readonly port: number,
    private readonly db: AppDatabase,
    private readonly processor: EventProcessor,
    private readonly mal: MalClient,
    private readonly onOAuthComplete: (error?: string) => void,
    private readonly onExtensionStateChange: () => void,
  ) {
    const storedCode = this.db.getSetting('extensionPairingCode');
    const hasValidStoredCode = /^\d{6}$/.test(storedCode);
    this.pairingCode = hasValidStoredCode
      ? storedCode
      : String(Math.floor(100000 + Math.random() * 900000));
    if (!hasValidStoredCode) this.db.setSetting('extensionPairingCode', this.pairingCode);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  isExtensionConnected(): boolean {
    return Date.now() - this.extensionSeenAt < 120_000;
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') return this.json(response, 204, null);

    const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.port}`);
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const valid = this.isAuthorized(request);
        if (valid) this.markExtensionSeen();
        return this.json(response, valid ? 200 : 401, { connected: valid });
      }
      if (request.method === 'POST' && url.pathname === '/api/pair') {
        const payload = await this.readJson(request);
        if (payload?.code !== this.pairingCode) return this.json(response, 403, { error: 'Incorrect pairing code.' });
        const token = randomBytes(32).toString('base64url');
        this.db.setSetting('extensionToken', token);
        this.markExtensionSeen();
        return this.json(response, 200, { token });
      }
      if (request.method === 'POST' && url.pathname === '/api/events') {
        if (!this.isAuthorized(request)) return this.json(response, 401, { error: 'Pair the extension first.' });
        this.markExtensionSeen();
        const event = eventSchema.parse(await this.readJson(request));
        if (isYoutubeUrl(event.url)) return this.json(response, 422, { error: 'YouTube is excluded from Anime Relay.' });
        const stored = await this.processor.ingest({ source: 'browser', ...event });
        return this.json(response, 202, { id: stored.id, status: stored.status });
      }
      if (request.method === 'GET' && url.pathname === '/oauth/mal/callback') {
        const code = url.searchParams.get('code');
        if (!code) throw new Error(url.searchParams.get('error') || 'MyAnimeList did not return an authorization code.');
        await this.mal.completeAuthorization(code);
        this.onOAuthComplete();
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Anime Relay connected</title><style>body{font:18px system-ui;display:grid;place-items:center;min-height:100vh;background:#101014;color:#f3f0ff}main{max-width:32rem;text-align:center}b{color:#b9ff66}</style><main><h1>MyAnimeList connected</h1><p>You can close this tab and return to Anime Relay.</p></main>');
        return;
      }
      this.json(response, 404, { error: 'Not found.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (url.pathname === '/oauth/mal/callback') this.onOAuthComplete(message);
      this.json(response, 400, { error: message });
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const token = this.db.getSetting('extensionToken');
    return Boolean(token) && request.headers.authorization === `Bearer ${token}`;
  }

  private markExtensionSeen(): void {
    const wasConnected = this.isExtensionConnected();
    this.extensionSeenAt = Date.now();
    if (!wasConnected) this.onExtensionStateChange();
  }

  private async readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 64 * 1024) throw new Error('Request body is too large.');
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
  }

  private json(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(payload == null ? '' : JSON.stringify(payload));
  }
}
