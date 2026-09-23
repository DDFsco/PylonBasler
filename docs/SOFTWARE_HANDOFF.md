# Software handoff — 0.3

Start with the [operator guide](OPERATOR_GUIDE.md). On a new Windows workstation, run `scripts/setup.ps1`, then `scripts/start.ps1`, and open `http://127.0.0.1:8765`.

The application has two separate paths:

- Real camera study: one to six Basler cameras, free run without TTL, native-pixel FFV1 recording, per-frame metadata and hashes, live preview, complete decode verification, and camera-setting restoration.
- Simulation: generated images and synthetic events for lifecycle, fault, queue, recovery, and audit testing.

The validated physical baseline is two a2A2590-60ucBAS color cameras at 2592×1944 BayerRG8, 30 fps, for 60 seconds. This establishes local recording throughput only. It does not establish simultaneous exposure or TDT alignment.

Hardware triggering, native TDT events, segmented long-duration real recording, and real neural waveform display remain pending. Preserve every `FAULT` result as well as successful evidence.
