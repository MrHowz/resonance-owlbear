import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/audio/engine', () => ({
  AudioEngine: class {
    setPreferences = vi.fn();
    apply = vi.fn();
    effect = vi.fn();
    unlock = vi.fn();
    stopEffects = vi.fn();
    destroy = vi.fn();
    status() {
      return {
        music: { phase: 'idle', duration: 0, position: 0 },
        ambience: { phase: 'idle', duration: 0, position: 0 },
        activeEffects: 0,
      };
    }
  },
}));
import { RoomService } from '../src/platform/service';
import type { Bridge, Message, Person } from '../src/platform/bridge';
import { emptySession, reduceSession, type Session } from '../src/core/model';
const gm: Person = { id: 'gm', connectionId: 'gm-connection', name: 'GM', role: 'GM' },
  player: Person = {
    id: 'player',
    connectionId: 'player-connection',
    name: 'Player',
    role: 'PLAYER',
  };
const track = { id: 'track', title: 'Track', url: 'https://example.com/a.mp3' };
let service: RoomService,
  metadata: unknown,
  receive: (e: Message) => void,
  stateListener: (s: unknown) => void,
  sent: unknown[],
  writes: number,
  people: Person[];
let writeGate: Promise<void> | undefined;
let startedWrites = 0;
function bridge(): Bridge {
  return {
    demo: false,
    self: { ...gm },
    getState: async () => structuredClone(metadata),
    setState: async (s) => {
      startedWrites++;
      if (writeGate) await writeGate;
      metadata = structuredClone(s);
      writes++;
      stateListener(s);
    },
    onState: (f) => {
      stateListener = f;
      return () => {};
    },
    send: async (data) => {
      sent.push(data);
      receive?.({ data, connectionId: gm.connectionId });
    },
    onMessage: (f) => {
      receive = f;
      return () => {};
    },
    people: async () => people,
    onPeople: () => () => {},
    destroy: () => {},
  };
}
beforeEach(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  metadata = null;
  sent = [];
  writes = 0;
  writeGate = undefined;
  startedWrites = 0;
  people = [gm, player];
  service = new RoomService(bridge());
  await service.start();
});
afterEach(() => {
  service.destroy();
  vi.unstubAllGlobals();
});
describe('room conductor', () => {
  it('coalesces queued room fader changes while a metadata write is slow', async () => {
    receive({
      connectionId: gm.connectionId,
      data: {
        type: 'command',
        command: { type: 'play', bus: 'music', track, loop: true, fade: 0 },
      },
    });
    await vi.waitFor(() => expect(writes).toBe(1));
    let release!: () => void;
    writeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    receive({
      connectionId: gm.connectionId,
      data: { type: 'command', command: { type: 'gain', bus: 'music', gain: 0.05 } },
    });
    await vi.waitFor(() => expect(startedWrites).toBe(2));
    for (let i = 2; i <= 20; i++) {
      receive({
        connectionId: gm.connectionId,
        data: { type: 'command', command: { type: 'gain', bus: 'music', gain: i / 20 } },
      });
      await Promise.resolve();
    }
    release();
    await vi.waitFor(() => expect((metadata as Session).music.gain).toBe(1));
    expect(writes).toBeLessThanOrEqual(3);
  });
  it('rejects commands from a player even when a payload claims to be GM', async () => {
    receive({
      connectionId: player.connectionId,
      data: {
        type: 'command',
        role: 'GM',
        command: { type: 'play', bus: 'music', track, loop: true, fade: 0 },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).toBe(0);
  });
  it('preserves scene ordering between two batches of coalesced fader updates', async () => {
    const dispatch = (command: unknown) =>
      receive({ connectionId: gm.connectionId, data: { type: 'command', command } });
    dispatch({ type: 'play', bus: 'music', track, loop: true, fade: 0 });
    await vi.waitFor(() => expect(writes).toBe(1));
    let release!: () => void;
    writeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    dispatch({ type: 'gain', bus: 'music', gain: 0.1 });
    await vi.waitFor(() => expect(startedWrites).toBe(2));
    dispatch({ type: 'gain', bus: 'music', gain: 0.2 });
    await Promise.resolve();
    dispatch({
      type: 'cue',
      fade: 0,
      cue: {
        id: 'scene',
        name: 'Scene',
        music: null,
        ambience: null,
        musicGain: 0.4,
        ambienceGain: 0.3,
      },
    });
    await Promise.resolve();
    dispatch({ type: 'gain', bus: 'music', gain: 0.9 });
    await Promise.resolve();
    release();
    await vi.waitFor(() => {
      expect((metadata as Session).music.gain).toBe(0.9);
      expect((metadata as Session).music.track).toBeNull();
    });
    expect(writes).toBe(5);
  });
  it('serializes rapid GM actions and persists only state changes', async () => {
    receive({
      connectionId: gm.connectionId,
      data: {
        type: 'command',
        command: { type: 'play', bus: 'music', track, loop: true, fade: 0 },
      },
    });
    receive({
      connectionId: gm.connectionId,
      data: { type: 'command', command: { type: 'pause', bus: 'music' } },
    });
    await vi.waitFor(() => expect(writes).toBe(2));
    const state = metadata as Session;
    expect(state.revision).toBe(2);
    expect(state.music.playing).toBe(false);
    expect(state.controller).toBe(gm.connectionId);
    receive({ connectionId: gm.connectionId, data: { type: 'hello' } });
    await Promise.resolve();
    expect(writes).toBe(2);
  });
  it('loads a durable timeline for a late join and rejects stale same-epoch snapshots', async () => {
    const s = {
      ...reduceSession(
        emptySession(),
        { type: 'play', bus: 'music', track, loop: true, fade: 0 },
        1000,
      ),
      controller: 'another-gm',
      epoch: 'epoch',
      revision: 8,
    };
    stateListener(s);
    stateListener({ ...s, revision: 2, music: { ...s.music, track: null } });
    const latest = sent.filter((x: any) => x.type === 'status').at(-1) as any;
    expect(latest.status.state.revision).toBe(8);
    expect(latest.status.state.music.track.id).toBe('track');
  });
  it('takes over explicitly from an offline conductor while preserving progress', async () => {
    metadata = {
      ...reduceSession(
        emptySession(),
        { type: 'play', bus: 'music', track, loop: true, fade: 0 },
        Date.now() - 5000,
      ),
      controller: 'offline-gm',
      epoch: 'old',
    };
    stateListener(metadata);
    receive({
      connectionId: gm.connectionId,
      data: { type: 'command', command: { type: 'takeover' } },
    });
    await vi.waitFor(() => expect(writes).toBe(1));
    const s = metadata as Session;
    expect(s.controller).toBe(gm.connectionId);
    expect(s.epoch).not.toBe('old');
    expect(s.music.position).toBeGreaterThanOrEqual(5);
  });
  it('ages low RTT samples so a later clock correction can be observed', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    const other = { ...gm, id: 'other', connectionId: 'other' };
    people.push(other);
    const s = { ...emptySession(), controller: other.connectionId, epoch: 'clock-epoch' };
    stateListener(s);
    let ping = sent.filter((m: any) => m.type === 'ping').at(-1) as any;
    receive({
      connectionId: other.connectionId,
      data: {
        type: 'pong',
        to: gm.connectionId,
        id: ping.id,
        t0: ping.t0,
        t1: 10000,
        t2: 10000,
        epoch: s.epoch,
      },
    });
    clock.mockReturnValue(41001);
    stateListener({ ...s, revision: 1 });
    ping = sent.filter((m: any) => m.type === 'ping').at(-1) as any;
    clock.mockReturnValue(41101);
    receive({
      connectionId: other.connectionId,
      data: {
        type: 'pong',
        to: gm.connectionId,
        id: ping.id,
        t0: ping.t0,
        t1: 41551,
        t2: 41551,
        epoch: s.epoch,
      },
    });
    await Promise.resolve();
    const latest = sent.filter((x: any) => x.type === 'status').at(-1) as any;
    expect(latest.status.clockOffset).toBe(500);
    expect(latest.status.clockRtt).toBe(100);
  });
});
