import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { setTimeout as delay, setImmediate as yieldNow } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { configOf, findFFmpeg, atomicJSON, appendCSV, ttlColumns, mapColumns } from './config.mjs';
import { packageVersion } from './runtime.mjs';
import { ImageCamera, SyntheticTrigger, SyntheticNeural } from './adapters.mjs';
import { OnlineQC } from './quality.mjs';
export class Session {
  state = 'IDLE';
  history = ['IDLE'];
  faults = [];
  streams = {};
  stopRequested = false;
  index = 0;
  preview = {};
  segments = [];
  constructor(root, input = {}, services = {}) {
    this.config = configOf(input);
    this.root = path.resolve(root);
    this.id =
      'session_' + new Date().toISOString().replace(/[:.]/g, '-') + '_' + randomUUID().slice(0, 8);
    this.dir = path.join(this.root, this.id);
    this.ffmpeg = services.ffmpeg ?? findFFmpeg();
    this.space =
      services.space ??
      (() => {
        const s = fs.statfsSync(this.root);
        return s.bavail * s.bsize;
      });
    this.cameras = this.config.cameras.map((c) => new ImageCamera(c));
    this.trigger = new SyntheticTrigger();
    this.neural = new SyntheticNeural();
    this.qc = new OnlineQC(
      this.config.cameras.map((c) => c.id),
      (i) => {
        if (fs.existsSync(this.dir)) this.log({ kind: 'qc_issue', ...i });
      },
    );
    this.move('CONFIGURED');
  }
  move(next) {
    const allowed = {
      IDLE: ['CONFIGURED'],
      CONFIGURED: ['PRECHECKED'],
      PRECHECKED: ['ARMED'],
      ARMED: ['RECORDING'],
      RECORDING: ['FINALIZING'],
      FINALIZING: ['COMPLETE'],
    };
    if (next !== 'FAULT' && !allowed[this.state]?.includes(next))
      throw new Error(`Invalid transition ${this.state} -> ${next}`);
    this.state = next;
    this.history.push(next);
    if (this.manifest) {
      this.log({ kind: 'state', state: next });
      this.save();
    }
  }
  save() {
    Object.assign(this.manifest, {
      state: this.state,
      state_history: this.history,
      faults: this.faults,
    });
    atomicJSON(path.join(this.dir, 'manifest.json'), this.manifest);
  }
  log(row) {
    fs.appendFileSync(
      this.logFD ?? path.join(this.dir, 'logs/events.jsonl'),
      JSON.stringify({ utc: new Date().toISOString(), ...row }) + '\n',
    );
  }
  closeFiles() {
    const errors = [];
    for (const key of ['ttlFD', 'mapFD', 'neuralFD', 'logFD'])
      if (this[key] !== undefined) {
        try {
          fs.closeSync(this[key]);
        } catch (e) {
          errors.push(e.message);
        }
        this[key] = undefined;
      }
    if (errors.length) {
      this.fail(new Error('FILE_CLOSE_FAILED: ' + errors.join('; ')));
      if (this.report) {
        Object.assign(this.report, { state: 'FAULT', simulation_pass: false, faults: this.faults });
        try {
          atomicJSON(path.join(this.dir, 'qc_report.json'), this.report);
        } catch {}
      }
    }
  }
  fail(error) {
    const message = error instanceof Error ? error.message : String(error);
    this.faults.push({ message, state: this.state, sim_pulse: this.index });
    this.stopRequested = true;
    if (this.state !== 'FAULT') {
      this.state = 'FAULT';
      this.history.push('FAULT');
    }
    if (this.manifest)
      try {
        this.log({ kind: 'fault', message });
        this.save();
      } catch (e) {
        this.faults.push({ message: 'FAULT_LOG_UNAVAILABLE: ' + e.message });
      }
  }
  async precheck() {
    if (this.state !== 'CONFIGURED') throw new Error('Precheck requires CONFIGURED');
    fs.mkdirSync(this.root, { recursive: true });
    const result = spawnSync(this.ffmpeg, ['-version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    if (result.error || result.status !== 0)
      throw new Error('FFMPEG_UNAVAILABLE: configure FFMPEG_PATH');
    const seconds = this.config.durationSeconds ?? 60;
    const required = Math.ceil(
      this.config.rateBytesPerSecond * seconds * 1.3 + this.config.reserveBytes,
    );
    const free = this.space();
    if (!Number.isFinite(free) || free < required)
      throw new Error(`DISK_CAPACITY: need ${required} bytes, available ${free}`);
    const probe = path.join(this.root, '.write-probe-' + randomUUID());
    fs.writeFileSync(probe, 'precheck', { flag: 'wx' });
    fs.unlinkSync(probe);
    await Promise.all([...this.cameras, this.trigger, this.neural].map((a) => a.prepare()));
    this.precheckResult = {
      scope: 'simulation',
      free_bytes: free,
      required_bytes: required,
      ffmpeg: result.stdout.split('\n')[0],
      performed_utc: new Date().toISOString(),
      disk_speed_validated: false,
      neural_recording: 'simulation_only',
    };
    this.move('PRECHECKED');
    return this.precheckResult;
  }
  async arm() {
    if (this.state !== 'PRECHECKED') throw new Error('Arm requires PRECHECKED');
    await Promise.all([...this.cameras, this.trigger, this.neural].map((a) => a.arm()));
    this.move('ARMED');
  }
  start() {
    if (this.state !== 'ARMED') throw new Error('Start requires ARMED');
    if (this.space() < this.precheckResult.required_bytes)
      throw new Error('DISK_CAPACITY_CHANGED: repeat precheck with sufficient capacity');
    // Reserve directory and state synchronously to reject double-clicks before awaiting workers.
    fs.mkdirSync(this.dir);
    fs.mkdirSync(path.join(this.dir, 'logs'));
    fs.mkdirSync(path.join(this.dir, 'neural'));
    this.logFD = fs.openSync(path.join(this.dir, 'logs/events.jsonl'), 'wx');
    this.manifest = {
      schema_version: '0.2',
      session_id: this.id,
      created_utc: new Date().toISOString(),
      mode: 'simulation_images',
      config: this.config,
      precheck: this.precheckResult,
      software: {
        version: packageVersion,
        node: process.version,
        ffmpeg: this.precheckResult.ffmpeg,
      },
      hardware: { camera_serials: [], tdt_processor: '', wiring: '' },
      neural_native: { authoritative: true, path: '', status: 'not_bound' },
      clocks: {
        pc_receive_monotonic_ns: 'host monotonic ns; uncalibrated',
        sim_camera: 'synthetic independent 1 MHz counters',
        sim_neural: 'synthetic 10 kHz',
      },
      video: {
        codec: 'FFV1',
        container: 'Matroska',
        bayer_policy: 'stored as uninterpolated gray plane; CFA retained in pixel_format',
        nominal_playback_fps: this.config.fps,
        acquisition_fps_verified: false,
      },
      simulation_warning:
        'Generated image pixels and synthetic timing; no device acquisition or electrical pulses',
      hardware_acceptance: false,
    };
    this.save();
    this.ttlFD = fs.openSync(path.join(this.dir, 'ttl_events.csv'), 'wx');
    fs.writeSync(this.ttlFD, ttlColumns.join(',') + '\n');
    this.mapFD = fs.openSync(path.join(this.dir, 'frame_ttl_map.csv'), 'wx');
    fs.writeSync(this.mapFD, mapColumns.join(',') + '\n');
    this.neuralFD = fs.openSync(path.join(this.dir, 'neural_preview.csv'), 'wx');
    fs.writeSync(
      this.neuralFD,
      'channel,tdt_sample_index,tdt_time_s,value,unit,decimation_factor,sim_sample_index,sim_sample_rate_hz,clock_domain\n',
    );
    this.move('RECORDING');
    this.startTime = performance.now();
    this.completion = this.run()
      .catch((e) => {
        this.fail(e);
        return this.status();
      })
      .finally(() => this.closeFiles());
    return this.status();
  }
  async workers() {
    await Promise.all(
      this.config.cameras.map(
        (camera) =>
          new Promise((resolve, reject) => {
            const w = new Worker(new URL('./writer-worker.mjs', import.meta.url), {
              execArgv: [],
              workerData: {
                dir: this.dir,
                camera,
                config: this.config,
                ffmpeg: this.ffmpeg,
                sessionId: this.id,
              },
            });
            const s = (this.streams[camera.id] = {
              worker: w,
              received: 0,
              written: 0,
              pending: 0,
              high_water: 0,
              ready: false,
              finished: false,
            });
            s.done = new Promise((r) => (s.resolveDone = r));
            const timer = setTimeout(() => {
              reject(new Error('Writer startup timeout'));
              w.terminate();
            }, 10000);
            w.on('message', (m) => {
              if (m.type === 'ready') {
                clearTimeout(timer);
                s.ready = true;
                resolve();
              }
              if (m.type === 'written') {
                s.written++;
                s.pending--;
              }
              if (m.type === 'fault') this.fail(new Error(camera.id + ': ' + m.error));
              if (m.type === 'finished') {
                s.finished = true;
                this.segments.push(...m.segments.map((x) => ({ ...x, camera: camera.id })));
                s.resolveDone();
              }
            });
            w.on('error', (e) => {
              clearTimeout(timer);
              this.fail(e);
              reject(e);
              s.resolveDone();
            });
            w.on('exit', (code) => {
              clearTimeout(timer);
              if (!s.finished) {
                const e = new Error(`Writer ${camera.id} exited unexpectedly (${code})`);
                this.fail(e);
                reject(e);
              }
              s.resolveDone();
            });
          }),
      ),
    );
  }
  submit(camera, frame) {
    const s = this.streams[camera.id];
    s.received++;
    this.log({
      kind: 'received',
      camera: camera.id,
      index: frame.index,
      event_id: frame.eventId,
      sim_block_id: frame.block,
      sim_camera_ticks: frame.cameraTicks,
      pc_receive_monotonic_ns: frame.pcNs,
    });
    if (s.pending >= this.config.queueFrames) throw new Error('QUEUE_OVERFLOW ' + camera.id);
    // Preview is a small copied plane, never the recorder's buffer.
    if (frame.index % Math.max(1, Math.floor(this.config.fps / 10)) === 0) {
      const pw = Math.min(160, camera.width),
        ph = Math.min(96, camera.height),
        channels = camera.pixelFormat === 'BayerRG8' ? 3 : 1,
        b = new Uint8Array(pw * ph * channels),
        bpp = camera.pixelFormat === 'Mono16' ? 2 : 1;
      for (let y = 0; y < ph; y++)
        for (let x = 0; x < pw; x++) {
          const sx = Math.floor((x * camera.width) / pw),
            sy = Math.floor((y * camera.height) / ph);
          if (channels === 3) {
            const x0 = Math.min(camera.width - 2, sx - (sx % 2)),
              y0 = Math.min(camera.height - 2, sy - (sy % 2)),
              n = y0 * camera.width + x0,
              d = (y * pw + x) * 3;
            b[d] = frame.pixels[n];
            b[d + 1] = Math.round((frame.pixels[n + 1] + frame.pixels[n + camera.width]) / 2);
            b[d + 2] = frame.pixels[n + camera.width + 1];
          } else {
            const n = (sy * camera.width + sx) * bpp;
            b[y * pw + x] = frame.pixels[n + bpp - 1];
          }
        }
      this.preview[camera.id] = {
        width: pw,
        height: ph,
        channels,
        data: Buffer.from(b).toString('base64'),
        label:
          channels === 3
            ? 'BayerRG8 2x2 color preview; saved pixels unchanged'
            : 'Simulation image',
      };
    }
    s.pending++;
    s.high_water = Math.max(s.high_water, s.pending);
    s.worker.postMessage({ type: 'frame', frame }, [frame.pixels.buffer]);
  }
  async run() {
    try {
      await this.workers();
      await Promise.all([...this.cameras, this.neural].map((a) => a.start()));
      await this.trigger.start();
      const target =
        this.config.durationSeconds === null
          ? Infinity
          : Math.ceil(this.config.durationSeconds * this.config.fps);
      this.startTime = performance.now();
      for (this.index = 0; this.index < target && !this.stopRequested; this.index++) {
        if (this.config.realtime) {
          const wait = this.startTime + (this.index * 1000) / this.config.fps - performance.now();
          if (wait > 0) await delay(wait);
          if (this.stopRequested) break;
        }
        if (this.index % this.config.fps === 0) {
          this.freeBytes = this.space();
          if (this.freeBytes < this.config.reserveBytes) throw new Error('DISK_RESERVE_REACHED');
        }
        const inject = this.index === this.config.faultPulse,
          scenario = this.config.scenario;
        if (inject && scenario === 'disconnect') throw new Error('INJECTED_DEVICE_DISCONNECT');
        if (inject && scenario === 'disk-full') throw new Error('INJECTED_DISK_FULL');
        const pulse = this.trigger.pulse(this.index),
          tt = [];
        if (!(inject && scenario === 'missing-ttl')) tt.push({ eventId: pulse.id });
        if (inject && scenario === 'duplicate-ttl') tt.push({ eventId: pulse.id });
        for (const t of tt)
          appendCSV(this.ttlFD, ttlColumns, {
            ttl_index: this.index,
            edge: 'rising',
            event_source: 'simulation',
            event_channel: 'SIM_TRIGGER',
            sim_event_id: t.eventId,
            sim_sample_index: Math.round((this.index * 10000) / this.config.fps),
            sim_sample_rate_hz: 10000,
            clock_domain: 'sim_neural',
          });
        const evidence = [];
        for (const [n, adapter] of this.cameras.entries()) {
          const camera = adapter.camera;
          if (inject && scenario === 'missing-frame' && n === 0) {
            appendCSV(this.mapFD, mapColumns, {
              sim_camera_id: camera.id,
              sim_event_id: pulse.id,
              ttl_index: this.index,
              match_status: 'missing_frame',
              quality_flag: 'injected',
            });
            continue;
          }
          const repeats = inject && scenario === 'duplicate-frame' && n === 0 ? 2 : 1;
          for (let r = 0; r < repeats; r++) {
            const f = adapter.capture(
              this.index,
              inject && scenario === 'ambiguous' ? '' : pulse.id,
            );
            f.block = this.index + 1;
            f.cameraTicks = 1000000 + Math.round((this.index * 1000000) / this.config.fps);
            if (inject && scenario === 'clock-reset') {
              f.block = 1;
              f.cameraTicks = 0;
            }
            evidence.push({
              id: camera.id,
              eventId: f.eventId,
              block: f.block,
              ticks: f.cameraTicks,
            });
            let status = 'matched_simulation',
              flag = 'synthetic_causal_token_only';
            if (!f.eventId) {
              status = 'ambiguous';
              flag = 'no_alignment_evidence';
            } else if (tt.length === 0) {
              status = 'missing_ttl';
              flag = 'no_ttl';
            } else if (tt.length > 1 || repeats > 1) {
              status = 'ambiguous';
              flag = 'duplicate_event';
            }
            if (inject && scenario === 'clock-reset') {
              status = 'ambiguous';
              flag = 'clock_reset';
            }
            appendCSV(this.mapFD, mapColumns, {
              sim_camera_id: camera.id,
              sim_event_id: f.eventId,
              ttl_index: tt.length === 1 ? this.index : '',
              match_status: status,
              quality_flag: flag,
            });
            this.submit(camera, f);
          }
        }
        this.qc.inspect(pulse, tt, evidence);
        const neural = this.neural.sample(this.index, this.config.fps);
        this.neuralPreview = neural;
        fs.appendFileSync(
          this.neuralFD,
          `SIM_SINE,,,${neural.value},simulation_arbitrary,${Number.isInteger(10000 / this.config.fps) ? 10000 / this.config.fps : ''},${neural.sample_index},10000,sim_neural\n`,
        );
        if (!this.config.realtime)
          while (Object.values(this.streams).some((s) => s.pending > 0) && !this.stopRequested)
            await delay(1); // accelerated file tests respect bounded transport
        await yieldNow();
      }
    } catch (e) {
      this.fail(e);
    } finally {
      this.captureEndTime = performance.now();
      await this.trigger.stop();
      await Promise.all([...this.cameras, this.neural].map((a) => a.stop()));
      if (this.state !== 'FAULT') this.move('FINALIZING');
      this.log({
        kind: 'stop',
        reason: this.stopReason ?? (this.faults.length ? 'fault' : 'duration'),
        generated_pulses: this.qc.events,
      });
      await Promise.all(
        Object.values(this.streams).map(async (s) => {
          if (s.finished) return;
          s.worker.postMessage({ type: 'finish' });
          let timer;
          await Promise.race([
            s.done,
            new Promise((resolve) => {
              timer = setTimeout(async () => {
                this.fail(new Error('Writer finalization timeout'));
                await s.worker.terminate();
                resolve();
              }, 60000);
            }),
          ]);
          clearTimeout(timer);
        }),
      );
      if (this.qc.issueCount && !this.faults.length) this.fail(new Error('QC_ALIGNMENT_FAILED'));
      for (const fd of [this.ttlFD, this.mapFD, this.neuralFD, this.logFD]) fs.fsyncSync(fd);
      const written = Object.values(this.streams).reduce((n, s) => n + s.written, 0),
        received = Object.values(this.streams).reduce((n, s) => n + s.received, 0);
      const decoded = this.segments.reduce((n, s) => n + (s.verification?.decoded_frames ?? 0), 0);
      const videoPass =
        received === written &&
        written === decoded &&
        this.segments.every((s) => s.verified) &&
        written > 0;
      if (!videoPass && !this.faults.length) this.fail(new Error('VIDEO_RECONCILIATION_FAILED'));
      this.report = {
        ...this.qc.report(),
        state: this.faults.length ? 'FAULT' : 'COMPLETE',
        simulation_pass: !this.faults.length,
        video_verified: videoPass,
        received_frames: received,
        encoder_submitted_frames: written,
        decoded_frames: decoded,
        faults: this.faults,
        streams: this.streamStats(),
        segments: this.segments,
        stop_reason: this.stopReason ?? (this.faults.length ? 'fault' : 'duration'),
        capture_elapsed_s: (this.captureEndTime - this.startTime) / 1000,
        native_neural_verification: 'NOT_IMPLEMENTED',
        actual_acquisition_fps_verified: false,
      };
      atomicJSON(path.join(this.dir, 'qc_report.json'), this.report);
      if (!this.faults.length) this.move('COMPLETE');
      else this.save();
      this.endTime = performance.now();
    }
    return this.report;
  }
  stop() {
    if (this.state !== 'RECORDING') throw new Error('Stop requires RECORDING');
    this.stopReason = 'operator';
    this.stopRequested = true;
    return this.status();
  }
  streamStats() {
    return Object.fromEntries(
      Object.entries(this.streams).map(([id, s]) => [
        id,
        {
          received: s.received,
          encoder_submitted: s.written,
          pending: s.pending,
          high_water: s.high_water,
          unwritten: s.received - s.written,
        },
      ]),
    );
  }
  status() {
    return {
      session_id: this.id,
      state: this.state,
      config: this.config,
      faults: this.faults,
      generated_pulses: this.qc.events,
      elapsed_wall_s: this.startTime
        ? ((this.endTime ?? performance.now()) - this.startTime) / 1000
        : 0,
      capture_elapsed_s: this.startTime
        ? ((this.captureEndTime ?? performance.now()) - this.startTime) / 1000
        : 0,
      streams: this.streamStats(),
      preview: this.preview,
      neural_preview: this.neuralPreview,
      free_bytes: this.freeBytes ?? this.precheckResult?.free_bytes,
      report: this.report,
      hardware_acceptance: false,
    };
  }
}
