import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isYoutubeUrl } from '../src/main/source-policy';

describe('browser source policy', () => {
  it.each([
    'https://youtube.com/watch?v=abc',
    'https://www.youtube.com/watch?v=abc',
    'https://music.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://www.youtube-nocookie.com/embed/abc',
  ])('hard-rejects YouTube URL %s', (url) => {
    expect(isYoutubeUrl(url)).toBe(true);
  });

  it('does not reject unrelated streaming sites', () => {
    expect(isYoutubeUrl('https://anikoto.cz/watch/show/ep-1')).toBe(false);
  });

  it('prevents the content script from loading on YouTube', () => {
    const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
    expect(manifest.content_scripts[0].exclude_matches).toEqual(expect.arrayContaining([
      '*://youtube.com/*',
      '*://*.youtube.com/*',
      '*://youtu.be/*',
      '*://*.youtube-nocookie.com/*',
    ]));
  });
});
