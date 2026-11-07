import type { Bus, Command, Cue, Session, Track, TrackRef } from './model';
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const num = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Enter a complete public audio URL.');
  }
  if (url.username || url.password)
    throw new Error('Audio links cannot contain login credentials.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Use an HTTPS audio link (HTTP is allowed only on localhost).');
  if (url.href.length > 1500) throw new Error('Audio URL is too long (maximum 1500 characters).');
  if (['drive.google.com', 'docs.google.com'].includes(url.hostname))
    throw new Error(
      'Google Drive does not support embedded audio. Use Dropbox or a direct audio URL.',
    );
  if (['youtube.com', 'www.youtube.com', 'youtu.be', 'open.spotify.com'].includes(url.hostname))
    throw new Error(
      'Use a direct audio file URL. YouTube and Spotify page links cannot play here.',
    );
  if (['dropbox.com', 'www.dropbox.com'].includes(url.hostname)) {
    url.hostname = 'dl.dropboxusercontent.com';
    url.searchParams.delete('dl');
    url.searchParams.delete('raw');
    url.searchParams.set('raw', '1');
  }
  url.hash = '';
  return url.href;
}
export function validRef(v: unknown): v is TrackRef {
  if (!isRecord(v) || !text(v.id, 100) || !text(v.title, 160) || !text(v.url, 1500)) return false;
  try {
    return normalizeUrl(v.url) === v.url;
  } catch {
    return false;
  }
}
export function parseTrack(v: unknown): Track {
  if (!isRecord(v) || typeof v.title !== 'string' || typeof v.url !== 'string')
    throw new Error('Every track needs a title and URL.');
  const title = v.title.trim();
  if (!text(title, 160)) throw new Error('Track titles must contain 1–160 characters.');
  const tags = Array.isArray(v.tags) ? v.tags : typeof v.tags === 'string' ? v.tags.split('|') : [];
  if (tags.some((t) => typeof t !== 'string')) throw new Error('Tags must be text.');
  const cleanTags = [...new Set((tags as string[]).map((t) => t.trim()).filter(Boolean))];
  if (cleanTags.length > 24 || cleanTags.some((t) => t.length > 40))
    throw new Error('Use up to 24 tags, each at most 40 characters.');
  return {
    id: text(v.id, 100) ? v.id : crypto.randomUUID(),
    title,
    url: normalizeUrl(v.url),
    tags: cleanTags,
    kind: v.kind === 'ambience' || v.kind === 'sfx' ? v.kind : 'music',
    favorite: v.favorite === true,
  };
}
export function validCue(v: unknown): v is Cue {
  return (
    isRecord(v) &&
    text(v.id, 100) &&
    text(v.name, 120) &&
    (v.music === null || validRef(v.music)) &&
    (v.ambience === null || validRef(v.ambience)) &&
    num(v.musicGain, 0, 1) &&
    num(v.ambienceGain, 0, 1)
  );
}
export function validSession(v: unknown): v is Session {
  if (
    !isRecord(v) ||
    v.version !== 1 ||
    !num(v.revision, 0, Number.MAX_SAFE_INTEGER) ||
    !Number.isInteger(v.revision) ||
    typeof v.epoch !== 'string' ||
    v.epoch.length > 100 ||
    typeof v.controller !== 'string' ||
    v.controller.length > 100 ||
    typeof v.controllerName !== 'string' ||
    v.controllerName.length > 160 ||
    !num(v.updatedAt, 0, 1e15) ||
    !num(v.fade, 0, 10)
  )
    return false;
  for (const bus of ['music', 'ambience']) {
    const l = v[bus];
    if (
      !isRecord(l) ||
      !(l.track === null || validRef(l.track)) ||
      typeof l.playing !== 'boolean' ||
      typeof l.loop !== 'boolean' ||
      !num(l.position, 0, 1e10) ||
      !num(l.anchor, 0, 1e15) ||
      !num(l.gain, 0, 1)
    )
      return false;
  }
  return (
    Array.isArray(v.queue) &&
    v.queue.length <= 20 &&
    v.queue.every(validRef) &&
    new TextEncoder().encode(JSON.stringify(v)).length <= 12000
  );
}
export function validCommand(v: unknown): v is Command {
  if (!isRecord(v) || typeof v.type !== 'string') return false;
  const bus = v.bus === 'music' || v.bus === 'ambience';
  switch (v.type) {
    case 'pause':
    case 'resume':
    case 'stop':
      return bus;
    case 'seek':
      return bus && num(v.position, 0, 604800);
    case 'gain':
      return bus && num(v.gain, 0, 1);
    case 'loop':
      return bus && typeof v.loop === 'boolean';
    case 'play':
      return bus && validRef(v.track) && typeof v.loop === 'boolean' && num(v.fade, 0, 10);
    case 'cue':
      return validCue(v.cue) && num(v.fade, 0, 10);
    case 'enqueue':
      return validRef(v.track);
    case 'removeQueue':
      return num(v.index, 0, 19) && Number.isInteger(v.index);
    case 'sfx':
      return validRef(v.track) && num(v.gain, 0, 1);
    case 'takeover':
    case 'next':
    case 'stopAll':
      return true;
    default:
      return false;
  }
}
export const buses: Bus[] = ['music', 'ambience'];
