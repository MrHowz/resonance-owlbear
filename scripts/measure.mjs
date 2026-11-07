import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import Fuse from 'fuse.js';
const names = (await readdir(new URL('../dist/assets/', import.meta.url))).filter((n) =>
  n.endsWith('.js'),
);
const assets = await Promise.all(
  names.map(async (name) => {
    const body = await readFile(new URL(`../dist/assets/${name}`, import.meta.url));
    return { name, bytes: body.length, gzipBytes: gzipSync(body).length };
  }),
);
let baseline = null;
try {
  const body = await readFile(
    new URL('../../tracks-investigation/shipped/assets/index-82c44e3a.js', import.meta.url),
  );
  baseline = { version: 'Tracks 1.8.0', bytes: body.length, gzipBytes: gzipSync(body).length };
} catch {
  /* Standalone project does not ship the inspected application. */
}
const data = Array.from({ length: 10000 }, (_, i) => ({
  title: `Track ${i} ${i % 2 ? 'forest' : 'tavern'}`,
  tags: [i % 2 ? 'exploration' : 'rest', `mood-${i % 10}`],
}));
const start = performance.now();
const index = new Fuse(data, {
  keys: [{ name: 'title', weight: 2 }, 'tags'],
  threshold: 0.34,
  ignoreLocation: true,
});
const indexMs = performance.now() - start;
const queries = ['forest', 'tavern', 'exploration', 'mood-4', 'foret'];
const timings = queries.map((query) => {
  const t = performance.now();
  const results = index.search(query);
  return { query, ms: +(performance.now() - t).toFixed(2), matches: results.length };
});
const output = {
  measuredAt: new Date().toISOString(),
  runtime: process.version,
  platform: process.platform,
  assets,
  total: assets.reduce(
    (a, b) => ({ bytes: a.bytes + b.bytes, gzipBytes: a.gzipBytes + b.gzipBytes }),
    { bytes: 0, gzipBytes: 0 },
  ),
  baseline,
  search: { rows: 10000, indexMs: +indexMs.toFixed(2), timings },
  limitations: [
    'Bundle byte sizes exclude CSS, fonts, audio and remote dependencies. Both gzip sizes use local Node zlib defaults, not measured HTTP transfer sizes.',
    'Search timings use synthetic data in one Node process; these are smoke measurements, not browser or cross-device benchmarks. No original-vs-new CPU, memory or synchronization latency speedup was measured.',
  ],
};
await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../docs/measurements.json', import.meta.url),
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output, null, 2));
