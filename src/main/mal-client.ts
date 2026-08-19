import { randomBytes } from 'node:crypto';
import type { AnimeCandidate, LibraryAnime } from '../shared/types.js';
import { AppDatabase } from './database.js';
import { titleSimilarity } from './title-parser.js';

const API_ROOT = 'https://api.myanimelist.net/v2';
const OAUTH_ROOT = 'https://myanimelist.net/v1/oauth2';

interface TokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
}

export class MalClient {
  private pendingVerifier = '';

  constructor(private readonly db: AppDatabase, private readonly redirectUri: string) {}

  createAuthorizationUrl(): string {
    const settings = this.db.getSettings();
    if (!settings.malClientId) throw new Error('Enter a MyAnimeList client ID first.');
    this.pendingVerifier = randomBytes(72).toString('base64url').slice(0, 96);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: settings.malClientId,
      code_challenge: this.pendingVerifier,
      code_challenge_method: 'plain',
      redirect_uri: this.redirectUri,
    });
    return `${OAUTH_ROOT}/authorize?${params}`;
  }

  async completeAuthorization(code: string): Promise<void> {
    if (!this.pendingVerifier) throw new Error('No MyAnimeList authorization is pending.');
    const settings = this.db.getSettings();
    const body = new URLSearchParams({
      client_id: settings.malClientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      code_verifier: this.pendingVerifier,
    });
    if (settings.malClientSecret) body.set('client_secret', settings.malClientSecret);
    const response = await fetch(`${OAUTH_ROOT}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error(`MyAnimeList authorization failed (${response.status}).`);
    const tokens = await response.json() as TokenResponse;
    this.saveTokens(tokens);
    this.pendingVerifier = '';
    const profile = await this.request<{ name: string }>('/users/@me');
    this.db.setSetting('malUsername', profile.name);
  }

  async search(query: string): Promise<AnimeCandidate[]> {
    const settings = this.db.getSettings();
    if (!settings.malClientId) return [];
    const params = new URLSearchParams({ q: query, limit: '10', fields: 'alternative_titles,main_picture,media_type,num_episodes' });
    const response = await fetch(`${API_ROOT}/anime?${params}`, {
      headers: { 'X-MAL-CLIENT-ID': settings.malClientId },
    });
    if (!response.ok) throw new Error(`Anime search failed (${response.status}).`);
    const payload = await response.json() as {
      data: Array<{ node: { id: number; title: string; alternative_titles?: { synonyms?: string[]; en?: string; ja?: string }; main_picture?: { medium?: string; large?: string }; media_type?: string; num_episodes?: number } }>;
    };
    return payload.data.map(({ node }) => {
      const alternatives = [node.alternative_titles?.en, node.alternative_titles?.ja, ...(node.alternative_titles?.synonyms ?? [])]
        .filter((value): value is string => Boolean(value));
      const score = Math.max(titleSimilarity(query, node.title), ...alternatives.map((title) => titleSimilarity(query, title)));
      return {
        id: node.id,
        title: node.title,
        englishTitle: node.alternative_titles?.en ?? null,
        japaneseTitle: node.alternative_titles?.ja ?? null,
        imageUrl: node.main_picture?.medium ?? node.main_picture?.large ?? null,
        alternativeTitles: alternatives,
        mediaType: node.media_type ?? null,
        episodes: node.num_episodes ?? null,
        score,
      };
    }).sort((a, b) => b.score - a.score);
  }

  async getAnimeDetails(animeId: number): Promise<LibraryAnime> {
    const anime = await this.request<{
      id: number;
      title: string;
      alternative_titles?: { en?: string; ja?: string };
      main_picture?: { medium?: string; large?: string };
      media_type?: string;
      num_episodes?: number;
      my_list_status?: { status?: string; num_episodes_watched?: number; updated_at?: string };
    }>(`/anime/${animeId}?fields=alternative_titles,main_picture,media_type,num_episodes,my_list_status`);
    return {
      malAnimeId: anime.id,
      title: anime.title,
      englishTitle: anime.alternative_titles?.en ?? null,
      japaneseTitle: anime.alternative_titles?.ja ?? null,
      imageUrl: anime.main_picture?.medium ?? anime.main_picture?.large ?? null,
      mediaType: anime.media_type ?? null,
      totalEpisodes: anime.num_episodes || null,
      watchedEpisodes: anime.my_list_status?.num_episodes_watched ?? 0,
      listStatus: anime.my_list_status?.status ?? null,
      lastActivityAt: anime.my_list_status?.updated_at ?? new Date().toISOString(),
      detailsUpdatedAt: new Date().toISOString(),
    };
  }

  async updateEpisode(animeId: number, episode: number): Promise<'updated' | 'already_ahead'> {
    const anime = await this.request<{ my_list_status?: { num_episodes_watched: number } }>(`/anime/${animeId}?fields=my_list_status`);
    const current = anime.my_list_status?.num_episodes_watched ?? 0;
    if (current >= episode) return 'already_ahead';
    const body = new URLSearchParams({ status: 'watching', num_watched_episodes: String(episode) });
    await this.request(`/anime/${animeId}/my_list_status`, { method: 'PUT', body });
    return 'updated';
  }

  async markWatching(animeId: number): Promise<void> {
    const body = new URLSearchParams({ status: 'watching' });
    await this.request(`/anime/${animeId}/my_list_status`, { method: 'PUT', body });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let accessToken = this.db.getSetting('malAccessToken');
    if (!accessToken) throw new Error('Connect MyAnimeList first.');
    let response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...init.headers },
    });
    if (response.status === 401 && this.db.getSetting('malRefreshToken')) {
      await this.refresh();
      accessToken = this.db.getSetting('malAccessToken');
      response = await fetch(`${API_ROOT}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...init.headers },
      });
    }
    if (!response.ok) throw new Error(`MyAnimeList request failed (${response.status}).`);
    return await response.json() as T;
  }

  private async refresh(): Promise<void> {
    const settings = this.db.getSettings();
    const body = new URLSearchParams({
      client_id: settings.malClientId,
      grant_type: 'refresh_token',
      refresh_token: this.db.getSetting('malRefreshToken'),
    });
    if (settings.malClientSecret) body.set('client_secret', settings.malClientSecret);
    const response = await fetch(`${OAUTH_ROOT}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error('MyAnimeList session expired. Please reconnect.');
    this.saveTokens(await response.json() as TokenResponse);
  }

  private saveTokens(tokens: TokenResponse): void {
    this.db.setSetting('malAccessToken', tokens.access_token);
    this.db.setSetting('malRefreshToken', tokens.refresh_token);
  }
}
