import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import Papa from 'papaparse';
import type { Cue, Track } from './model';
import { isRecord, parseTrack, validCue } from './validation';
interface LibraryDB extends DBSchema {
  tracks: { key: string; value: Track };
  cues: { key: string; value: Cue };
  settings: { key: string; value: unknown };
}
let db: Promise<IDBPDatabase<LibraryDB> | null> | undefined;
let temporary = false;
const memory = {
  tracks: new Map<string, Track>(),
  cues: new Map<string, Cue>(),
  settings: new Map<string, unknown>(),
};
const getDB = () =>
  (db ??= (async () => {
    try {
      return await openDB<LibraryDB>('resonance-library', 1, {
        upgrade(d) {
          d.createObjectStore('tracks', { keyPath: 'id' });
          d.createObjectStore('cues', { keyPath: 'id' });
          d.createObjectStore('settings');
        },
      });
    } catch {
      temporary = true;
      return null;
    }
  })());
export const storageIsTemporary = () => temporary;
export async function loadLibrary() {
  const d = await getDB();
  return d
    ? { tracks: await d.getAll('tracks'), cues: await d.getAll('cues') }
    : {
        tracks: structuredClone([...memory.tracks.values()]),
        cues: structuredClone([...memory.cues.values()]),
      };
}
export async function saveTrack(track: Track) {
  const d = await getDB(),
    clean = parseTrack(track);
  if (d) await d.put('tracks', clean);
  else memory.tracks.set(clean.id, clean);
}
export async function deleteTrack(id: string) {
  const d = await getDB();
  if (d) await d.delete('tracks', id);
  else memory.tracks.delete(id);
}
export async function saveCue(cue: Cue) {
  if (!validCue(cue)) throw new Error('Invalid scene.');
  const d = await getDB();
  if (d) await d.put('cues', cue);
  else memory.cues.set(cue.id, structuredClone(cue));
}
export async function deleteCue(id: string) {
  const d = await getDB();
  if (d) await d.delete('cues', id);
  else memory.cues.delete(id);
}
export async function getSetting<T>(key: string): Promise<T | undefined> {
  const d = await getDB();
  return (d ? await d.get('settings', key) : memory.settings.get(key)) as T | undefined;
}
export async function setSetting(key: string, value: unknown) {
  const d = await getDB();
  if (d) await d.put('settings', value, key);
  else memory.settings.set(key, value);
}
export function parseImport(
  body: string,
  format: 'csv' | 'json',
): { tracks: Track[]; cues: Cue[] } {
  if (body.length > 8 * 1024 * 1024) throw new Error('Import is too large. Maximum size is 8 MB.');
  let rows: unknown[];
  let cues: Cue[] = [];
  if (format === 'json') {
    const parsed: unknown = JSON.parse(body);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.tracks) ||
      !Array.isArray(parsed.cues)
    )
      throw new Error('This is not a Resonance v1 backup.');
    if (parsed.cues.length > 500 || !parsed.cues.every(validCue))
      throw new Error('Invalid scenes in backup.');
    rows = parsed.tracks;
    cues = parsed.cues;
  } else {
    const parsed = Papa.parse<Record<string, string>>(body.replace(/^\uFEFF/, ''), {
      header: true,
      delimiter: ',',
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    if (parsed.errors.length) throw new Error(`CSV: ${parsed.errors[0].message}`);
    if (!['title', 'url', 'tags'].every((h) => parsed.meta.fields?.includes(h)))
      throw new Error('CSV header must include title,url,tags.');
    rows = parsed.data;
  }
  if (rows.length > 10000) throw new Error('Import up to 10,000 tracks at a time.');
  return {
    tracks: rows.map((row, i) => {
      try {
        return parseTrack(row);
      } catch (e) {
        throw new Error(`Row ${i + 2}: ${(e as Error).message}`);
      }
    }),
    cues,
  };
}
export async function importLibrary(data: { tracks: Track[]; cues: Cue[] }) {
  const incoming = data.tracks.map(parseTrack);
  if (!data.cues.every(validCue)) throw new Error('Invalid scenes in import.');
  const d = await getDB();
  if (!d) {
    const result = mergeTracks([...memory.tracks.values()], incoming);
    for (const track of result.tracks) memory.tracks.set(track.id, track);
    for (const cue of data.cues) memory.cues.set(cue.id, structuredClone(cue));
    return { added: result.added, updated: result.updated };
  }
  const tx = d.transaction(['tracks', 'cues'], 'readwrite');
  const tracks = tx.objectStore('tracks');
  const existing = await tracks.getAll();
  const result = mergeTracks(existing, incoming);
  for (const track of result.tracks) await tracks.put(track);
  for (const cue of data.cues) await tx.objectStore('cues').put(cue);
  await tx.done;
  return { added: result.added, updated: result.updated };
}
function mergeTracks(existing: Track[], incoming: Track[]) {
  const byUrl = new Map(existing.map((t) => [t.url, t])),
    ids = new Set(existing.map((t) => t.id));
  const writes = new Map<string, Track>();
  let added = 0,
    updated = 0;
  for (const imported of incoming) {
    const old = byUrl.get(imported.url);
    const id = old?.id ?? (ids.has(imported.id) ? crypto.randomUUID() : imported.id);
    const track = { ...imported, id };
    ids.add(id);
    if (old) updated++;
    else added++;
    writes.set(id, track);
    byUrl.set(track.url, track);
  }
  return { tracks: [...writes.values()], added, updated };
}
export function exportCSV(tracks: Track[]) {
  return Papa.unparse(
    tracks.map((t) => ({ title: t.title, url: t.url, tags: t.tags.join('|') })),
    { escapeFormulae: true },
  );
}
export function exportJSON(tracks: Track[], cues: Cue[]) {
  return JSON.stringify({ version: 1, tracks, cues }, null, 2);
}
export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
