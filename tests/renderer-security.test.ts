import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('renderer content security policy', () => {
  it('allows MyAnimeList cover artwork from the API image host', () => {
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    expect(html).toContain("img-src 'self' data: https://cdn.myanimelist.net https://api-cdn.myanimelist.net");
  });

  it('does not include directives browsers ignore in a meta policy', () => {
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    expect(html).not.toContain('frame-ancestors');
  });
});
