# Session schemas: current 0.2 and legacy 0.1

## Current image workflow (0.2)

Version 0.2 is implemented by src/workflow/. It retains the reference columns but produces actual FFV1/MKV video segments, per-frame hash sidecars, and per-camera segment indexes. Frames use record_status=submitted_to_encoder; final segment verification and QC determine whether that submission produced the expected decoded pixels. Receipt logs, encoder submission counts and decoded-frame counts are separate evidence.

The frames CSV adds sha256 and pixel_format. Metadata is streamed to persistent file handles, flushed at finalization; every camera writer runs separately. The schema preserves empty camera_serial, camera_block_id, camera_timestamp_ticks and all tdt_* hardware fields in simulation. Simulated clocks and identities live in sim_* fields. Segment sidecars retain frame order and SHA256; actual decoded pixels are checked against them. A recovery audit also compares frame-CSV indexes, counts and hashes against segment evidence.

The manifest records config.cameras (1–6 IDs), per-camera ROI/format, nominal fps, duration or manual stop, queue/memory limits, precheck capacity, versions, clock definitions, state history and faults. Unknown physical hardware fields remain empty. BayerRG8 is stored as a raw mosaic in a gray video plane; the manifest/CSV retain CFA identity. Mono16 is stored gray16le and validated byte-for-byte. UI conversion never changes saved data.

QC separates simulation_pass, video_verified and hardware_acceptance (always false here). Source playback fps is not a measured acquisition rate. Real-time capture_elapsed_s and generated pulses describe the software test only. Full issue records remain in logs; only the first 100 are kept in the summary to bound memory. A non-COMPLETE manifest is never upgraded by recovery.

Native TDT attachments live in unique tdt_import_* directories containing original TTL CSV and a provenance/hash binding. Native block existence is checked but its contents are not decoded or certified. Imported TTLs remain unaligned, especially when attached as references to generated sessions. Synthetic and real clock domains are never mixed. Browser import currently handles small exports up to 2 MiB.

## Legacy metadata-only schema (0.1)

`manifest.json` binds one unique session ID to mode, created UTC, operator, software versions, hardware fields, simulation parameters, clock definitions, native-neural path, video-verification status, state/history and faults. Unknown hardware values are empty strings/arrays; JSON null means an unavailable numeric/result value. Simulator IDs are never camera serials. Schema changes must increment schema_version.

CSV files are UTF-8, header-first, comma-delimited, quoted data cells with doubled embedded quotes. Empty cells mean unavailable, never zero. Required reference columns are retained:

| File | Required columns (in order) |
|---|---|
| camera_<serial>_frames.csv | session_id, camera_serial, video_part, video_frame_index, camera_block_id, camera_timestamp_ticks, camera_tick_hz, pc_receive_monotonic_ns, record_status, frame_width, frame_height |
| ttl_events.csv | ttl_index, edge, tdt_sample_index, tdt_sample_rate_hz, tdt_time_s, event_source, event_channel |
| frame_ttl_map.csv | camera_serial, video_part, video_frame_index, camera_block_id, ttl_index, tdt_sample_index, match_status, quality_flag |
| neural_preview.csv | channel, tdt_sample_index, tdt_time_s, value, unit, decimation_factor |

Simulation filenames use SIM_A/SIM_B instead of unavailable serials. Frames append sim_camera_id, sim_event_id, sim_block_id, sim_camera_ticks, sim_camera_tick_hz, clock_domain. TTL appends sim_event_id, sim_sample_index, sim_sample_rate_hz, sim_time_s, clock_domain. Mapping appends sim_camera_id, sim_event_id, sim_block_id. Neural preview appends sim_sample_index, sim_sample_rate_hz, sim_time_s, clock_domain. Exact executable headers live in src/contracts.mjs.

Units: timestamps are integer ticks with stated ticks/s; host receipt time is integer monotonic nanoseconds serialized as decimal text to avoid float precision loss; sample indices are integers with samples/s; time_s is seconds in its own domain; image dimensions are pixels. Simulated TTL index is zero-based; simulated camera block IDs start at 1. No cross-domain subtraction occurs. All tdt_* values remain empty in simulation. Synthetic sine preview uses arbitrary units and a declared 100× decimation relative to an analytic 10 kHz signal; no full-rate neural file is generated.

Frame record_status is metadata_only: video_part and video_frame_index remain empty because there is no image writer. Production adapters must distinguish received, written, failed and unrecoverable records, validate actual device IDs/timestamp semantics and map decoded segment indices. Do not substitute this CSV writer for a video writer.

Mapping statuses: matched_simulation (synthetic causal token only), missing_frame, missing_ttl, ambiguous. Duplicate frames/TTLs are ambiguous with duplicate flags; missing association evidence stays ambiguous even if counts match. A missing token can yield both an unmatched frame and a TTL without a proven frame: these are unresolved evidence records, not an assertion that two physical losses occurred. The simulator's planned causal event IDs permit identifying both-missing events; real hardware does not supply this oracle. Mapping uses all received metadata, including journal-only records after writer faults; QC separately reports received vs persisted counts. No frames or TTLs are fabricated to fill gaps.

`qc_report.json` records state, counts, issues with causal IDs, stream ranges and domains, queue high-water levels, pending records, faults, hardware_acceptance=false and video_verification=NOT_IMPLEMENTED_METADATA_ONLY. COMPLETE means only that the metadata demo passed its checks. QC errors end in FAULT. A requested run interrupted before all pulses is faulted; ungenerated pulses are not labeled as observed hardware misses.

`logs/events.jsonl` journals received metadata before queue admission, transitions and faults. Existing session directories are refused. Received metadata survives injected queue/writer faults via this journal; successfully written CSV prefixes remain untouched. Real I/O errors may prevent logging or finalization, and abrupt interruption may leave a truncated final line. This is partial-output preservation, not a power-loss durability guarantee. Preserve original files before recovery.

`neural/` is empty in simulation. Real sessions must link or contain the actual TDT native block as the authoritative neural record, plus validated optional exports. No fake TDT block, video or hardware timestamp is created. Segmentation, actual codec/video decode, neural native-block verification, streaming production QC, calibration and hardware integration are future gates.
