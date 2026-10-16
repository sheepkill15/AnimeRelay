const NOISE = [
  /\b(?:watch|stream|online|free|english|subbed|dubbed|episode|ep\.?|season)\b/gi,
  /\b(?:1080p|720p|480p|webrip|web-dl|bluray|x26[45]|hevc|aac)\b/gi,
  /\[[^\]]*]/g,
  /\([^)]*(?:sub|dub|1080|720|480)[^)]*\)/gi,
];

export function normalizeTitle(value: string): string {
  let title = value.normalize('NFKC');
  for (const pattern of NOISE) title = title.replace(pattern, ' ');
  return title.trim()
    .replace(/\b(?:s\d{1,2}e\d{1,4}|e\d{1,4})\b/gi, ' ')
    .replace(/[._|]+/g, ' ')
    .replace(/\s+-\s+(?:\d{1,4}|[^-]{0,20}(?:stream|anime).*?)$/i, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

// Like normalizeTitle, but keeps distinguishing symbols such as the "°" in
// "Gintama°" or the trailing "." in "Gintama." so sequel entries never score
// identically to the original series.
export function normalizeTitleExact(value: string): string {
  let title = value.normalize('NFKC');
  for (const pattern of NOISE) title = title.replace(pattern, ' ');
  return title.trim()
    .replace(/\b(?:s\d{1,2}e\d{1,4}|e\d{1,4})\b/gi, ' ')
    .replace(/(?<=\S)\.(?=\S)|\.{2,}(?=\S)/g, ' ')
    .replace(/[_|]+/g, ' ')
    .replace(/\s+-\s+(?:\d{1,4}|[^-]{0,20}(?:stream|anime).*?)$/i, ' ')
    .replace(/[()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:,;·]+|[\s\-–—:,;·]+$/g, '')
    .toLocaleLowerCase();
}

const EPISODE_PATTERNS = [
  /\bS\d{1,2}E(\d{1,4})\b/i,
  /\b(?:episode|ep\.?)\s*[-:#]?\s*(\d{1,4})(?:\D|$)/i,
  /(?:^|[\s._-])E(\d{1,4})(?:\D|$)/i,
  /\s+-\s+(\d{1,4})(?:v\d+)?(?:\D|$)/i,
  /^(\d{1,4})(?:v\d+)?\s*[-_.]\s*/,
];

export function parseEpisode(...values: Array<string | null | undefined>): number | null {
  for (const value of values) {
    if (!value) continue;
    for (const pattern of EPISODE_PATTERNS) {
      const match = value.match(pattern);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

// Splits a player window title or file name into the series name and episode.
// Everything after the episode marker is the episode title ("Show - 05 - Name"),
// so only the text before it identifies the series. Episode-first titles such as
// "101 - The Boy in the Iceberg" carry no series name at all.
export function parseMediaTitle(value: string): { series: string | null; episode: number | null } {
  for (const pattern of EPISODE_PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;
    return { series: normalizeTitle(value.slice(0, match.index)) || null, episode: Number(match[1]) };
  }
  return { series: null, episode: null };
}

export function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  // Punctuation-only differences ("Yu-Gi-Oh!" vs "yu gi oh") are still a match,
  // but rank just below an exact one so "Gintama" beats "Gintama°".
  if (a === b) return normalizeTitleExact(left) === normalizeTitleExact(right) ? 1 : 0.99;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.94;

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const tokenScore = union ? intersection / union : 0;
  const editScore = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return tokenScore * 0.65 + editScore * 0.35;
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
