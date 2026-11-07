import OBR from '@owlbear-rodeo/sdk';
export const META_KEY = 'app.resonance/transport';
export const CHANNEL = 'app.resonance/v1';
export type Person = { id: string; connectionId: string; name: string; role: 'GM' | 'PLAYER' };
export type Message = { data: unknown; connectionId: string };
export interface Bridge {
  demo: boolean;
  self: Person;
  getState(): Promise<unknown>;
  setState(state: unknown): Promise<void>;
  onState(fn: (v: unknown) => void): () => void;
  send(data: unknown, destination?: 'LOCAL' | 'REMOTE' | 'ALL'): Promise<void>;
  onMessage(fn: (e: Message) => void): () => void;
  people(): Promise<Person[]>;
  onPeople(fn: (p: Person[]) => void): () => void;
  destroy(): void;
}
export async function createBridge(): Promise<Bridge> {
  if (!OBR.isAvailable && window.self === window.top) return demoBridge();
  await new Promise<void>((resolve) => {
    if (OBR.isReady) resolve();
    else OBR.onReady(resolve);
  });
  const self: Person = {
    id: OBR.player.id,
    connectionId: await OBR.player.getConnectionId(),
    name: await OBR.player.getName(),
    role: await OBR.player.getRole(),
  };
  const cleanups: (() => void)[] = [];
  cleanups.push(OBR.player.onChange((p) => Object.assign(self, p)));
  return {
    demo: false,
    self,
    getState: async () => (await OBR.room.getMetadata())[META_KEY],
    setState: (state) => OBR.room.setMetadata({ [META_KEY]: state }),
    onState: (fn) => OBR.room.onMetadataChange((m) => fn(m[META_KEY])),
    send: (data, destination = 'ALL') => OBR.broadcast.sendMessage(CHANNEL, data, { destination }),
    onMessage: (fn) => OBR.broadcast.onMessage(CHANNEL, fn),
    people: async () => [self, ...(await OBR.party.getPlayers())],
    onPeople: (fn) => {
      const update = async () => fn([self, ...(await OBR.party.getPlayers())]);
      const a = OBR.party.onChange((p) => fn([self, ...p]));
      const b = OBR.player.onChange(() => {
        void update();
      });
      return () => {
        a();
        b();
      };
    },
    destroy: () => cleanups.splice(0).forEach((f) => f()),
  };
}
// The standalone desk is an explicit local simulator. OBR always uses its SDK.
function demoBridge(): Bridge {
  const params = new URLSearchParams(location.search);
  const room = (params.get('room') ?? 'preview').replace(/[^\w-]/g, '').slice(0, 50);
  const id = crypto.randomUUID();
  const self: Person = {
    id,
    connectionId: id,
    name: params.get('role') === 'PLAYER' ? 'Guest listener' : 'You',
    role: params.get('role') === 'PLAYER' ? 'PLAYER' : 'GM',
  };
  const channel = new BroadcastChannel(`resonance-demo-${room}`);
  const stateKey = `resonance-demo-state-${room}`;
  const messages = new Set<(e: Message) => void>();
  const states = new Set<(v: unknown) => void>();
  const peopleListeners = new Set<(p: Person[]) => void>();
  const peers = new Map<string, { person: Person; seen: number }>();
  const publishPeople = () =>
    peopleListeners.forEach((f) => f([self, ...[...peers.values()].map((p) => p.person)]));
  const hello = () => {
    channel.postMessage({ kind: 'hello', self });
    for (const [key, p] of peers)
      if (Date.now() - p.seen > 8000) {
        peers.delete(key);
        publishPeople();
      }
  };
  channel.onmessage = (e) => {
    const m = e.data;
    if (m.kind === 'hello') {
      const fresh = !peers.has(m.self.connectionId);
      peers.set(m.self.connectionId, { person: m.self, seen: Date.now() });
      if (fresh) {
        hello();
        publishPeople();
      }
    }
    if (m.kind === 'bye') {
      peers.delete(m.id);
      publishPeople();
    }
    if (m.kind === 'message') messages.forEach((f) => f({ data: m.data, connectionId: m.sender }));
    if (m.kind === 'state') states.forEach((f) => f(m.state));
  };
  const timer = setInterval(hello, 2000);
  hello();
  return {
    demo: true,
    self,
    getState: async () => {
      try {
        return JSON.parse(localStorage.getItem(stateKey) ?? 'null');
      } catch {
        return null;
      }
    },
    setState: async (state) => {
      localStorage.setItem(stateKey, JSON.stringify(state));
      channel.postMessage({ kind: 'state', state });
      states.forEach((f) => f(state));
    },
    onState: (fn) => {
      states.add(fn);
      return () => states.delete(fn);
    },
    send: async (data, destination = 'ALL') => {
      if (destination !== 'LOCAL') channel.postMessage({ kind: 'message', data, sender: id });
      if (destination !== 'REMOTE') messages.forEach((f) => f({ data, connectionId: id }));
    },
    onMessage: (fn) => {
      messages.add(fn);
      return () => messages.delete(fn);
    },
    people: async () => [self, ...[...peers.values()].map((p) => p.person)],
    onPeople: (fn) => {
      peopleListeners.add(fn);
      return () => peopleListeners.delete(fn);
    },
    destroy: () => {
      clearInterval(timer);
      channel.postMessage({ kind: 'bye', id });
      channel.close();
    },
  };
}
