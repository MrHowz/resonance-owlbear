// Deliver the first value immediately, then only the newest value in each
// interval. A pointer/key release flushes the final value without waiting.
export function latestThrottle<T>(deliver: (value: T) => void, interval = 100) {
  let lastAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued: { value: T } | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!queued) return;
    const value = queued.value;
    queued = undefined;
    lastAt = performance.now();
    deliver(value);
  };
  return {
    push(value: T, final = false) {
      queued = { value };
      const remaining = interval - (performance.now() - lastAt);
      if (final || remaining <= 0) flush();
      else if (!timer) timer = setTimeout(flush, remaining);
    },
    flush,
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      queued = undefined;
    },
  };
}
