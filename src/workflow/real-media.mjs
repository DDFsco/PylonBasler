import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findPython, projectRoot } from './runtime.mjs';
const execute = promisify(execFile);
export class RealMedia {
  busy = false;
  constructor(root) {
    this.root = path.resolve(root);
  }
  locate(id) {
    if (
      typeof id !== 'string' ||
      !/^((group|run)_[a-zA-Z0-9_-]+\/){0,2}real_[a-zA-Z0-9_-]+$/.test(id)
    )
      throw new Error('Invalid real recording ID');
    const root = fs.realpathSync(this.root),
      dir = fs.realpathSync(path.join(root, id));
    if (!dir.startsWith(root + path.sep)) throw new Error('Recording outside root');
    const reportPath = fs.realpathSync(path.join(dir, 'report.json'));
    if (!reportPath.startsWith(dir + path.sep)) throw new Error('Invalid recording report');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const files = report.segments?.map((segment) => segment.file) ?? ['camera.mkv'];
    if (!files.length) throw new Error('Recording has no video segments');
    for (const file of files) {
      if (typeof file !== 'string' || !/^camera(?:_part\d{5})?\.mkv$/.test(file))
        throw new Error('Invalid recording segment');
      if (!fs.realpathSync(path.join(dir, file)).startsWith(dir + path.sep))
        throw new Error('Invalid recording file');
    }
    return dir;
  }
  list() {
    const found = [];
    const walk = (dir, depth) => {
      if (depth > 3 || !fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || e.isSymbolicLink()) continue;
        const next = path.join(dir, e.name);
        if (e.name.startsWith('real_')) {
          try {
            const id = path.relative(this.root, next).split(path.sep).join('/');
            const valid = this.locate(id);
            const r = JSON.parse(fs.readFileSync(path.join(valid, 'report.json'), 'utf8'));
            if (r.decoded_frames > 0)
              found.push({
                id,
                serial: r.serial,
                model: r.model,
                frames: r.decoded_frames,
                state: r.state,
                pixel_format: r.pixel_format,
              });
          } catch {}
        } else if (/^(run|group)_/.test(e.name)) walk(next, depth + 1);
      }
    };
    walk(this.root, 0);
    return found.sort((a, b) => b.id.split('/').at(-1).localeCompare(a.id.split('/').at(-1)));
  }
  async frame(id, index) {
    if (this.busy) throw new Error('Replay decoder is busy');
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid frame index');
    const dir = this.locate(id);
    this.busy = true;
    try {
      const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
      if (index >= report.decoded_frames)
        throw new Error('Frame index is outside the decoded recording');
      const { stdout } = await execute(
        findPython(),
        [path.join(projectRoot, 'scripts/camera_preview.py'), dir, String(index)],
        { windowsHide: true, timeout: 20000, maxBuffer: 4e6 },
      );
      return JSON.parse(stdout);
    } finally {
      this.busy = false;
    }
  }
}
