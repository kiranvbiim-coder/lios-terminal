# LiOS — Local Development & Verification

**Repository:** `kiranvbiim-coder/lios-terminal`
**Default branch:** `main`  
**Purpose:** technical runbook only. Read `AGENTS.md`, the final SI execution plan and mandatory `technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` before the product/subsystem docs. Commands below are prospective checks, not evidence executed by this reconciliation.

## Requirements

- Node.js >= 22.12
- npm >= 10
- macOS or Windows for desktop packaging work
- Python 3.11–3.13 when running Python engines outside the packaged managed runtime

## Install

```bash
git clone https://github.com/kiranvbiim-coder/lios-terminal.git lios-terminal
cd lios-terminal/src
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

### User-owned persistent Home (headless)

The public source includes `src/deploy/home/compose.yaml`, using the existing server and identity authority rather than a separate headless backend. From `src/`, with Docker Compose installed:

```bash
docker compose -f deploy/home/compose.yaml up --build -d
```

The service runs as UID/GID `10001`, drops Linux capabilities, uses a read-only root filesystem and bounded temporary storage, and persists the canonical Home in the `home-data` volume. It binds **only** `127.0.0.1:10000` on the host; `LIOS_HOME_PORT` changes that local port. Do not expose it publicly without your own HTTPS reverse proxy and access policy. No LiOS-operated runtime cloud is required.

For first-owner enrollment, obtain the one-time token from the private Home file `/data/lios/owner-setup.token` or the initial operator-only service log. Do not publish logs containing that token. Finish setup through HTTPS or direct loopback; the canonical owner bootstrap closes after the first owner exists. Credentials/session state remain in the persistent Home, never baked into the image. Preserve the volume when updating; removing it deletes your Home.

Strict execution remains enabled. This pack does not mount a host Docker socket, install arbitrary packages, grant a provider entitlement or silently fall back to host execution. Governed computation that requires an absent backend stays unavailable until that backend is separately configured and approved. Stop/restart retains saved work and does not authorize replay of uncertain side effects.

**Qualification boundary:** YAML semantics and the canonical production server can be verified locally without building an installer. A container build, cloud deployment, clean-host recovery and SP-06/SP-07 qualification are separate evidence; do not treat this recipe as a passed deployment.

### Native Apple, Android and watch clients

Reviewed source is under `apps/apple` and `apps/android`. Exact owner-authorized transfers and pinned MIT adaptations are recorded in `apps/provenance.json` and `apps/NOTICE.txt`. These clients connect to the same user-owned Home, not a separate mobile backend. Do not commit generated projects, local SDK paths, keystores, provisioning profiles or signing passwords.

Apple requires full Xcode with iOS/watchOS SDKs and XcodeGen >= 2.42. From the repository root:

```bash
cd apps/apple
xcodegen generate --spec project.yml
xcodebuild -project LiOSApple.xcodeproj -scheme LiOS \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

For owner-signed device builds, supply `LIOS_DEVELOPMENT_TEAM` and a bundle prefix you control. No team identifier or signing credential is included. Run `LiOSAppleTests` on an available iOS simulator before device qualification.

Android/Wear requires JDK 17, Gradle 8.11.1 and Android SDK 35. From `apps/android`, run `gradle :phone:assembleDebug :wear:assembleDebug`. Release signing reads only the owner's `LIOS_ANDROID_KEYSTORE`, `LIOS_ANDROID_STORE_PASSWORD`, `LIOS_ANDROID_KEY_ALIAS` and `LIOS_ANDROID_KEY_PASSWORD` environment settings. Review the resolved dependency notices before distribution; source availability is not APK signing or release qualification.

Enable device networking on the Home only when needed. Compare its TLS certificate fingerprint out-of-band; issue a one-use pairing code and explicitly approve the device on Home. Apple accepts the owner-shown WSS endpoint, fingerprint and code; Android/Wear accepts the Home's `lios-pair:v1:` invitation. A changed pin requires owner inspection, never trust-on-first-use or silent replacement.

Projects, Chats, Artifact revisions, notification reads and financial reviews use current canonical Home state. A disconnected receipt/review remains a draft. Reconnect never releases a draft automatically: inspect it and explicitly release the same request after Home rereads identity, receipt/head and policy. Exact ambiguous-delivery retries return the existing approval receipt; changed content under the same request is refused. Financial review never authorizes a trade, command or other execution. Watch snapshots are visibly historical; Apple Watch opens review on the phone rather than submitting approval.

Foreground/connected notification delivery is supported by the client source; background push or an always-on relay is not provided. Lock-screen notification text is generic; full details require opening LiOS. A stopped Home cannot serve fresh state.

**Observed verification:** compiled Home signed-TLS pairing/owner approval, canonical Chat continuity and explicit review/replay/refusal journey passed without AI. Production Apple proof code compiled/ran and Gateway code typechecked on macOS. Full iOS/watchOS app builds/tests and Android/Wear compilation remain **NOT_RUN** on the current host because their SDK/build prerequisites are absent; native UI and shipping acceptance remain separate.


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

### Automation notifications and Home attention

In **Automations**, choose the Project for saved workflows and their canonical notifications. Configured relevance, unchanged-result and cooldown rules govern delivery; completion rereads the owner's current notification policy rather than using an old run-start snapshot. Concurrent completions share one cooldown admission. Marking a delivered notification read persists on Home. A failed run remains failed even when its notification is suppressed.

Expand **Home-wide attention** only when wanted. This reads the owner's watchlist and saved intelligence across Home, not only the selected Project. Inspect the source evidence, then use **Mark reviewed**, **Snooze** or **Reopen for review**. Snooze stays quiet until explicitly reopened; neither review control changes a financial Decision, submits a trade nor authorizes execution. The panel does not fetch while collapsed. Previously reviewed material items remain inspectable after reload.

Market attention retains actual quote observation time and never invents portfolio exposure to boost priority. Missing observation time does not become a fresh event. Source access/freshness and live target qualification remain independent from these control/UI checks.

Successful saved-conversation reruns retain generated outputs as canonical Project Artifacts with their trust/source/receipt and refresh metadata. Run output records exact retained versions/content hashes. A second identical deterministic financial result is not treated as changed merely because a new run, receipt or draft ID was generated. These retained outputs are new work products, not automatic financial Decision approval or an overwrite of an owner's reviewed conclusion.

Recurring work reloads the owner's current active/lock/password/role/organization state before admission. Pausing or changing a scheduled/event workflow invalidates an already captured action snapshot before the run insert. A denied owner is counted as failed without stopping other owners' due work. Filing observation also uses the owner's current source/credential/consent context before provider access. These checks do not establish provider coverage, always-on availability or automatic restart-safe side-effect replay.

For a **Filing / Earnings / Valuation / Portfolio / Report** monitor, first retain the successful financial work in its Project. Use **Tools → Advanced → Save workflow**, choose the Finance template, inspect the exact retained version/hash and check explicit baseline acceptance. Home verifies the successful recorded request, current Artifact head, receipts and completed execution record at creation and on every run. Missing/stale custody stops the monitor rather than silently rebinding it. The dialog uses the successful server-resolved mode/scope, which may differ from the original composer intent. This accepts a monitor baseline only, never a financial Decision or execution approval. Unsupported attachment replay remains explicitly refused.

For accepted deterministic Personal Finance work, **Use the latest saved Personal Finance profile on each run** explicitly binds the exact saved Project resource instead of replaying frozen account inputs. It is off by default. Home records the current resource id, input hash and as-of date per run; deleted, archived or invalid source state stops the run. This does not move the excluded financial profile into ordinary AI context. Without the option, the accepted original inputs are replayed; no current-data refresh is claimed.

Thesis monitors propose substantive typed-evidence changes through the existing Artifact review queue. They do not automatically advance the owner's thesis version or conclusion. Review the proposal in **Library**, inspect evidence, then explicitly Accept or Reject. Repeated identical evidence reuses the proposal and does not produce repeated material-change alerts; observation timestamps alone do not count as thesis changes.

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

### Restore destination safety

Restore requires a real Home directory and refuses symbolic-link destinations before importing the database, then rechecks each file path before mutation. Extraction reserves a fresh private staging directory and cleans only its own reservation on failure. Replaced files are retained in an exclusive `restore-previous-<timestamp>-<uuid>` directory, so repeated restores in one second preserve separate historical copies. A source-level restore test does not establish packaged recovery or whole-Home transactional rollback across every mid-restore failure.

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
