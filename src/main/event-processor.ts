import type { AnimeCandidate, WatchEvent, WatchEventInput } from '../shared/types.js';
import { AppDatabase } from './database.js';
import { MalClient } from './mal-client.js';
import { normalizeTitle } from './title-parser.js';

export class EventProcessor {
  private readonly active = new Set<number>();
  private readonly pending = new Set<number>();
  private readonly markedWatching = new Set<number>();
  private readonly hydrating = new Set<number>();

  constructor(
    private readonly db: AppDatabase,
    private readonly mal: MalClient,
    private readonly onChange: () => void,
  ) {}

  async ingest(input: WatchEventInput): Promise<WatchEvent> {
    const threshold = this.db.getSettings().completionThreshold;
    const initialStatus = input.progress >= threshold ? 'ready' : 'watching';
    let event = this.db.upsertEvent(input, initialStatus);
    if (input.detectedMalAnimeId && event.malAnimeId !== input.detectedMalAnimeId) {
      this.db.setEventMatch(event.id, input.detectedMalAnimeId, input.title, 1);
      if (event.progress < threshold) this.db.setEventStatus(event.id, 'watching');
      event = this.db.getEventBySourceKey(input.sourceKey)!;
    }
    this.onChange();
    if (event.status !== 'synced' && event.status !== 'ignored') void this.process(event.id);
    return event;
  }

  async confirmMatch(eventId: number, candidate: AnimeCandidate): Promise<void> {
    const event = this.db.listEvents(500).find((item) => item.id === eventId);
    if (!event) throw new Error('Watch event not found.');
    this.db.rememberMapping(normalizeTitle(event.title), candidate.id, candidate.title);
    this.db.upsertLibraryAnime(candidate);
    this.db.setEventMatch(event.id, candidate.id, candidate.title, 1);
    this.onChange();
    await this.process(event.id);
  }

  async search(query: string): Promise<AnimeCandidate[]> {
    return this.mal.search(query);
  }

  async hydrateLibrary(): Promise<void> {
    if (!this.db.getSettings().malConnected) return;
    for (const anime of this.db.listLibrary()) await this.hydrateAnime(anime.malAnimeId, true);
  }

  private async process(eventId: number): Promise<void> {
    if (this.active.has(eventId)) {
      this.pending.add(eventId);
      return;
    }
    this.active.add(eventId);
    try {
      let event = this.db.listEvents(500).find((item) => item.id === eventId);
      if (!event || event.status === 'synced' || event.status === 'ignored') return;
      let animeId = event.malAnimeId;
      let matchedTitle = event.matchedTitle;
      let confidence = event.confidence ?? 0;
      let matchedCandidate: AnimeCandidate | null = null;
      if (!animeId) {
        const normalized = normalizeTitle(event.title);
        const remembered = this.db.findMapping(normalized);
        if (remembered) {
          animeId = remembered.malAnimeId;
          matchedTitle = remembered.matchedTitle;
          confidence = 1;
        } else if (event.status === 'needs_match') {
          return;
        } else {
          const candidates = await this.mal.search(event.title);
          const best = candidates[0];
          if (!best || best.score < 0.82) {
            this.db.setEventStatus(event.id, 'needs_match');
            return;
          }
          animeId = best.id;
          matchedTitle = best.title;
          confidence = best.score;
          matchedCandidate = best;
        }
        this.db.setEventMatch(event.id, animeId, matchedTitle!, confidence);
        const threshold = this.db.getSettings().completionThreshold;
        this.db.setEventStatus(event.id, event.progress >= threshold ? 'ready' : 'watching');
      }
      if (matchedCandidate) this.db.upsertLibraryAnime(matchedCandidate);
      this.db.touchLibraryActivity(animeId, matchedTitle!, event.observedAt);
      void this.hydrateAnime(animeId);
      this.db.rememberMapping(normalizeTitle(event.title), animeId, matchedTitle!);

      if (this.db.getSettings().malConnected && !this.markedWatching.has(animeId)) {
        await this.mal.markWatching(animeId);
        this.markedWatching.add(animeId);
        this.db.updateLibraryProgress(animeId, null, 'watching');
      }

      event = this.db.listEvents(500).find((item) => item.id === eventId);
      const threshold = this.db.getSettings().completionThreshold;
      if (!event) return;
      if (event.progress < threshold || event.episode == null) {
        if (event.status !== 'watching') this.db.setEventStatus(event.id, 'watching');
        return;
      }
      await this.mal.updateEpisode(animeId, event.episode);
      this.db.updateLibraryProgress(animeId, event.episode, 'watching');
      this.db.setEventStatus(event.id, 'synced');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.setEventStatus(eventId, message.includes('Connect MyAnimeList') ? 'ready' : 'failed', message);
    } finally {
      this.active.delete(eventId);
      this.onChange();
      if (this.pending.delete(eventId)) void this.process(eventId);
    }
  }

  private async hydrateAnime(animeId: number, force = false): Promise<void> {
    if (this.hydrating.has(animeId) || !this.db.getSettings().malConnected) return;
    const existing = this.db.getLibraryAnime(animeId);
    const detailsAge = existing?.detailsUpdatedAt ? Date.now() - new Date(existing.detailsUpdatedAt).getTime() : Number.POSITIVE_INFINITY;
    if (!force && detailsAge < 7 * 24 * 60 * 60_000) return;
    this.hydrating.add(animeId);
    try {
      this.db.upsertLibraryAnime(await this.mal.getAnimeDetails(animeId));
      this.onChange();
    } catch {
      // Metadata enrichment is optional; tracking continues with the matched title.
    } finally {
      this.hydrating.delete(animeId);
    }
  }
}
