# LiOS — Local Development & Verification

**Repository:** `kiranvbiim-coder/lios-v1.0.0`
**Default branch:** `main`  
**Purpose:** technical runbook only. Read `AGENTS.md`, the final SI execution plan and mandatory `technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` before the product/subsystem docs. Commands below are prospective checks, not evidence executed by this reconciliation.

## Requirements

- Node.js >= 22.12
- npm >= 10
- macOS or Windows for desktop packaging work
- Python 3.11–3.13 when running Python engines outside the packaged managed runtime

## Install

```bash
git clone <repo-url> lios-v1.0.0
cd lios-v1.0.0/src
npm ci
```

No `.env` is required for the basic local desktop/web development path; the app can use embedded PGlite.

## Start internal development build

```bash
cd src
npm run dev
```

Default local port: `5052`.

## One Home build and authentication authority

LiOS uses one build/web bundle and one Home-owned `/api/auth/*` identity/API authority, with runtime role/entitlement behavior. Separate `dev:client`/dual-audience workflows are retired historical assumptions, not instructions to recreate a customer service. Desktop Local is default; a user-owned server/cloud Home is permitted, but no LiOS-operated customer runtime is required. Local trial or imported vendor-signed licence governs effective access independently of work ownership.

## First-run expectations

On a fresh local data directory:

1. establish/sign in to the local Home owner identity when prompted;
2. enter chat immediately; a first question may become Quick Chat without a Project;
3. connect AI/data contextually when needed; zero connections is valid for supported local/deterministic work;
4. do not require persona/domain/provider/tutorial setup. Project Home is rich and adaptive, while Global/New Chat stays minimal.

**Current runnable retention flow:** use **Keep in Project** to save conversation-produced Artifact work, including work from Project Chat. Project Chat saves into its current Project; Quick/Temporary Keep requires an explicit existing/new Project destination and scope preview. Saving refreshed work also requires Keep to append a version. This Artifact retention gap does not mean ordinary saved Projects, chats or already-kept Artifacts are lost.

**Approved target, still open under TC-13/P4:** meaningful Project outputs must auto-persist as versioned Artifacts without manual Keep. Quick/Temporary promotion must retain the explicit destination/scope preview. Permission enforcement, provenance, immutable versions and accessible history remain required; the current Keep flow does not close this target.

Do not infer target product UX from a legacy/current implementation screen. The canonical target is defined by:

- `docs/LIOS_MASTER_PLAN.md`
- `docs/LIOS_UX_SYSTEM.md`
- `docs/LIOS_EXECUTION_ROADMAP.md`

## Core verification

Run from `src/`:

```bash
npm run check
npm run test:offline
npm run test:trust
npm run test:provider-contract
npm run test:desktop
npm run test:release-preflight
npm run build
```

Run the full Python deterministic-engine suite when Python/quant code changes:

```bash
PYTHONPATH=python-service python -m unittest discover -s python-service -p 'test_*.py'
```

Tenant/security-sensitive changes require a real PostgreSQL/RLS verification path as defined in `AGENTS.md`.

## Useful commands

```bash
npm run smoke:local
npm run audit:quant
npm run acceptance:providers
npm run acceptance:desktop
npm run acceptance:accessibility
npm run acceptance:production
npm run acceptance:security
```

## Desktop packaging

Local package without final distribution signing:

```bash
npm run app:pack
```

macOS distribution:

```bash
npm run app:dist:mac
```

Windows distribution:

```bash
npm run app:dist:win
```

Public release remains fail-closed until signing/notarization/update/recovery prerequisites are satisfied.

## Python managed runtime

The retail runtime is **pack-scoped and core-first**.

- core quant packages are installed first;
- fixed-income, forecasting, econometrics, ML, optimization, SEC research and community-data packs are optional;
- yfinance/community Yahoo is opt-in;
- OpenBB is excluded from the runtime; no OpenBB sidecar or package is required or supported;
- do not install speculative Python libraries outside the active task's runtime-pack decision.

See `docs/LIOS_ARCHITECTURE.md` for the reuse matrix.

### Target wheel-lock qualification

From `src/`, run `node --import tsx script/qualify_runtime_wheels.ts --output /absolute/new-release-directory --python python3.12 --packs core`. Additional comma-separated pack IDs are opt-in. The tool reuses canonical manifest specifications and pip's wheel-only resolver; ranges become exact versions from real wheel metadata. Each pack includes core and is constrained to the same core closure.

The output contains per-pack wheels, `<pack>.lock.txt` with SHA-256 hashes of actual bytes, and `qualification.json` binding the manifest digest, target platform, Python version and outcomes. A fresh venv installs offline using `--require-hashes`, runs `pip check` and exercises native core imports. Failed/source-only/ambiguous closures publish no qualified output. The directory must not already exist.

These are unsigned target-host release candidates, not runtime activation, model-asset qualification, cross-platform certification or an OSS dependency-rights approval. Review/sign/stage the selected locks through the existing release process before shipping; this command never sets production `hashVerified` or changes managed-runtime readiness.

The shipping server suite runs with two concurrent test files to bound native/database worker pressure on the owner host. `gate:local` writes each step's stdout/stderr directly to its announced log file as it executes; unfinished steps retain diagnostic output rather than losing buffered output on interruption. Concurrency changes do not remove tests or change pass/fail semantics.

Python HTTP computation deadlines and owner cancellation remain active until the complete success/error body has been read and decoded, not merely until headers arrive. Stalled bodies return the locally classified timeout/cancellation failure rather than remaining pending indefinitely. This aborts the client HTTP request; it does not claim that remote CPU computation has stopped or that strict long-lived sidecar isolation is available.

Failed readiness checks without a live owned child and rejected environment lookups are not cached permanently. After configuration correction, a later explicit request may retry; concurrent requests still share one readiness/metadata operation. No automatic retry loop is introduced, and a cancelled child retains startup ownership until its exit observer clears it.

## Data and AI

- user credentials must never be committed;
- BYOD/private data stays local wherever practical;
- BYOAI is provider-neutral;
- AI OFF must preserve deterministic workflows;
- community/unofficial data access is consent-gated;
- missing data must remain unavailable rather than fabricated.

## Multi-agent development

Before coding, every agent must read `AGENTS.md`.

Use:

1. current `main`;
2. SI phase/workstream and existing canonical `GM/TC/CA/LIOS-P*` owner ID(s);
3. one bounded task branch and singular shared-core owner, with coordinated parallel consumers behind stable contracts;
4. explicit high-conflict files and dependencies;
5. target Shipping Point, exact MSJ contribution, evidence/truth level and reproducible PR handoff.

Do not continue from an old agent branch merely because its name sounds relevant.

SP-01–07 require real integrated journeys, target/package execution where applicable, no fake success, protected accepted regressions and exact build/environment/outcome/limitation records. Source-only work does not prove SP acceptance or P14 release. Ordinary PR authority is the owner self-hosted Linux `lios-docker` Quality Gate; queued/offline runners are infrastructure, not pass/fail. Manual P11 macOS/Windows qualification remains separate.

## Resetting local data

Deleting local PGlite/workspace state is destructive. Only do it when intentionally testing clean first-run behavior, and never treat deletion as a fix for a migration defect.
