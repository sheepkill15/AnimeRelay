import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function runContentScript(options: {
  url?: string;
  documentTitle?: string;
  heading?: string;
  activeEpisode?: { dataset: Record<string, string> } | null;
  watchMain?: { dataset: Record<string, string> } | null;
  runtimeInvalidated?: boolean;
  runtimeIdInvalidated?: boolean;
} = {}) {
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const listeners: Record<string, (event: unknown) => void> = {};
  let metadataReads = 0;
  const location = new URL(options.url ?? 'https://anikoto.cz/watch/the-asterisk-war-xgzuw/ep-1');
  const activeEpisode = options.activeEpisode === undefined ? { dataset: { num: '1', mal: '30544' } } : options.activeEpisode;
  const watchMain = options.watchMain === undefined ? { dataset: { epName: '1' } } : options.watchMain;
  const heading = { textContent: options.heading ?? 'The Asterisk War' };
  const document = {
    title: options.documentTitle ?? 'Watch The Asterisk War Episode 1 Anime English SUB/DUB - Anikoto',
    documentElement: {},
    pictureInPictureElement: null,
    querySelector(selector: string) {
      metadataReads += 1;
      if (selector === '#watch-main') return watchMain;
      if (selector === '.episodes a.active') return activeEpisode;
      if (selector === 'h1') return heading;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const windowObject: Record<string, unknown> = {
    addEventListener(name: string, listener: (event: unknown) => void) { listeners[name] = listener; },
  };
  windowObject.top = windowObject;
  const runtime = {
    sendMessage(message: { type: string; payload: Record<string, unknown> }) {
      if (options.runtimeInvalidated) throw new Error('Extension context invalidated.');
      sent.push(message);
    },
  } as { id?: string; sendMessage(message: { type: string; payload: Record<string, unknown> }): void };
  Object.defineProperty(runtime, 'id', {
    get() {
      if (options.runtimeIdInvalidated) throw new Error('Extension context invalidated.');
      return 'test-extension';
    },
  });
  const source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    chrome: { runtime },
    clearInterval() {},
    document,
    Element: class {},
    location,
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval() { return 1; },
    URL,
    WeakMap,
    window: windowObject,
  });
  return { sent, listeners, metadataReads };
}

describe('Anikoto content adapter', () => {
  it('uses the explicit title, episode, and MAL id from the page', () => {
    const { sent } = runContentScript();
    expect(sent[0]).toEqual({
      type: 'page-context',
      payload: {
        title: 'The Asterisk War',
        episode: 1,
        detectedMalAnimeId: 30544,
        url: 'https://anikoto.cz/watch/the-asterisk-war-xgzuw/ep-1',
      },
    });
  });

  it('converts Anikoto player messages into playback progress', () => {
    const { sent, listeners } = runContentScript();
    listeners.message({
      origin: 'https://megacloud.example',
      data: { channel: 'megacloud', event: 'time', time: 1200, duration: 1380 },
    });
    expect(sent[1].type).toBe('playback');
    expect(sent[1].payload).toMatchObject({
      title: 'The Asterisk War',
      episode: 1,
      detectedMalAnimeId: 30544,
      positionSeconds: 1200,
      durationSeconds: 1380,
      player: 'Embedded player · anikoto.cz',
    });
    expect(sent[1].payload.progress).toBeCloseTo(1200 / 1380);
  });

  it('ignores non-HTTPS synthetic player messages', () => {
    const { sent, listeners } = runContentScript();
    listeners.message({
      origin: 'null',
      data: { type: 'watching-log', currentTime: 1300, duration: 1380 },
    });
    expect(sent).toHaveLength(1);
  });
});

describe('generic embedded-player adapter', () => {
  it('tracks common timeupdate messages without a site-specific adapter', () => {
    const { sent, listeners } = runContentScript({
      url: 'https://anime-example.test/watch/some-show/ep-3',
      documentTitle: 'Watch Some Show Episode 3 - Anime Example',
      heading: 'Some Show',
      activeEpisode: null,
      watchMain: null,
    });
    listeners.message({
      origin: 'https://player-cdn.example',
      data: { event: 'timeupdate', currentTime: 1250, duration: 1400 },
    });
    expect(sent[1]).toMatchObject({
      type: 'playback',
      payload: {
        title: 'Some Show',
        episode: 3,
        progress: 1250 / 1400,
        player: 'Embedded player · anime-example.test',
      },
    });
  });

  it('stops quietly when Chrome invalidates a reloaded extension context', () => {
    expect(() => runContentScript({ runtimeInvalidated: true })).not.toThrow();
  });

  it('checks the extension context before reading page metadata', () => {
    const result = runContentScript({ runtimeIdInvalidated: true });
    expect(result.sent).toHaveLength(0);
    expect(result.metadataReads).toBe(0);
  });
});
