import { useCallback, useEffect, useRef, useState } from 'react';
import { createBridge, type Bridge } from '../platform/bridge';
import { RoomService, type ServiceStatus } from '../platform/service';
import { isRecord, validSession } from '../core/validation';
import { DEFAULT_PREFS, emptySession, type Command, type Preferences } from '../core/model';
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
  const pending = useRef(
    new Map<string, { command: Command; timer: ReturnType<typeof setTimeout> }>(),
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
              validSession(e.data.status.state)
            ) {
              setStatus(e.data.status as unknown as ServiceStatus);
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
      for (const item of pending.current.values()) clearTimeout(item.timer);
      pending.current.clear();
      cleanup.forEach((f) => f());
      service?.destroy();
      owned?.destroy();
      bridgeRef.current = null;
    };
  }, []);
  const command = useCallback(
    (cmd: Command) => {
      if (cmd.type === 'gain' || cmd.type === 'seek') {
        const key = `${cmd.type}:${cmd.bus}`;
        clearTimeout(pending.current.get(key)?.timer);
        const timer = setTimeout(() => {
          pending.current.delete(key);
          send(cmd);
        }, 120);
        pending.current.set(key, { command: cmd, timer });
        return;
      }
      // Preserve ordering when a drag is immediately followed by pause/next.
      for (const item of pending.current.values()) {
        clearTimeout(item.timer);
        send(item.command);
      }
      pending.current.clear();
      send(cmd);
    },
    [send],
  );
  const preferences = useCallback((p: Preferences) => {
    const b = bridgeRef.current;
    if (!b) return;
    void b
      .send({ type: 'preferences', preferences: p }, 'LOCAL')
      .catch((e) => errorRef.current((e as Error).message));
  }, []);
  const unlock = useCallback(() => {
    void bridgeRef.current?.send({ type: 'unlock' }, 'LOCAL');
  }, []);
  return { bridge, status, connected, command, preferences, unlock };
}
