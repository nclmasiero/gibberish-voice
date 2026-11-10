// Renders every preset to WAV (in ./renders or the dir given as argv[2]) and prints level stats.
// Usage: npm run build && node scripts/render.mjs [outDir] ["text"]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OfflineAudioContext } from 'node-web-audio-api';
import { presets, render } from '../dist/index.js';

const outDir = process.argv[2] ?? 'renders';
const text = process.argv[3] ?? 'Well met, traveller! Have you seen my cat? She ran off... again.';
mkdirSync(outDir, { recursive: true });

function wav(buffer) {
  const data = buffer.getChannelData(0);
  const out = Buffer.alloc(44 + data.length * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + data.length * 2, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(buffer.sampleRate, 24); out.writeUInt32LE(buffer.sampleRate * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  return out;
}

for (const [name, voice] of Object.entries({ default: {}, ...presets })) {
  const buffer = await render(text, { ...voice, OfflineAudioContext });
  const d = buffer.getChannelData(0);
  let peak = 0, sum = 0, nan = 0;
  for (const x of d) { if (Number.isNaN(x)) nan++; peak = Math.max(peak, Math.abs(x)); sum += x * x; }
  const rmsDb = 10 * Math.log10(sum / d.length);
  writeFileSync(join(outDir, `${name}.wav`), wav(buffer));
  console.log(`${name.padEnd(8)} ${buffer.duration.toFixed(2)}s  peak ${peak.toFixed(3)}  rms ${rmsDb.toFixed(1)} dBFS${nan ? `  NaN×${nan}` : ''}`);
}
