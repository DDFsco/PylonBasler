# Operator guide

## Start the application

Run the setup once on a new Windows computer:

```powershell
.\scripts\setup.ps1
```

Start the local application:

```powershell
.\scripts\start.ps1
```

Open `http://127.0.0.1:8765`. Keep the terminal open while recording. Before closing it, stop the active study and wait for `COMPLETE` or `FAULT`.

## Record a real study without TTL

1. Close pylon Viewer and every other program that may own a camera.
2. Select **Discover cameras** and verify both serial numbers.
3. Enter the serial numbers under **Real camera study**, separated by commas.
4. Enter the frame rate and duration. The current validated baseline is two color cameras at 30 fps for 60 seconds.
5. Select **Start real study**. No TTL pulse or Synapse connection is required in this mode.
6. Watch the live previews and status. Preview targets 10 fps and is isolated from the lossless writer.
7. A successful result reports `COMPLETE`, no faults, equal received/written/decoded counts, matching pixel hashes, contiguous block IDs, and restored camera settings.

Free run does not verify simultaneous exposure. Reports therefore keep `synchronization_verified: false`, `ttl_required: false`, and `ttl_recorded: false`.

Real study files are stored under `outputs/real-camera-checks`. Each camera folder contains the lossless MKV, frame metadata CSV, encoder log, report, and final process result. Group studies also contain `group-report.json`.

## Review saved frames

Select a recording under **Saved real recordings**, enter any decoded frame index, and select **Decode saved frame**. The application decodes the selected frame from the saved MKV instead of using the live preview cache.

## Simulation

The simulation panel remains available for software fault and recovery tests. Simulation output is not evidence of physical camera or TDT performance.
