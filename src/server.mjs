import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Session } from './workflow/session.mjs';
import { SynapseStatus } from './workflow/adapters.mjs';
import { inspectSession } from './workflow/recovery.mjs';
import { attachTDT, attachRealTDT } from './workflow/tdt-import.mjs';
import { findFFmpeg } from './workflow/config.mjs';
import { launch } from './workflow/video.mjs';
import { RealCameraCheck } from './workflow/real-check.mjs';
import { RealMedia } from './workflow/real-media.mjs';
import { cameraSettings } from './workflow/camera-settings.mjs';
export async function readJSONBody(request, maxBytes = 3e6) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export function createApp(root = path.resolve('outputs/sessions')) {
  fs.mkdirSync(root, { recursive: true });
  root = fs.realpathSync(root);
  const token = randomBytes(24).toString('hex');
  let session = null,
    busy = false,
    auditBusy = false,
    previewBusy = false;
  const realCheck = new RealCameraCheck(path.join(path.dirname(root), 'real-camera-checks'));
  const realMedia = new RealMedia(realCheck.root);
  const locate = (id) => {
    if (!/^session_[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid session ID');
    const p = path.join(root, id);
    if (!fs.existsSync(p) || fs.lstatSync(p).isSymbolicLink()) throw new Error('Session not found');
    return p;
  };
  const readJSON = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const server = http.createServer(async (req, res) => {
    const address = server.address(),
      origin = `http://127.0.0.1:${address.port}`;
    if (req.headers.host !== `127.0.0.1:${address.port}`) {
      res.writeHead(403);
      return res.end('Use loopback address');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, origin),
        route = url.pathname;
      if (req.method === 'GET' && route === '/') {
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(
          fs
            .readFileSync(new URL('./ui/index.html', import.meta.url), 'utf8')
            .replace('__TOKEN__', token),
        );
      }
      if (req.method === 'GET' && ['/app.js', '/style.css'].includes(route)) {
        res.writeHead(200, {
          'Content-Type': route.endsWith('.js') ? 'text/javascript' : 'text/css',
        });
        return res.end(fs.readFileSync(new URL('./ui' + route, import.meta.url)));
      }
      if (route.startsWith('/api/') && req.headers['x-session-token'] !== token)
        return json({ error: 'Token required' }, 403);
      if (req.method === 'GET') {
        if (route === '/api/real/previews') return json(realCheck.previews());
        if (route === '/api/real/recordings') return json(realMedia.list());
        if (route === '/api/real/frame') {
          if (realCheck.child || session?.state === 'RECORDING' || session?.state === 'FINALIZING')
            throw new Error('Wait until recording finishes before replay');
          return json(
            await realMedia.frame(
              url.searchParams.get('id'),
              Number(url.searchParams.get('index')),
            ),
          );
        }
        if (route === '/api/real/status') return json(realCheck.status());
        if (route === '/api/status') return json(session?.status() ?? { state: 'IDLE' });
        if (route === '/api/tdt-status') return json(await new SynapseStatus().read());
        if (route === '/api/sessions')
          return json(
            fs
              .readdirSync(root)
              .filter((x) => x.startsWith('session_'))
              .flatMap((id) => {
                try {
                  const m = readJSON(locate(id), 'manifest.json');
                  return [{ id, state: m.state, mode: m.mode, created: m.created_utc }];
                } catch {
                  return [];
                }
              })
              .reverse(),
          );
        if (route === '/api/review') {
          const dir = locate(url.searchParams.get('id'));
          return json({
            manifest: readJSON(dir, 'manifest.json'),
            qc: fs.existsSync(path.join(dir, 'qc_report.json'))
              ? readJSON(dir, 'qc_report.json')
              : null,
          });
        }
        if (route === '/api/frame') {
          if (previewBusy) throw new Error('Another replay decode is in progress');
          const dir = locate(url.searchParams.get('id')),
            file = url.searchParams.get('file'),
            index = Number(url.searchParams.get('index'));
          if (
            !/^camera_SIM_[1-6]_part\d{5,}\.mkv$/.test(file) ||
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index > 100000
          )
            throw new Error('Invalid replay selection');
          const fps = Number(readJSON(dir, 'manifest.json').config?.fps);
          if (!Number.isFinite(fps) || fps <= 0) throw new Error('Invalid recording frame rate');
          previewBusy = true;
          try {
            const p = launch(findFFmpeg(), [
              '-v',
              'error',
              '-ss',
              String(index / fps),
              '-i',
              path.join(dir, file),
              '-vf',
              'scale=640:-1',
              '-frames:v',
              '1',
              '-f',
              'image2pipe',
              '-c:v',
              'png',
              'pipe:1',
            ]);
            p.stdin.end();
            const chunks = [];
            let size = 0;
            const timer = setTimeout(() => p.kill(), 10000);
            try {
              for await (const b of p.stdout) {
                size += b.length;
                if (size > 8e6) {
                  p.kill();
                  throw new Error('Preview too large');
                }
                chunks.push(b);
              }
              await p.done;
              if (!size) throw new Error('Frame not found');
              return json({ png: Buffer.concat(chunks).toString('base64') });
            } finally {
              clearTimeout(timer);
            }
          } finally {
            previewBusy = false;
          }
        }
        return json({ error: 'Not found' }, 404);
      }
      if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (req.headers.origin && req.headers.origin !== origin)
        return json({ error: 'Origin rejected' }, 403);
      const data = await readJSONBody(req);
      if (route === '/api/real/stop') return json(realCheck.stop());
      if (route === '/api/real/attach-tdt') {
        if (realCheck.child) throw new Error('Wait for real-camera recording to finish');
        return json(attachRealTDT(realMedia.locate(data.id), data));
      }
      if (route === '/api/camera/settings') {
        if (busy || realCheck.child || (session?.completion && !session.report))
          throw new Error('Camera settings unavailable during recording or another operation');
        busy = true;
        try {
          const result = await cameraSettings(data);
          if (result.error && result.rollback) result.error += ` (rollback: ${result.rollback})`;
          return json(result, result.error ? 400 : 200);
        } finally {
          busy = false;
        }
      }
      if (route === '/api/real/start') {
        if (
          busy ||
          auditBusy ||
          previewBusy ||
          realMedia.busy ||
          (session?.completion && !session.report)
        )
          throw new Error('Wait for the current operation to finish');
        return json(
          realCheck.start(data.serials ?? data.serial, {
            fps: data.fps,
            seconds: data.seconds,
            captureMode: data.captureMode,
            triggerSource: data.triggerSource,
            triggerWaitSeconds: data.triggerWaitSeconds,
          }),
        );
      }
      if (realCheck.child) throw new Error('A real camera study is active; wait for finalization');
      if (route === '/api/configure') {
        if (
          busy ||
          (session &&
            !['IDLE', 'CONFIGURED', 'PRECHECKED', 'ARMED', 'COMPLETE', 'FAULT'].includes(
              session.state,
            )) ||
          (session?.completion && !session.report)
        )
          throw new Error('Recording or finalization is active');
        session = new Session(root, data);
        return json(session.status());
      }
      if (route === '/api/precheck' || route === '/api/arm') {
        if (!session || busy) throw new Error('No session or another operation is active');
        busy = true;
        try {
          if (route.endsWith('precheck')) await session.precheck();
          else await session.arm();
          return json(session.status());
        } finally {
          busy = false;
        }
      }
      if (route === '/api/start') {
        if (!session || busy) throw new Error('Not ready');
        return json(session.start());
      }
      if (route === '/api/stop') {
        if (!session) throw new Error('No session');
        return json(session.stop());
      }
      if (route === '/api/audit') {
        if (auditBusy || session?.state === 'RECORDING' || session?.state === 'FINALIZING')
          throw new Error('Audit unavailable while busy');
        auditBusy = true;
        try {
          return json(await inspectSession(locate(data.id)));
        } finally {
          auditBusy = false;
        }
      }
      if (route === '/api/attach-tdt') return json(attachTDT(locate(data.id), data));
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      if (!res.headersSent) json({ error: e.message }, 400);
      else res.end();
    }
  });
  return {
    server,
    token,
    realCheck,
    get session() {
      return session;
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp(
    process.env.RECORDING_ROOT ? path.resolve(process.env.RECORDING_ROOT) : undefined,
  );
  app.server.listen(Number(process.env.PORT ?? 8765), '127.0.0.1', () =>
    console.log(
      `Open http://127.0.0.1:${app.server.address().port} — real free-run studies and simulation`,
    ),
  );
  process.once('SIGINT', async () => {
    app.realCheck.stop();
    if (app.realCheck.completion) await app.realCheck.completion;
    if (app.session?.state === 'RECORDING') app.session.stop();
    if (app.session?.completion) await app.session.completion;
    app.server.close();
  });
}
