import { AudioEngine, type EngineStatus } from '../audio/engine';
import {
  clockSample,
  DEFAULT_PREFS,
  emptySession,
  reanchor,
  reduceSession,
  type Command,
  type Preferences,
  type Session,
} from '../core/model';
import { isRecord, validCommand, validRef, validSession } from '../core/validation';
import type { Bridge, Message, Person } from './bridge';
export type ServiceStatus = {
  state: Session;
  engine: EngineStatus;
  preferences: Preferences;
  clockOffset: number;
  clockRtt: number | null;
  people: Person[];
  controllerOnline: boolean;
};
export class RoomService {
  private state = emptySession();
  private prefs: Preferences = { ...DEFAULT_PREFS };
  private people: Person[] = [];
  private offset = 0;
  private rtt = Infinity;
  private cleanups: (() => void)[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private serial: Promise<void> = Promise.resolve();
  private engine: AudioEngine;
  private probes = new Map<string, number>();
  private lastEnded = '';
  private destroyed = false;
  private clockSamples: { rtt: number; offset: number; at: number }[] = [];
  private lastRequest = new Map<string, number>();
  constructor(private bridge: Bridge) {
    this.engine = new AudioEngine(
      () => this.report(),
      (bus, id) => {
        const token = `${this.state.epoch}/${this.state.revision}/${id}`;
        if (
          bus === 'music' &&
          this.state.controller === this.bridge.self.connectionId &&
          !this.state.music.loop &&
          this.lastEnded !== token
        ) {
          this.lastEnded = token;
          this.enqueue({ type: 'next' }, this.bridge.self.connectionId);
        }
      },
      () => Date.now() + this.offset,
    );
  }
  async start() {
    try {
      const p = JSON.parse(localStorage.getItem('resonance-preferences') ?? 'null');
      if (validPreferences(p)) this.prefs = p;
    } catch {
      /* Preferences are optional; no library is stored here. */
    }
    this.engine.setPreferences(this.prefs);
    this.people = await this.bridge.people();
    this.cleanups.push(
      this.bridge.onState((v) => this.receiveState(v)),
      this.bridge.onMessage((e) => {
        void this.receive(e).catch((e) => this.error((e as Error).message));
      }),
      this.bridge.onPeople((p) => {
        this.people = p;
        this.report();
      }),
    );
    this.receiveState(await this.bridge.getState());
    this.timer = setInterval(() => {
      this.probe();
      this.report();
    }, 5000);
    this.probe();
    this.report();
  }
  private receiveState(v: unknown) {
    if (!validSession(v)) return;
    if (v.epoch === this.state.epoch && v.revision < this.state.revision) return;
    if (v.epoch !== this.state.epoch) {
      this.offset = 0;
      this.rtt = Infinity;
      this.probes.clear();
      this.clockSamples = [];
    }
    this.state = v;
    this.engine.apply(v);
    this.report();
    this.probe();
  }
  private async receive({ data: m, connectionId: sender }: Message) {
    if (!isRecord(m) || typeof m.type !== 'string') return;
    const local = sender === this.bridge.self.connectionId;
    if (m.type === 'hello' && local) {
      this.report();
      return;
    }
    if (m.type === 'preferences' && local && validPreferences(m.preferences)) {
      this.prefs = m.preferences;
      this.engine.setPreferences(this.prefs);
      try {
        localStorage.setItem('resonance-preferences', JSON.stringify(this.prefs));
      } catch {
        /* Works in memory when storage is denied. */
      }
      this.report();
      return;
    }
    if (m.type === 'unlock' && local) {
      this.engine.unlock();
      return;
    }
    if (m.type === 'command' && validCommand(m.command)) {
      this.people = await this.bridge.people();
      if (!this.people.some((p) => p.connectionId === sender && p.role === 'GM')) {
        if (local) this.error('Only a GM can control shared playback.');
        return;
      }
      if (m.command.type === 'takeover') {
        if (local) this.enqueue(m.command, sender);
        return;
      }
      if (!this.state.controller && local) this.enqueue(m.command, sender);
      else if (this.state.controller === this.bridge.self.connectionId)
        this.enqueue(m.command, sender);
      return;
    }
    if (
      m.type === 'snapshot' &&
      validSession(m.state) &&
      sender === m.state.controller &&
      this.people.some((p) => p.connectionId === sender && p.role === 'GM')
    ) {
      // Room metadata is the durable authority; broadcasts only accelerate this exact epoch.
      if (m.state.epoch === this.state.epoch && m.state.revision >= this.state.revision)
        this.receiveState(m.state);
    }
    if (
      m.type === 'ping' &&
      typeof m.id === 'string' &&
      m.id.length <= 100 &&
      typeof m.t0 === 'number' &&
      Number.isFinite(m.t0) &&
      this.state.controller === this.bridge.self.connectionId
    ) {
      const t1 = Date.now();
      await this.bridge.send({
        type: 'pong',
        id: m.id,
        to: sender,
        t0: m.t0,
        t1,
        t2: Date.now(),
        epoch: this.state.epoch,
      });
    }
    if (
      m.type === 'pong' &&
      m.to === this.bridge.self.connectionId &&
      sender === this.state.controller &&
      m.epoch === this.state.epoch &&
      typeof m.id === 'string' &&
      typeof m.t0 === 'number' &&
      this.probes.get(m.id) === m.t0 &&
      typeof m.t1 === 'number' &&
      typeof m.t2 === 'number' &&
      Number.isFinite(m.t1) &&
      Number.isFinite(m.t2)
    ) {
      this.probes.delete(m.id);
      const received = Date.now();
      const rawRtt = received - m.t0 - (m.t2 - m.t1);
      if (received < m.t0 || m.t2 < m.t1 || rawRtt < 0 || rawRtt >= 10000) return;
      const sample = clockSample(m.t0, m.t1, m.t2, received);
      this.clockSamples = [
        ...this.clockSamples.filter((s) => received - s.at < 30000),
        { ...sample, at: received },
      ].slice(-8);
      const best = this.clockSamples.reduce((a, b) => (a.rtt < b.rtt ? a : b));
      this.rtt = best.rtt;
      this.offset = best.offset;
      this.engine.apply(this.state);
      this.report();
    }
    if (
      m.type === 'effect' &&
      sender === this.state.controller &&
      m.epoch === this.state.epoch &&
      typeof m.id === 'string' &&
      m.id.length <= 100 &&
      validRef(m.track) &&
      typeof m.gain === 'number' &&
      Number.isFinite(m.gain) &&
      m.gain >= 0 &&
      m.gain <= 1 &&
      typeof m.at === 'number' &&
      Number.isFinite(m.at)
    )
      this.engine.effect(m.id, m.track, m.gain, m.at);
    if (m.type === 'silence' && sender === this.state.controller && m.epoch === this.state.epoch)
      this.engine.stopEffects();
  }
  private enqueue(command: Command, sender: string) {
    // Serialize metadata mutations and isolate failures so the next action can still run.
    this.serial = this.serial
      .then(() => this.execute(command, sender))
      .catch((e) => this.error((e as Error).message));
  }
  private async execute(command: Command, sender: string) {
    if (this.destroyed) return;
    const people = await this.bridge.people();
    if (
      !people.some((p) => p.connectionId === sender && p.role === 'GM') ||
      this.bridge.self.role !== 'GM'
    )
      throw new Error('Only a GM can control shared playback.');
    const raw = await this.bridge.getState();
    const latest = validSession(raw) ? raw : emptySession();
    let state = latest;
    if (command.type === 'takeover' || !state.controller) {
      const now = Date.now();
      state = reanchor(
        state,
        now + (state.controller === this.state.controller ? this.offset : 0),
        now,
      );
      state = {
        ...state,
        controller: this.bridge.self.connectionId,
        controllerName: this.bridge.self.name,
        epoch: crypto.randomUUID(),
        revision: 0,
      };
      this.offset = 0;
      this.rtt = 0;
    }
    if (state.controller !== this.bridge.self.connectionId)
      throw new Error('The conductor has changed. Take control before sending another command.');
    if (command.type === 'sfx') {
      const now = Date.now();
      if (now - (this.lastRequest.get(sender) ?? 0) < 100) return;
      this.lastRequest.set(sender, now);
      // A newly created session must be durable before the one-shot is published.
      if (latest.epoch !== state.epoch) {
        state.revision++;
        await this.commit(state);
      }
      const message = {
        type: 'effect',
        id: crypto.randomUUID(),
        epoch: state.epoch,
        track: command.track,
        gain: command.gain,
        at: now,
      };
      await this.bridge.send(message);
      return;
    }
    if (command.type === 'stopAll') await this.bridge.send({ type: 'silence', epoch: state.epoch });
    state =
      command.type === 'takeover'
        ? { ...state, revision: state.revision + 1 }
        : reduceSession(state, command, Date.now());
    await this.commit(state);
  }
  private async commit(state: Session) {
    if (!validSession(state))
      throw new Error('Session is too large. Remove some queued tracks or shorten their URLs.');
    await this.bridge.setState(state);
    this.receiveState(state);
    await this.bridge.send({ type: 'snapshot', state });
  }
  private probe() {
    if (!this.state.controller || this.state.controller === this.bridge.self.connectionId) {
      this.offset = 0;
      this.rtt = this.state.controller ? 0 : Infinity;
      return;
    }
    const now = Date.now();
    for (const [id, time] of this.probes) if (now - time > 10000) this.probes.delete(id);
    const id = crypto.randomUUID();
    this.probes.set(id, now);
    void this.bridge.send({ type: 'ping', id, t0: now }).catch(() => {});
  }
  private report() {
    if (this.destroyed) return;
    const status: ServiceStatus = {
      state: this.state,
      engine: this.engine.status(),
      preferences: this.prefs,
      clockOffset: this.offset,
      clockRtt: Number.isFinite(this.rtt) ? this.rtt : null,
      people: this.people,
      controllerOnline: this.people.some((p) => p.connectionId === this.state.controller),
    };
    void this.bridge.send({ type: 'status', status }, 'LOCAL').catch(() => {});
  }
  private error(message: string) {
    void this.bridge.send({ type: 'serviceError', message }, 'LOCAL').catch(() => {});
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    this.cleanups.splice(0).forEach((f) => f());
    this.engine.destroy();
  }
}
export function validPreferences(v: unknown): v is Preferences {
  return (
    isRecord(v) &&
    typeof v.muted === 'boolean' &&
    ['master', 'music', 'ambience', 'sfx'].every(
      (k) =>
        typeof v[k] === 'number' &&
        Number.isFinite(v[k]) &&
        (v[k] as number) >= 0 &&
        (v[k] as number) <= 1,
    ) &&
    typeof v.fade === 'number' &&
    Number.isFinite(v.fade) &&
    v.fade >= 0 &&
    v.fade <= 10
  );
}
