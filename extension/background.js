const BRIDGE = 'http://127.0.0.1:3210';
const tabContexts = new Map();
const recentlySent = new Map();

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('health', { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'health') void checkHealth(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'page-context' && sender.tab?.id != null) {
    tabContexts.set(sender.tab.id, { ...message.payload, seenAt: Date.now() });
    return false;
  }
  if (message.type === 'playback') {
    void relayPlayback(message.payload, sender).then(sendResponse);
    return true;
  }
  if (message.type === 'pair') {
    void pair(message.code).then(sendResponse);
    return true;
  }
  if (message.type === 'status') {
    void getStatus().then(sendResponse);
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => tabContexts.delete(tabId));

async function pair(code) {
  try {
    const response = await fetch(`${BRIDGE}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: String(code).trim() }),
    });
    const payload = await response.json();
    if (!response.ok) return { ok: false, error: payload.error || 'Pairing failed.' };
    await chrome.storage.local.set({ bridgeToken: payload.token });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Anime Relay is not running.' };
  }
}

async function relayPlayback(payload, sender) {
  const { bridgeToken } = await chrome.storage.local.get('bridgeToken');
  if (!bridgeToken) return { ok: false, error: 'not_paired' };
  const context = sender.tab?.id != null ? tabContexts.get(sender.tab.id) : null;
  const merged = mergeContext(payload, context, sender.frameId === 0);
  if (!merged.title) return { ok: false, error: 'no_title' };

  const dedupeKey = `${merged.sourceKey}:${Math.floor(merged.progress * 20)}`;
  if (Date.now() - (recentlySent.get(dedupeKey) ?? 0) < 30_000) return { ok: true, deduped: true };
  recentlySent.set(dedupeKey, Date.now());
  for (const [key, timestamp] of recentlySent) if (Date.now() - timestamp > 10 * 60_000) recentlySent.delete(key);

  try {
    const response = await fetch(`${BRIDGE}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bridgeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    });
    if (response.status === 401) await chrome.storage.local.remove('bridgeToken');
    return { ok: response.ok };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

function mergeContext(playback, context, fromTopFrame = false) {
  // Top-frame playback already carries the newest SPA metadata. Cached tab
  // context is only needed to enrich videos running inside a player iframe.
  const contextFresh = !fromTopFrame && context && Date.now() - context.seenAt < 30 * 60_000;
  const title = contextFresh && context.title ? context.title : playback.title;
  const episode = contextFresh && context.episode != null ? context.episode : playback.episode;
  const detectedMalAnimeId = contextFresh && context.detectedMalAnimeId != null
    ? context.detectedMalAnimeId
    : playback.detectedMalAnimeId;
  const url = contextFresh && context.url ? context.url : playback.url;
  const keyTitle = String(title || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 160);
  return {
    ...playback,
    title,
    episode,
    detectedMalAnimeId,
    url,
    sourceKey: `browser:${new URL(url).hostname}:${keyTitle}:${episode ?? new URL(url).pathname}`.slice(0, 500),
  };
}

async function getStatus() {
  const { bridgeToken } = await chrome.storage.local.get('bridgeToken');
  if (!bridgeToken) return { paired: false, reachable: false };
  try {
    const response = await fetch(`${BRIDGE}/api/health`, { headers: { Authorization: `Bearer ${bridgeToken}` } });
    if (response.status === 401) await chrome.storage.local.remove('bridgeToken');
    return { paired: response.ok, reachable: true };
  } catch {
    return { paired: true, reachable: false };
  }
}

async function checkHealth() { await getStatus(); }
