# Thread Resolver Bootstrap

This directory stores runtime thread cache for `::init`.

- Resolver script: `resolve-init-thread.ps1`
- Runtime cache: `current-thread.json` (generated at runtime)

`resolve-init-thread.ps1` behavior:
1. Resolve local datetime and derive `${SESSIONS_ROOT}\yyyy\MM\dd`.
2. Scan `rollout-*.jsonl` by `LastWriteTime` descending.
3. Parse first `session_meta` entry and extract `payload.id` as `thread_id`.
4. Write `current-thread.json` with selected source metadata and `turn_index`.
