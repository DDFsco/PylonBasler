import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findPython } from './runtime.mjs';
const script = fileURLToPath(new URL('../../scripts/camera_settings.py', import.meta.url));
export function cameraSettings(request) {
  return new Promise((resolve, reject) => {
    const p = spawn(findPython(), [script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    p.stdout.on('data', (b) => {
      out += b;
    });
    p.stderr.on('data', (b) => {
      err = (err + b).slice(-4000);
    });
    p.stdin.on('error', () => {});
    p.on('error', reject);
    p.on('close', (code) => {
      try {
        if (code !== 0) throw Error(err || `Camera settings exit ${code}`);
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
    p.stdin.end(JSON.stringify(request));
  });
}
