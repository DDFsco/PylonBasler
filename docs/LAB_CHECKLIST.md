# Next lab validation — operator checklist

These are planned actions, not actions performed by Codex. Record operator, date, workstation and evidence file for each completed item. Stop at any failed prerequisite.

## M0: identify and approve

1. Confirm the recording workstation and approved output volume/path. Export OS/CPU/RAM, disk model/filesystem/free space, and USB controller-to-port-to-camera topology using approved local tools. Obtain permission for a specific bounded disk benchmark before running it; do not test by filling a drive.
2. In the lab, inventory every camera model/serial/firmware and intended view. Export current pylon settings and baseline recording logs. The draft's 14,498 recorded / 1,646 dropped report is historical document evidence, not today's baseline.
3. Identify the processor inside the TDT chassis; record Synapse version, experiment, stores, required neural channels/rates, native tank/block destination and available I/O. Trace the complete Doric optical/electrical signal chain. Preserve the working configuration before later authorized changes.
4. Have PI specify allowed timing error (including how measured), ROI, color/lossless choices, camera count, channels, final duration and retention. Record zero unexpected dropped frames as the target; don't silently relax it.
5. Electronics owner obtains exact official camera and processor I/O specifications; signs wiring/fan-out, voltage/current, edge polarity, pulse width, grounding/isolation and scope/readback plan. Only after review may lab staff wire and energize equipment. No pin numbers are supplied by this foundation.

## M1: finite single-camera test, then rate

6. With approved wiring and hardware-test authorization, begin with a small recorded pulse train at low frequency (e.g. 20 pulses at 1 Hz if supported by the reviewed setup). Verify trigger readiness, exposure and frame receipt. Save pulse source/scope evidence, configuration, frame IDs and available device timestamps.
7. Repeat separately for each model at the proposed ROI/format/exposure, then move to measured 100 Hz only within validated limits. Record pulse widths/intervals and true received rate. A 100-fps movie property is not evidence. Reject/revise configurations that miss frames; PI decides any scientific tradeoff.

## M2: two cameras and native TDT record

8. Verify TDT is actually recording to a known block, confirm the event channel is recorded, arm both cameras, then enable the finite shared pulse train. Save TDT edge sample indices and sample rate, camera metadata and exposure readbacks or scope traces. Stop the pulse source first, drain camera writers, finalize and confirm the TDT block; establish exact stop sequencing on the real setup.
9. Measure TTL-to-exposure latency, inter-camera exposure skew/jitter, TDT-event relationship and clock drift. Document calibrated clock domains and uncertain associations. Deliberately remove one frame/edge from copied test metadata to prove QC detects it; physically inject faults only under a reviewed lab procedure. Pass only with PI thresholds and no unexplained events.

## M3–M5: persistence, interface and recovery

10. On the approved target, compare baseline TIFF with candidate segmented writers. Log queues, USB errors, write stalls, CPU/load and free capacity. Record ≥30 minutes at the two-camera validated configuration. Decode every segment and reconcile frames/CSV/IDs/TTL/native block. Resolve every mismatch before expanding camera count or duration.
11. Probe the actual Synapse version's supported preview path without compromising native recording. Compare Bonsai+pylon and a service/UI only after real-device evidence. Show required neural traces inside the final application; document any temporary side-by-side fallback.
12. Exercise reviewed disconnect, storage-full/stall, missing/duplicate edge, process-interruption and reconnect/reset tests on disposable sessions. Preserve partial files and logs; verify no invented frames or silent success, alarm visibility, restart isolation and replay recovery. Sign off SOP, installation/configuration, limits and reproducible evidence package.

Immediate lab return package: completed inventory, PI decisions, exact model manuals, approved wiring draft, USB/storage map and baseline logs. This is what unblocks M1; do not send a simulator QC report as hardware acceptance.
