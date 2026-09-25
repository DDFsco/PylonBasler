# Implementation status — workflow 0.3

## Implemented

- Local operator UI: configure 1–6 streams, precheck, arm, record, manual/timed stop, preview/queue/free-space health, visible faults, session review and saved-frame decoding.
- Separate bounded per-camera writer workers, FFV1/MKV segments, native pixel preservation for Mono8/BayerRG8/Mono16, per-frame SHA256 and actual decoded-frame comparison. Source pixel format/CFA retained; playback rate is never acquisition evidence.
- Readiness/state guards, duplicate start rejection, precheck and start-time capacity checks, reserve monitoring, explicit overflow/writer/disconnect faults, partial-output retention and read-only recovery audits.
- Schema 0.2 plus legacy metadata-only 0.1 audit support; real hardware fields remain empty in generated sessions.
- Read-only Synapse status integration based on installed vendor API endpoints. Separate native-block reference/TTL import with attribution and hash; no implicit alignment. Browser TTL import currently limited to 2 MiB.
- Constant-state synthetic QC and an independently tested calibrated matching function. No valid calibration, clock reset, shared candidate or ambiguous match can silently become an ordinal pairing.

## Evidence and remaining gates

Current local automated results: **53 Node tests and 6 Python tests passed, 0 failed**. GitHub Actions repeats both suites on Windows with the pinned FFmpeg build. A two-hour-plus, six-stream virtual-time accounting test covers 720,001 pulse events; it is not a two-hour wall-clock recording or throughput test. Small real-time image recording and decode tests are reported separately.

The first one-minute six-stream attempt (one-minute-soak-result.json) failed with QUEUE_OVERFLOW SIM_6 under concurrent test load. It was correctly marked FAULT and retained 24,257 decoded frames. The code was improved to retain metadata file handles during recording, flush at finalization, and use a 128-frame bounded default queue. The retry in one-minute-soak-after-optimization.json passed: six 64×48 streams, 6,000 synthetic pulses, 36,000 received/submitted/decoded frames, all per-frame pixel hashes matched, zero pending/unwritten frames. Mono8, BayerRG8 and Mono16 were covered with 20-second segments. This is one minute of real-time low-payload software operation, not a physical six-camera performance test. Retain both reports, not only successful evidence.

The Node image generator and metadata coordinator remain a software test harness. A separate pypylon path performs bounded free-run or external-TTL FrameStart recording from one to six selected physical cameras. Electrical trigger acceptance and native TDT event acquisition remain pending the established lab gates. There is no claim of measured synchronized exposure, 100 fps color-camera acceptance, full-size six-camera throughput, two-hour endurance, calibrated timing tolerance, power-loss durability, or completed in-app neural preview.

The environment block has been resolved. Read-only PnP enumeration now reported Basler ace USB3 Vision Camera and a TDT PO5/PO5e/PO5c interface-card driver. Earlier photos identify camera acA1440-220um serial 40475309, U3V/BaslerUSB, displayed Version 107652-13. Synapse configuration contains RZ6 and RZ2; a successful read-only query returned Idle, zero errors, RZ6(1)=12207.03125 Hz and RZ2(2)=6103.515625 Hz. These processor settings do not establish the stored neural-channel sample rates or physical wiring. A later status read failed; its exact response is retained in tdt-readonly-status.json.

## Development/reproduction

Node v24.19.0; FFmpeg 9.0.2 essentials portable build, downloaded from the Windows binary provider linked by the official FFmpeg download page. Archive SHA256: 60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba. Published checksum matched before extraction. It resides in work/tools, with no system installation/PATH change. The setup script stops on a changed archive hash. Third-party binary licensing/readme files are retained with the extracted distribution; source-only delivery does not redistribute the binary.

Run `node --test --test-isolation=none` from the project. Start the UI with `scripts/start.ps1`. Installation and operator steps are documented in OPERATOR_GUIDE.md and the root README. Older archived source bundles describe earlier simulation-only versions and are not the current release.

## Requirements carried forward

Selectable 1–6 cameras. Variable duration, provisionally 1–2 hours or more. Preserve native selected pixels losslessly; preview conversions are separate. Minimize measured exposure error; numeric timing acceptance requires PI agreement. Two cameras/30 minutes is an intermediate MVP gate, not a software maximum. Six cameras at 1440×512, one byte/pixel, 100 fps produce 442.368 MB/s and 3.185 TB in two hours before overhead; no existing disk has been approved on capacity alone.
# 2026-09-23 update: free-run real camera studies

The web application records one to six physical cameras in free run or shared external-TTL FrameStart mode. It preserves native pixels, block IDs, camera timestamps, PC receive times, and per-frame hashes, writes five-minute FFVHUFF/MKV segments, decodes every saved frame with bounded verification memory, and restores the original frame-rate and trigger settings. Two color cameras have completed a 30 fps, 60-second free-run recording on the development workstation.

Live preview targets 10 fps. Conversion and downsampling run on an independent latest-frame worker so delayed preview work does not block capture. Saved-frame replay uses fast intra-frame seeking. The parent process escalates a cooperative stop to a complete process-tree termination after five seconds. Hardware exposure synchronization, native TDT events, long-duration physical acceptance, and real neural traces remain unaccepted.
