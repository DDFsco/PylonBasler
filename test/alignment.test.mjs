import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCalibrated } from '../src/workflow/alignment.mjs';
const c = {
  validated: true,
  evidence: 'test-fixture-only',
  samplesPerTick: 0.01,
  anchorTick: 1000,
  anchorSample: 200,
  uncertaintySamples: 0.2,
  validFromTick: 1000,
  validToTick: 5000,
  cameraClock: 'CAM',
  tdtClock: 'TDT',
};
test('calibrated alignment is independent of input order and clock epochs', () => {
  const r = matchCalibrated(
    [
      { id: 'b', ticks: 2000, clock: 'CAM' },
      { id: 'a', ticks: 1000, clock: 'CAM' },
    ],
    [
      { index: 7, sample: 200, clock: 'TDT' },
      { index: 9, sample: 210, clock: 'TDT' },
    ],
    c,
  );
  assert.equal(r[0].ttl_index, 9);
  assert.equal(r[1].ttl_index, 7);
});
test('ambiguous, missing, reset and wrong-domain timing never silently pairs by order', () => {
  const f = [{ id: 'a', ticks: 1000, clock: 'CAM' }];
  assert.equal(matchCalibrated(f, [], c)[0].status, 'missing_ttl');
  assert.equal(
    matchCalibrated(
      f,
      [
        { index: 1, sample: 200, clock: 'TDT' },
        { index: 2, sample: 200, clock: 'TDT' },
      ],
      c,
    )[0].status,
    'ambiguous',
  );
  assert.equal(matchCalibrated([{ ...f[0], ticks: 0 }], [], c)[0].status, 'ambiguous');
  assert.equal(matchCalibrated(f, [], { ...c, validated: false })[0].status, 'ambiguous');
  assert.equal(matchCalibrated([{ ...f[0], clock: 'HOST' }], [], c)[0].status, 'ambiguous');
});
test('two frames cannot both consume one event; inaccurate clock model leaves a gap', () => {
  const f = [
      { id: 'a', ticks: 1000, clock: 'CAM' },
      { id: 'b', ticks: 1000, clock: 'CAM' },
    ],
    t = [{ index: 1, sample: 200, clock: 'TDT' }];
  assert.ok(
    matchCalibrated(f, t, c)
      .slice(0, 2)
      .every((x) => x.status === 'ambiguous'),
  );
  assert.equal(
    matchCalibrated(
      [{ id: 'later', ticks: 5000, clock: 'CAM' }],
      [{ index: 1, sample: 245, clock: 'TDT' }],
      c,
    )[0].status,
    'missing_ttl',
  );
});
