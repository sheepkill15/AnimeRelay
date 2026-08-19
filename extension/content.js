const MINIMUM_DURATION = 4 * 60;
const sentForVideo = new WeakMap();
let lastSiteProgress = 0;
let lastSitePosition = 0;
let lastSiteDuration = 0;
let lastSiteIdentity = '';
let lastSiteReportedIdentity = '';
let lastContextIdentity = '';
let lastKnownUrl = location.href;
let extensionContextActive = true;
let contextTimer = null;
let navigationTimer = null;
let videoObserver = null;

function deactivateExtensionContext() {
  extensionContextActive = false;
  if (contextTimer != null) clearInterval(contextTimer);
  if (navigationTimer != null) clearInterval(navigationTimer);
  videoObserver?.disconnect();
}

function handleMessagingError(error) {
  if (/extension context invalidated/i.test(String(error?.message || error || ''))) deactivateExtensionContext();
}

function hasValidExtensionContext() {
  if (!extensionContextActive) return false;
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      deactivateExtensionContext();
      return false;
    }
    return true;
  } catch (error) {
    handleMessagingError(error);
    return false;
  }
}

function safeSendMessage(message) {
  if (!hasValidExtensionContext()) return false;
  try {
    const pending = chrome.runtime.sendMessage(message);
    if (pending && typeof pending.catch === 'function') void pending.catch(handleMessagingError);
    return true;
  } catch (error) {
    handleMessagingError(error);
    return false;
  }
}

function pageContext() {
  const adapted = siteContext();
  if (adapted) return adapted;
  const candidates = collectTitleCandidates();
  const preferredTitle = document.querySelector('[data-anime-title]')?.getAttribute('data-anime-title')
    || document.querySelector('h1')?.textContent
    || document.querySelector('[itemprop="name"]')?.textContent;
  const rawTitle = preferredTitle || candidates[0] || document.title;
  const detectedMalAnimeId = readDetectedMalAnimeId();
  return {
    title: cleanTitle(rawTitle),
    episode: parseEpisode(...candidates, location.pathname),
    detectedMalAnimeId,
    url: location.href,
  };
}

function readDetectedMalAnimeId() {
  const element = document.querySelector('[data-mal].active, [data-mal-id].active, [data-mal], [data-mal-id]');
  const value = Number(element?.getAttribute('data-mal') || element?.getAttribute('data-mal-id') || 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function siteContext() {
  if (!(location.hostname === 'anikoto.cz' || location.hostname.endsWith('.anikoto.cz'))) return null;
  const watchMain = document.querySelector('#watch-main');
  const activeEpisode = document.querySelector('.episodes a.active');
  const title = document.querySelector('h1')?.textContent?.trim();
  const episode = Number(activeEpisode?.dataset.num || watchMain?.dataset.epName || parseEpisode(location.pathname));
  const detectedMalAnimeId = Number(activeEpisode?.dataset.mal || 0);
  if (!title || !Number.isInteger(episode) || episode < 1) return null;
  return {
    title,
    episode,
    detectedMalAnimeId: detectedMalAnimeId > 0 ? detectedMalAnimeId : null,
    url: location.href,
  };
}

function collectTitleCandidates() {
  const values = [];
  const add = (value) => { if (value && typeof value === 'string' && !values.includes(value.trim())) values.push(value.trim()); };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent || '{}');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) { add(item.name); add(item.headline); add(item.partOfSeries?.name); }
    } catch { /* Ignore invalid publisher metadata. */ }
  }
  add(document.querySelector('meta[property="og:title"]')?.content);
  add(document.querySelector('meta[name="twitter:title"]')?.content);
  add(document.querySelector('[itemprop="name"]')?.textContent);
  add(document.querySelector('h1')?.textContent);
  add(document.title);
  return values;
}

function parseEpisode(...values) {
  const patterns = [
    /\bS\d{1,2}E(\d{1,4})\b/i,
    /\b(?:episode|ep\.?)\s*[-:#]?\s*(\d{1,4})(?:\D|$)/i,
    /(?:^|[\s._-])E(\d{1,4})(?:\D|$)/i,
    /\/episode[-_/]?(\d{1,4})(?:\D|$)/i,
    /\s+-\s+(\d{1,4})(?:v\d+)?(?:\D|$)/i,
  ];
  for (const value of values) for (const pattern of patterns) {
    const match = String(value || '').match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function cleanTitle(value) {
  const hostBrand = location.hostname.replace(/^www\./, '').split('.')[0];
  const escapedBrand = hostBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(value || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\b(?:watch|stream)\s+(?:anime\s+)?(?:online\s+)?/gi, ' ')
    .replace(/\b(?:episode|ep\.?)\s*[-:#]?\s*\d{1,4}\b/gi, ' ')
    .replace(/\b(?:anime\s+)?english\s+(?:sub(?:bed)?|dub(?:bed)?)(?:\s*\/\s*(?:sub(?:bed)?|dub(?:bed)?))?\b/gi, ' ')
    .replace(new RegExp(`\\s*[-|–—]\\s*${escapedBrand}\\s*$`, 'i'), ' ')
    .replace(/\s+[|–—]\s+[^|–—]*(?:anime|stream|watch)[^|–—]*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contextIdentity(context) {
  return [context.url, context.detectedMalAnimeId || '', context.title || '', context.episode || ''].join('|');
}

function resetSitePlayback(identity) {
  if (lastSiteIdentity === identity) return;
  lastSiteIdentity = identity;
  lastSiteProgress = 0;
  lastSitePosition = 0;
  lastSiteDuration = 0;
}

function reportContext(force = false) {
  if (!hasValidExtensionContext()) return;
  if (window.top !== window) return;
  const context = pageContext();
  const identity = contextIdentity(context);
  resetSitePlayback(identity);
  lastKnownUrl = location.href;
  if (!force && identity === lastContextIdentity) return;
  lastContextIdentity = identity;
  safeSendMessage({ type: 'page-context', payload: context });
}

function detectPageTransition() {
  if (!hasValidExtensionContext() || window.top !== window) return;
  if (location.href !== lastKnownUrl) reportContext();
  else {
    // Some players switch the active episode before or without changing the URL.
    const context = pageContext();
    if (contextIdentity(context) !== lastContextIdentity) reportContext();
  }
}

function observeClientNavigation() {
  if (window.top !== window) return;
  if (typeof history === 'undefined') return;
  for (const method of ['pushState', 'replaceState']) {
    if (typeof history?.[method] !== 'function') continue;
    const original = history[method].bind(history);
    history[method] = (...args) => {
      const result = original(...args);
      setTimeout(detectPageTransition, 0);
      return result;
    };
  }
  window.addEventListener('popstate', detectPageTransition, { passive: true });
  window.addEventListener('hashchange', detectPageTransition, { passive: true });
}

function reportSitePlayback(positionSeconds, durationSeconds, forceComplete = false) {
  if (!hasValidExtensionContext()) return;
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds) || durationSeconds < MINIMUM_DURATION) return;
  const context = pageContext();
  if (!context.title || context.episode == null) return;
  const identity = contextIdentity(context);
  resetSitePlayback(identity);
  lastSitePosition = positionSeconds;
  lastSiteDuration = durationSeconds;
  const progress = forceComplete ? 1 : Math.min(Math.max(positionSeconds / durationSeconds, 0), 1);
  const firstReportForEpisode = lastSiteReportedIdentity !== identity;
  if (!forceComplete && !firstReportForEpisode && progress - lastSiteProgress < 0.025) return;
  lastSiteProgress = progress;
  lastSiteReportedIdentity = identity;
  safeSendMessage({ type: 'playback', payload: {
    sourceKey: '',
    title: context.title,
    episode: context.episode,
    detectedMalAnimeId: context.detectedMalAnimeId,
    progress,
    durationSeconds,
    positionSeconds,
    url: context.url,
    player: `Embedded player · ${location.hostname}`,
    observedAt: new Date().toISOString(),
  }});
}

function observeSitePlayerMessages() {
  if (window.top !== window) return;
  window.addEventListener('message', (event) => {
    if (!hasValidExtensionContext()) return;
    if (!String(event.origin || '').startsWith('https://')) return;
    let message = event.data;
    if (typeof message === 'string') {
      try { message = JSON.parse(message); } catch { return; }
    }
    if (!message || typeof message !== 'object') return;
    const messageType = String(message.type || message.event || '').toLocaleLowerCase();
    const isKnownTimeEvent = message.type === 'watching-log'
      || (message.channel === 'megacloud' && message.event === 'time')
      || ['time', 'timeupdate', 'progress', 'player:time'].includes(messageType);
    if (isKnownTimeEvent) {
      reportSitePlayback(
        Number(message.currentTime ?? message.time ?? message.position),
        Number(message.duration ?? message.total),
      );
      return;
    }
    if ((message.event === 'complete' || message.type === 'complete') && lastSiteProgress >= 0.75) {
      reportSitePlayback(lastSitePosition, lastSiteDuration, true);
    }
  });
}

function observeVideo(video) {
  if (sentForVideo.has(video)) return;
  sentForVideo.set(video, { identity: '', progress: 0 });
  const report = (force = false) => {
    if (!hasValidExtensionContext()) return;
    if (!Number.isFinite(video.duration) || video.duration < MINIMUM_DURATION || video.currentTime < 1) return;
    const context = pageContext();
    const identity = contextIdentity(context);
    const progress = video.ended ? 1 : Math.min(video.currentTime / video.duration, 1);
    const previous = sentForVideo.get(video) || { identity: '', progress: 0 };
    const lastProgress = previous.identity === identity ? previous.progress : 0;
    if (!force && previous.identity === identity && progress - lastProgress < 0.025) return;
    sentForVideo.set(video, { identity, progress });
    safeSendMessage({ type: 'playback', payload: {
      sourceKey: '',
      title: context.title,
      episode: context.episode,
      detectedMalAnimeId: context.detectedMalAnimeId,
      progress,
      durationSeconds: video.duration,
      positionSeconds: video.currentTime,
      url: location.href,
      player: document.pictureInPictureElement === video ? 'Browser · Picture in Picture' : 'Browser',
      observedAt: new Date().toISOString(),
    }});
  };
  video.addEventListener('timeupdate', () => report(false), { passive: true });
  video.addEventListener('ended', () => report(true), { passive: true });
}

function discoverVideos(root = document) { root.querySelectorAll('video').forEach(observeVideo); }

reportContext(true);
observeClientNavigation();
observeSitePlayerMessages();
discoverVideos();
videoObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) for (const node of mutation.addedNodes) {
    if (!(node instanceof Element)) continue;
    if (node.matches('video')) observeVideo(node);
    discoverVideos(node);
  }
});
videoObserver.observe(document.documentElement, { subtree: true, childList: true });
contextTimer = setInterval(() => reportContext(true), 30_000);
navigationTimer = setInterval(detectPageTransition, 1_000);
