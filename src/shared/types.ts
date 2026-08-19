export type WatchSource = 'browser' | 'plex' | 'local';
export type WatchEventStatus = 'watching' | 'ready' | 'synced' | 'needs_match' | 'ignored' | 'failed';

export interface WatchEventInput {
  source: WatchSource;
  sourceKey: string;
  title: string;
  episode: number | null;
  progress: number;
  durationSeconds?: number | null;
  positionSeconds?: number | null;
  url?: string | null;
  player?: string | null;
  detectedMalAnimeId?: number | null;
  observedAt: string;
}

export interface WatchEvent extends WatchEventInput {
  id: number;
  status: WatchEventStatus;
  malAnimeId: number | null;
  matchedTitle: string | null;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface AppSettings {
  completionThreshold: number;
  malClientId: string;
  malClientSecret: string;
  malConnected: boolean;
  malUsername: string | null;
  plexEnabled: boolean;
  localDetectionEnabled: boolean;
  discordEnabled: boolean;
  discordApplicationId: string;
  startWithWindows: boolean;
}

export interface DashboardSnapshot {
  events: WatchEvent[];
  settings: AppSettings;
  extensionConnected: boolean;
  pairingCode: string;
  bridgePort: number;
  plexStatus: PlexClientStatus;
  library: LibraryAnime[];
  discordStatus: DiscordStatus;
}

export interface PlexClientStatus {
  clientDetected: boolean;
  lastPlaybackAt: string | null;
  error: string | null;
}

export interface AnimeCandidate {
  id: number;
  title: string;
  englishTitle: string | null;
  japaneseTitle: string | null;
  imageUrl: string | null;
  alternativeTitles: string[];
  mediaType: string | null;
  episodes: number | null;
  score: number;
}

export interface LibraryAnime {
  malAnimeId: number;
  title: string;
  englishTitle: string | null;
  japaneseTitle: string | null;
  imageUrl: string | null;
  mediaType: string | null;
  totalEpisodes: number | null;
  watchedEpisodes: number;
  listStatus: string | null;
  lastActivityAt: string;
  detailsUpdatedAt: string | null;
}

export interface DiscordStatus {
  connected: boolean;
  error: string | null;
}
