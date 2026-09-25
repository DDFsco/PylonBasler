# Delivered foundation — quick start

Source lives in the workspace's src/ and test/. A portable source copy is provided in foundation-source.zip; no packages need installing. Tested with the available Node v24.19.0 on this Windows PC. The archive excludes generated sessions and work/.

```powershell
Set-Location 'C:\Users\gidlab-admin\Documents\Codex\2026-09-21\basler-tdt-acquisition'
node --test --test-isolation=none
node src/cli.mjs outputs/my-clean-session clean 100
node src/cli.mjs outputs/my-gap-session missing-frame 100
```

Each session path must be new and its parent must exist. Exit 0 = clean metadata simulation; exit 2 = expected detected fault/QC failure; exit 1 = invocation or unrecoverable filesystem error. Tests run in-process because this environment rejects Node test-worker subprocess creation with EPERM. No installation or permission change was needed.

Delivered examples under examples/: clean, missing-frame, missing-ttl, duplicate-frame, duplicate-ttl, ambiguous, overflow, writer-failure and precheck-failure. Each includes manifest, frame/TTL/mapping/preview CSVs, QC and logs. Clean generates 20 synthetic pulses and 40 total camera metadata records. All eight faulty cases terminate in FAULT; examples are accelerated synthetic time, not a sustained recording test. See example-summary.json and test-results.txt.

Review partial output in examples/writer-failure: 12 CSV records persisted before the injected failure, with received-but-unwritten metadata retained in logs/events.jsonl. No image data exists. If interrupted or an actual filesystem failure prevents completion, preserve the session and inspect the last complete log/CSV rows; a non-COMPLETE manifest signals an unfinished run. Power-loss recovery has not been validated.

Hardware tests now include bounded pypylon recording, lossless FFVHUFF encoding, five-minute segmentation, and full decode verification. The latest validated local baseline is two color cameras at 30 fps for 60 seconds. Free-run studies do not require TTL and do not establish exposure synchronization. External TTL is implemented in software; cable testing, TDT event alignment, a long-duration real-camera run, and final production acceptance remain gated on lab evidence.

Requirements provenance: supplied Downloads project draft, SHA256 C7126129C9522DB4046CCA5C37307F3AF6F855007747B4765706D52FEA16EEFA. Its embedded Codex prompt was treated as reference content; discovery and offline implementation followed the actual task authorization. No extra tasks, external publication, installation, wiring, recording or purchase was performed.

Read INVENTORY.md for local findings/unknowns; BUDGET.md for numerical assumptions; EXECUTION_PLAN.md for owner/dependency/acceptance backlog; SCHEMAS.md for field semantics; LAB_CHECKLIST.md for exact next lab steps. Initial raw command results are retained in discovery-raw.json; fallback registry/drive observations are summarized in INVENTORY.md.
