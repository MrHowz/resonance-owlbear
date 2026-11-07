import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  exportCSV,
  exportJSON,
  importLibrary,
  loadLibrary,
  parseImport,
} from '../src/core/library';
import { parseTrack } from '../src/core/validation';
describe('Tracks migration and backups', () => {
  it('reads BOM, quoted commas, embedded newline and pipe-separated tags', () => {
    const data = parseImport(
      '\ufefftitle,url,tags\r\n"Rain, at night",https://example.com/rain.mp3,weather|rain\r\n"Two\nlines",https://example.com/two.mp3,quiet',
      'csv',
    );
    expect(data.tracks[0].title).toBe('Rain, at night');
    expect(data.tracks[0].tags).toEqual(['weather', 'rain']);
    expect(data.tracks[1].title).toBe('Two\nlines');
  });
  it('validates the entire import before any write and rejects malformed schemas', () => {
    expect(() =>
      parseImport(
        'title,url,tags\nValid,https://example.com/a.mp3,calm\nBad,javascript:bad,x',
        'csv',
      ),
    ).toThrow('Row 3');
    expect(() => parseImport('url\nhttps://example.com/a', 'csv')).toThrow('header');
    expect(() => parseImport('{"version":2,"tracks":[],"cues":[]}', 'json')).toThrow();
  });
  it('merges by normalized URL in a transaction and retains an existing id', async () => {
    const one = parseTrack({
      id: 'original-id',
      title: 'Before',
      url: 'https://example.com/same.mp3',
      tags: [],
    });
    await importLibrary({ tracks: [one], cues: [] });
    const updated = parseImport(
      'title,url,tags\nAfter,https://example.com/same.mp3,updated\nAnother,https://example.com/new.mp3,new',
      'csv',
    );
    expect(await importLibrary(updated)).toEqual({ added: 1, updated: 1 });
    const saved = (await loadLibrary()).tracks.find((t) => t.url === one.url)!;
    expect(saved.id).toBe('original-id');
    expect(saved.title).toBe('After');
  });
  it('roundtrips JSON metadata and escapes spreadsheet formulae on CSV export', () => {
    const t = parseTrack({
      title: '=1+1',
      url: 'https://example.com/c.mp3',
      kind: 'sfx',
      tags: ['magic'],
      favorite: true,
    });
    const body = exportJSON([t], []);
    expect(parseImport(body, 'json').tracks[0]).toEqual(t);
    expect(exportCSV([t])).toContain("'=1+1");
  });
  it('does not overwrite an unrelated track when imported IDs collide', async () => {
    const one = parseTrack({ id: 'collision', title: 'Keep', url: 'https://example.com/keep.mp3' });
    await importLibrary({ tracks: [one], cues: [] });
    const two = parseTrack({ id: 'collision', title: 'New', url: 'https://example.com/other.mp3' });
    await importLibrary({ tracks: [two], cues: [] });
    const saved = (await loadLibrary()).tracks;
    expect(saved.find((t) => t.id === 'collision')?.title).toBe('Keep');
    expect(saved.find((t) => t.url === two.url)?.id).not.toBe('collision');
  });
});
