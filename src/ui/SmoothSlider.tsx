import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clamp } from '../core/model';

interface Props {
  label: string;
  value: number;
  disabled?: boolean;
  className?: string;
  onChange: (value: number, final: boolean) => void;
}
const keys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);
const percent = (value: number) => `${Math.round(value * 100)}%`;

export function SmoothSlider({ label, value, disabled = false, className = '', onChange }: Props) {
  const [draft, setDraft] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const gesture = useRef<{
    start: number;
    value: number;
    changed: boolean;
    pointerId?: number;
  } | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const displayed = draft ?? pending ?? clamp(value);

  useEffect(() => {
    if (pending !== null && Math.abs(value - pending) < 0.0005) setPending(null);
  }, [value, pending]);
  useEffect(() => {
    if (pending === null) return;
    const timer = setTimeout(() => setPending(null), 3000);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (disabled) {
      gesture.current = null;
      setDraft(null);
      setPending(null);
      clearTimeout(fallback.current);
    }
  }, [disabled]);
  useEffect(() => () => clearTimeout(fallback.current), []);

  function change(next: number) {
    const bounded = Math.round(clamp(next) * 1000) / 1000;
    gesture.current ??= { start: displayed, value: displayed, changed: false };
    gesture.current.value = bounded;
    gesture.current.changed = true;
    setDraft(bounded);
    onChange(bounded, false);
  }
  function finish(cancelled = false) {
    clearTimeout(fallback.current);
    const active = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (!active?.changed || disabled) return;
    const next = cancelled ? active.start : active.value;
    setPending(next);
    onChange(next, true);
  }

  return (
    <div className={`smooth-slider ${className}${draft !== null ? ' is-scrubbing' : ''}`}>
      <div
        className={`seek-control${disabled ? ' is-disabled' : ''}`}
        style={{ '--seek-position': `${displayed * 100}%` } as CSSProperties}
      >
        <div className="seek-rail" aria-hidden="true">
          <div className="seek-fill" style={{ transform: `scaleX(${displayed})` }} />
        </div>
        <span className="seek-preview" aria-hidden="true">
          {percent(displayed)}
        </span>
        <input
          aria-label={label}
          aria-valuetext={percent(displayed)}
          type="range"
          min="0"
          max="1"
          step=".001"
          value={displayed}
          disabled={disabled}
          onPointerDown={(e) => {
            if (disabled || e.button !== 0) return;
            clearTimeout(fallback.current);
            gesture.current = {
              start: displayed,
              value: displayed,
              changed: false,
              pointerId: e.pointerId,
            };
            setDraft(displayed);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onChange={(e) => {
            if (disabled) return;
            change(Number(e.currentTarget.value));
            if (gesture.current?.pointerId === undefined) {
              clearTimeout(fallback.current);
              fallback.current = setTimeout(() => finish(), 180);
            }
          }}
          onPointerUp={(e) => {
            if (gesture.current?.pointerId === e.pointerId) finish();
          }}
          onLostPointerCapture={(e) => {
            if (gesture.current?.pointerId === e.pointerId) finish();
          }}
          onPointerCancel={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              finish(true);
              return;
            }
            if (disabled || !keys.has(e.key)) return;
            e.preventDefault();
            clearTimeout(fallback.current);
            const current = gesture.current?.value ?? displayed;
            const jump =
              e.key === 'PageUp'
                ? 0.1
                : e.key === 'PageDown'
                  ? -0.1
                  : e.key === 'ArrowRight' || e.key === 'ArrowUp'
                    ? 0.01
                    : -0.01;
            change(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : current + jump);
          }}
          onKeyUp={(e) => {
            if (keys.has(e.key) && gesture.current?.pointerId === undefined) finish();
          }}
          onBlur={() => {
            if (gesture.current?.pointerId === undefined) finish();
          }}
        />
      </div>
      <span className="slider-value" aria-hidden="true">
        {percent(displayed)}
      </span>
    </div>
  );
}
