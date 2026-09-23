# Throughput and capacity budget

Planning calculations only, not measurements. MB = 10^6 bytes; GB = 10^9 bytes; MiB = 2^20 bytes; GiB = 2^30 bytes. Assumed 1440 × 512 pixels, 100 acquired frames/s/camera and 1,800 s. No compression benefit assumed. Color examples are storage layouts, not validated camera configurations.

`image_bytes = width × height × stored_bytes_per_pixel`

`video_bytes_per_second = image_bytes × acquisition_fps × camera_count`

`session_bytes = (video_rate + neural_rate + measured_metadata_rate) × seconds`

| Cameras / representation | Bytes/pixel | MB/s | GiB / 30 min | GB / 30 min | 1.30 × video budget GB |
|---|---:|---:|---:|---:|---:|
| 1 / Mono8 or unexpanded Bayer8 | 1 | 73.728 | 123.596 | 132.7104 | 172.52352 |
| 2 / Mono8 or unexpanded Bayer8 | 1 | 147.456 | 247.192 | 265.4208 | 345.04704 |
| 4 / Mono8 or unexpanded Bayer8 | 1 | 294.912 | 494.385 | 530.8416 | 690.09408 |
| 2 / unpacked 16-bit samples | 2 | 294.912 | 494.385 | 530.8416 | 690.09408 |
| 2 / RGB8, three bytes/pixel | 3 | 442.368 | 741.577 | 796.2624 | 1035.14112 |

The 30% allocation is a provisional engineering reserve for planning, not measured container overhead or an acceptance limit. Recompute with actual stride, packed pixel representation, metadata, image padding, container/codec and TDT storage. Lossless compression ratios are scene-dependent and cannot be guaranteed.

Example neural allowance ONLY: 32 channels × 25,000 samples/s × 4 bytes/sample = 3.2 MB/s = 5.76 GB per 30 min. No claim that these are the experiment's channels or TDT's native on-disk representation. Two-camera Mono8 plus this hypothetical stream: 150.656 MB/s and 271.1808 GB; 1.30× = 195.8528 MB/s planning write target and 352.53504 GB storage allocation before measured metadata. If TDT writes elsewhere, budget both destinations separately.

180,000 frames/camera and 180,000 rising events are expected for an exact 1,800 s pulse train at 100 Hz with defined start/stop boundaries. A count alone cannot validate rate, alignment or exposure. For example, one 500-byte frame-metadata row per frame gives 0.1 MB/s for two cameras; measure actual schema sizes and mapping/TTL overhead instead of adopting that estimate.

Queue example: 128 raw Mono8 frames per camera = 94,371,840 bytes = 90 MiB and 1.28 s at 100 fps. Two such queues consume 180 MiB excluding buffers, encoding, preview and runtime overhead. A 5,000-frame buffer is 3,686,400,000 bytes (3.433 GiB) per camera and covers only 50 s of stall; it cannot fix sustained underperformance. The simulator's 8-record queues hold metadata, not images.

C: and D: currently have less free space than the two-camera uncompressed 30-minute video alone. E: has enough reported free capacity for that example, but its physical identity, filesystem, permissions, competing load, throughput and role are unknown. Do not select it on capacity alone. Two-camera RGB8 with reserve exceeds its snapshot free space.

Lab evidence needed: exact approved volume/path, available capacity and retention reserve, mapped USB controllers and competing devices, actual payload throughput, p95/max queue occupancy, CPU and encoder load, write latency/stalls and 30-minute sustained recording. Agree a bounded scratch benchmark target, size, duration, cleanup and stop conditions before any benchmark. Then use the actual recording pipeline to validate the budget. No disk benchmark or bulk payload write was performed here.
