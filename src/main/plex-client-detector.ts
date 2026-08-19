import { existsSync } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AppDatabase } from './database.js';
import { EventProcessor } from './event-processor.js';
import type { PlexClientStatus } from '../shared/types.js';

interface PlexMetadata {
  ratingKey: string;
  guid: string | null;
  title: string;
  episode: number;
  durationMs: number;
}

export interface PlexPlaybackUpdate extends PlexMetadata {
  positionMs: number;
  state: string;
}

const MAX_INITIAL_BYTES = 8 * 1024 * 1024;
const PROGRESS_PATTERN = /"ratingKey"\s*:\s*"([^"]+)"[\s\S]{0,1500}?"playbackTime"\s*:\s*\d+[\s\S]{0,600}?"state"\s*:\s*"(playing|paused|stopped|buffering)"[\s\S]{0,600}?"time"\s*:\s*(\d+)/g;

export function parsePlexLogChunk(text: string, metadata: Map<string, PlexMetadata>): PlexPlaybackUpdate[] {
  const updates = new Map<string, PlexPlaybackUpdate>();

  for (const line of text.split(/\r?\n/)) {
    const marker = 'Queue media: ';
    const markerIndex = line.indexOf(marker);
    if (markerIndex < 0) continue;
    try {
      const payload = JSON.parse(line.slice(markerIndex + marker.length)) as {
        decision?: { metadataItem?: Record<string, unknown> };
        startPositionSeconds?: number;
      };
      const item = payload.decision?.metadataItem;
      if (!item || item.type !== 'episode') continue;
      const ratingKey = String(item.ratingKey ?? '');
      const title = String(item.grandparentTitle ?? '');
      const episode = Number(item.index);
      const durationMs = Number(item.duration);
      if (!ratingKey || !title || !Number.isInteger(episode) || episode < 1 || !(durationMs > 0)) continue;
      const parsed: PlexMetadata = {
        ratingKey,
        guid: typeof item.guid === 'string' ? item.guid : null,
        title,
        episode,
        durationMs,
      };
      metadata.set(ratingKey, parsed);
      updates.set(ratingKey, {
        ...parsed,
        positionMs: Math.max(0, Number(payload.startPositionSeconds ?? 0) * 1000),
        state: 'playing',
      });
    } catch {
      // Plex log lines are best effort and can be cut during rotation.
    }
  }

  for (const match of text.matchAll(PROGRESS_PATTERN)) {
    const item = metadata.get(match[1]);
    if (!item) continue;
    updates.set(item.ratingKey, {
      ...item,
      positionMs: Number(match[3]),
      state: match[2],
    });
  }

  return [...updates.values()];
}

export class PlexClientDetector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private initialized = false;
  private offset = 0;
  private carry = '';
  private readonly metadata = new Map<string, PlexMetadata>();
  private readonly logPath: string | null;

  constructor(
    private readonly db: AppDatabase,
    private readonly processor: EventProcessor,
    private readonly onStateChange: () => void,
    localAppData = process.env.LOCALAPPDATA,
  ) {
    this.logPath = localAppData ? join(localAppData, 'Plex', 'Logs', 'Plex.log') : null;
  }

  getStatus(): PlexClientStatus {
    return {
      clientDetected: Boolean(this.logPath && existsSync(this.logPath)),
      lastPlaybackAt: this.db.getSetting('plexLastPlaybackAt') || null,
      error: this.db.getSetting('plexLastError') || null,
    };
  }

  start(): void {
    if (this.timer || process.platform !== 'win32') return;
    this.timer = setInterval(() => void this.scan(), 10_000);
    void this.scan();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scan(): Promise<void> {
    if (!this.db.getSettings().plexEnabled || this.running || !this.logPath) return;
    this.running = true;
    try {
      if (!this.initialized) await this.initialize();
      const info = await stat(this.logPath);
      if (info.size < this.offset) {
        this.offset = 0;
        this.carry = '';
      }
      if (info.size === this.offset) return;
      const length = info.size - this.offset;
      const handle = await open(this.logPath, 'r');
      try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, this.offset);
        this.offset = info.size;
        const combined = this.carry + buffer.toString('utf8');
        await this.ingestText(combined);
        this.carry = combined.slice(-32_000);
      } finally {
        await handle.close();
      }
      this.db.setSetting('plexLastError', '');
    } catch (error) {
      this.db.setSetting('plexLastError', error instanceof Error ? error.message : String(error));
      this.onStateChange();
    } finally {
      this.running = false;
    }
  }

  private async initialize(): Promise<void> {
    this.initialized = true;
    if (!this.logPath) return;
    const previousPath = join(this.logPath, '..', 'Plex.1.log');
    try {
      parsePlexLogChunk((await readFile(previousPath)).subarray(-MAX_INITIAL_BYTES).toString('utf8'), this.metadata);
    } catch {
      // A previous log is optional.
    }
    const current = await readFile(this.logPath);
    const tail = current.subarray(-MAX_INITIAL_BYTES).toString('utf8');
    parsePlexLogChunk(tail, this.metadata);
    this.carry = tail.slice(-32_000);
    this.offset = current.length;
  }

  private async ingestText(text: string): Promise<void> {
    const updates = parsePlexLogChunk(text, this.metadata);
    for (const update of updates) {
      const durationSeconds = update.durationMs / 1000;
      const positionSeconds = Math.max(0, update.positionMs / 1000);
      await this.processor.ingest({
        source: 'plex',
        sourceKey: `plex-client:${update.guid ?? update.ratingKey}`,
        title: update.title,
        episode: update.episode,
        progress: Math.min(positionSeconds / durationSeconds, 1),
        durationSeconds,
        positionSeconds,
        player: 'Plex for Windows',
        observedAt: new Date().toISOString(),
      });
    }
    if (updates.length > 0) {
      this.db.setSetting('plexLastPlaybackAt', new Date().toISOString());
      this.onStateChange();
    }
  }
}
