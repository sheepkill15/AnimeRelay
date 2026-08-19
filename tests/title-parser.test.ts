import { describe, expect, it } from 'vitest';
import { normalizeTitle, parseEpisode, titleSimilarity } from '../src/main/title-parser';

describe('parseEpisode', () => {
  it.each([
    ['Frieren: Beyond Journey’s End Episode 12', 12],
    ['[SubsPlease] Sousou no Frieren - 24 (1080p).mkv', 24],
    ['Dan Da Dan S01E07', 7],
    ['/shows/dandadan/episode-9', 9],
  ])('extracts an episode from %s', (value, expected) => {
    expect(parseEpisode(value)).toBe(expected);
  });

  it('does not treat a year as an episode without an episode marker', () => {
    expect(parseEpisode('Best anime of 2026')).toBeNull();
  });
});

describe('normalizeTitle', () => {
  it('removes release metadata without losing the series name', () => {
    expect(normalizeTitle('[SubsPlease] Dungeon Meshi - 18 [1080p]')).toBe('dungeon meshi');
  });
});

describe('titleSimilarity', () => {
  it('strongly matches punctuation and case variants', () => {
    expect(titleSimilarity('DAN DA DAN', 'Dan Da Dan')).toBe(1);
  });

  it('does not confidently match unrelated titles', () => {
    expect(titleSimilarity('Monster', 'Frieren')).toBeLessThan(0.5);
  });
});
