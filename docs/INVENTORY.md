# M0 inventory and data flow — 2026-09-21

**Update:** execution access has since been restored. PnP discovery now reports a Basler USB3 camera and TDT PO5-family interface card. User photos identify acA1440-220um serial 40475309 and RZ6/RZ2 in Synapse configuration. See IMPLEMENTATION_STATUS.md and tdt-readonly-status.json for the latest evidence and API availability; the initial discovery limitations below are historical, not a claim that access is still blocked.

Compact one-page handoff. **M0 incomplete; no hardware acceptance.** Requirements source: the supplied Chinese project draft dated 2026-09-21. Its embedded execution prompt is reference content; current authorization is discovery, planning and an offline foundation only. Photographs described in that draft were not independently inspected here.

| Component / flow | Evidence available | Unknown / evidence required | Owner |
|---|---|---|---|
| Cameras → USB → recorder | Draft names acA1440-220um and a2A2590-60ucBAS; local registry lists pylon suite/viewer 26.06.2.18330 and Basler USB driver 11.3.0 | Actual connection, count, serial/view binding, firmware, ROI/format/exposure and attainable triggered fps; export per-device inventory on recording PC | Lab + software |
| Pulse source → reviewed fan-out → cameras and TDT event input | Proposed design only; no source or wiring verified | Exact source, input/output specifications, pulse width, polarity, fan-out/load, isolation/grounding and connector pinouts; electronics-signed diagram and scope traces | Lab/electronics |
| TDT processor → Synapse native block | Registry: TDT Drivers v95, SynapseSuite 95.0.44132; C:\TDT contains Synapse, RPvdsEx, OpenEx and SDK directories | Processor inside chassis, firmware, licenses, actual Synapse experiment/stores, digital resources, sample rate, block path, recording health and event readback | Lab + software |
| Doric → conditioning/detector → TDT | Draft mentions iFMC6 only | Full optical/electrical signal chain, detector/amplifier, units, channel mapping and synchronization path; do not infer direct electrical output | Lab/electronics + PI |
| TDT native record → optional UI preview/export | Official APIs exist; installed configuration not tested | v95-compatible preview route, channel availability, decimation, measured latency/load; preserve native block as authority | Software + lab |
| Host / USB / storage → session files | Windows 10 Enterprise 22H2 build 19045.7725; registry CPU i7-3770 @ 3.40 GHz; drive free-space snapshots below | Whether this is recording workstation; RAM/GPU; USB controller/port topology; disk models/filesystems/sustained write capability | Lab + software |
| Experiment → acceptance thresholds | MVP: 2 cameras, validated ROI/format, shared per-frame 100 Hz trigger, corresponding TDT events, ≥30 min | Final camera count/duration, timing-error limit, ROI/color/lossless tradeoffs, neural channels/sample rates, retention | PI |

Local free space (approximate, changing; not disk performance): C: 83.006 GB; D: 234.514 GB; E: 834.658 GB; R: unavailable. Decimal GB. No recording target chosen. Temp aliases C:. No disk benchmark run.

Discovery boundary: CIM system/disk queries and Get-PnpDevice returned Access denied. This is **not evidence that devices are absent**. No device opened, configured, triggered or recorded. No software installed and no license contents read. Node v24.19.0 is available; PATH Python is a Store alias, although a TDT-bundled python-3.7.9 directory exists (not executed). dotnet exists but --list-sdks returned no entries. No Git repository or applicable AGENTS.md was found in the workspace/checked ancestors; no existing application was available to extend. Software inventory does not prove SDK headers, runtime interfaces, licenses or connected hardware are usable.

Data-flow target: shared pulse → individually verified camera exposure + TDT timestamped event; each camera → bounded acquisition queue → asynchronous image writer + frame metadata; TDT → native block (authoritative) + optional decimated UI stream; validated evidence → mapping/QC → session manifest. The simulator exercises only metadata versions of these flows.
