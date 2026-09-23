# Real camera study

The real study path records one to six Basler cameras through pypylon. It preserves each selected camera's native Mono8, Mono16, or BayerRG8 pixels in a lossless FFV1/MKV file and records the block ID, native camera timestamp, PC receive time, and SHA-256 hash for every frame.

## Free run without TTL

The current study mode is `free_run_no_ttl`. It does not require a pulse generator, TDT event input, or a running Synapse experiment. At startup it snapshots every trigger selector, temporarily disables trigger modes, applies the requested frame-rate limit, and verifies the resulting rate. At finalization it restores the original frame-rate and trigger settings.

This allows real recordings while hardware synchronization is being prepared. Concurrent camera starts and overlapping PC receive times do not prove simultaneous exposure, so `synchronization_verified` remains false.

## Preview behavior

Live preview targets 10 fps. The capture thread only places the latest eligible frame into a one-item preview queue. A separate worker performs Bayer display conversion, downsampling, JSON serialization, and publication. If that worker falls behind, display frames are skipped while original recording continues.

The preview is limited to approximately 320 pixels wide to reduce browser decoding and transfer load. Bayer conversion is for display only and is not color calibrated. Saved pixels are unchanged.

The final report includes `preview_target_fps`, `preview_updates`, `preview_skipped_updates` when applicable, and `preview_observed_fps`. Preview rate is a user-interface metric and is not acquisition-rate evidence.

## Limits

The interface accepts integer rates from 1–100 fps and durations from 1–14,400 seconds. Long studies currently produce one MKV per camera and perform a full decode and pixel-hash comparison after capture. Segmented real-camera recording remains future work, so long-duration use requires additional hardware validation and sufficient free storage.
