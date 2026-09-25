# Real camera study

The real study path records one to six Basler cameras through pypylon. It preserves each selected camera's native Mono8, Mono16, or BayerRG8 pixels in a lossless FFVHUFF/MKV file and records the block ID, native camera timestamp, PC receive time, and SHA-256 hash for every frame.

## Free run without TTL

The current study mode is `free_run_no_ttl`. It does not require a pulse generator, TDT event input, or a running Synapse experiment. At startup it snapshots every trigger selector, temporarily disables trigger modes, applies the requested frame-rate limit, and verifies the resulting rate. At finalization it restores the original frame-rate and trigger settings.

This allows real recordings while hardware synchronization is being prepared. Concurrent camera starts and overlapping PC receive times do not prove simultaneous exposure, so `synchronization_verified` remains false.

## External TTL FrameStart

The `external_ttl_frame_start` mode disables all existing trigger modes, configures `FrameStart`, the selected physical `Line1`–`Line4` source, `RisingEdge`, and timed exposure, then starts grabbing before it publishes `armed.json`. A multi-camera status becomes `ARMED_WAITING_FOR_TTL` only after every child camera has published that marker. The first accepted edge produces `trigger-received.json` and changes the status to `RECORDING`.

The requested fps is the expected TTL rate in this mode. The requested duration defines an exact target of `fps × seconds` frames. A run faults if no triggered frame arrives within the configured arm timeout, if the pulse train stops before the target, if exposure time is not shorter than the pulse period, or if any normal recording verification fails.

Each received frame is evidence that the configured camera input accepted a trigger. This does not by itself prove that TDT stored the edge or quantify exposure skew. Reports therefore include `camera_ttl_trigger_verified` and `ttl_edges_inferred_from_frames`, while `ttl_recorded` and `synchronization_verified` remain false until TDT evidence and a timing measurement are attached.

## Preview behavior

Live preview targets 10 fps. The capture thread only places the latest eligible frame into a one-item preview queue. A separate worker performs Bayer display conversion, downsampling, JSON serialization, and publication. If that worker falls behind, display frames are skipped while original recording continues.

The preview is limited to approximately 320 pixels wide to reduce browser decoding and transfer load. Bayer conversion is for display only and is not color calibrated. Saved pixels are unchanged.

The final report includes `preview_target_fps`, `preview_updates`, `preview_skipped_updates` when applicable, and `preview_observed_fps`. Preview rate is a user-interface metric and is not acquisition-rate evidence.

## Limits

The interface accepts integer rates from 1–100 fps and durations from 1–14,400 seconds. Real studies write five-minute FFVHUFF/MKV segments. After capture, every segment is fully decoded and compared with a streaming source-frame hash file, keeping verification memory bounded. Long-duration use still requires hardware validation and sufficient free storage.

Saved-frame replay maps the global frame index to its segment and uses intra-frame timestamp seeking, so replay latency does not grow with the complete recording length.
