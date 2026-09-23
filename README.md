# Basler–TDT acquisition workflow 0.3

This Windows application records one to six physical Basler cameras or runs generated-image simulations for software testing. Real studies preserve native Mono8, Mono16, or BayerRG8 pixels in lossless FFV1/MKV files, save per-frame identity and timing metadata, and decode every saved frame for pixel-hash verification.

The current real study mode is **free run without TTL**. It does not require a pulse generator, TDT event input, or active Synapse recording. The application temporarily disables camera trigger modes, applies the requested frame-rate limit, and restores all affected settings after recording. Concurrent starts do not prove synchronized exposure, so reports explicitly keep `synchronization_verified: false`.

Live camera preview targets 10 fps. Preview conversion and downsampling run on an independent latest-frame worker and never become the source for saved pixels.

## Requirements

- Windows 10 or newer
- Node.js 24 or newer
- Python 3.12
- Basler USB camera driver / pylon runtime appropriate for the connected cameras
- Enough local storage for lossless recordings
- Synapse only when read-only TDT status or later TDT integration is needed

## Install on a new computer

Clone the repository, open PowerShell in the project directory, and run:

```powershell
.\scripts\setup.ps1
```

The setup script creates `.venv`, installs the pinned Python camera dependencies, downloads the checked FFmpeg build, and checks the environment. It does not install hardware drivers or Node.js.

To repeat the checks without reinstalling anything:

```powershell
.\scripts\check-environment.ps1
```

## Start

```powershell
.\scripts\start.ps1
```

Open `http://127.0.0.1:8765`. The server binds only to loopback and generates a new request token every time it starts.

## Real study workflow

1. Close pylon Viewer and any other application that may own a camera.
2. Discover the cameras and confirm their serial numbers and settings.
3. Enter one to six serial numbers, the frame rate, and the duration.
4. Start the real study. TTL and Synapse are optional in the current free-run mode.
5. Wait for `COMPLETE` or `FAULT` and review the saved report.

The tested baseline on the development workstation is two `a2A2590-60ucBAS` color cameras at 2592×1944 BayerRG8, 30 fps, for 60 seconds. A result is complete only when received, written, and decoded frame counts match; saved pixel hashes match; block IDs and camera timestamps are continuous; and camera settings are restored.

Real files are written under `outputs/real-camera-checks`. Outputs, local environments, downloaded tools, and hardware-specific recordings are excluded from Git.

## Tests

```powershell
node --test --test-isolation=none
& .\.venv\Scripts\python.exe -m unittest discover -s test -p 'test_*.py'
```

Software tests do not establish camera throughput, hardware synchronization, or TDT alignment.

## Current limits

- Real studies accept 1–100 fps and 1–14,400 seconds.
- Each real camera currently writes one MKV and verifies the whole file after capture; segmented long-duration recording is still pending.
- Free-run camera overlap is based on PC receive times and is not exposure synchronization evidence.
- TDT status is read only. Native TDT event capture and neural waveform preview are not yet integrated.
- The simulation path remains separate and cannot claim hardware acceptance.

See [Operator guide](docs/OPERATOR_GUIDE.md), [Real camera study](docs/REAL_CAMERA_STUDY.md), [Camera settings](docs/CAMERA_SETTINGS.md), and [Implementation status](docs/IMPLEMENTATION_STATUS.md).
