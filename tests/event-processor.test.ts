import { describe, expect, it, vi } from 'vitest';
import type { WatchEvent } from '../src/shared/types';
import type { AppDatabase } from '../src/main/database';
import type { MalClient } from '../src/main/mal-client';
import { EventProcessor } from '../src/main/event-processor';

describe('EventProcessor direct MAL metadata', () => {
  it('remembers a supplied MAL id without marking an early event ready', async () => {
    let event: WatchEvent = {
      id: 1,
      source: 'browser',
      sourceKey: 'browser:anikoto.cz:the-asterisk-war:1',
      title: 'The Asterisk War',
      episode: 1,
      progress: 0.5,
      observedAt: new Date().toISOString(),
      status: 'watching',
      malAnimeId: null,
      matchedTitle: null,
      confidence: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
    };
    const db = {
      getSettings: () => ({ completionThreshold: 0.85, malConnected: true }),
      upsertEvent: () => event,
      setEventMatch: (_id: number, malAnimeId: number, matchedTitle: string, confidence: number) => {
        event = { ...event, malAnimeId, matchedTitle, confidence, status: 'ready' };
      },
      setEventStatus: (_id: number, status: WatchEvent['status']) => { event = { ...event, status }; },
      getEventBySourceKey: () => event,
      listEvents: () => [event],
      findMapping: () => null,
      rememberMapping: vi.fn(),
      touchLibraryActivity: vi.fn(),
      getLibraryAnime: () => null,
      upsertLibraryAnime: vi.fn(),
      updateLibraryProgress: vi.fn(),
    } as unknown as AppDatabase;
    const markWatching = vi.fn().mockResolvedValue(undefined);
    const mal = { updateEpisode: vi.fn(), markWatching, search: vi.fn() } as unknown as MalClient;
    const processor = new EventProcessor(db, mal, vi.fn());

    const stored = await processor.ingest({
      source: 'browser',
      sourceKey: event.sourceKey,
      title: event.title,
      episode: 1,
      progress: 0.5,
      detectedMalAnimeId: 30544,
      observedAt: new Date().toISOString(),
    });

    expect(stored).toMatchObject({ malAnimeId: 30544, status: 'watching' });
    await vi.waitFor(() => expect(markWatching).toHaveBeenCalledWith(30544));
    expect(mal.updateEpisode).not.toHaveBeenCalled();
  });

  it('marks a confirmed early match as watching without advancing an episode', async () => {
    let event: WatchEvent = {
      id: 2,
      source: 'plex',
      sourceKey: 'plex-client:episode-2',
      title: 'Example Anime',
      episode: 2,
      progress: 0.1,
      observedAt: new Date().toISOString(),
      status: 'needs_match',
      malAnimeId: null,
      matchedTitle: null,
      confidence: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
    };
    const db = {
      getSettings: () => ({ completionThreshold: 0.85, malConnected: true }),
      listEvents: () => [event],
      rememberMapping: vi.fn(),
      touchLibraryActivity: vi.fn(),
      getLibraryAnime: () => null,
      upsertLibraryAnime: vi.fn(),
      updateLibraryProgress: vi.fn(),
      setEventMatch: (_id: number, malAnimeId: number, matchedTitle: string, confidence: number) => {
        event = { ...event, malAnimeId, matchedTitle, confidence, status: 'ready' };
      },
      setEventStatus: (_id: number, status: WatchEvent['status']) => { event = { ...event, status }; },
    } as unknown as AppDatabase;
    const markWatching = vi.fn().mockResolvedValue(undefined);
    const updateEpisode = vi.fn();
    const processor = new EventProcessor(db, { markWatching, updateEpisode } as unknown as MalClient, vi.fn());

    await processor.confirmMatch(event.id, {
      id: 100,
      title: 'Example Anime',
      englishTitle: 'Example Anime',
      japaneseTitle: '例のアニメ',
      imageUrl: null,
      alternativeTitles: [],
      mediaType: 'tv',
      episodes: 12,
      score: 1,
    });

    expect(markWatching).toHaveBeenCalledWith(100);
    expect(updateEpisode).not.toHaveBeenCalled();
    expect(event.status).toBe('watching');
  });
});
