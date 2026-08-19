import { DatabaseSync } from 'node:sqlite';
import { safeStorage } from 'electron';
import type { AnimeCandidate, AppSettings, LibraryAnime, WatchEvent, WatchEventInput, WatchEventStatus } from '../shared/types.js';

const DEFAULTS: Omit<AppSettings, 'malConnected' | 'malUsername'> = {
  completionThreshold: 0.85,
  malClientId: '',
  malClientSecret: '',
  plexEnabled: false,
  localDetectionEnabled: true,
  discordEnabled: false,
  discordApplicationId: '',
  startWithWindows: false,
};

const SECRET_KEYS = new Set(['malClientSecret', 'plexToken', 'malAccessToken', 'malRefreshToken', 'extensionToken', 'extensionPairingCode']);

function encodeSetting(key: string, value: string): string {
  if (!SECRET_KEYS.has(key) || !value) return value;
  if (!safeStorage.isEncryptionAvailable()) return `plain:${value}`;
  return `safe:${safeStorage.encryptString(value).toString('base64')}`;
}

function decodeSetting(key: string, value: string | undefined): string {
  if (!value || !SECRET_KEYS.has(key)) return value ?? '';
  if (value.startsWith('plain:')) return value.slice(6);
  if (!value.startsWith('safe:')) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(5), 'base64'));
  } catch {
    return '';
  }
}

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS watch_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        episode INTEGER,
        progress REAL NOT NULL,
        duration_seconds REAL,
        position_seconds REAL,
        url TEXT,
        player TEXT,
        observed_at TEXT NOT NULL,
        status TEXT NOT NULL,
        mal_anime_id INTEGER,
        matched_title TEXT,
        confidence REAL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS watch_events_updated_idx ON watch_events(updated_at DESC);
      CREATE TABLE IF NOT EXISTS title_mappings (
        normalized_title TEXT PRIMARY KEY,
        mal_anime_id INTEGER NOT NULL,
        matched_title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS anime_library (
        mal_anime_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        english_title TEXT,
        japanese_title TEXT,
        image_url TEXT,
        media_type TEXT,
        total_episodes INTEGER,
        watched_episodes INTEGER NOT NULL DEFAULT 0,
        list_status TEXT,
        last_activity_at TEXT NOT NULL,
        details_updated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO anime_library(
        mal_anime_id, title, watched_episodes, last_activity_at, created_at, updated_at
      )
      SELECT
        mal_anime_id,
        MAX(COALESCE(matched_title, title)),
        MAX(CASE WHEN status = 'synced' THEN COALESCE(episode, 0) ELSE 0 END),
        MAX(observed_at),
        MIN(created_at),
        MAX(updated_at)
      FROM watch_events
      WHERE mal_anime_id IS NOT NULL
      GROUP BY mal_anime_id;
    `);
  }

  close(): void {
    this.db.close();
  }

  getSetting(key: string): string {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return decodeSetting(key, row?.value);
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, encodeSetting(key, value));
  }

  getSettings(): AppSettings {
    return {
      completionThreshold: Number(this.getSetting('completionThreshold') || DEFAULTS.completionThreshold),
      malClientId: this.getSetting('malClientId') || DEFAULTS.malClientId,
      malClientSecret: this.getSetting('malClientSecret') || DEFAULTS.malClientSecret,
      malConnected: Boolean(this.getSetting('malAccessToken')),
      malUsername: this.getSetting('malUsername') || null,
      plexEnabled: this.getSetting('plexEnabled') === 'true',
      localDetectionEnabled: this.getSetting('localDetectionEnabled') !== 'false',
      discordEnabled: this.getSetting('discordEnabled') === 'true',
      discordApplicationId: this.getSetting('discordApplicationId') || DEFAULTS.discordApplicationId,
      startWithWindows: this.getSetting('startWithWindows') === 'true',
    };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'malConnected' || key === 'malUsername' || value === undefined) continue;
      this.setSetting(key, String(value));
    }
    return this.getSettings();
  }

  upsertEvent(input: WatchEventInput, status: WatchEventStatus): WatchEvent {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO watch_events(
        source, source_key, title, episode, progress, duration_seconds, position_seconds,
        url, player, observed_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        title = excluded.title,
        episode = COALESCE(excluded.episode, watch_events.episode),
        progress = MAX(excluded.progress, watch_events.progress),
        duration_seconds = COALESCE(excluded.duration_seconds, watch_events.duration_seconds),
        position_seconds = MAX(COALESCE(excluded.position_seconds, 0), COALESCE(watch_events.position_seconds, 0)),
        url = COALESCE(excluded.url, watch_events.url),
        player = COALESCE(excluded.player, watch_events.player),
        observed_at = excluded.observed_at,
        status = CASE
          WHEN watch_events.status = 'synced' THEN 'synced'
          WHEN watch_events.status = 'ignored' THEN 'ignored'
          WHEN watch_events.status = 'needs_match' THEN 'needs_match'
          ELSE excluded.status
        END,
        updated_at = excluded.updated_at
    `).run(
      input.source, input.sourceKey, input.title, input.episode, input.progress,
      input.durationSeconds ?? null, input.positionSeconds ?? null, input.url ?? null,
      input.player ?? null, input.observedAt, status, now, now,
    );
    const event = this.getEventBySourceKey(input.sourceKey)!;
    if (event.malAnimeId) this.touchLibraryActivity(event.malAnimeId, event.matchedTitle ?? event.title, event.observedAt);
    return event;
  }

  getEventBySourceKey(sourceKey: string): WatchEvent | null {
    const row = this.db.prepare('SELECT * FROM watch_events WHERE source_key = ?').get(sourceKey) as Record<string, unknown> | undefined;
    return row ? mapEvent(row) : null;
  }

  setEventMatch(id: number, malAnimeId: number, matchedTitle: string, confidence: number): void {
    this.db.prepare(`
      UPDATE watch_events SET mal_anime_id = ?, matched_title = ?, confidence = ?, status = 'ready', error = NULL, updated_at = ?
      WHERE id = ?
    `).run(malAnimeId, matchedTitle, confidence, new Date().toISOString(), id);
    const event = this.listEvents(500).find((item) => item.id === id);
    if (event) this.touchLibraryActivity(malAnimeId, matchedTitle, event.observedAt);
  }

  setEventStatus(id: number, status: WatchEventStatus, error: string | null = null): void {
    this.db.prepare('UPDATE watch_events SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(status, error, new Date().toISOString(), id);
  }

  listEvents(limit = 100): WatchEvent[] {
    const rows = this.db.prepare('SELECT * FROM watch_events ORDER BY updated_at DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map(mapEvent);
  }

  rememberMapping(normalizedTitle: string, malAnimeId: number, matchedTitle: string): void {
    this.db.prepare(`
      INSERT INTO title_mappings(normalized_title, mal_anime_id, matched_title, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(normalized_title) DO UPDATE SET mal_anime_id = excluded.mal_anime_id, matched_title = excluded.matched_title
    `).run(normalizedTitle, malAnimeId, matchedTitle, new Date().toISOString());
  }

  findMapping(normalizedTitle: string): { malAnimeId: number; matchedTitle: string } | null {
    const row = this.db.prepare('SELECT mal_anime_id, matched_title FROM title_mappings WHERE normalized_title = ?')
      .get(normalizedTitle) as { mal_anime_id: number; matched_title: string } | undefined;
    return row ? { malAnimeId: row.mal_anime_id, matchedTitle: row.matched_title } : null;
  }

  touchLibraryActivity(malAnimeId: number, title: string, observedAt: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO anime_library(mal_anime_id, title, last_activity_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(mal_anime_id) DO UPDATE SET
        title = CASE WHEN anime_library.title = '' THEN excluded.title ELSE anime_library.title END,
        last_activity_at = MAX(anime_library.last_activity_at, excluded.last_activity_at),
        updated_at = excluded.updated_at
    `).run(malAnimeId, title, observedAt, now, now);
  }

  upsertLibraryAnime(anime: AnimeCandidate | LibraryAnime): void {
    const now = new Date().toISOString();
    const isCandidate = 'id' in anime;
    const malAnimeId = isCandidate ? anime.id : anime.malAnimeId;
    const totalEpisodes = isCandidate ? anime.episodes : anime.totalEpisodes;
    const watchedEpisodes = isCandidate ? 0 : anime.watchedEpisodes;
    const listStatus = isCandidate ? null : anime.listStatus;
    const lastActivityAt = isCandidate ? now : anime.lastActivityAt;
    this.db.prepare(`
      INSERT INTO anime_library(
        mal_anime_id, title, english_title, japanese_title, image_url, media_type,
        total_episodes, watched_episodes, list_status, last_activity_at,
        details_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mal_anime_id) DO UPDATE SET
        title = excluded.title,
        english_title = COALESCE(excluded.english_title, anime_library.english_title),
        japanese_title = COALESCE(excluded.japanese_title, anime_library.japanese_title),
        image_url = COALESCE(excluded.image_url, anime_library.image_url),
        media_type = COALESCE(excluded.media_type, anime_library.media_type),
        total_episodes = COALESCE(NULLIF(excluded.total_episodes, 0), anime_library.total_episodes),
        watched_episodes = MAX(anime_library.watched_episodes, excluded.watched_episodes),
        list_status = COALESCE(excluded.list_status, anime_library.list_status),
        last_activity_at = MAX(anime_library.last_activity_at, excluded.last_activity_at),
        details_updated_at = excluded.details_updated_at,
        updated_at = excluded.updated_at
    `).run(
      malAnimeId,
      anime.title,
      anime.englishTitle,
      anime.japaneseTitle,
      anime.imageUrl,
      anime.mediaType,
      totalEpisodes,
      watchedEpisodes,
      listStatus,
      lastActivityAt,
      now,
      now,
      now,
    );
  }

  updateLibraryProgress(malAnimeId: number, watchedEpisodes: number | null, listStatus: string | null): void {
    this.db.prepare(`
      UPDATE anime_library SET
        watched_episodes = MAX(watched_episodes, COALESCE(?, watched_episodes)),
        list_status = COALESCE(?, list_status),
        updated_at = ?
      WHERE mal_anime_id = ?
    `).run(watchedEpisodes, listStatus, new Date().toISOString(), malAnimeId);
  }

  getLibraryAnime(malAnimeId: number): LibraryAnime | null {
    const row = this.db.prepare('SELECT * FROM anime_library WHERE mal_anime_id = ?').get(malAnimeId) as Record<string, unknown> | undefined;
    return row ? mapLibraryAnime(row) : null;
  }

  listLibrary(): LibraryAnime[] {
    const rows = this.db.prepare('SELECT * FROM anime_library ORDER BY last_activity_at DESC, title COLLATE NOCASE').all() as Record<string, unknown>[];
    return rows.map(mapLibraryAnime);
  }
}

function mapEvent(row: Record<string, unknown>): WatchEvent {
  return {
    id: Number(row.id),
    source: row.source as WatchEvent['source'],
    sourceKey: String(row.source_key),
    title: String(row.title),
    episode: row.episode == null ? null : Number(row.episode),
    progress: Number(row.progress),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    positionSeconds: row.position_seconds == null ? null : Number(row.position_seconds),
    url: row.url == null ? null : String(row.url),
    player: row.player == null ? null : String(row.player),
    observedAt: String(row.observed_at),
    status: row.status as WatchEventStatus,
    malAnimeId: row.mal_anime_id == null ? null : Number(row.mal_anime_id),
    matchedTitle: row.matched_title == null ? null : String(row.matched_title),
    confidence: row.confidence == null ? null : Number(row.confidence),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    error: row.error == null ? null : String(row.error),
  };
}

function mapLibraryAnime(row: Record<string, unknown>): LibraryAnime {
  return {
    malAnimeId: Number(row.mal_anime_id),
    title: String(row.title),
    englishTitle: row.english_title == null ? null : String(row.english_title),
    japaneseTitle: row.japanese_title == null ? null : String(row.japanese_title),
    imageUrl: row.image_url == null ? null : String(row.image_url),
    mediaType: row.media_type == null ? null : String(row.media_type),
    totalEpisodes: row.total_episodes == null ? null : Number(row.total_episodes),
    watchedEpisodes: Number(row.watched_episodes),
    listStatus: row.list_status == null ? null : String(row.list_status),
    lastActivityAt: String(row.last_activity_at),
    detailsUpdatedAt: row.details_updated_at == null ? null : String(row.details_updated_at),
  };
}
