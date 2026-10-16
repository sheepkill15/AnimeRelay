import { describe, expect, it } from 'vitest';
import { normalizeTitle, parseEpisode, parseMediaTitle, titleSimilarity } from '../src/main/title-parser';

describe('parseEpisode', () => {
  it.each([
    ['Frieren: Beyond Journey’s End Episode 12', 12],
    ['[SubsPlease] Sousou no Frieren - 24 (1080p).mkv', 24],
    ['Dan Da Dan S01E07', 7],
    ['/shows/dandadan/episode-9', 9],
    ['101 - The Boy in the Iceberg', 101],
    ['05v2 - Rewatch', 5],
  ])('extracts an episode from %s', (value, expected) => {
    expect(parseEpisode(value)).toBe(expected);
  });

  it('does not treat a leading number as an episode without a separator', () => {
    expect(parseEpisode('5 Centimeters per Second')).toBeNull();
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

  it('ranks the original series above symbol-only sequels like Gintama°', () => {
    expect(titleSimilarity('gintama', 'Gintama')).toBe(1);
    expect(titleSimilarity('gintama', 'Gintama°')).toBeLessThan(1);
    expect(titleSimilarity('gintama', 'Gintama’')).toBeLessThan(1);
    expect(titleSimilarity('gintama', 'Gintama.')).toBeLessThan(1);
  });
});

describe('parseMediaTitle', () => {
  it.each([
    ['Yu-Gi-Oh! Duel Monsters - 001 - The Heart of the Cards', 'yu gi oh duel monsters', 1],
    ['Yu-Gi-Oh! Duel Monsters - 002 - The Gauntlet Is Thrown', 'yu gi oh duel monsters', 2],
    ['Avatar The Last Airbender S01E03 - The Southern Air Temple', 'avatar the last airbender', 3],
    ['[SubsPlease] Sousou no Frieren - 24 (1080p)', 'sousou no frieren', 24],
    ['Dan Da Dan Episode 7 - Title Here', 'dan da dan', 7],
  ])('keeps only the series name from %s', (value, series, episode) => {
    expect(parseMediaTitle(value)).toEqual({ series, episode });
  });

  it('reports no series for episode-first titles', () => {
    expect(parseMediaTitle('101 - The Boy in the Iceberg')).toEqual({ series: null, episode: 101 });
  });
});

describe('titleSimilarity punctuation', () => {
  it('matches punctuated MAL titles against normalized queries', () => {
    expect(titleSimilarity('yu gi oh', 'Yu-Gi-Oh!')).toBeGreaterThanOrEqual(0.82);
    expect(titleSimilarity('yu gi oh duel monsters', 'Yu☆Gi☆Oh! Duel Monsters')).toBeGreaterThanOrEqual(0.82);
  });
});
