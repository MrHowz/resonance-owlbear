import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('keeps the desk usable without persistent storage and can export its temporary library', async () => {
  vi.stubGlobal('indexedDB', {
    open() {
      throw new DOMException('Storage blocked', 'SecurityError');
    },
  });
  const lib = await import('../src/core/library');
  const { parseTrack } = await import('../src/core/validation');
  const track = parseTrack({
    title: 'Temporary sound',
    url: 'https://example.com/temp.mp3',
    tags: [],
  });
  await lib.saveTrack(track);
  expect(lib.storageIsTemporary()).toBe(true);
  expect((await lib.loadLibrary()).tracks).toEqual([track]);
  expect(lib.exportJSON((await lib.loadLibrary()).tracks, [])).toContain('Temporary sound');
});
