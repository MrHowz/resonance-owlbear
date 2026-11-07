import { useCallback, useEffect, useRef, useState } from 'react';
import { createBridge, type Bridge } from '../platform/bridge';
import { RoomService, validPreferences, type ServiceStatus } from '../platform/service';
import { isRecord, validSession } from '../core/validation';
import { DEFAULT_PREFS, emptySession, type Command, type Preferences } from '../core/model';
import { latestThrottle } from './latestThrottle';
type GainCommand = Extract<Command, { type: 'gain' }>;
const emptyStatus = (): ServiceStatus => ({
  state: emptySession(),
  engine: {
    music: { phase: 'idle', position: 0, duration: 0 },
    ambience: { phase: 'idle', position: 0, duration: 0 },
    activeEffects: 0,
  },
  preferences: { ...DEFAULT_PREFS },
  clockOffset: 0,
  clockRtt: null,
  people: [],
  controllerOnline: false,
});
export function useDesk(onError: (text: string) => void) {
  const bridgeRef = useRef<Bridge | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [status, setStatus] = useState(emptyStatus);
  const [connected, setConnected] = useState(false);
  const gainWriters = useRef(new Map<string, ReturnType<typeof latestThrottle<GainCommand>>>());
  const preferenceWriter = useRef<ReturnType<typeof latestThrottle<Preferences>> | undefined>(
    undefined,
  );
  const currentPreferences = useRef<Preferences>({ ...DEFAULT_PREFS });
  const preferenceTargets = useRef(
    new Map<keyof Preferences, { value: number | boolean; expires: number }>(),
  );
  const send = useCallback((cmd: Command) => {
    const b = bridgeRef.current;
    if (!b) return;
    void b
      .send({ type: 'command', command: cmd })
      .catch((e) => errorRef.current((e as Error).message));
  }, []);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void)[] = [];
    let service: RoomService | undefined;
    let owned: Bridge | undefined;
    void createBridge()
      .then(async (b) => {
        if (disposed) {
          b.destroy();
          return;
        }
        owned = b;
        bridgeRef.current = b;
        setBridge(b);
        cleanup.push(
          b.onMessage((e) => {
            if (e.connectionId !== b.self.connectionId || !isRecord(e.data)) return;
            if (
              e.data.type === 'status' &&
              isRecord(e.data.status) &&
              validSession(e.data.status.state) &&
              validPreferences(e.data.status.preferences)
            ) {
              const incoming = e.data.status as unknown as ServiceStatus;
              for (const [key, target] of preferenceTargets.current) {
                if (
                  incoming.preferences[key] === target.value ||
                  performance.now() > target.expires
                )
                  preferenceTargets.current.delete(key);
              }
              const overrides = Object.fromEntries(
                [...preferenceTargets.current].map(([key, target]) => [key, target.value]),
              );
              const preferences = { ...incoming.preferences, ...overrides };
              currentPreferences.current = preferences;
              setStatus({ ...incoming, preferences });
              setConnected(true);
            }
            if (e.data.type === 'serviceError' && typeof e.data.message === 'string')
              errorRef.current(e.data.message);
          }),
        );
        if (b.demo) {
          service = new RoomService(b);
          await service.start();
        }
        await b.send({ type: 'hello' }, 'LOCAL');
        const hello = setInterval(() => {
          void b.send({ type: 'hello' }, 'LOCAL').catch(() => {});
        }, 5000);
        cleanup.push(() => clearInterval(hello));
      })
      .catch((e) => errorRef.current(`Connection failed: ${(e as Error).message}`));
    return () => {
      disposed = true;
      for (const writer of gainWriters.current.values()) writer.cancel();
      preferenceWriter.current?.cancel();
      cleanup.forEach((f) => f());
      service?.destroy();
      owned?.destroy();
      bridgeRef.current = null;
    };
  }, []);
  const command = useCallback(
    (cmd: Command, final = true) => {
      if (cmd.type === 'gain') {
        let writer = gainWriters.current.get(cmd.bus);
        if (!writer) {
          writer = latestThrottle<GainCommand>(send);
          gainWriters.current.set(cmd.bus, writer);
        }
        writer.push(cmd, final);
        return;
      }
      // Preserve ordering when a drag is immediately followed by pause/next.
      for (const writer of gainWriters.current.values()) writer.flush();
      gainWriters.current.clear();
      send(cmd);
    },
    [send],
  );
  const preferences = useCallback((patch: Partial<Preferences>, final = true) => {
    const b = bridgeRef.current;
    if (!b) return;
    const next = { ...currentPreferences.current, ...patch };
    if (!validPreferences(next)) return;
    for (const key of Object.keys(patch) as (keyof Preferences)[])
      preferenceTargets.current.set(key, { value: next[key], expires: performance.now() + 3000 });
    currentPreferences.current = next;
    if (final) setStatus((s) => ({ ...s, preferences: next }));
    preferenceWriter.current ??= latestThrottle<Preferences>((preferences) => {
      void b
        .send({ type: 'preferences', preferences }, 'LOCAL')
        .catch((e) => errorRef.current((e as Error).message));
    });
    preferenceWriter.current.push(next, final);
  }, []);
  const unlock = useCallback(() => {
    void bridgeRef.current?.send({ type: 'unlock' }, 'LOCAL');
  }, []);
  return { bridge, status, connected, command, preferences, unlock };
}
