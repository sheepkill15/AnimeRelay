import type { AnimeCandidate, AppSettings, DashboardSnapshot } from '../shared/types';

declare global {
  interface Window {
    animeRelay: {
      getSnapshot(): Promise<DashboardSnapshot>;
      updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
      connectMal(): Promise<void>;
      searchAnime(query: string): Promise<AnimeCandidate[]>;
      confirmEvent(eventId: number, candidate: AnimeCandidate): Promise<void>;
      ignoreEvent(eventId: number): Promise<void>;
      openExtensionFolder(): Promise<string>;
      openDiscordPortal(): Promise<void>;
      onSnapshot(listener: (snapshot: DashboardSnapshot) => void): () => void;
    };
  }
}

export {};
