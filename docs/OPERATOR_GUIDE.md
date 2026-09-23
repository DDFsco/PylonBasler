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

## Record synchronized cameras with a shared TTL

1. Use the camera and cable manuals to identify one valid input line on each camera. Do not infer connector pins from the software line name.
2. Connect one pulse source through a suitable fan-out to the same input line on every camera. Record the same pulse in TDT, either from the generating signal inside Synapse or through a digital-input loopback. Use the required common reference/ground and verify electrical levels before connecting the cameras.
3. In Synapse, configure an Epoc Store for the rising edge and confirm that the event channel changes once for each test pulse. Keep native TDT recording as the authoritative event record.
4. In the application, discover both cameras, enter both serial numbers, select **External TTL — shared FrameStart**, and select the physical line used by the cable.
5. Set the pulse rate and duration. The software expects exactly `rate × duration` rising edges. Exposure time must be shorter than one pulse period.
6. Select **Arm cameras for external TTL**. Do not send pulses while the status is `PREPARING`.
7. Wait until the group status is `ARMED_WAITING_FOR_TTL`. Start Synapse recording, then enable the finite pulse train.
8. The status changes to `RECORDING` after every selected camera has received its first triggered frame. Stop the pulse train after the planned edge count. Let the application drain, decode, and verify the videos.
9. A software pass requires equal target, received, written, and decoded frame counts for every camera, contiguous block IDs, monotonic camera ticks, matching pixel hashes, `camera_ttl_trigger_verified: true`, and restored settings.
10. Before scientific use, measure trigger-to-exposure latency and inter-camera skew with an oscilloscope or camera exposure outputs. The application intentionally leaves `synchronization_verified: false` until that measurement is documented.

If no frame arrives before the configured wait expires, the run ends in `FAULT` with the selected input line in the error. Check pulse voltage, polarity, fan-out, cable pinout, line selection, ground/reference, and whether the pulse train began only after all cameras were armed.

Real study files are stored under `outputs/real-camera-checks`. Each camera folder contains the lossless MKV, frame metadata CSV, encoder log, report, and final process result. Group studies also contain `group-report.json`.

## Review saved frames

Select a recording under **Saved real recordings**, enter any decoded frame index, and select **Decode saved frame**. The application decodes the selected frame from the saved MKV instead of using the live preview cache.

## Simulation

The simulation panel remains available for software fault and recovery tests. Simulation output is not evidence of physical camera or TDT performance.
