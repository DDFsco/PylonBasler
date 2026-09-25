import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp, readJSONBody } from '../src/server.mjs';
import {
  RealCameraCheck,
  forceTerminate,
  validateSerials,
  summarizeChecks,
  validateSettings,
} from '../src/workflow/real-check.mjs';
test('real study settings are bounded before camera access', () => {
  assert.deepEqual(validateSettings(), {
    fps: 10,
    seconds: 10,
    cameraCount: 1,
    captureMode: 'free_run_no_ttl',
    triggerSource: 'Line1',
    triggerWaitSeconds: 120,
    segmentSeconds: 300,
  });
  assert.deepEqual(
    validateSettings({
      fps: 100,
      seconds: 14400,
      cameraCount: 6,
      captureMode: 'external_ttl_frame_start',
      triggerSource: 'Line3',
      triggerWaitSeconds: 600,
      segmentSeconds: 600,
    }),
    {
      fps: 100,
      seconds: 14400,
      cameraCount: 6,
      captureMode: 'external_ttl_frame_start',
      triggerSource: 'Line3',
      triggerWaitSeconds: 600,
      segmentSeconds: 600,
    },
  );
  for (const options of [
    { fps: 0 },
    { fps: 101 },
    { fps: '100' },
    { seconds: 0 },
    { seconds: 14401 },
    { seconds: 1.5 },
  ])
    assert.throws(() => validateSettings(options), /requires/);
  for (const cameraCount of [0, 7, 1.5, '2'])
    assert.throws(() => validateSettings({ cameraCount }), /Camera count/);
  assert.throws(() => validateSettings({ captureMode: 'bad' }), /capture mode/);
  assert.throws(() => validateSettings({ triggerSource: 'Software' }), /Trigger source/);
  assert.throws(() => validateSettings({ triggerWaitSeconds: 4 }), /Trigger wait/);
  assert.throws(() => validateSettings({ segmentSeconds: 30 }), /Segment duration/);
});

test('forced stop targets the complete Windows process tree', () => {
  const child = {
    pid: 1234,
    kill() {
      throw new Error('fallback should not run');
    },
  };
  let command, args;
  const fakeSpawn = (nextCommand, nextArgs) => {
    command = nextCommand;
    args = nextArgs;
    return { once() {} };
  };
  assert.equal(forceTerminate(child, fakeSpawn), true);
  if (process.platform === 'win32') {
    assert.equal(command, 'taskkill');
    assert.deepEqual(args, ['/pid', '1234', '/T', '/F']);
  }
});

test('request JSON preserves a multibyte character split across chunks', async () => {
  const encoded = Buffer.from(JSON.stringify({ operator: 'Renée' }));
  const split = encoded.indexOf(Buffer.from('é')) + 1;
  const request = (async function* () {
    yield encoded.subarray(0, split);
    yield encoded.subarray(split);
  })();
  assert.deepEqual(await readJSONBody(request), { operator: 'Renée' });
});

test('multi camera selection rejects duplicates and more than six cameras', () => {
  assert.throws(() => validateSerials([]));
  assert.throws(() => validateSerials(['40475309', '40475309']), /Duplicate/);
  assert.throws(() => validateSerials(Array.from({ length: 7 }, (_, i) => String(100000 + i))));
  assert.equal(validateSerials(['40475309', '40488229']).length, 2);
});
test('concurrent check requires overlapping receives and all streams verified', () => {
  const good = {
    state: 'COMPLETE',
    video_verified: true,
    settings_restored: true,
    received_frames: 100,
    written_frames: 100,
    decoded_frames: 100,
    first_pc_monotonic_ns: '1000000000',
    last_pc_monotonic_ns: '11000000000',
    faults: [],
  };
  const r = summarizeChecks([good, { ...good, first_pc_monotonic_ns: '2000000000' }]);
  assert.equal(r.state, 'COMPLETE');
  assert.equal(r.pc_receive_overlap_s, 9);
  assert.equal(r.decoded_frames, 200);
  assert.equal(r.synchronization_verified, false);
  assert.equal(r.capture_mode, 'free_run_no_ttl');
  assert.equal(r.ttl_required, false);
  assert.equal(r.ttl_recorded, false);
  assert.equal(
    summarizeChecks([
      good,
      { ...good, first_pc_monotonic_ns: '12000000000', last_pc_monotonic_ns: '22000000000' },
    ]).state,
    'FAULT',
  );
  assert.equal(summarizeChecks([good, { ...good, state: 'FAULT' }]).state, 'FAULT');
  assert.equal(summarizeChecks([good, { ...good, settings_restored: false }]).state, 'FAULT');
  const triggered = summarizeChecks([
    { ...good, capture_mode: 'external_ttl_frame_start', camera_ttl_trigger_verified: true },
    { ...good, capture_mode: 'external_ttl_frame_start', camera_ttl_trigger_verified: true },
  ]);
  assert.equal(triggered.ttl_required, true);
  assert.equal(triggered.shared_trigger_configured, true);
  assert.equal(triggered.synchronization_verified, false);
});

test('real camera start requires serial and rejects an already running check', () => {
  const c = new RealCameraCheck();
  for (const serial of ['', undefined, '../../x', '40475309 --bad'])
    assert.throws(() => c.start(serial), /serial number/);
  c.child = {};
  assert.throws(() => c.start('40475309'), /already active/);
});
test('real camera API requires token and blocks simulation mutations while hardware is busy', async () => {
  fs.mkdirSync('work/real-api-test', { recursive: true });
  const app = createApp('work/real-api-test/sessions');
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (route, body, token = app.token) =>
    fetch(base + '/api/' + route, {
      method: 'POST',
      headers: { 'X-Session-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post('real/start', { serial: '40475309' }, 'wrong')).status, 403);
    assert.equal((await post('real/start', { serial: 'bad' })).status, 400);
    app.realCheck.child = {};
    const blocked = await post('camera/settings', {
      operation: 'apply',
      serial: '40475309',
      changes: { ExposureTime: 5000 },
    });
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).error, /unavailable during recording/);
    assert.equal(
      (await post('camera/settings', { operation: 'read', serial: '40475309' }, 'wrong')).status,
      403,
    );
    const r = await post('configure', {});
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /real camera study is active/i);
    assert.equal(app.session, null);
  } finally {
    app.realCheck.child = null;
    await new Promise((r) => app.server.close(r));
  }
});
