# Changes

## 0.2.0

- Add independent work trackers for HTTP lifetimes, async handlers, and background tasks.
- Add graceful shutdown with a shared drain/resource-cleanup deadline and injectable hooks.
- Add configurable retention for explicitly selected log files and daily log families.
- Add transport-independent notification dispatch with memory, file, and Redis-compatible cooldown stores.
- Export each addition from the root and its own package subpath without new runtime dependencies.
