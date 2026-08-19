import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import type { DiscordStatus, LibraryAnime, WatchEvent } from '../shared/types.js';
import type { AppDatabase } from './database.js';

const HANDSHAKE = 0;
const FRAME = 1;
export const ACTIVITY_TTL_MS = 2 * 60_000;

interface DiscordActivity {
  type: number;
  details: string;
  state: string;
  timestamps?: { end?: number };
  assets?: { large_image?: string; large_text?: string };
}

export class DiscordPresence {
  private socket: Socket | null = null;
  private readBuffer = Buffer.alloc(0);
  private connecting = false;
  private connected = false;
  private error: string | null = null;
  private applicationId = '';
  private pendingActivity: DiscordActivity | null = null;
  private lastSignature = '';

  constructor(private readonly db: AppDatabase, private readonly onStateChange: () => void) {}

  getStatus(): DiscordStatus {
    return { connected: this.connected, error: this.error };
  }

  refresh(): void {
    const settings = this.db.getSettings();
    if (!settings.discordEnabled) {
      this.disconnect(true);
      return;
    }
    if (!/^\d{17,20}$/.test(settings.discordApplicationId)) {
      this.setStatus(false, 'Enter a valid Discord Application ID.');
      this.disconnect(false);
      return;
    }

    const event = findActivePlayback(this.db.listEvents(50));
    const anime = event?.malAnimeId ? this.db.getLibraryAnime(event.malAnimeId) : null;
    this.pendingActivity = event ? this.buildActivity(event, anime) : null;

    if (this.applicationId !== settings.discordApplicationId) {
      this.disconnect(false);
      this.applicationId = settings.discordApplicationId;
    }
    if (this.connected) this.sendActivity();
    else void this.connect();
  }

  stop(): void {
    this.disconnect(true);
  }

  private buildActivity(event: WatchEvent, anime: LibraryAnime | null): DiscordActivity {
    const title = anime?.englishTitle || anime?.title || event.matchedTitle || event.title;
    const episode = event.episode == null ? 'Episode in progress' : `Episode ${event.episode}`;
    const state = `${episode} · ${Math.round(event.progress * 100)}%`;
    const remaining = event.durationSeconds && event.positionSeconds != null
      ? Math.max(0, event.durationSeconds - event.positionSeconds)
      : 0;
    return {
      type: 3,
      details: truncate(title),
      state: truncate(state),
      ...(remaining > 5 ? { timestamps: { end: Math.round(Date.now() / 1000 + remaining) } } : {}),
      ...(anime?.imageUrl ? { assets: { large_image: anime.imageUrl, large_text: truncate(anime.japaneseTitle || anime.title) } } : {}),
    };
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.connected || process.platform !== 'win32') return;
    this.connecting = true;
    this.error = null;
    try {
      for (let index = 0; index < 10; index += 1) {
        const socket = await openPipe(`\\\\?\\pipe\\discord-ipc-${index}`);
        if (!socket) continue;
        this.attach(socket);
        socket.write(encodeFrame(HANDSHAKE, { v: 1, client_id: this.applicationId }));
        return;
      }
      this.setStatus(false, 'Discord desktop is not running or its activity pipe is unavailable.');
    } finally {
      this.connecting = false;
    }
  }

  private attach(socket: Socket): void {
    this.socket = socket;
    this.readBuffer = Buffer.alloc(0);
    socket.on('data', (chunk) => this.readFrames(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    socket.on('error', (error) => this.setStatus(false, error.message));
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setStatus(false, this.error);
    });
  }

  private readFrames(chunk: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    while (this.readBuffer.length >= 8) {
      const length = this.readBuffer.readUInt32LE(4);
      if (this.readBuffer.length < length + 8) return;
      const payload = JSON.parse(this.readBuffer.subarray(8, 8 + length).toString('utf8')) as {
        evt?: string;
        data?: { message?: string };
      };
      this.readBuffer = this.readBuffer.subarray(8 + length);
      if (payload.evt === 'READY') {
        this.setStatus(true, null);
        this.lastSignature = '';
        this.sendActivity();
      } else if (payload.evt === 'ERROR') {
        this.setStatus(false, payload.data?.message || 'Discord rejected the activity update.');
      }
    }
  }

  private sendActivity(): void {
    if (!this.socket || !this.connected) return;
    const signature = JSON.stringify(this.pendingActivity);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.socket.write(encodeFrame(FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: this.pendingActivity },
      nonce: randomUUID(),
    }));
  }

  private disconnect(clear: boolean): void {
    const socket = this.socket;
    if (clear && socket && this.connected) {
      socket.end(encodeFrame(FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: null },
        nonce: randomUUID(),
      }));
    } else {
      socket?.destroy();
    }
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.readBuffer = Buffer.alloc(0);
    this.lastSignature = '';
    if (clear) this.error = null;
  }

  private setStatus(connected: boolean, error: string | null): void {
    const changed = this.connected !== connected || this.error !== error;
    this.connected = connected;
    this.error = error;
    if (changed) this.onStateChange();
  }
}

export function encodeFrame(opcode: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const frame = Buffer.allocUnsafe(8 + body.length);
  frame.writeUInt32LE(opcode, 0);
  frame.writeUInt32LE(body.length, 4);
  body.copy(frame, 8);
  return frame;
}

export function findActivePlayback(events: WatchEvent[], now = Date.now()): WatchEvent | undefined {
  return events.find((item) => {
    if (item.status === 'ignored' || item.status === 'failed') return false;
    const age = now - new Date(item.observedAt).getTime();
    return age >= 0 && age < ACTIVITY_TTL_MS;
  });
}

function openPipe(path: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => finish(null), 350);
    const finish = (result: Socket | null) => {
      clearTimeout(timer);
      socket.removeAllListeners('connect');
      socket.removeAllListeners('error');
      if (!result) socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => finish(socket));
    socket.once('error', () => finish(null));
  });
}

function truncate(value: string): string {
  return value.trim().slice(0, 128);
}
