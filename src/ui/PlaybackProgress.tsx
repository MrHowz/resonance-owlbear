import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { clamp, elapsed, formatTime, type Layer } from '../core/model';

interface Props {
  layer: Layer;
  duration: number;
  clockOffset: number;
  canSeek: boolean;
  onSeek: (position: number) => void;
}
type Draft = { position: number; changed: boolean; pointerId?: number };
type PendingSeek = { position: number; at: number; baseline: string };
const seekKeys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);

// Only this small control paints on animation frames. Library rows, the mixer,
// audio playback and room metadata do not need to update at the display rate.
export function PlaybackProgress({ layer, duration, clockOffset, canSeek, onSeek }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const currentTime = useRef<HTMLSpanElement>(null);
  const preview = useRef<HTMLOutputElement>(null);
  const helpId = useId();
  const [scrubbing, setScrubbing] = useState(false);
  const draft = useRef<Draft | null>(null);
  const pending = useRef<PendingSeek | null>(null);
  const keyboardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ layer, duration, clockOffset, canSeek, onSeek });
  const clock = useRef({ position: 0, at: 0 });
  const previousPlaying = useRef(layer.playing);
  const usableDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const disabled = !canSeek || !layer.track || !usableDuration;

  const positionAt = useCallback((now = performance.now()) => {
    const { layer, duration } = latest.current;
    if (draft.current) return draft.current.position;
    const base = pending.current ?? clock.current;
    const position = base.position + (layer.playing ? Math.max(0, now - base.at) / 1000 : 0);
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return layer.loop && !pending.current ? position % duration : clamp(position, 0, duration);
  }, []);

  const paint = useCallback((position: number) => {
    const duration = latest.current.duration;
    const bounded = Number.isFinite(duration) && duration > 0 ? clamp(position, 0, duration) : 0;
    const fraction = duration > 0 ? bounded / duration : 0;
    if (input.current) input.current.value = bounded.toFixed(3);
    if (fill.current) fill.current.style.transform = `scaleX(${fraction})`;
    control.current?.style.setProperty('--seek-position', `${fraction * 100}%`);
    const text = formatTime(bounded);
    if (currentTime.current?.textContent !== text && currentTime.current)
      currentTime.current.textContent = text;
    if (preview.current?.textContent !== text && preview.current)
      preview.current.textContent = text;
    const valueText = `${text} of ${formatTime(duration)}`;
    if (input.current?.getAttribute('aria-valuetext') !== valueText)
      input.current?.setAttribute('aria-valuetext', valueText);
  }, []);

  const rebase = useCallback(() => {
    const { layer, duration, clockOffset } = latest.current;
    clock.current = {
      position: elapsed(layer, Date.now() + clockOffset, duration),
      at: performance.now(),
    };
  }, []);

  useLayoutEffect(() => {
    latest.current = { layer, duration, clockOffset, canSeek, onSeek };
    const timeline = `${layer.anchor}:${layer.position}`;
    const interrupted = previousPlaying.current !== layer.playing || disabled;
    // Do not let a status refresh, room fader change or acknowledgement of an
    // earlier seek pull the thumb away from the user's current drag/seek.
    if (
      interrupted ||
      (pending.current &&
        timeline !== pending.current.baseline &&
        Math.abs(layer.position - pending.current.position) < 0.02)
    ) {
      pending.current = null;
      clearTimeout(pendingTimer.current);
    }
    if (disabled) {
      draft.current = null;
      clearTimeout(keyboardTimer.current);
      setScrubbing(false);
    }
    previousPlaying.current = layer.playing;
    rebase();
    paint(positionAt());
  }, [layer, duration, clockOffset, canSeek, onSeek, disabled, paint, positionAt, rebase]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      paint(positionAt());
      if (layer.playing && usableDuration && !scrubbing && !document.hidden)
        frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        rebase();
        tick();
      }
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [layer.playing, usableDuration, scrubbing, paint, positionAt, rebase]);

  useEffect(
    () => () => {
      clearTimeout(keyboardTimer.current);
      clearTimeout(pendingTimer.current);
    },
    [],
  );

  function commit() {
    clearTimeout(keyboardTimer.current);
    const selection = draft.current;
    draft.current = null;
    setScrubbing(false);
    if (!selection?.changed || disabled) {
      paint(positionAt());
      return;
    }
    const position = clamp(selection.position, 0, usableDuration);
    pending.current = {
      position,
      at: performance.now(),
      baseline: `${layer.anchor}:${layer.position}`,
    };
    clearTimeout(pendingTimer.current);
    // Restore the authoritative timeline if a rejected/disconnected command
    // never arrives back. This timeout is local UI state, not a room write.
    pendingTimer.current = setTimeout(() => {
      pending.current = null;
      rebase();
      paint(positionAt());
    }, 2500);
    paint(position);
    onSeek(position);
  }

  function cancel() {
    clearTimeout(keyboardTimer.current);
    draft.current = null;
    setScrubbing(false);
    paint(positionAt());
  }

  return (
    <div className={`seek-row${scrubbing ? ' is-scrubbing' : ''}`}>
      <span ref={currentTime} className="seek-time">
        0:00
      </span>
      <div ref={control} className={`seek-control${disabled ? ' is-disabled' : ''}`}>
        <div className="seek-rail" aria-hidden="true">
          <div ref={fill} className="seek-fill" />
        </div>
        <output ref={preview} className="seek-preview" aria-hidden="true">
          0:00
        </output>
        <input
          ref={input}
          aria-label="Music position"
          aria-describedby={helpId}
          type="range"
          min="0"
          max={usableDuration || 1}
          step=".001"
          defaultValue="0"
          disabled={disabled}
          onPointerDown={(e) => {
            if (disabled || e.button !== 0) return;
            clearTimeout(keyboardTimer.current);
            draft.current = { position: positionAt(), changed: false, pointerId: e.pointerId };
            setScrubbing(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onChange={(e) => {
            if (disabled) return;
            draft.current = {
              ...draft.current,
              position: Number(e.currentTarget.value),
              changed: true,
            };
            setScrubbing(true);
            paint(draft.current.position);
            if (draft.current.pointerId === undefined) {
              clearTimeout(keyboardTimer.current);
              keyboardTimer.current = setTimeout(commit, 180);
            }
          }}
          onPointerUp={(e) => {
            if (draft.current?.pointerId === e.pointerId) commit();
          }}
          onLostPointerCapture={(e) => {
            if (draft.current?.pointerId === e.pointerId) commit();
          }}
          onPointerCancel={cancel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
              return;
            }
            if (disabled || !seekKeys.has(e.key)) return;
            e.preventDefault();
            const current = positionAt();
            const jump =
              e.key === 'PageUp'
                ? 10
                : e.key === 'PageDown'
                  ? -10
                  : e.key === 'ArrowRight' || e.key === 'ArrowUp'
                    ? 1
                    : -1;
            const position = clamp(
              e.key === 'Home' ? 0 : e.key === 'End' ? usableDuration : current + jump,
              0,
              usableDuration,
            );
            draft.current = { position, changed: true };
            setScrubbing(true);
            paint(position);
            clearTimeout(keyboardTimer.current);
          }}
          onKeyUp={(e) => {
            if (seekKeys.has(e.key) && draft.current?.pointerId === undefined) commit();
          }}
          onBlur={() => {
            if (draft.current?.pointerId === undefined) commit();
          }}
        />
      </div>
      <span className="seek-time">{formatTime(usableDuration)}</span>
      <span id={helpId} className="visually-hidden">
        Use arrow keys to seek one second, Page Up or Down for ten seconds, Home or End for the
        start or end, and Escape to cancel.
      </span>
    </div>
  );
}
