import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Camera, TTL, Neural, Writer, StateMachine, BoundedQueue, schemas } from './contracts.mjs';

export class SimCamera extends Camera {
  constructor(id, config) {
    super();
    this.id = id;
    this.config = config;
  }
  capture(pulse) {
    const { scenario } = this.config;
    if (scenario === 'missing-frame' && this.id === 'SIM_A' && pulse.index === 3) return [];
    const row = {
      session_id: this.config.sessionId,
      camera_serial: '',
      video_part: '',
      video_frame_index: '',
      camera_block_id: '',
      camera_timestamp_ticks: '',
      camera_tick_hz: '',
      pc_receive_monotonic_ns: process.hrtime.bigint().toString(),
      record_status: 'metadata_only',
      frame_width: 1440,
      frame_height: 512,
      sim_camera_id: this.id,
      sim_event_id: scenario === 'ambiguous' && pulse.index === 3 ? '' : pulse.id,
      sim_block_id: pulse.index + 1,
      sim_camera_ticks: 1000000 + pulse.index * 10000,
      sim_camera_tick_hz: 1000000,
      clock_domain: `sim_camera_${this.id}`,
    };
    return scenario === 'duplicate-frame' && this.id === 'SIM_A' && pulse.index === 3
      ? [row, { ...row }]
      : [row];
  }
}
export class SimTTL extends TTL {
  constructor(config) {
    super();
    this.config = config;
  }
  observe(pulse) {
    if (this.config.scenario === 'missing-ttl' && pulse.index === 3) return [];
    const row = {
      ttl_index: pulse.index,
      edge: 'rising',
      tdt_sample_index: '',
      tdt_sample_rate_hz: '',
      tdt_time_s: '',
      event_source: 'simulation',
      event_channel: 'SIM_TRIGGER',
      sim_event_id: pulse.id,
      sim_sample_index: pulse.index * 100,
      sim_sample_rate_hz: 10000,
      sim_time_s: pulse.index / 100,
      clock_domain: 'sim_neural_sample_clock',
    };
    return this.config.scenario === 'duplicate-ttl' && pulse.index === 3
      ? [row, { ...row }]
      : [row];
  }
}
export class SimNeural extends Neural {
  preview(pulse) {
    return {
      channel: 'SIM_SINE',
      tdt_sample_index: '',
      tdt_time_s: '',
      value: Math.sin((2 * Math.PI * pulse.index) / 100),
      unit: 'simulation_arbitrary',
      decimation_factor: 100,
      sim_sample_index: pulse.index * 100,
      sim_sample_rate_hz: 10000,
      sim_time_s: pulse.index / 100,
      clock_domain: 'sim_neural_sample_clock',
    };
  }
}
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
export class CSVWriter extends Writer {
  count = 0;
  constructor(dir, failAfter = Infinity) {
    super();
    this.dir = dir;
    this.failAfter = failAfter;
    this.streams = {
      SIM_A: ['camera_SIM_A_frames.csv', 'frames'],
      SIM_B: ['camera_SIM_B_frames.csv', 'frames'],
      ttl: ['ttl_events.csv', 'ttl'],
      neural: ['neural_preview.csv', 'neural'],
    };
    for (const [file, schema] of Object.values(this.streams))
      fs.writeFileSync(path.join(dir, file), schemas[schema] + '\n', { flag: 'wx' });
  }
  write(stream, row) {
    if (this.count >= this.failAfter) throw new Error('INJECTED_WRITER_FAILURE');
    const [file, schema] = this.streams[stream];
    fs.appendFileSync(
      path.join(this.dir, file),
      schemas[schema]
        .split(',')
        .map((k) => csvCell(row[k]))
        .join(',') + '\n',
    );
    this.count++;
  }
}

// Matching evidence is a synthetic causal event token, NOT order, block ID, or clock subtraction.
// Hardware use requires an independently validated mapping algorithm and calibration evidence.
export function qc(frames, ttls, expectedIds, cameraIds = ['SIM_A', 'SIM_B']) {
  const map = [],
    issues = [];
  const add = (camera, id, f, t, status, flag) => {
    map.push({
      camera_serial: '',
      video_part: '',
      video_frame_index: '',
      camera_block_id: '',
      ttl_index: t?.ttl_index ?? '',
      tdt_sample_index: '',
      match_status: status,
      quality_flag: flag,
      sim_camera_id: camera,
      sim_event_id: id,
      sim_block_id: f?.sim_block_id ?? '',
    });
    if (status !== 'matched_simulation') issues.push({ camera, id, status, flag });
  };
  for (const camera of cameraIds) {
    const cameraFrames = frames.filter((f) => f.sim_camera_id === camera);
    const ids = new Set(
      [
        ...expectedIds,
        ...cameraFrames.map((f) => f.sim_event_id),
        ...ttls.map((t) => t.sim_event_id),
      ].filter(Boolean),
    );
    for (const id of ids) {
      const ff = cameraFrames.filter((f) => f.sim_event_id === id),
        tt = ttls.filter((t) => t.sim_event_id === id);
      if (ff.length > 1 || tt.length > 1) {
        for (const f of ff.length ? ff : [null])
          add(
            camera,
            id,
            f,
            tt[0],
            'ambiguous',
            ff.length > 1 ? 'duplicate_frame' : 'duplicate_ttl',
          );
      } else if (!ff.length && !tt.length) add(camera, id, null, null, 'ambiguous', 'both_missing');
      else if (!ff.length)
        add(camera, id, null, tt[0], 'missing_frame', 'no_frame_with_proven_token');
      else if (!tt.length) add(camera, id, ff[0], null, 'missing_ttl', 'no_ttl_with_proven_token');
      else add(camera, id, ff[0], tt[0], 'matched_simulation', 'synthetic_causal_token_only');
    }
    for (const f of cameraFrames.filter((f) => !f.sim_event_id))
      add(camera, '', f, null, 'ambiguous', 'no_alignment_evidence');
    const seen = new Set();
    for (const f of cameraFrames) {
      if (seen.has(f.sim_block_id))
        issues.push({ camera, status: 'duplicate_block_id', block: f.sim_block_id });
      seen.add(f.sim_block_id);
    }
  }
  return { map, issues, simulation_qc_pass: issues.length === 0 };
}
function json(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
export const scenarios = [
  'clean',
  'missing-frame',
  'missing-ttl',
  'duplicate-frame',
  'duplicate-ttl',
  'ambiguous',
  'overflow',
  'writer-failure',
  'precheck-failure',
];
export function runSession(dir, options = {}) {
  const config = {
    pulses: 20,
    queueCapacity: 8,
    scenario: 'clean',
    ...options,
    sessionId: randomUUID(),
  };
  if (
    !scenarios.includes(config.scenario) ||
    !Number.isInteger(config.pulses) ||
    config.pulses < 5 ||
    config.pulses > 10000
  )
    throw new Error('Use a listed scenario and 5..10000 pulses (metadata demo only)');
  const queues = Object.fromEntries(
    ['SIM_A', 'SIM_B', 'ttl', 'neural'].map((k) => [k, new BoundedQueue(config.queueCapacity)]),
  );
  // Exclusive session directory prevents accidental overwrite of prior evidence.
  fs.mkdirSync(dir);
  fs.mkdirSync(path.join(dir, 'logs'));
  fs.mkdirSync(path.join(dir, 'neural'));
  const state = new StateMachine(),
    faults = [],
    received = [],
    ttls = [],
    expected = [],
    written = { SIM_A: 0, SIM_B: 0, ttl: 0, neural: 0 };
  const manifest = {
    schema_version: '0.1',
    session_id: config.sessionId,
    mode: 'simulation_metadata_only',
    created_utc: new Date().toISOString(),
    operator: '',
    software: { name: 'basler-tdt-simulator', version: '0.1.0', node: process.version },
    hardware: {
      camera_serials: [],
      camera_models: [],
      firmware: [],
      tdt_processor: '',
      synapse_version: '',
      doric_chain: '',
      wiring: '',
    },
    neural_native: { authoritative: true, path: '', status: 'not_present_in_simulation' },
    simulation: {
      ...config,
      fps: 100,
      roi: [1440, 512],
      pixel_format: 'Mono8',
      sample_rate_hz: 10000,
      duration_s: config.pulses / 100,
      wall_clock_pacing: false,
      camera_ids: ['SIM_A', 'SIM_B'],
    },
    clocks: {
      pc_receive_monotonic_ns: 'host monotonic; no cross-domain calibration',
      sim_camera_SIM_A: 'synthetic 1 MHz independent domain',
      sim_camera_SIM_B: 'synthetic 1 MHz independent domain',
      sim_neural_sample_clock: 'synthetic 10 kHz domain',
    },
    alignment_evidence:
      'sim_event_id is a simulator-only causal token, unavailable on real hardware',
    video: { implemented: false, decoded_frame_count: null },
    state: state.state,
  };
  const manifestFile = path.join(dir, 'manifest.json');
  json(manifestFile, manifest);
  const log = (event) =>
    fs.appendFileSync(path.join(dir, 'logs', 'events.jsonl'), JSON.stringify(event) + '\n');
  const move = (next) => {
    state.move(next);
    log({ state: next });
    manifest.state = next;
    manifest.state_history = state.history;
    json(manifestFile, manifest);
  };
  let writer;
  function enqueue(stream, row) {
    // Journal received metadata before queue admission; overflow evidence is retained.
    log({ kind: 'received', stream, row });
    if (stream.startsWith('SIM_')) received.push(row);
    else if (stream === 'ttl') ttls.push(row);
    queues[stream].push(row);
  }
  function drain() {
    for (const [stream, q] of Object.entries(queues))
      while (q.items.length) {
        writer.write(stream, q.peek());
        q.shift();
        written[stream]++;
      }
  }
  try {
    writer = new CSVWriter(dir, config.scenario === 'writer-failure' ? 12 : Infinity);
    move('CONFIGURED');
    if (config.scenario === 'precheck-failure') throw new Error('PRECHECK_NOT_READY');
    // Simulation readiness only; no hardware, storage speed or physical recording assertion.
    manifest.precheck = {
      scope: 'simulation',
      camera_ready: true,
      neural_ready: true,
      trigger_ready: true,
    };
    move('PRECHECKED');
    move('ARMED');
    move('RECORDING');
    const cameras = ['SIM_A', 'SIM_B'].map((id) => new SimCamera(id, config)),
      ttl = new SimTTL(config),
      neural = new SimNeural();
    for (let index = 0; index < config.pulses; index++) {
      const pulse = { index, id: `synthetic-pulse-${index}` };
      expected.push(pulse.id);
      for (const row of ttl.observe(pulse)) enqueue('ttl', row);
      for (const camera of cameras)
        for (const row of camera.capture(pulse)) enqueue(camera.id, row);
      enqueue('neural', neural.preview(pulse));
      if (config.scenario !== 'overflow') drain();
    }
    move('FINALIZING');
    drain();
  } catch (error) {
    faults.push({ code: error.message, state: state.state });
    if (state.state !== 'FAULT') move('FAULT');
    log({ kind: 'fault', ...faults.at(-1) });
    // A functioning writer can still save already queued records after queue overflow.
    if (writer)
      try {
        drain();
      } catch (e) {
        faults.push({ code: e.message, state: 'FAULT', phase: 'drain' });
      }
  }
  const report = qc(received, ttls, expected);
  if (report.issues.length && state.state !== 'FAULT') {
    faults.push({ code: 'QC_FAILED', state: state.state });
    move('FAULT');
    log({ kind: 'fault', code: 'QC_FAILED' });
  }
  fs.writeFileSync(
    path.join(dir, 'frame_ttl_map.csv'),
    schemas.map +
      '\n' +
      report.map
        .map((row) =>
          schemas.map
            .split(',')
            .map((k) => csvCell(row[k]))
            .join(','),
        )
        .join('\n') +
      '\n',
  );
  const ranges = {};
  for (const id of ['SIM_A', 'SIM_B']) {
    const f = received.filter((r) => r.sim_camera_id === id);
    ranges[id] = {
      clock_domain: `sim_camera_${id}`,
      first_tick: f[0]?.sim_camera_ticks ?? null,
      last_tick: f.at(-1)?.sim_camera_ticks ?? null,
      count: f.length,
    };
  }
  ranges.ttl = {
    clock_domain: 'sim_neural_sample_clock',
    first_sample: ttls[0]?.sim_sample_index ?? null,
    last_sample: ttls.at(-1)?.sim_sample_index ?? null,
    count: ttls.length,
  };
  const result = {
    ...report,
    simulation_qc_pass: report.simulation_qc_pass && faults.length === 0,
    hardware_acceptance: false,
    video_verification: 'NOT_IMPLEMENTED_METADATA_ONLY',
    state: state.state === 'FAULT' ? 'FAULT' : 'COMPLETE',
    faults,
    expected_generated_pulses: expected.length,
    requested_pulses: config.pulses,
    received_frames: received.length,
    received_ttls: ttls.length,
    written,
    stream_ranges: ranges,
    queue_high_water: Object.fromEntries(Object.entries(queues).map(([k, q]) => [k, q.highWater])),
    pending_records: Object.fromEntries(
      Object.entries(queues).map(([k, q]) => [k, q.items.length]),
    ),
    recovery:
      'Received metadata is also in logs/events.jsonl. No image pixels exist. Real filesystem failures may prevent final reports; initial manifest and prior rows are retained.',
  };
  delete result.map;
  manifest.faults = faults;
  json(path.join(dir, 'qc_report.json'), result);
  // COMPLETE is committed only after the mapping and QC files exist.
  if (state.state !== 'FAULT') move('COMPLETE');
  else json(manifestFile, manifest);
  return result;
}
