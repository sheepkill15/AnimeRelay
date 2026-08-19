import { useEffect, useMemo, useState } from 'react';
import type { AnimeCandidate, AppSettings, DashboardSnapshot, LibraryAnime, WatchEvent, WatchEventStatus } from '../shared/types';

type View = 'activity' | 'library' | 'setup';

export function App() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [view, setView] = useState<View>('activity');
  const [resolveEvent, setResolveEvent] = useState<WatchEvent | null>(null);

  useEffect(() => {
    void window.animeRelay.getSnapshot().then(setSnapshot);
    return window.animeRelay.onSnapshot(setSnapshot);
  }, []);

  const needsAttention = useMemo(
    () => snapshot?.events.filter((event) => event.status === 'needs_match' || event.status === 'failed') ?? [],
    [snapshot],
  );

  if (!snapshot) return <div className="loading">Opening Anime Relay…</div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><LogoMark /><span>Anime Relay</span></div>
        <nav aria-label="Primary navigation">
          <button className={view === 'activity' ? 'nav-active' : ''} onClick={() => setView('activity')}>
            <ActivityIcon /> Activity {needsAttention.length > 0 && <span className="nav-count">{needsAttention.length}</span>}
          </button>
          <button className={view === 'library' ? 'nav-active' : ''} onClick={() => setView('library')}>
            <LibraryIcon /> Library
          </button>
          <button className={view === 'setup' ? 'nav-active' : ''} onClick={() => setView('setup')}>
            <SettingsIcon /> Connections
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="quiet-dot" /> Running in background
          <small>Closing this window keeps tracking.</small>
        </div>
      </aside>

      <main className="main-content">
        {view === 'activity' ? (
          <ActivityView snapshot={snapshot} onResolve={setResolveEvent} onSetup={() => setView('setup')} />
        ) : view === 'library' ? (
          <LibraryView snapshot={snapshot} />
        ) : (
          <SetupView snapshot={snapshot} onSnapshot={setSnapshot} />
        )}
      </main>

      {resolveEvent && <ResolveDialog event={resolveEvent} onClose={() => setResolveEvent(null)} />}
    </div>
  );
}

function ActivityView({ snapshot, onResolve, onSetup }: {
  snapshot: DashboardSnapshot;
  onResolve: (event: WatchEvent) => void;
  onSetup: () => void;
}) {
  const syncedToday = snapshot.events.filter((event) => event.status === 'synced' && isToday(event.updatedAt)).length;
  const events = combineEvents(snapshot.events);
  const libraryById = new Map(snapshot.library.map((anime) => [anime.malAnimeId, anime]));
  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">AUTOMATIC WATCH LOG</p><h1>Your episodes, accounted for.</h1></div>
        <div className="connection-pills">
          <StatusPill connected={snapshot.settings.malConnected} label={snapshot.settings.malUsername ? `MAL · ${snapshot.settings.malUsername}` : 'MyAnimeList'} />
          <StatusPill connected={snapshot.extensionConnected} label="Browser" />
          <StatusPill connected={snapshot.settings.plexEnabled && snapshot.plexStatus.clientDetected && !snapshot.plexStatus.error} label="Plex client" muted={!snapshot.settings.plexEnabled} />
        </div>
      </header>

      {!snapshot.settings.malConnected && (
        <section className="callout">
          <div className="callout-icon">↗</div>
          <div><strong>Connect MyAnimeList to begin syncing</strong><p>Detections are stored locally in the meantime, so nothing gets lost.</p></div>
          <button className="primary" onClick={onSetup}>Finish setup</button>
        </section>
      )}

      <section className="stat-grid">
        <article><span>Synced today</span><strong>{syncedToday}</strong><small>episodes</small></article>
        <article><span>Identified shows</span><strong>{snapshot.library.length}</strong><small>in your Anime Relay library</small></article>
        <article><span>Completion rule</span><strong>{Math.round(snapshot.settings.completionThreshold * 100)}%</strong><small>before MAL update</small></article>
      </section>

      <section className="activity-section">
        <div className="section-title"><div><h2>Recent activity</h2><p>One show timeline, regardless of where you watched.</p></div></div>
        {events.length === 0 ? (
          <div className="empty-state"><span>◌</span><h3>Waiting for your next episode</h3><p>Pair the browser extension or enable Plex. Detections will appear here as you watch.</p><button onClick={onSetup}>Set up a source</button></div>
        ) : (
          <div className="event-list">
            {events.map((event) => <EventRow key={`${event.malAnimeId ?? event.title}:${event.episode ?? event.id}`} event={event} anime={event.malAnimeId ? libraryById.get(event.malAnimeId) ?? null : null} onResolve={() => onResolve(event)} />)}
          </div>
        )}
      </section>
    </>
  );
}

function EventRow({ event, anime, onResolve }: { event: WatchEvent; anime: LibraryAnime | null; onResolve: () => void }) {
  const status = statusCopy(event);
  const title = anime?.englishTitle || anime?.title || event.matchedTitle || event.title;
  return (
    <article className="event-row">
      <ShowArtwork anime={anime} />
      <div className="event-main">
        <div className="event-heading"><strong>{title}</strong>{event.episode != null && <span>Episode {event.episode}</span>}</div>
        <div className="event-meta">{anime?.japaneseTitle && <><span lang="ja">{anime.japaneseTitle}</span><span>·</span></>}<span>{relativeTime(event.updatedAt)}</span></div>
        <div className="progress-track"><span style={{ width: `${Math.round(event.progress * 100)}%` }} /></div>
      </div>
      <div className={`event-status status-${event.status}`}><span />{status}</div>
      {(event.status === 'needs_match' || event.status === 'failed') && <button className="small-button" onClick={onResolve}>{event.status === 'failed' ? 'Review' : 'Match'}</button>}
    </article>
  );
}

function LibraryView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const activeByAnime = new Map<number, WatchEvent>();
  for (const event of combineEvents(snapshot.events)) {
    if (!event.malAnimeId || activeByAnime.has(event.malAnimeId)) continue;
    activeByAnime.set(event.malAnimeId, event);
  }
  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">YOUR LIBRARY</p><h1>Every show Anime Relay knows.</h1><p className="header-copy">Titles, artwork, and MAL progress are enriched automatically after a show is identified.</p></div>
      </header>
      {snapshot.library.length === 0 ? (
        <div className="empty-state"><span>◇</span><h3>No identified shows yet</h3><p>Your library fills itself as Anime Relay identifies activity.</p></div>
      ) : (
        <section className="library-grid">
          {snapshot.library.map((anime) => {
            const active = activeByAnime.get(anime.malAnimeId);
            const completion = anime.totalEpisodes ? Math.min(anime.watchedEpisodes / anime.totalEpisodes, 1) : 0;
            return <article className="library-card" key={anime.malAnimeId}>
              <ShowArtwork anime={anime} large />
              <div className="library-card-body">
                <div><h2>{anime.englishTitle || anime.title}</h2>{anime.japaneseTitle && <p lang="ja">{anime.japaneseTitle}</p>}</div>
                <div className="library-progress-copy"><strong>{anime.watchedEpisodes}</strong><span>{anime.totalEpisodes ? ` / ${anime.totalEpisodes} episodes` : ' episodes watched'}</span></div>
                <div className="library-progress"><span style={{ width: `${Math.round(completion * 100)}%` }} /></div>
                {active && active.status !== 'synced' && <p className="library-active">Episode {active.episode ?? '—'} currently {Math.round(active.progress * 100)}%</p>}
                <small>{anime.listStatus ? anime.listStatus.replaceAll('_', ' ') : 'Identified'} · Last activity {relativeTime(anime.lastActivityAt)}</small>
              </div>
            </article>;
          })}
        </section>
      )}
    </>
  );
}

function SetupView({ snapshot, onSnapshot }: { snapshot: DashboardSnapshot; onSnapshot: (value: DashboardSnapshot) => void }) {
  const [form, setForm] = useState(snapshot.settings);
  const [saved, setSaved] = useState(false);
  const [plexSaving, setPlexSaving] = useState(false);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    const settings = await window.animeRelay.updateSettings(form);
    onSnapshot({ ...snapshot, settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const connect = async () => {
    const settings = await window.animeRelay.updateSettings({ malClientId: form.malClientId, malClientSecret: form.malClientSecret });
    onSnapshot({ ...snapshot, settings });
    await window.animeRelay.connectMal();
  };
  const setPlexEnabled = async (enabled: boolean) => {
    update('plexEnabled', enabled);
    setPlexSaving(true);
    try {
      const settings = await window.animeRelay.updateSettings({ plexEnabled: enabled });
      setForm((current) => ({ ...current, plexEnabled: settings.plexEnabled }));
      onSnapshot({ ...snapshot, settings: { ...snapshot.settings, plexEnabled: settings.plexEnabled } });
    } finally {
      setPlexSaving(false);
    }
  };
  const plexState = !form.plexEnabled
    ? 'Optional'
    : snapshot.plexStatus.error
      ? 'Needs attention'
      : snapshot.plexStatus.clientDetected
        ? snapshot.plexStatus.lastPlaybackAt ? 'Playback detected' : 'Waiting for playback'
        : 'Client not found';

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">CONNECTIONS</p><h1>Teach it where you watch.</h1><p className="header-copy">Everything is processed on this computer. Only completed episode updates are sent to MyAnimeList.</p></div></header>
      <div className="setup-stack">
        <ConnectionCard number="01" title="MyAnimeList" state={snapshot.settings.malConnected ? `Connected as ${snapshot.settings.malUsername}` : 'Required'} connected={snapshot.settings.malConnected}>
          <p>Register a MAL API client using the callback URL below, then enter its credentials.</p>
          <code>http://127.0.0.1:{snapshot.bridgePort}/oauth/mal/callback</code>
          <div className="field-grid">
            <label><span>Client ID</span><input value={form.malClientId} onChange={(e) => update('malClientId', e.target.value)} placeholder="MyAnimeList client ID" /></label>
            <label><span>Client secret</span><input type="password" value={form.malClientSecret} onChange={(e) => update('malClientSecret', e.target.value)} placeholder="Stored with Windows encryption" /></label>
          </div>
          <button className="primary" disabled={!form.malClientId} onClick={() => void connect()}>{snapshot.settings.malConnected ? 'Reconnect account' : 'Connect MyAnimeList'}</button>
        </ConnectionCard>

        <ConnectionCard number="02" title="Browser extension" state={snapshot.extensionConnected ? 'Paired' : 'Waiting to pair'} connected={snapshot.extensionConnected}>
          <p>Load this durable extension folder once, then enter the code. Future Anime Relay updates keep both the folder and pairing code.</p>
          <div className="pairing-row"><div><span>PAIRING CODE</span><strong>{snapshot.pairingCode}</strong></div><button onClick={() => void window.animeRelay.openExtensionFolder()}>Open extension folder</button></div>
          <small>After an app update, use Reload on the browser's Extensions page and refresh any open streaming tabs.</small>
        </ConnectionCard>

        <ConnectionCard number="03" title="Plex" state={plexState} connected={form.plexEnabled && snapshot.plexStatus.clientDetected && !snapshot.plexStatus.error}>
          <div className="toggle-line"><div><p>Watch the local Plex for Windows client for anime playback.</p><small>Reads Plex's local playback log only. No server URL, server token, Plex Pass, or server-owner setup is needed.</small></div><Toggle checked={form.plexEnabled} disabled={plexSaving} onChange={(checked) => void setPlexEnabled(checked)} /></div>
          {form.plexEnabled && <p className={`source-feedback ${snapshot.plexStatus.error ? 'source-error' : ''}`}>{snapshot.plexStatus.error
            ? `Could not read Plex playback: ${snapshot.plexStatus.error}`
            : snapshot.plexStatus.clientDetected
              ? snapshot.plexStatus.lastPlaybackAt ? `Last playback detected ${relativeTime(snapshot.plexStatus.lastPlaybackAt)}.` : 'Plex for Windows was found. Start an episode; detection appears after the first playback progress update.'
              : 'Plex for Windows has not been detected on this computer.'}</p>}
        </ConnectionCard>

        <ConnectionCard number="04" title="Discord activity" state={snapshot.discordStatus.connected ? 'Connected' : form.discordEnabled ? 'Waiting for Discord' : 'Optional'} connected={snapshot.discordStatus.connected}>
          <div className="toggle-line"><div><p>Show the current anime, episode, progress, and remaining time on your Discord profile.</p><small>Requires Discord desktop and a Discord Developer Application ID. Disabled by default for privacy.</small></div><Toggle checked={form.discordEnabled} onChange={(checked) => update('discordEnabled', checked)} /></div>
          <div className="field-grid single-field"><label><span>Discord Application ID</span><input disabled={!form.discordEnabled} value={form.discordApplicationId} onChange={(e) => update('discordApplicationId', e.target.value.replace(/\D/g, ''))} placeholder="123456789012345678" /></label></div>
          <button onClick={() => void window.animeRelay.openDiscordPortal()}>Open Discord Developer Portal</button>
          {form.discordEnabled && snapshot.discordStatus.error && <p className="source-feedback source-error">{snapshot.discordStatus.error}</p>}
        </ConnectionCard>

        <ConnectionCard number="05" title="Local players" state={form.localDetectionEnabled ? 'Experimental' : 'Off'} connected={form.localDetectionEnabled}>
          <div className="toggle-line"><div><p>Detect VLC, mpv, MPC-HC, and PotPlayer window titles.</p><small>Detection works now; automatic completion requires a player integration and is intentionally not guessed.</small></div><Toggle checked={form.localDetectionEnabled} onChange={(checked) => update('localDetectionEnabled', checked)} /></div>
        </ConnectionCard>

        <ConnectionCard number="06" title="Windows startup" state={form.startWithWindows ? 'Starts minimized' : 'Off'} connected={form.startWithWindows}>
          <div className="toggle-line"><div><p>Start Anime Relay automatically when you sign in to Windows.</p><small>It opens directly in the system tray without showing the dashboard.</small></div><Toggle checked={form.startWithWindows} onChange={(checked) => update('startWithWindows', checked)} /></div>
        </ConnectionCard>

        <section className="preferences-card"><div><h3>Completion threshold</h3><p>Mark an episode watched after this percentage.</p></div><div className="range-control"><input type="range" min="70" max="95" step="1" value={Math.round(form.completionThreshold * 100)} onChange={(e) => update('completionThreshold', Number(e.target.value) / 100)} /><strong>{Math.round(form.completionThreshold * 100)}%</strong></div></section>
        <div className="save-row"><span className={saved ? 'save-confirm visible' : 'save-confirm'}>Saved</span><button className="primary" onClick={() => void save()}>Save connections</button></div>
      </div>
    </>
  );
}

function ConnectionCard({ number, title, state, connected, children }: { number: string; title: string; state: string; connected: boolean; children: React.ReactNode }) {
  return <section className="connection-card"><div className="card-head"><div className="step-number">{number}</div><h2>{title}</h2><span className={connected ? 'card-state connected' : 'card-state'}><i />{state}</span></div><div className="card-body">{children}</div></section>;
}

function ResolveDialog({ event, onClose }: { event: WatchEvent; onClose: () => void }) {
  const [query, setQuery] = useState(event.title);
  const [results, setResults] = useState<AnimeCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const search = async () => { setSearching(true); try { setResults(await window.animeRelay.searchAnime(query)); } finally { setSearching(false); } };
  useEffect(() => { void search(); }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="resolve-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <p className="eyebrow">CONFIRM ONCE, REMEMBER FOREVER</p><h2 id="resolve-title">Which anime is “{event.title}”?</h2><p>Future episodes using this title will match automatically.</p>
        <form className="search-row" onSubmit={(e) => { e.preventDefault(); void search(); }}><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} /><button>{searching ? 'Searching…' : 'Search'}</button></form>
        <div className="candidate-list">{results.map((candidate) => <button key={candidate.id} onClick={() => void window.animeRelay.confirmEvent(event.id, candidate).then(onClose)}><div><strong>{candidate.englishTitle || candidate.title}</strong>{candidate.japaneseTitle && <em lang="ja">{candidate.japaneseTitle}</em>}<span>{[candidate.mediaType?.replace('_', ' '), candidate.episodes ? `${candidate.episodes} eps` : null].filter(Boolean).join(' · ')}</span></div><b>{Math.round(candidate.score * 100)}%</b></button>)}</div>
        <button className="text-button" onClick={() => void window.animeRelay.ignoreEvent(event.id).then(onClose)}>Ignore this detection</button>
      </section>
    </div>
  );
}

function StatusPill({ connected, label, muted = false }: { connected: boolean; label: string; muted?: boolean }) { return <span className={`status-pill ${connected ? 'online' : ''} ${muted ? 'muted' : ''}`}><i />{label}</span>; }
function Toggle({ checked, disabled = false, onChange }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) { return <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>; }
function statusCopy(event: WatchEvent): string { return ({ watching: `${Math.round(event.progress * 100)}% watched`, ready: 'Ready to sync', synced: 'Synced', needs_match: 'Needs match', ignored: 'Ignored', failed: 'Sync failed' })[event.status]; }
function isToday(value: string): boolean { const date = new Date(value); const now = new Date(); return date.toDateString() === now.toDateString(); }
function relativeTime(value: string): string { const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000)); if (seconds < 60) return 'just now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`; return new Date(value).toLocaleDateString(); }
function ShowArtwork({ anime, large = false }: { anime: LibraryAnime | null; large?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [anime?.imageUrl]);
  const showImage = Boolean(anime?.imageUrl) && !imageFailed;
  return <div className={`show-artwork ${large ? 'show-artwork-large' : ''}`}>{showImage ? <img src={anime!.imageUrl!} alt="" onError={() => setImageFailed(true)} /> : <LogoMark />}</div>;
}
function combineEvents(events: WatchEvent[]): WatchEvent[] {
  const combined = new Map<string, WatchEvent>();
  for (const event of [...events].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())) {
    const titleKey = (event.matchedTitle || event.title).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-');
    const key = `${event.malAnimeId ? `mal:${event.malAnimeId}` : `title:${titleKey}`}:episode:${event.episode ?? 'unknown'}`;
    const existing = combined.get(key);
    if (!existing) {
      combined.set(key, { ...event });
      continue;
    }
    const preferredStatus = statusPriority(event.status) > statusPriority(existing.status) ? event.status : existing.status;
    combined.set(key, {
      ...existing,
      progress: Math.max(existing.progress, event.progress),
      positionSeconds: Math.max(existing.positionSeconds ?? 0, event.positionSeconds ?? 0),
      durationSeconds: existing.durationSeconds ?? event.durationSeconds,
      status: preferredStatus,
    });
  }
  return [...combined.values()];
}
function statusPriority(status: WatchEventStatus): number { return ({ ignored: 0, watching: 1, ready: 2, synced: 3, needs_match: 4, failed: 5 })[status]; }
function LogoMark() { return <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#8061f5"/><path d="M8.5 12.5a9 9 0 0 1 14.6-3.8M23.5 19.5a9 9 0 0 1-14.6 3.8" fill="none" stroke="#eee9ff" strokeWidth="2.3" strokeLinecap="round"/><path d="m21.8 6.6 3 .9-2.1 2.3M10.2 25.4l-3-.9 2.1-2.3" fill="none" stroke="#eee9ff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/><path d="m13 10.5 8.5 5.5-8.5 5.5Z" fill="#fff"/><circle cx="24" cy="22" r="3.8" fill="#b9ff66" stroke="#fff" strokeWidth="1.2"/><path d="m22.3 22 1.2 1.2 2.2-2.5" fill="none" stroke="#352064" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ActivityIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h3l2-5 4 10 2-5h3" /></svg>; }
function LibraryIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3.5h9.5A2.5 2.5 0 0 1 16 6v10.5H6.5A2.5 2.5 0 0 1 4 14V3.5Z"/><path d="M4 14a2.5 2.5 0 0 1 2.5-2.5H16"/></svg>; }
function SettingsIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3"/><path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.3 4.3l1.4 1.4m8.6 8.6 1.4 1.4m0-11.4-1.4 1.4m-8.6 8.6-1.4 1.4"/></svg>; }
