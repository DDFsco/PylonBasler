# Basler–TDT Acquisition Tool: User and Handling Guide

## 1. Purpose

This Windows tool records one to six Basler cameras, preserves native camera pixels in lossless MKV files, saves per-frame metadata, and verifies every saved frame after acquisition. It supports:

- **Free run without TTL** for ordinary camera recording.
- **External TTL FrameStart** for triggering multiple cameras from one shared electrical pulse source.
- Read-only Synapse status checks.
- Attachment and validation of exported TDT TTL events after a real recording.
- Simulation for software checks and fault testing.

The application reports software integrity and hardware synchronization separately. A `COMPLETE` recording proves that its saved camera files passed the implemented checks. It does not, by itself, prove a measured inter-camera exposure skew or final camera-to-TDT timing accuracy.

## 2. Repository

GitHub repository:

```text
https://github.com/DDFsco/PylonBasler.git
```

Clone it on a new Windows workstation:

```powershell
git clone https://github.com/DDFsco/PylonBasler.git
cd PylonBasler
```

To update an existing checkout when no local files have been changed:

```powershell
git pull
.\scripts\setup.ps1
```

Do not store study recordings inside Git. The repository excludes local environments, downloaded tools, and `outputs/`.

## 3. Required software and hardware

Install these before running setup:

- Windows 10 or newer.
- Node.js 24 or newer.
- Python 3.12.
- The Basler pylon runtime and USB camera driver.
- Git for cloning and updating the repository.
- TDT Synapse when neural data or TDT TTL events are required.

The setup script installs the pinned Python packages and a local FFmpeg build. It does not install Node.js, Python, Git, the Basler driver, or Synapse.

For the tested `a2A2590-60ucBAS` camera, the I/O connector is an **M8 6-pin female, A-coded** connector. The mating cable must use an **M8 6-pin male, A-coded** connector. A 6-pin Hirose plug for an older Basler ace camera is not the same connector.

For a Line1 trigger cable on this camera model:

| Connection | Camera pin |
|---|---:|
| Trigger signal / BNC center | M8 pin 2, opto-coupled Line1 input |
| Trigger reference / BNC shield | M8 pin 3, opto-input ground |

Confirm the actual cable datasheet before connection. Do not infer the pinout from connector appearance alone. Verify voltage, current, polarity, grounding, and fan-out with the equipment manuals before connecting a TDT output to a camera.

## 4. First-time installation

Open PowerShell in the cloned repository and run:

```powershell
.\scripts\setup.ps1
```

The script performs these tasks:

1. Checks for Node.js 24 or newer.
2. Creates `.venv` with Python 3.12.
3. Installs the pinned `numpy` and `pypylon` dependencies.
4. Downloads the configured FFmpeg build into `work/tools/ffmpeg`.
5. Runs the environment check and lists detected Basler cameras.

Run the environment check again at any time:

```powershell
.\scripts\check-environment.ps1
```

Expected output includes the Node, Python, NumPy, pypylon, and FFmpeg versions plus a JSON list of detected cameras.

## 5. Starting and stopping the application

Start the application from PowerShell:

```powershell
.\scripts\start.ps1
```

Then open:

```text
http://127.0.0.1:8765
```

Keep the PowerShell window open. The application is local to the workstation and binds only to the loopback address.

Before closing the PowerShell window:

1. Stop any active real study or simulation.
2. Wait until the state is `COMPLETE` or `FAULT`.
3. Allow lossless video decoding and hash verification to finish.
4. Close the browser page, then stop the server with `Ctrl+C` in PowerShell.

Do not disconnect a camera, remove storage, or terminate the server while a study is recording or finalizing.

## 6. Camera preparation

Before every real study:

1. Connect every camera directly to a suitable USB 3.x port.
2. Close pylon Viewer and any other application that may own a camera.
3. Open the tool and select **Discover cameras**.
4. Confirm every expected serial number and model.
5. Select each camera and choose **Read settings**.
6. Review exposure, gain, ROI, pixel format, resulting frame rate, supported FrameStart input lines, and current line status.
7. Apply settings to one camera at a time.

Recommended rules:

- Disable automatic exposure before entering a manual exposure time.
- Disable automatic gain before entering manual gain.
- Use the same ROI, pixel format, exposure, and gain on cameras that will be compared.
- Keep exposure time shorter than one frame or TTL period.
- Re-read the camera after changing ROI because valid offsets and dimensions may change.

Camera-setting changes affect the selected camera but do not save a permanent camera UserSet. The recording workflow temporarily changes acquisition and trigger controls, then restores them after finalization.

## 7. Free-run recording without TTL

Use this mode when synchronized exposure is not required or the trigger cable is not connected.

1. Complete the camera preparation steps.
2. Enter one to six serial numbers, separated by commas or spaces.
3. Select **Free run — no TTL required**.
4. Enter the target frame rate and duration.
5. Select **Start real study**.
6. Watch the preview and status while recording.
7. Wait for final decoding and verification.

A successful free-run result should report:

- `state: COMPLETE`
- No faults.
- Target, received, written, and decoded frame counts are equal.
- `pixel_hashes_match: true`
- `block_ids_contiguous: true`
- `camera_ticks_monotonic: true`
- `settings_restored: true`
- `video_verified: true`

Free run starts cameras concurrently, but PC receive-time overlap is not exposure synchronization evidence. The report therefore keeps `synchronization_verified: false`.

## 8. Shared-TTL multi-camera recording

### 8.1 Recommended signal topology

Use one pulse source for every device:

```text
Shared TTL source
  ├─ Camera 1 trigger input
  ├─ Camera 2 trigger input
  ├─ Additional camera trigger inputs
  └─ TDT digital input, or an internally recorded TDT output event
```

Use a proper fan-out or distribution method. Do not assume that chaining adapters or adding 50-ohm terminators will preserve the required voltage. Confirm the signal at each branch with an oscilloscope before connecting valuable equipment.

In Synapse, configure an Epoc Store for the same rising edge. Native TDT recording is the authoritative TDT event record.

### 8.2 Software procedure

1. Connect and verify the trigger wiring, but keep the pulse train disabled.
2. Prepare all cameras and confirm that the selected physical Line is supported.
3. Enter all camera serial numbers.
4. Select **External TTL — shared FrameStart**.
5. Select the camera input used by the cable, normally `Line1` for the opto-coupled input on the tested ace 2 model.
6. Enter the expected TTL rate as **Frame rate**.
7. Enter the pulse-train duration. The software expects exactly `frame rate × duration` rising edges and frames per camera.
8. Set **Wait for first TTL** long enough to start Synapse and the pulse source after arming.
9. Select **Arm cameras for external TTL**.
10. Do not send pulses while the state is `PREPARING`.
11. Wait until the group state is `ARMED_WAITING_FOR_TTL`.
12. Start Synapse recording.
13. Enable the finite TTL pulse train.
14. Confirm that the application changes to `RECORDING` after every selected camera receives its first triggered frame.
15. Let the finite pulse train produce the planned number of rising edges.
16. Wait while the application drains queues, closes files, decodes the videos, compares hashes, and restores the camera settings.

A successful camera-side trigger result should additionally report:

- `capture_mode: external_ttl_frame_start`
- `ttl_required: true`
- `camera_ttl_trigger_verified: true` for every camera.
- `ttl_edges_inferred_from_frames` equals the target frame count.
- `shared_trigger_configured: true` in the group report.

These fields prove that each camera accepted the configured trigger sequence and produced the expected frames. They do not prove that TDT stored every edge or establish measured exposure skew.

### 8.3 Final hardware synchronization acceptance

Before using the system for scientific measurements:

1. Measure the shared TTL at every camera input.
2. Observe a camera exposure-active or strobe output where available.
3. Measure trigger-to-exposure latency, inter-camera skew, and jitter with an oscilloscope or logic analyzer.
4. Verify the corresponding TDT event count and timestamps.
5. Document the wiring, line selection, pulse voltage, pulse width, rate, exposure, measured skew, and acceptance limit.

The software intentionally keeps `synchronization_verified: false` until this physical timing evidence has been established.

## 9. Attaching TDT TTL evidence

After Synapse finalizes its block:

1. Export the TTL events to CSV.
2. Under **Saved real recordings**, select one camera recording.
3. Expand **Attach TDT TTL evidence to this real recording**.
4. Enter the operator name.
5. Enter the existing native TDT block directory.
6. Select the TTL CSV.
7. Choose **Attach TDT evidence**.
8. Repeat for each camera recording that must be bound to the same TDT evidence.

Required CSV columns:

```text
ttl_index,edge,tdt_sample_index,tdt_sample_rate_hz,event_source,event_channel
```

Example:

```csv
ttl_index,edge,tdt_sample_index,tdt_sample_rate_hz,event_source,event_channel
0,rising,1000,24414.0625,TDT,CamTrig
1,rising,1610,24414.0625,TDT,CamTrig
```

The importer checks required columns, indexes, sample rate consistency, time consistency when present, duplicate edges, nonmonotonic samples, and the number of rising edges. A clean count comparison reports:

```text
COUNTS_MATCH_PENDING_TIMING_CALIBRATION
```

This is evidence that counts agree. It is not a claim that camera and TDT clock domains have already been calibrated.

## 10. Preview and saved-frame review

Live preview is display-only:

- It targets up to 10 fps.
- It is downsampled to reduce browser and CPU load.
- It automatically slows when the lossless writer is busy.
- Bayer color preview is approximate and not color calibrated.
- Preview pixels are never used as the recorded source.

To inspect saved data:

1. Choose a recording under **Saved real recordings**.
2. Enter a frame index.
3. Select **Decode saved frame**.
4. Use **Next frame** to advance.

The displayed saved frame is decoded from the MKV file, not from the live-preview cache.

## 11. Output files

Real studies are stored under:

```text
outputs/real-camera-checks/
```

Each camera recording normally contains:

| File | Purpose |
|---|---|
| `camera.mkv` | Native-pixel, lossless FFVHUFF video |
| `frames.csv` | Frame index, block ID, camera ticks, host receive time, and SHA-256 |
| `report.json` | Camera result and verification evidence |
| `encoder.log` | FFmpeg errors, normally empty on success |
| `process-result.json` | Parent-process result |

A multi-camera run also contains `group-report.json`. Triggered runs preserve arm and first-trigger markers. TDT imports are stored in unique `tdt_import_*` directories with the original CSV and a hashed binding record.

Preserve both `COMPLETE` and `FAULT` runs until the cause of every fault is understood. Copy the entire group directory when archiving or transferring a study.

## 12. Status reference

| State | Meaning |
|---|---|
| `IDLE` | No real study is active |
| `PREPARING` | Cameras are opening, being configured, and starting acquisition |
| `ARMED_WAITING_FOR_TTL` | Every selected camera is ready; the pulse train may start |
| `RECORDING` | Frames are being received and written |
| `STOPPING` | Stop was requested; queued data is being drained |
| `COMPLETE` | Recording and implemented verification checks passed |
| `FAULT` | One or more checks failed; inspect `faults` and preserve the output |

## 13. Troubleshooting

### Camera is not found

- Close pylon Viewer.
- Reconnect the USB cable and use a direct USB 3.x port.
- Confirm that the camera appears in pylon Viewer.
- Run `.\scripts\check-environment.ps1`.
- Avoid running two copies of the acquisition server.

### `spawn EPERM`

- Start the application with `.\scripts\start.ps1` rather than launching `node` from a restricted shell.
- Confirm that antivirus or endpoint controls are not blocking the project Python or FFmpeg executable.
- Close the old server before starting another copy.

### No TTL-triggered frame arrives

- Confirm that the state reached `ARMED_WAITING_FOR_TTL` before pulses began.
- Verify that the selected software Line matches the physical cable pin.
- Check BNC direction, voltage, polarity, pulse width, and reference/ground.
- Confirm that the pulse reaches every camera branch with an oscilloscope.
- Confirm that exposure time is shorter than the pulse period.
- For the tested `a2A2590-60ucBAS`, use the M8 connector and Line1 pinout described above; do not use an incompatible Hirose cable.

### Frame count is lower than the TTL count

- Reduce the trigger rate.
- Reduce exposure time.
- Confirm the camera's maximum rate for the selected ROI and pixel format.
- Check USB bandwidth and use separate host controllers when available.
- Look for missing or distorted pulses at each camera input.

### Writer queue overflow

- Use the current FFVHUFF build from the repository.
- Reduce resolution, frame rate, or camera count.
- Record to a fast local SSD with adequate free space.
- Avoid other CPU-heavy or disk-heavy work during recording.
- Preview will throttle automatically; increasing the queue only delays a sustained throughput failure.

### Insufficient disk space

- Shorten the study or reduce ROI/frame rate.
- Move old output directories to archival storage.
- Keep additional space for verification and normal filesystem overhead.
- Lossless compression depends on scene content and cannot guarantee a fixed compression ratio.

### Preview frame rate is low

A lower preview rate is expected when recording load increases. Judge acquisition from received/written/decoded counts and measured receive rate, not from the browser preview rate.

### TDT evidence reports `MISMATCH`

- Confirm that the export contains rising edges from the correct event channel.
- Check that the pulse train began only after every camera was armed.
- Compare the expected count with the Synapse event count and every camera frame count.
- Check for duplicate, falling-edge, or unrelated events in the CSV.

## 14. Simulation and software verification

Simulation verifies software lifecycle, queue, video, recovery, and fault behavior. It does not prove camera performance, TTL electrical integrity, TDT timing, or hardware synchronization.

Run the software test suites from PowerShell:

```powershell
node --test --test-isolation=none
& .\.venv\Scripts\python.exe -m unittest discover -s test -p 'test_*.py'
```

## 15. Current operational limits

- Real studies accept 1–100 fps and durations from 1 to 14,400 seconds.
- Each real camera writes one MKV for the complete study.
- Full-file decode and hash verification occur after acquisition.
- Long recordings require measured storage and throughput margins.
- Automatic native TDT event retrieval and live neural-waveform display are not implemented.
- TDT exports can be attached and checked, but cross-clock timing calibration remains a separate hardware-validation step.
- Hardware synchronization acceptance requires measured timing evidence.

## 16. Routine checklist

Before recording:

- [ ] Correct repository version checked out.
- [ ] Environment check passes.
- [ ] Cameras detected by serial number.
- [ ] pylon Viewer closed.
- [ ] ROI, pixel format, exposure, and gain confirmed.
- [ ] Required disk space available.
- [ ] Trigger connector and pinout verified when using TTL.
- [ ] TTL electrical levels and fan-out verified.
- [ ] Synapse block destination and Epoc Store confirmed.

After recording:

- [ ] State is `COMPLETE`, or every `FAULT` is investigated.
- [ ] Received, written, and decoded counts agree.
- [ ] Pixel hashes match.
- [ ] Camera block IDs and timestamps are continuous.
- [ ] Camera settings were restored.
- [ ] TDT event count agrees with triggered camera frame counts.
- [ ] Native TDT block and full camera group directory are archived together.
- [ ] Physical timing acceptance evidence is retained for synchronized studies.
