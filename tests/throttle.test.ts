import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { latestThrottle } from '../src/ui/latestThrottle';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('streams the newest value at bounded intervals during a continuous drag', () => {
  const send = vi.fn();
  const writer = latestThrottle(send);
  for (let value = 0; value < 100; value++) {
    writer.push(value);
    vi.advanceTimersByTime(10);
  }
  expect(send.mock.calls.length).toBeLessThanOrEqual(11);
  expect(send.mock.calls[0][0]).toBe(0);
  expect(send.mock.calls.at(-1)?.[0]).toBe(99);
  writer.cancel();
});
it('flushes the final value immediately and cancels the obsolete scheduled send', () => {
  const send = vi.fn();
  const writer = latestThrottle(send);
  writer.push(0.1);
  vi.advanceTimersByTime(10);
  writer.push(0.2);
  writer.push(0.9, true);
  expect(send.mock.calls.map((c) => c[0])).toEqual([0.1, 0.9]);
  vi.advanceTimersByTime(500);
  expect(send).toHaveBeenCalledTimes(2);
});
it('does not send queued values after its owner closes', () => {
  const send = vi.fn();
  const writer = latestThrottle(send);
  writer.push(0.1);
  writer.push(0.8);
  writer.cancel();
  vi.advanceTimersByTime(500);
  expect(send.mock.calls.map((c) => c[0])).toEqual([0.1]);
});
