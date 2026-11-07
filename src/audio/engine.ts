import {
  clamp,
  drift,
  elapsed,
  type Bus,
  type Layer,
  type Preferences,
  type Session,
  type TrackRef,
  DEFAULT_PREFS,
} from '../core/model';
export type AudioStatus = {
  phase: 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';
  duration: number;
  position: number;
  error?: string;
};
export type EngineStatus = { music: AudioStatus; ambience: AudioStatus; activeEffects: number };
type Deck = {
  audio: HTMLAudioElement;
  trackId: string;
  generation: number;
  mix: number;
  status: AudioStatus;
  ready: boolean;
  cancelFade?: () => void;
  outgoing?: HTMLAudioElement;
  timeout?: ReturnType<typeof setTimeout>;
  starting?: boolean;
  fadeSeconds?: number;
  completedKey?: string;
};
const idle = (): AudioStatus => ({ phase: 'idle', duration: 0, position: 0 });
export class AudioEngine {
  private decks: Record<Bus, Deck>;
  private effects = new Set<HTMLAudioElement>();
  private effectTimers = new Map<HTMLAudioElement, ReturnType<typeof setTimeout>>();
  private seenEffects = new Map<string, number>();
  private state?: Session;
  private prefs: Preferences = { ...DEFAULT_PREFS };
  private timer: ReturnType<typeof setInterval>;
  private destroyed = false;
  constructor(
    private emit: (s: EngineStatus) => void,
    private ended: (bus: Bus, id: string) => void,
    private now = () => Date.now(),
    private makeAudio = () => new Audio(),
  ) {
    this.decks = { music: this.deck(), ambience: this.deck() };
    this.timer = setInterval(() => {
      this.correct();
      this.report();
    }, 2000);
    if (typeof window !== 'undefined') window.addEventListener('focus', this.focus);
  }
  private deck(): Deck {
    const audio = this.makeAudio();
    audio.preload = 'metadata';
    return { audio, trackId: '', generation: 0, mix: 1, status: idle(), ready: false };
  }
  private focus = () => {
    this.correct(true);
    this.report();
  };
  private release(audio: HTMLAudioElement) {
    audio.onloadedmetadata = null;
    audio.oncanplay = null;
    audio.onerror = null;
    audio.onended = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  private gain(bus: Bus) {
    return (
      (this.prefs.muted ? 0 : this.prefs.master) * this.prefs[bus] * (this.state?.[bus].gain ?? 1)
    );
  }
  setPreferences(p: Preferences) {
    this.prefs = p;
    for (const bus of ['music', 'ambience'] as const) {
      const d = this.decks[bus];
      d.audio.volume = clamp(this.gain(bus) * d.mix);
      if (d.outgoing) d.outgoing.volume = clamp(this.gain(bus) * (1 - d.mix));
    }
    for (const a of this.effects)
      a.volume = clamp(
        (this.prefs.muted ? 0 : this.prefs.master) * this.prefs.sfx * Number(a.dataset.gain ?? 1),
      );
  }
  apply(state: Session) {
    const previous = this.state;
    this.state = state;
    for (const bus of ['music', 'ambience'] as const) {
      const layer = state[bus],
        deck = this.decks[bus];
      if (!layer.track) {
        clearTimeout(deck.timeout);
        deck.cancelFade?.();
        deck.generation++;
        if (deck.outgoing) this.release(deck.outgoing);
        deck.outgoing = undefined;
        this.release(deck.audio);
        deck.trackId = '';
        deck.status = idle();
        deck.ready = false;
        continue;
      }
      if (deck.trackId !== layer.track.id || deck.audio.getAttribute('src') !== layer.track.url)
        this.load(bus, layer, state.fade);
      else {
        deck.audio.loop = layer.loop;
        deck.audio.volume = clamp(this.gain(bus) * deck.mix);
        const old = previous?.[bus];
        if (deck.ready)
          this.align(
            bus,
            !old ||
              old.anchor !== layer.anchor ||
              old.position !== layer.position ||
              old.playing !== layer.playing,
          );
      }
    }
    this.report();
  }
  private load(bus: Bus, layer: Layer, seconds: number) {
    const old = this.decks[bus];
    clearTimeout(old.timeout);
    old.cancelFade?.();
    if (old.outgoing) this.release(old.outgoing);
    const outgoing = !old.audio.paused && seconds > 0 ? old.audio : undefined;
    if (!outgoing) this.release(old.audio);
    const deck = this.deck();
    deck.generation = old.generation + 1;
    deck.trackId = layer.track!.id;
    deck.status.phase = 'loading';
    deck.outgoing = outgoing;
    deck.mix = outgoing ? 0 : 1;
    deck.fadeSeconds = seconds;
    this.decks[bus] = deck;
    const audio = deck.audio;
    audio.loop = layer.loop;
    audio.volume = clamp(this.gain(bus) * deck.mix);
    audio.onloadedmetadata = () => {
      if (this.decks[bus] !== deck || this.destroyed) return;
      deck.ready = true;
      deck.status.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      this.align(bus, true);
    };
    audio.oncanplay = () => {
      if (this.decks[bus] !== deck || this.destroyed) return;
      deck.ready = true;
      if (deck.status.phase === 'loading') this.align(bus, true);
    };
    audio.onerror = () => {
      clearTimeout(deck.timeout);
      if (this.decks[bus] !== deck) return;
      deck.status = {
        ...deck.status,
        phase: 'error',
        error: 'Cannot load audio. Check that the URL is public and points to an audio file.',
      };
      deck.cancelFade?.();
      if (deck.outgoing) this.release(deck.outgoing);
      deck.outgoing = undefined;
      this.report();
    };
    audio.onended = () => {
      if (!audio.loop && this.decks[bus] === deck) {
        deck.status.phase = 'paused';
        this.complete(bus);
        this.report();
      }
    };
    audio.src = layer.track!.url;
    audio.load();
    // Fade begins only after the incoming deck really plays; failed loads keep a visible error.
    deck.timeout = setTimeout(() => {
      if (deck.status.phase === 'loading') {
        deck.status = {
          ...deck.status,
          phase: 'error',
          error: 'Audio loading timed out. Check the link and try again.',
        };
        if (deck.outgoing) this.release(deck.outgoing);
        deck.outgoing = undefined;
        this.report();
      }
    }, 20000);
    const originalCanPlay = audio.oncanplay;
    audio.oncanplay = (event) => {
      clearTimeout(deck.timeout);
      originalCanPlay?.call(audio, event);
    };
  }
  private prepareFade(bus: Bus, deck: Deck, seconds: number) {
    let timer: ReturnType<typeof setTimeout>;
    const start = performance.now();
    let cancelled = false;
    deck.cancelFade = () => {
      cancelled = true;
      clearTimeout(timer);
    };
    const step = () => {
      if (cancelled || this.destroyed || this.decks[bus] !== deck) return;
      if (deck.audio.paused || deck.status.phase !== 'playing') return;
      deck.mix = clamp((performance.now() - start) / (seconds * 1000));
      deck.audio.volume = clamp(this.gain(bus) * deck.mix);
      if (deck.outgoing) deck.outgoing.volume = clamp(this.gain(bus) * (1 - deck.mix));
      if (deck.mix < 1) timer = setTimeout(step, 40);
      else {
        if (deck.outgoing) this.release(deck.outgoing);
        deck.outgoing = undefined;
        deck.cancelFade = undefined;
      }
    };
    // Background tabs can suspend animation frames. Timers may be
    // throttled, so each callback derives progress from elapsed monotonic time.
    timer = setTimeout(step, 40);
  }
  private align(bus: Bus, hard: boolean) {
    const deck = this.decks[bus],
      layer = this.state?.[bus];
    if (!layer?.track || !deck.ready) return;
    const a = deck.audio;
    const target = elapsed(layer, this.now(), a.duration);
    const difference = drift(a.currentTime, target, a.duration, layer.loop);
    if (hard || Math.abs(difference) > 0.8) {
      try {
        a.currentTime = target;
      } catch {
        /* Some streams cannot seek before canplay. */
      }
      a.playbackRate = 1;
    } else
      a.playbackRate = Math.abs(difference) > 0.12 ? clamp(1 + difference * 0.04, 0.97, 1.03) : 1;
    const finished =
      layer.playing && Number.isFinite(a.duration) && target >= a.duration && !layer.loop;
    if (layer.playing && !finished) {
      if (a.paused && !deck.starting && deck.status.phase !== 'error') {
        deck.starting = true;
        void a
          .play()
          .then(() => {
            deck.starting = false;
            if (this.decks[bus] !== deck || this.destroyed) return;
            clearTimeout(deck.timeout);
            if (!this.state?.[bus].playing) {
              a.pause();
              deck.status.phase = 'paused';
            } else {
              deck.status.phase = 'playing';
              delete deck.status.error;
              if (deck.outgoing && !deck.cancelFade)
                this.prepareFade(bus, deck, deck.fadeSeconds || 0.1);
            }
            this.report();
          })
          .catch((e) => {
            deck.starting = false;
            if (this.decks[bus] !== deck || this.destroyed) return;
            clearTimeout(deck.timeout);
            deck.status = {
              ...deck.status,
              phase: e.name === 'NotAllowedError' ? 'blocked' : 'error',
              error:
                e.name === 'NotAllowedError'
                  ? 'Your browser needs permission to play audio. Choose Enable audio.'
                  : 'Playback failed. Check the audio URL and try again.',
            };
            deck.cancelFade?.();
            if (deck.outgoing) this.release(deck.outgoing);
            deck.outgoing = undefined;
            deck.mix = 1;
            this.report();
          });
      }
    } else {
      a.pause();
      if (deck.outgoing) {
        this.release(deck.outgoing);
        deck.outgoing = undefined;
        deck.cancelFade?.();
        deck.mix = 1;
      }
      deck.status.phase = 'paused';
      if (finished) this.complete(bus);
    }
  }
  private complete(bus: Bus) {
    const deck = this.decks[bus],
      layer = this.state?.[bus];
    if (!layer?.track) return;
    const key = `${layer.anchor}:${layer.position}`;
    if (deck.completedKey === key) return;
    deck.completedKey = key;
    this.ended(bus, deck.trackId);
  }
  private correct(hard = false) {
    for (const bus of ['music', 'ambience'] as const)
      if (this.decks[bus].status.phase !== 'blocked') this.align(bus, hard);
  }
  unlock() {
    for (const bus of ['music', 'ambience'] as const) {
      const d = this.decks[bus];
      if (d.status.phase === 'blocked' || d.status.phase === 'error') {
        d.status.phase = 'loading';
        if (d.ready) this.align(bus, true);
        else if (this.state?.[bus].track) this.load(bus, this.state[bus], 0);
      }
    }
  }
  effect(id: string, track: TrackRef, gain: number, at: number) {
    const now = this.now();
    for (const [key, seen] of this.seenEffects)
      if (now - seen > 60000) this.seenEffects.delete(key);
    if (this.seenEffects.has(id) || Math.abs(now - at) > 5000 || this.effects.size >= 4) return;
    this.seenEffects.set(id, now);
    const a = this.makeAudio();
    a.dataset.gain = String(gain);
    a.preload = 'none';
    a.volume = clamp((this.prefs.muted ? 0 : this.prefs.master) * this.prefs.sfx * gain);
    a.src = track.url;
    this.effects.add(a);
    let timeout: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timeout);
      this.effectTimers.delete(a);
      this.effects.delete(a);
      this.release(a);
      this.report();
    };
    a.onended = finish;
    a.onerror = finish;
    timeout = setTimeout(finish, 120000);
    this.effectTimers.set(a, timeout);
    void a.play().catch(finish);
    this.report();
  }
  status(): EngineStatus {
    const status = (bus: Bus): AudioStatus => ({
      ...this.decks[bus].status,
      position: this.decks[bus].audio.currentTime || 0,
    });
    return {
      music: status('music'),
      ambience: status('ambience'),
      activeEffects: this.effects.size,
    };
  }
  private report() {
    if (!this.destroyed) this.emit(this.status());
  }
  stopEffects() {
    for (const a of this.effects) {
      clearTimeout(this.effectTimers.get(a));
      this.release(a);
    }
    this.effectTimers.clear();
    this.effects.clear();
    this.report();
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.focus);
    for (const deck of Object.values(this.decks)) {
      clearTimeout(deck.timeout);
      deck.cancelFade?.();
      this.release(deck.audio);
      if (deck.outgoing) this.release(deck.outgoing);
    }
    this.stopEffects();
  }
}
