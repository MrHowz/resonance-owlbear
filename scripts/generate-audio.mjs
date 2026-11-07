import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../public/audio/', import.meta.url));
await mkdir(directory, { recursive: true });
let seed = 4182;
const noise = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return (seed / 4294967296) * 2 - 1;
};
const specs = [
  ['archive', 16, [130.813, 196, 261.626]],
  ['quiet', 16, [146.832, 220, 293.665]],
  ['unknown', 16, [110, 164.814, 220]],
  ['lastlight', 16, [123.471, 185, 246.942]],
  ['rain', 16, []],
  ['woods', 16, []],
  ['thunder', 3, []],
  ['magic', 2, []],
];
for (const [name, duration, notes] of specs) {
  const rate = 22050,
    samples = rate * duration,
    buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  let low = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    low = 0.97 * low + 0.03 * noise();
    const envelope = Math.min(1, t / 0.12, (duration - t) / 0.15);
    let value = notes.reduce(
      (v, f, j) =>
        v +
        Math.sin(2 * Math.PI * f * t) *
          (0.035 + 0.015 * Math.sin((2 * Math.PI * (j + 1) * t) / duration)),
      0,
    );
    if (name === 'rain') value = 0.1 * noise() + low * 0.6;
    if (name === 'woods')
      value =
        low * 0.3 +
        0.025 * Math.sin(2 * Math.PI * 1300 * t + Math.sin(t * 9)) * Math.max(0, Math.sin(t * 2));
    if (name === 'thunder') value = (low * 2 + 0.04 * noise()) * Math.exp(-t * 1.5);
    if (name === 'magic')
      value = Math.sin(2 * Math.PI * (520 * t + 240 * t * t)) * Math.exp(-t * 3) * 0.18;
    buffer.writeInt16LE(
      Math.round(Math.max(-0.9, Math.min(0.9, value * envelope)) * 32767),
      44 + i * 2,
    );
  }
  await writeFile(`${directory}/${name}.wav`, buffer);
}
console.log('Generated 8 original synthetic demo sounds (CC0).');
