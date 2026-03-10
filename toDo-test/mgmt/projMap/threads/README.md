# Thread Init Resolver

Use this script when the incoming user command is `::init`.

## Command

```powershell
& "$WORKSPACE_ROOT\mgmt\projMap\threads\resolve-init-thread.ps1" -CommandText '::init'
```

## Behavior

- Reads local current datetime.
- Resolves day folder under `${SESSIONS_ROOT}\yyyy\MM\dd`.
- Scans recent `rollout-*.jsonl` files by latest write time.
- Extracts `session_meta.payload.id` as `thread_id`.
- Writes cache to `${PROJMAP_DIR}\threads\current-thread.json` with `thread_id` and `turn_index: 0`.
