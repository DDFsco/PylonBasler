import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const packageVersion = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
).version;

export function findPython() {
  if (process.env.CAMERA_PYTHON) return process.env.CAMERA_PYTHON;
  const venv = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venv)) return venv;
  return process.platform === 'win32' ? 'python' : 'python3';
}
