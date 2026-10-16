import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCommandLinePaths, resolveLocalMedia, seriesFromPath, stripPlayerSuffix } from '../src/main/local-detector';

describe('seriesFromPath', () => {
  it('skips season folders and remembers the season number', () => {
    expect(seriesFromPath(String.raw`D:\Anime\Avatar - The Last Airbender (2005)\Book 1\101 - The Boy in the Iceberg.mkv`))
      .toEqual({ series: 'avatar the last airbender', season: 1 });
  });

  it('refuses generic folders as series names', () => {
    expect(seriesFromPath(String.raw`C:\Users\me\Downloads\101 - The Boy in the Iceberg.mkv`)).toBeNull();
  });
});

describe('parseCommandLinePaths', () => {
  it('extracts quoted paths and file URIs but not the executable', () => {
    expect(parseCommandLinePaths(String.raw`"C:\Program Files\VideoLAN\VLC\vlc.exe" --started-from-file "D:\Shows\ATLA\101 - Pilot.mkv"`))
      .toEqual([String.raw`D:\Shows\ATLA\101 - Pilot.mkv`]);
  });
});

describe('resolveLocalMedia', () => {
  let root = '';
  let book1 = '';

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'anime-relay-'));
    book1 = path.join(root, 'Avatar The Last Airbender', 'Book 1');
    await mkdir(book1, { recursive: true });
    await writeFile(path.join(book1, '101 - The Boy in the Iceberg.mkv'), '');
    await writeFile(path.join(book1, '102 - The Avatar Returns.mkv'), '');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses the window title when it names the series', async () => {
    expect(await resolveLocalMedia(stripPlayerSuffix('Yu-Gi-Oh! - 005 - Rage of the Blue-Eyes.mkv - VLC media player'), []))
      .toEqual({ title: 'yu gi oh', episode: 5 });
  });

  it('takes the series from the folder for episode-first titles, including the next file in the playlist', async () => {
    const opened = path.join(book1, '101 - The Boy in the Iceberg.mkv');
    expect(await resolveLocalMedia('101 - The Boy in the Iceberg', [opened]))
      .toEqual({ title: 'avatar the last airbender', episode: 1 });
    expect(await resolveLocalMedia('102 - The Avatar Returns', [opened]))
      .toEqual({ title: 'avatar the last airbender', episode: 2 });
  });

  it('ignores episode-first titles it cannot locate rather than matching the episode name', async () => {
    expect(await resolveLocalMedia('101 - The Boy in the Iceberg', [])).toBeNull();
  });
});
