import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { FORMATS } from './config.mjs';
export const hash = (b) => createHash('sha256').update(b).digest('hex');
export function launch(exe, args) {
  const p = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let errorText = '';
  p.stderr.on('data', (b) => {
    errorText = (errorText + b.toString()).slice(-8192);
  });
  // Consume stdin errors even if they occur between writes.
  p.stdin.on('error', () => {});
  p.done = new Promise((resolve, reject) => {
    p.once('error', reject);
    p.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${errorText}`)),
    );
  });
  p.done.catch(() => {});
  return p;
}
export async function verifyVideo(exe, file, hashFile, pixelFormat) {
  const expected = [];
  const reader = readline.createInterface({
    input: fs.createReadStream(hashFile),
    crlfDelay: Infinity,
  });
  for await (const line of reader) if (line) expected.push(JSON.parse(line).sha256);
  const p = launch(exe, [
    '-v',
    'error',
    '-xerror',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-fps_mode',
    'passthrough',
    '-pix_fmt',
    FORMATS[pixelFormat].ffmpeg,
    '-f',
    'framehash',
    '-hash',
    'sha256',
    'pipe:1',
  ]);
  p.stdin.end();
  const lines = readline.createInterface({ input: p.stdout, crlfDelay: Infinity });
  let decoded = 0,
    mismatches = 0;
  for await (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const value = line.split(',').at(-1).trim();
    if (value !== expected[decoded]) mismatches++;
    decoded++;
  }
  await p.done;
  if (decoded !== expected.length || mismatches)
    throw new Error(
      `DECODE_MISMATCH expected=${expected.length} decoded=${decoded} mismatches=${mismatches}`,
    );
  return {
    decoded_frames: decoded,
    pixel_hashes_match: true,
    method: 'actual_decode_sha256_per_frame',
  };
}
