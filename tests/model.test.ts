import { describe, expect, it } from 'vitest';
import {
  clockSample,
  drift,
  elapsed,
  emptySession,
  reanchor,
  reduceSession,
  type TrackRef,
} from '../src/core/model';
import { normalizeUrl, parseTrack, validCommand, validSession } from '../src/core/validation';
const track: TrackRef = { id: 'track', title: 'Test', url: 'https://example.com/test.mp3' };
describe('shared timeline', () => {
  it('preserves position through pause, delayed resume and late join', () => {
    let s = reduceSession(
      emptySession(),
      { type: 'play', bus: 'music', track, loop: true, fade: 2.5 },
      10000,
    );
    expect(elapsed(s.music, 13700, 10)).toBeCloseTo(3.7);
    s = reduceSession(s, { type: 'pause', bus: 'music' }, 13700);
    expect(elapsed(s.music, 50000, 10)).toBeCloseTo(3.7);
    s = reduceSession(s, { type: 'resume', bus: 'music' }, 60000);
    expect(elapsed(s.music, 68000, 10)).toBeCloseTo(1.7);
    expect(validSession(s)).toBe(true);
  });
  it('keeps ambience independent from music and gains do not reanchor', () => {
    const s = reduceSession(
      emptySession(),
      { type: 'play', bus: 'ambience', track, loop: true, fade: 0 },
      1000,
    );
    const next = reduceSession(s, { type: 'gain', bus: 'ambience', gain: 0.3 }, 5000);
    expect(next.ambience.anchor).toBe(1000);
    expect(next.ambience.gain).toBe(0.3);
    expect(next.music.track).toBeNull();
  });
  it('reanchors both layers when the conductor clock changes', () => {
    const s = reduceSession(
      emptySession(),
      { type: 'play', bus: 'music', track, loop: true, fade: 0 },
      10000,
    );
    const taken = reanchor(s, 25000, 120000);
    expect(elapsed(taken.music, 123000)).toBe(18);
  });
  it('calculates shortest drift across a loop boundary', () => {
    expect(drift(9.9, 0.1, 10, true)).toBeCloseTo(0.2);
    expect(drift(0.1, 9.9, 10, true)).toBeCloseTo(-0.2);
    expect(drift(9.9, 0.1, 10, false)).toBeCloseTo(-9.8);
  });
  it('uses an NTP clock sample rather than assuming identical clocks', () => {
    expect(clockSample(1000, 1540, 1550, 1090)).toEqual({ rtt: 80, offset: 500 });
  });
  it('queues finite music, advances, and empties without restarting a loop', () => {
    let s = reduceSession(
      emptySession(),
      { type: 'play', bus: 'music', track, loop: true, fade: 0 },
      1000,
    );
    s = reduceSession(s, { type: 'enqueue', track: { ...track, id: 'second' } }, 2000);
    expect(s.music.loop).toBe(false);
    s = reduceSession(s, { type: 'next' }, 3000);
    expect(s.music.track?.id).toBe('second');
    expect(s.queue).toHaveLength(0);
    expect(s.music.loop).toBe(false);
    s = reduceSession(s, { type: 'next' }, 4000);
    expect(s.music.playing).toBe(false);
  });
});
describe('untrusted input', () => {
  it('converts only exact Dropbox hosts and retains public share keys', () => {
    expect(normalizeUrl('https://www.dropbox.com/scl/fi/abc/song.mp3?rlkey=key&dl=0')).toBe(
      'https://dl.dropboxusercontent.com/scl/fi/abc/song.mp3?rlkey=key&raw=1',
    );
    expect(normalizeUrl('https://evildropbox.com/a')).toBe('https://evildropbox.com/a');
  });
  it.each([
    'javascript:alert(1)',
    'file:///secret',
    'http://example.com/a',
    'https://user:pass@example.com/a',
    'https://drive.google.com/file/d/x',
    'https://www.youtube.com/watch?v=x',
  ])('rejects unsupported URL %s', (raw) => {
    expect(() => normalizeUrl(raw)).toThrow();
  });
  it('trims and deduplicates tags, validates numeric payloads and versions', () => {
    expect(
      parseTrack({ title: ' Good ', url: track.url, tags: [' rain ', 'rain', ''] }).tags,
    ).toEqual(['rain']);
    expect(validCommand({ type: 'gain', bus: 'music', gain: NaN })).toBe(false);
    expect(validCommand({ type: 'seek', bus: 'music', position: Infinity })).toBe(false);
    expect(validCommand({ type: 'removeQueue', index: -1 })).toBe(false);
    expect(validSession({ ...emptySession(), version: 2 })).toBe(false);
  });
});
