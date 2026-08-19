import { describe, expect, it } from 'vitest';
import { parsePlexLogChunk } from '../src/main/plex-client-detector';

describe('Plex client log parsing', () => {
  it('extracts episode metadata and the latest local playback position', () => {
    const metadata = new Map();
    const queued = {
      decision: {
        metadataItem: {
          type: 'episode',
          ratingKey: '42',
          guid: 'plex://episode/example',
          grandparentTitle: 'Example Anime',
          index: 7,
          duration: 1_440_000,
        },
      },
      startPositionSeconds: 12,
    };
    const log = [
      `INFO - [Engine] Queue media: ${JSON.stringify(queued)}`,
      'DEBUG - timeline {',
      '  "ratingKey": "42",',
      '  "key": "/library/metadata/42",',
      '  "playbackTime": 1230000,',
      '  "state": "playing"',
      '  "time": 1380000',
      '}',
    ].join('\n');

    expect(parsePlexLogChunk(log, metadata)).toEqual([{
      ratingKey: '42',
      guid: 'plex://episode/example',
      title: 'Example Anime',
      episode: 7,
      durationMs: 1_440_000,
      positionMs: 1_380_000,
      state: 'playing',
    }]);
  });

  it('ignores movies and progress without known episode metadata', () => {
    const metadata = new Map();
    const movie = { decision: { metadataItem: { type: 'movie', ratingKey: '9', title: 'Movie', duration: 1000 } } };
    const log = `Queue media: ${JSON.stringify(movie)}\n"ratingKey":"404","playbackTime":900,"state":"playing","time":1200000`;
    expect(parsePlexLogChunk(log, metadata)).toEqual([]);
  });

  it('uses absolute media time instead of watchtime after resuming', () => {
    const metadata = new Map();
    const queued = {
      decision: { metadataItem: { type: 'episode', ratingKey: '8', grandparentTitle: 'Resume Anime', index: 2, duration: 1_440_000 } },
      startPositionSeconds: 1_200,
    };
    const log = [
      `Queue media: ${JSON.stringify(queued)}`,
      '"ratingKey":"8","playbackTime":17000,"state":"playing","time":1217000',
    ].join('\n');
    const [update] = parsePlexLogChunk(log, metadata);
    expect(update.positionMs).toBe(1_217_000);
    expect(update.positionMs / update.durationMs).toBeCloseTo(0.845, 2);
  });
});
