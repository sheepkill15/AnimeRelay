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

export function parseEpisode(...values: Array<string | null | undefined>): number | null {
  for (const value of values) {
    if (!value) continue;
    const patterns = [
      /\bS\d{1,2}E(\d{1,4})\b/i,
      /\b(?:episode|ep\.?)\s*[-:#]?\s*(\d{1,4})(?:\D|$)/i,
      /(?:^|[\s._-])E(\d{1,4})(?:\D|$)/i,
      /\s+-\s+(\d{1,4})(?:v\d+)?(?:\D|$)/i,
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

export function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
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
