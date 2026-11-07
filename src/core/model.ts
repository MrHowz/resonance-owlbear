export type Bus = 'music' | 'ambience';
export type Kind = Bus | 'sfx';
export interface Track {
  id: string;
  title: string;
  url: string;
  tags: string[];
  kind: Kind;
  favorite: boolean;
}
export interface TrackRef {
  id: string;
  title: string;
  url: string;
}
export interface Layer {
  track: TrackRef | null;
  playing: boolean;
  position: number;
  anchor: number;
  gain: number;
  loop: boolean;
}
export interface Session {
  version: 1;
  revision: number;
  epoch: string;
  controller: string;
  controllerName: string;
  updatedAt: number;
  fade: number;
  music: Layer;
  ambience: Layer;
  queue: TrackRef[];
}
export interface Cue {
  id: string;
  name: string;
  music: TrackRef | null;
  ambience: TrackRef | null;
  musicGain: number;
  ambienceGain: number;
}
export interface Preferences {
  master: number;
  muted: boolean;
  music: number;
  ambience: number;
  sfx: number;
  fade: number;
}
export const DEFAULT_PREFS: Preferences = {
  master: 0.7,
  muted: false,
  music: 1,
  ambience: 1,
  sfx: 0.8,
  fade: 2.5,
};
export type Command =
  | { type: 'play'; bus: Bus; track: TrackRef; loop: boolean; fade: number }
  | { type: 'pause' | 'resume' | 'stop'; bus: Bus }
  | { type: 'seek'; bus: Bus; position: number }
  | { type: 'gain'; bus: Bus; gain: number }
  | { type: 'loop'; bus: Bus; loop: boolean }
  | { type: 'cue'; cue: Cue; fade: number }
  | { type: 'enqueue'; track: TrackRef }
  | { type: 'removeQueue'; index: number }
  | { type: 'next' | 'stopAll' }
  | { type: 'sfx'; track: TrackRef; gain: number }
  | { type: 'takeover' };
export const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));
export const ref = ({ id, title, url }: TrackRef): TrackRef => ({ id, title, url });
export const emptyLayer = (gain = 0.8): Layer => ({
  track: null,
  playing: false,
  position: 0,
  anchor: 0,
  gain,
  loop: true,
});
export function emptySession(): Session {
  return {
    version: 1,
    revision: 0,
    epoch: '',
    controller: '',
    controllerName: '',
    updatedAt: 0,
    fade: 2.5,
    music: emptyLayer(),
    ambience: emptyLayer(0.45),
    queue: [],
  };
}
export function elapsed(layer: Layer, now: number, duration?: number): number {
  const pos = Math.max(
    0,
    layer.position + (layer.playing ? Math.max(0, now - layer.anchor) / 1000 : 0),
  );
  return duration && Number.isFinite(duration) && duration > 0
    ? layer.loop
      ? pos % duration
      : Math.min(pos, duration)
    : pos;
}
export function drift(actual: number, target: number, duration: number, loop: boolean): number {
  let delta = target - actual;
  if (loop && duration > 0 && Number.isFinite(duration))
    delta = ((((delta + duration / 2) % duration) + duration) % duration) - duration / 2;
  return delta;
}
export function reanchor(session: Session, oldNow: number, newNow: number): Session {
  const change = (l: Layer): Layer => ({ ...l, position: elapsed(l, oldNow), anchor: newNow });
  return {
    ...session,
    music: change(session.music),
    ambience: change(session.ambience),
    updatedAt: newNow,
  };
}
export function reduceSession(
  s: Session,
  cmd: Exclude<Command, { type: 'sfx' | 'takeover' }>,
  now: number,
): Session {
  let next: Session = {
    ...s,
    music: { ...s.music },
    ambience: { ...s.ambience },
    queue: [...s.queue],
    revision: s.revision + 1,
    updatedAt: now,
  };
  if (cmd.type === 'play')
    next[cmd.bus] = {
      ...s[cmd.bus],
      track: ref(cmd.track),
      playing: true,
      position: 0,
      anchor: now,
      loop: cmd.loop,
    };
  if (cmd.type === 'play' || cmd.type === 'cue') next.fade = clamp(cmd.fade, 0, 10);
  if (cmd.type === 'pause')
    next[cmd.bus] = {
      ...s[cmd.bus],
      playing: false,
      position: elapsed(s[cmd.bus], now),
      anchor: now,
    };
  if (cmd.type === 'resume' && s[cmd.bus].track)
    next[cmd.bus] = { ...s[cmd.bus], playing: true, anchor: now };
  if (cmd.type === 'stop') next[cmd.bus] = { ...emptyLayer(s[cmd.bus].gain), anchor: now };
  if (cmd.type === 'seek')
    next[cmd.bus] = { ...s[cmd.bus], position: clamp(cmd.position, 0, 604800), anchor: now };
  if (cmd.type === 'gain') next[cmd.bus].gain = clamp(cmd.gain);
  if (cmd.type === 'loop') next[cmd.bus].loop = cmd.loop;
  if (cmd.type === 'cue') {
    next.queue = [];
    for (const bus of ['music', 'ambience'] as const)
      next[bus] = {
        track: cmd.cue[bus],
        playing: !!cmd.cue[bus],
        position: 0,
        anchor: now,
        loop: true,
        gain: bus === 'music' ? cmd.cue.musicGain : cmd.cue.ambienceGain,
      };
  }
  if (cmd.type === 'enqueue') {
    if (s.queue.length >= 20) throw new Error('Queue is full (20 tracks).');
    next.queue.push(ref(cmd.track));
    next.music.loop = false;
  }
  if (cmd.type === 'removeQueue') next.queue.splice(cmd.index, 1);
  if (cmd.type === 'next') {
    const track = next.queue.shift();
    next.music = track
      ? { ...s.music, track, playing: true, position: 0, anchor: now, loop: false }
      : { ...s.music, playing: false, position: elapsed(s.music, now), anchor: now };
  }
  if (cmd.type === 'stopAll') {
    next.music = emptyLayer(s.music.gain);
    next.ambience = emptyLayer(s.ambience.gain);
    next.queue = [];
  }
  return next;
}
export function clockSample(t0: number, t1: number, t2: number, t3: number) {
  return { rtt: Math.max(0, t3 - t0 - (t2 - t1)), offset: (t1 - t0 + (t2 - t3)) / 2 };
}
export function formatTime(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0:00';
  return `${Math.floor(n / 60)}:${Math.floor(n % 60)
    .toString()
    .padStart(2, '0')}`;
}
