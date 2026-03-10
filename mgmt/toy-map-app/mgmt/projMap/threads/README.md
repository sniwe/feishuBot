# Thread Init Resolver

Use this script when the incoming user command is `::init`.

## Command

```powershell
& C:\Users\Qub\mgmt\toy-map-app\mgmt\projMap\threads\resolve-init-thread.ps1 -CommandText '::init'
```

## Behavior

- Reads local current datetime.
- Resolves day folder under `C:\Users\Qub\.codex\sessions\yyyy\MM\dd`.
- Scans recent `rollout-*.jsonl` files by latest write time.
- Extracts `session_meta.payload.id` as `thread_id`.
- Writes cache to `C:\Users\Qub\mgmt\toy-map-app\mgmt\projMap\threads\current-thread.json` with `thread_id` and `turn_index: 0`.
