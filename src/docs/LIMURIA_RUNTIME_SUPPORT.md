# Limuria Runtime Support

This matrix is the runtime support reference under the current SI/GM contracts, not a Phase 0 execution roadmap or proof of packaged qualification. Versions below the minimum are unsupported even when a narrow command appears to work.

| Component | Supported baseline | Purpose / notes |
| --- | --- | --- |
| Node.js | 22.12 LTS or newer 22.x | Server, Vite, tests, packaging. Required by the Electron rebuild toolchain. |
| npm | 10 or newer | Lockfile and lifecycle scripts. |
| Python | 3.11 through 3.13 | Development analytics runtime may be optional; signed desktop releases require the bundled, managed, verified sidecar rather than customer-installed Python. |
| PostgreSQL | 15 or newer | Advanced user-owned canonical database via `DATABASE_URL`, not LiOS-hosted production infrastructure. |
| PGlite | Repository-locked version | Default local canonical database; do not share one data directory across concurrent processes. |
| Electron | Repository-locked version | macOS and Windows desktop shell. |
| macOS | 13 Ventura or newer | Supported desktop target; Apple Silicon is the primary packaging target. |

macOS release artifacts require Developer ID signing and notarization; Windows x64 NSIS installers and bundled sidecars require Authenticode signing. Public qualification targets macOS Apple Silicon arm64 and Windows x64 under P2/P14; other build/runtime architectures are not automatically qualified. Unsigned local/preview builds cannot substitute for exact signed-release evidence.

## Known local PGlite startup limitation

The embedded desktop database is a single-owner data directory, not a
concurrent multi-process database. `src/dataRootCore.cjs` resolves the DataRoot:
`LIOS_DATA_ROOT`, legacy `LIMURIA_DATA_DIR`, saved selection, then
`~/.limuria-terminal` in production or `<cwd>/data` in development. The normal
database directory is `<DataRoot>/pgdata`; legacy direct database-directory
layouts are recognized by the resolver. Starting another server or packaged app against the same
directory while the first process still owns it is unsupported and can fail
closed on the ownership marker. A stale or damaged directory can instead
surface as PGlite's opaque WASM `RuntimeError: Aborted()` during startup or
migration. Stale-lock handling does not make concurrent access safe.

Preserve the existing data directory when diagnosing this condition; do not
delete or reset it as a verification shortcut. For isolated browser checks,
use a dedicated `LIOS_DATA_ROOT` so the result represents a clean,
single-process local database. Isolated-browser verification must be reported
separately from shared-database migration/startup acceptance. User-owned PostgreSQL
via `DATABASE_URL` is a separate deployment path and is not subject to this
local-directory limitation.


## Deterministic Commands

- `npm run check`: TypeScript contract check.
- `npm run test:offline`: deterministic tests with no paid provider or network dependency.
- `npm run test:trust`: auth audience, tenant scope, upload policy, and listener behavior.
- `npm run test:provider-contract`: deterministic parsing and normalization tests for external provider payloads.
- `npm run build`: the single web build and server bundle; authorization remains server/main-process role-gated.
- `npm run smoke:local`: public health, page, and anonymous-auth boundary against a running build.
- `LIMURIA_SMOKE_EMAIL=... LIMURIA_SMOKE_PASSWORD=... npm run smoke:local`: adds a real session login check.
- `npm run audit:prod`: exact-lock production dependency advisory report; high/critical findings or unavailable advisory data fail closed. Historical snapshots are not accepted residuals.

Live provider checks are intentionally separate from the offline suite because they consume credentials, quota, and external availability. Each provider feature must expose its unavailable/degraded state without preventing terminal startup.
