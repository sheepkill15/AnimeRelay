import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { AppDatabase } from '../src/main/database';

let db: AppDatabase | null = null;
afterEach(() => { db?.close(); db = null; });

describe('anime library storage', () => {
  it('creates a persistent show when an event is identified and enriches its metadata', () => {
    db = new AppDatabase(':memory:');
    const event = db.upsertEvent({
      source: 'browser',
      sourceKey: 'browser:test:episode-3',
      title: 'Test Anime',
      episode: 3,
      progress: 0.5,
      observedAt: '2026-08-19T10:00:00.000Z',
    }, 'watching');
    db.setEventMatch(event.id, 123, 'Test Anime', 1);
    db.upsertLibraryAnime({
      id: 123,
      title: 'Test Anime',
      englishTitle: 'Test Anime English',
      japaneseTitle: 'テストアニメ',
      imageUrl: 'https://api-cdn.myanimelist.net/test.jpg',
      alternativeTitles: [],
      mediaType: 'tv',
      episodes: 12,
      score: 1,
    });
    db.updateLibraryProgress(123, 2, 'watching');

    expect(db.listLibrary()).toEqual([expect.objectContaining({
      malAnimeId: 123,
      englishTitle: 'Test Anime English',
      japaneseTitle: 'テストアニメ',
      totalEpisodes: 12,
      watchedEpisodes: 2,
      listStatus: 'watching',
    })]);
  });
});
