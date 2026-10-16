import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AppDatabase } from './database.js';
import { EventProcessor } from './event-processor.js';
import { normalizeTitle, parseMediaTitle } from './title-parser.js';

const execFileAsync = promisify(execFile);
const PLAYER_NAMES = ['vlc', 'mpv', 'mpc-hc64', 'mpc-hc', 'potplayermini64', 'potplayermini'];
const VIDEO_EXTENSION = /\.(mkv|mp4|avi|webm|m4v|mov|wmv|ts)$/i;
const SEASON_FOLDER = /^(?:season|series|book|part|cour|s)\s*[-_.]?\s*(\d{1,2})\b/i;
const IGNORED_FOLDER = /^(?:specials?|extras?|featurettes|(?:disc|cd|dvd)\s*\d+)$/i;
const GENERIC_FOLDER = /^(?:anime|tv|tv shows|shows|series|videos|movies|downloads|desktop|media|completed|torrents|[a-z]:?)$/i;

interface PlayerWindow {
  ProcessName: string;
  MainWindowTitle: string;
  CommandLine?: string | null;
}

export interface LocalMedia {
  title: string;
  episode: number;
}

export class LocalDetector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly db: AppDatabase, private readonly processor: EventProcessor) {}

  start(): void {
    if (this.timer || process.platform !== 'win32') return;
    this.timer = setInterval(() => void this.scan(), 10_000);
    void this.scan();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async scan(): Promise<void> {
    if (!this.db.getSettings().localDetectionEnabled || this.running) return;
    this.running = true;
    try {
      const script = `$players = ${PLAYER_NAMES.map((name) => `'${name}'`).join(',')}; `
        + 'Get-Process | Where-Object { $_.MainWindowTitle -and $players -contains $_.ProcessName } | '
        + 'ForEach-Object { [pscustomobject]@{ ProcessName = $_.ProcessName; MainWindowTitle = $_.MainWindowTitle; '
        + 'CommandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine } } | ConvertTo-Json -Compress';
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5_000 });
      const parsed = JSON.parse(stdout || '[]') as PlayerWindow | PlayerWindow[];
      const windows = Array.isArray(parsed) ? parsed : [parsed];
      for (const window of windows) {
        const rawTitle = stripPlayerSuffix(window.MainWindowTitle);
        const hints = [...parseCommandLinePaths(window.CommandLine ?? '')];
        if (window.ProcessName.toLocaleLowerCase() === 'vlc') hints.push(...await readVlcRecents());
        const media = await resolveLocalMedia(rawTitle, hints);
        if (!media) continue;
        await this.processor.ingest({
          source: 'local',
          sourceKey: `local:${window.ProcessName}:${normalizeTitle(rawTitle)}`,
          title: media.title,
          episode: media.episode,
          progress: 0,
          player: window.ProcessName,
          observedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Window-title detection is best effort; unsupported players remain silent.
    } finally {
      this.running = false;
    }
  }
}

export function stripPlayerSuffix(windowTitle: string): string {
  return windowTitle
    .replace(/\s+-\s+VLC media player$/i, '')
    .replace(/\s+-\s+mpv$/i, '')
    .replace(VIDEO_EXTENSION, '');
}

// Works out the series and episode for a player window. The window title alone
// is used when it names the series ("Show - 05 - Episode Name"); episode-first
// titles ("101 - The Boy in the Iceberg") are looked up on disk so the series
// comes from the containing folder instead of the episode name.
export async function resolveLocalMedia(rawTitle: string, pathHints: string[]): Promise<LocalMedia | null> {
  const fromTitle = parseMediaTitle(rawTitle);
  if (fromTitle.episode == null) return null;
  if (fromTitle.series) return { title: fromTitle.series, episode: fromTitle.episode };

  const file = await findPlayingFile(rawTitle, pathHints);
  const folder = file ? seriesFromPath(file) : null;
  if (!folder) return null;
  let episode = fromTitle.episode;
  // "Book 1/101 - ..." style numbering encodes the season in the hundreds.
  if (folder.season != null && episode >= 100 && Math.floor(episode / 100) === folder.season) episode %= 100;
  return { title: folder.series, episode };
}

export function seriesFromPath(filePath: string): { series: string; season: number | null } | null {
  let season: number | null = null;
  let directory = path.dirname(filePath);
  for (let depth = 0; depth < 4; depth += 1) {
    const name = path.basename(directory);
    if (!name || directory === path.dirname(directory)) return null;
    const seasonMatch = name.match(SEASON_FOLDER);
    if (seasonMatch || IGNORED_FOLDER.test(name)) {
      if (seasonMatch && season == null) season = Number(seasonMatch[1]);
      directory = path.dirname(directory);
      continue;
    }
    if (GENERIC_FOLDER.test(name)) return null;
    const series = normalizeTitle(name.replace(/\((?:19|20)\d{2}\)/g, ' '));
    return series ? { series, season } : null;
  }
  return null;
}

export function parseCommandLinePaths(commandLine: string): string[] {
  const paths: string[] = [];
  for (const match of commandLine.matchAll(/"([^"]+)"|(\S+)/g)) {
    const token = match[1] ?? match[2];
    if (/^file:\/\//i.test(token)) {
      try { paths.push(fileURLToPath(token)); } catch { /* malformed URI */ }
    } else if (/^[a-z]:[\\/]|^\\\\/i.test(token) && !/\.exe$/i.test(token)) {
      paths.push(token);
    }
  }
  return paths;
}

async function readVlcRecents(): Promise<string[]> {
  if (!process.env.APPDATA) return [];
  try {
    const ini = await readFile(path.join(process.env.APPDATA, 'vlc', 'vlc-qt-interface.ini'), 'utf8');
    const list = ini.match(/^\[RecentsMRL]\s*[\s\S]*?^list=(.*)$/m)?.[1] ?? '';
    return list.split(/,\s*/).flatMap((uri) => {
      try { return [fileURLToPath(uri.trim())]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

async function findPlayingFile(rawTitle: string, hints: string[]): Promise<string | null> {
  const wanted = rawTitle.toLocaleLowerCase();
  const matches = (file: string) => path.basename(file).replace(VIDEO_EXTENSION, '').toLocaleLowerCase() === wanted;
  const directories = new Set<string>();
  for (const hint of hints) {
    const info = await stat(hint).catch(() => null);
    if (!info) continue;
    if (info.isFile()) {
      if (matches(hint)) return hint;
      directories.add(path.dirname(hint));
    } else if (info.isDirectory()) {
      directories.add(hint);
    }
  }
  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isFile() && matches(full)) return full;
    }
    // A folder opened directly (or a sibling season) may hold the file one level down.
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = await readdir(path.join(directory, entry.name)).catch(() => []);
      const name = nested.find((item) => matches(item));
      if (name) return path.join(directory, entry.name, name);
    }
  }
  return null;
}
