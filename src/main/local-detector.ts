import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppDatabase } from './database.js';
import { EventProcessor } from './event-processor.js';
import { normalizeTitle, parseEpisode } from './title-parser.js';

const execFileAsync = promisify(execFile);
const PLAYER_NAMES = new Set(['vlc', 'mpv', 'mpc-hc64', 'mpc-hc', 'potplayermini64', 'potplayermini']);

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
      const script = "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5_000 });
      const parsed = JSON.parse(stdout || '[]') as { ProcessName: string; MainWindowTitle: string } | Array<{ ProcessName: string; MainWindowTitle: string }>;
      const windows = Array.isArray(parsed) ? parsed : [parsed];
      for (const window of windows) {
        if (!PLAYER_NAMES.has(window.ProcessName.toLocaleLowerCase())) continue;
        const rawTitle = window.MainWindowTitle
          .replace(/\s+-\s+VLC media player$/i, '')
          .replace(/\s+-\s+mpv$/i, '')
          .replace(/\.(mkv|mp4|avi|webm)$/i, '');
        const episode = parseEpisode(rawTitle);
        const title = normalizeTitle(rawTitle.replace(/\b(?:episode|ep\.?)?\s*[-:#]?\s*\d{1,4}\b/i, ' '));
        if (!title || episode == null) continue;
        await this.processor.ingest({
          source: 'local',
          sourceKey: `local:${window.ProcessName}:${normalizeTitle(rawTitle)}`,
          title,
          episode,
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
