import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import { DEFAULT_PREFS, emptySession, reduceSession } from '../src/core/model';
class FakeAudio {
  src = '';
  preload = '';
  loop = false;
  paused = true;
  volume = 1;
  duration = 20;
  currentTime = 0;
  playbackRate = 1;
  dataset: Record<string, string> = {};
  onloadedmetadata: (() => void) | null = null;
  oncanplay: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onended: (() => void) | null = null;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  getAttribute(name: string) {
    return name === 'src' ? this.src : null;
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
}
let engine: AudioEngine, audios: FakeAudio[];
const onEnded = vi.fn<(bus: 'music' | 'ambience', id: string) => void>();
const track = { id: 'a', title: 'Audio', url: 'https://example.com/a.mp3' };
beforeEach(() => {
  vi.useFakeTimers();
  audios = [];
  onEnded.mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb: (n: number) => void) =>
    setTimeout(() => cb(Date.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  engine = new AudioEngine(
    vi.fn(),
    onEnded,
    () => 1000,
    () => {
      const a = new FakeAudio();
      audios.push(a);
      return a as unknown as HTMLAudioElement;
    },
  );
});
afterEach(() => {
  engine.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('audio resource ownership', () => {
  it('loads only the active track and reuses the same deck for gain updates', async () => {
    const s = reduceSession(
      emptySession(),
      { type: 'play', bus: 'music', track, loop: true, fade: 0 },
      1000,
    );
    engine.apply(s);
    expect(audios).toHaveLength(3);
    const active = audios[2];
    active.onloadedmetadata?.();
    await Promise.resolve();
    expect(active.play).toHaveBeenCalledTimes(1);
    active.currentTime = 0.05;
    engine.apply(reduceSession(s, { type: 'gain', bus: 'music', gain: 0.2 }, 1000));
    expect(audios).toHaveLength(3);
    expect(active.currentTime).toBe(0.05);
    expect(active.volume).toBeCloseTo(0.14);
  });
  it('surfaces autoplay rejection and can retry after a user gesture', async () => {
    engine.apply(
      reduceSession(
        emptySession(),
        { type: 'play', bus: 'music', track, loop: true, fade: 0 },
        1000,
      ),
    );
    const a = audios[2];
    a.play.mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    a.onloadedmetadata?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.status().music.phase).toBe('blocked');
    engine.unlock();
    await Promise.resolve();
    expect(engine.status().music.phase).toBe('playing');
  });
  it('bounds and deduplicates one-shot sounds and releases all on stop', () => {
    for (let i = 0; i < 8; i++) engine.effect(String(i), track, 1, 1000);
    expect(engine.status().activeEffects).toBe(4);
    engine.effect('0', track, 1, 1000);
    expect(engine.status().activeEffects).toBe(4);
    engine.stopEffects();
    expect(engine.status().activeEffects).toBe(0);
    expect(audios.slice(2).every((a) => a.paused && !a.src)).toBe(true);
  });
  it('releases the outgoing source after a crossfade and on destroy', async () => {
    // Hidden background iframes do not have to deliver animation frames.
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    let s = reduceSession(
      emptySession(),
      { type: 'play', bus: 'music', track, loop: true, fade: 1 },
      1000,
    );
    engine.apply(s);
    audios[2].onloadedmetadata?.();
    await Promise.resolve();
    s = reduceSession(
      s,
      {
        type: 'play',
        bus: 'music',
        track: { ...track, id: 'b', url: 'https://example.com/b.mp3' },
        loop: true,
        fade: 1,
      },
      1000,
    );
    engine.apply(s);
    audios[3].onloadedmetadata?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1100);
    expect(audios[2].src).toBe('');
    expect(audios[2].paused).toBe(true);
    engine.destroy();
    expect(audios.every((a) => !a.src && a.paused)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('completes an already elapsed nonloop timeline after reload exactly once', () => {
    let s = reduceSession(
      emptySession(),
      { type: 'play', bus: 'music', track, loop: false, fade: 0 },
      1000,
    );
    s = reduceSession(s, { type: 'seek', bus: 'music', position: 30 }, 1000);
    engine.apply(s);
    audios[2].onloadedmetadata?.();
    engine.apply(s);
    audios[2].onended?.();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(audios[2].paused).toBe(true);
  });
});
