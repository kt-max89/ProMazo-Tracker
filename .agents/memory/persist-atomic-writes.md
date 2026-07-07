---
name: persist.ts atomic write pattern
description: Why direct writeFileSync is unsafe and how the fixed atomic write works
---

`server/persist.ts` backs projects and tasks with JSON files under `./data/`. The original implementation used `fs.writeFileSync(file, json)` directly, which is not atomic: a crash or power loss mid-write leaves a truncated file. On next boot, `loadStore` catches the JSON parse error and silently returns `defaults`, then overwrites the corrupt file — causing silent data loss.

**Fix (now in place):** write to a tmp file in `os.tmpdir()`, `fsync` to flush to disk, then `fs.renameSync(tmp, file)`. Rename is atomic on POSIX systems. The temp file is cleaned up on failure. `ensureDataDir()` is also called before each save (not just at boot) so a removed `data/` dir doesn't break saves.

**How to apply:** Any new persist-style store added to this codebase should use `saveStore` from `persist.ts` — do not introduce additional bare `writeFileSync` calls for persistent state.
