# LiOS Progressive Validation & CI Strategy

**Owner decisions:** 2026-10-04 progressive gates; 2026-10-14 standard-hosted Linux/macOS/Windows source validation for deliberate public-source release
**Applies to:** all LiOS implementation work, `SI-01` through `SI-07`, `SP-01` through `SP-07`, and P14 release qualification  
**Status:** MANDATORY EXECUTION CONTRACT  
**Primary objective:** maximize implementation speed and preserve engineering truth while minimizing unnecessary self-hosted runner load and GitHub-hosted Actions minutes.

## Public source distribution boundary — 2026-10-14

This separate sanitized proprietary source repository contains **only** `.github/workflows/source-cross-platform.yml`. `third_party/source-distribution.json` inventories the deliberately withheld private production, signing, specialist, self-hosted and packaged qualification workflows and datasets. The original private repository and history remain private; the historical private qualification strategy below does not authorize execution from this snapshot.

The standard hosted source matrix retains Linux, macOS and Windows with the same source tests and build commands. `npm run gate:local` mirrors its five validation commands after local dependency/interpreter setup, not the withheld full Quality Gate. No source failure is converted into a skip or success. Existing hardware-dependent skips (including Actions multicast discovery) stay visible and remain unqualified.

`npm run benchmark:instrument-search:real` is an explicit, separately discovered real-universe benchmark, **NOT_RUN** by source CI. Before running locally, the user must provide lawfully entitled real catalogs under `<ELECTRON_RESOURCES_PATH>/server/data/` (`tickers.json`, `provider_ingested_universe.json`) and attest permitted use with `LIOS_REAL_DATA_BENCHMARK_ENTITLED=1`. Both latency cases require at least 80,000 actual candidates. Missing entitlement/data/scale fails the benchmark prerequisite; no synthetic filler, bundled provider bytes or invented observations substitutes for it.

Source-distribution governance validates the **absence** of withheld release workflows; it does not fabricate their success. Signed installers, native hardware, real-data performance and packaged SP/P14 qualification are **NOT_RUN**, regardless of source matrix results. Their real proof still requires the private release/target contracts.


## 1. Core doctrine

LiOS does **not** use the full repository Quality Gate as the ordinary coding loop.

The mandatory model is:

> **TEST NARROWLY WHILE BUILDING → TEST ACROSS BOUNDARIES WHEN INTEGRATING → TEST EVERYTHING WHEN SHIPPING.**

Implementation continues through bounded branches/tasks. Each task performs focused validation appropriate to its changed behavior. Shared-core milestones receive broader integration validation. The complete repository Quality Gate, packaged target proof and Shipping Point MSJ are reserved primarily for Shipping Points and release qualification.

The strategy prevents both failure modes:

- **too much CI:** every small PR repeatedly runs the full repository gate, wasting time, Mac resources and hosted Actions minutes;
- **too little validation:** an entire SI phase is developed without meaningful testing and accumulated defects are discovered only at the end.

No Shipping Point policy permits agents to skip focused testing while coding.

## 2. Validation levels — V0 through V4

### V0 — Fast Check

**Purpose:** immediate developer/agent feedback while editing.

**Where:** local coding environment whenever possible.

**Typical scope:**

- syntax/compile/static validation for touched code;
- direct unit test(s) for changed behavior;
- JSON/schema/config validation;
- deterministic known-answer check for changed quantitative logic;
- minimal lint/type check required to catch local mistakes.

**Expected cadence:** continuously during implementation.

**Target duration:** seconds to roughly two minutes where practical.

**GitHub Actions:** not required.

### V1 — Focused Task Gate

**Purpose:** prove a bounded task/PR works for its claimed scope before integration.

**Where:** local first; self-hosted only when the required environment is unavailable locally.

**Required behavior:**

- run the focused subsystem tests for changed code;
- run typecheck/build checks needed by that subsystem;
- run known-answer/reconciliation tests for changed deterministic calculations;
- run the affected browser/client smoke when the user flow itself changed;
- record exact commands/outcomes in the PR/handoff.

**Typical examples:**

- GM-11 permission change → GM permission/grant/conversation execution tests + typecheck;
- P4 spreadsheet change → P4 Artifact + spreadsheet import/export + relevant Univer tests;
- P11 valuation change → affected Python model + known-answer + bridge/receipt tests;
- TC UI change → affected client/component tests + focused browser smoke.

The full repository Quality Gate is **not** required merely because a bounded PR exists.

### V2 — Integration Gate

**Purpose:** validate shared contracts and cross-subsystem behavior after a meaningful integration milestone.

**Where:** self-hosted Mac or other approved self-hosted target by default.

**Required for:** changes that materially alter a canonical shared core or after several related bounded tasks converge.

Shared-core examples include:

- execution/Gateway;
- permissions/security/authentication;
- central schema/migrations;
- P4 Artifact authority;
- P5 entity identity;
- P11 engine registry/execution authority;
- P13/GM skills/MCP/plugin authority;
- persistence/storage/backup;
- Working Context;
- model routing;
- Electron/native packaging contracts.

Example GM-11 integration journey:

> request → authorization → exact operation → sandbox → execution → cancellation/recovery → receipt

V2 remains **relevant-subsystem integration**, not automatically the entire LiOS repository.

### V3 — Shipping Gate

**Purpose:** full integrated qualification for a Shipping Point.

**Primary cadence:** `SP-01` through `SP-07`.

**Where:** approved self-hosted infrastructure, using the actual target environment where applicable.

V3 is the normal place to execute the expensive complete Quality Gate and Shipping Point proof, including as applicable:

- complete TypeScript/Node suites;
- complete deterministic Python suites;
- migrations/database contracts;
- live PostgreSQL/RLS contracts;
- security/trust/provider contracts;
- OSS/provenance/license audits;
- canonical P/TC/GM/CA acceptance scripts;
- production build;
- Electron/desktop package or other target package;
- real target/browser/app smoke;
- current Shipping Point MSJ;
- critical regression MSJs from previously accepted Shipping Points;
- restart/recovery;
- backup/restore where required by the Shipping Point;
- resource/packaging evidence;
- exact evidence record.

A V3 pass alone does not accept an SP unless all five Shipping Point gates and the declared MSJ also pass.

### V4 — Release Gate

**Purpose:** final release qualification, primarily `SP-07` / P14.

V4 may include evidence that cannot be represented faithfully by the owner Mac alone:

- clean-machine/install proof;
- supported cross-platform matrix;
- Windows qualification;
- signed/notarized package proof;
- release metadata/assets;
- upgrade/migration/rollback;
- release-channel/update proof;
- final security/privacy/performance/accessibility qualification;
- P14 certification.

GitHub-hosted runners are also used for the owner's three-platform source regression baseline (§7). Source-only jobs are not V4 evidence: real packaged target, installation, signing and release qualification remain separate.

## 3. Risk classes — R0 through R4

Every substantial task/PR declares a validation risk class.

| Risk | Meaning | Minimum validation |
|---|---|---|
| `R0` | docs/comments/metadata with no runtime behavior change | V0 / structural validation |
| `R1` | isolated low-risk implementation | V0 + V1 |
| `R2` | normal capability/product implementation | V0 + V1; selected V2 when interfaces cross subsystems |
| `R3` | shared-core/security/schema/runtime/identity/authority change | V0 + V1 + mandatory relevant V2 |
| `R4` | Shipping Point/release candidate | V0 + V1 + V2 + V3; V4 when release qualification applies |

Risk classification is based on blast radius and authority, not line count.

An R3 task does **not** automatically justify the full V3 repository gate. It requires the relevant V2 integration proof first. A full gate may be run as an explicit exceptional checkpoint when the owner judges the shared-core risk unusually high, but that exception must be stated rather than becoming routine.

## 4. Changed-area validation selection

Agents choose the smallest safe test pack that proves changed behavior. The mapping is maintained by canonical authority, not by convenience.

Initial mapping guidance:

| Changed authority/path | Minimum focused/integration pack |
|---|---|
| execution / `server/exec/**` | GM-10/GM-11 tests; V2 execution flow when shared contract changes |
| Gateway/device trust | GM-08/09 + affected reconnect/cancel/device tests |
| permissions/auth/secrets | trust/security/grant tests; V2 authorization journey |
| schema/migrations/RLS | migration metadata + affected stores + live RLS where material |
| P4 Artifact code | P4/CA-01 Artifact/import/export/version tests |
| P5/entity resolver | P5/CA-03 ambiguity/no-ticker/provider-call controls |
| P11 deterministic engines | affected engine tests + known-answer/reconciliation + receipt/bridge tests |
| portfolio/risk/personal finance | relevant P6/P8/P11 deterministic pack |
| memory | GM-19 + permission/delete/correction persistence tests |
| skills/MCP/plugins | GM-20/P13 + permission/runtime integration tests |
| TC Project/Chat UX | affected client tests + focused browser smoke |
| Electron/native/package | desktop/native tests + target packaging proof at appropriate level |

This table is guidance, not permission to omit a known affected contract.

Future path-aware automation may compute suggested test packs, but automation must not become a new architectural authority. The canonical subsystem owners remain responsible for deciding sufficient evidence.

## 5. SI and Shipping Point cadence

Each SI phase is a **development container**, not one giant branch or one giant PR.

Example:

```text
bounded task A → V0/V1 → merge
bounded task B → V0/V1 → merge
shared-core milestone → V2
bounded task C → V0/V1 → merge
...
SI candidate ready
      ↓
V3 complete Quality Gate
      ↓
Shipping Point MSJ
      ↓
SP accepted
      ↓
tag/freeze known-good baseline
      ↓
next SI phase
```

Do not create an `SI-01` or `SI-02` mega-branch containing weeks of unrelated work.

After acceptance, record the exact commit and create/record a stable SP baseline/tag according to the release procedure, for example `sp-01-accepted`, when the owner chooses to publish that tag.

Later phases must preserve accepted SP journeys.

## 6. Full Quality Gate trigger policy

The complete `LIOS Quality Gate` is **manual/deliberate**, not the ordinary PR/push loop.

Approved reasons to run the full gate:

1. a declared `SP-01`…`SP-07` candidate;
2. P14 / release candidate qualification;
3. an explicitly documented exceptional R3 shared-core checkpoint where full-repository regression confidence is materially justified.

Not sufficient by itself:

- opening an ordinary PR;
- pushing another small commit;
- changing documentation;
- fixing a focused test;
- convenience or uncertainty that should first be resolved through V0/V1/V2.

The dispatcher records the purpose/target so the run has context.

## 7. GitHub Actions and runner policy

### Local-first

Local focused testing is the default implementation loop.

### Self-hosted first

The owner's self-hosted Mac is the primary integration/desktop/Shipping Point runner for work it can faithfully prove.

Use it primarily for:

- V2 integration gates;
- V3 Shipping Gates;
- Electron/macOS/native packaging;
- node-pty/native runtime checks;
- browser/Electron smoke;
- PostgreSQL/RLS integration;
- restart/recovery and target MSJs.

### Standard-hosted source validation

The owner's 2026-10-14 choice adds `LiOS Hosted Source Validation` (`.github/workflows/source-cross-platform.yml`) on **standard** `ubuntu-24.04`, `macos-15` and `windows-2022` runners. The repository remains private until the owner deliberately authorizes publication; public source retains the owner's proprietary rights and is not an open-source license grant. The workflow's platform jobs are disabled while `github.event.repository.private` is true. Do not dispatch jobs or change visibility to work around private billing or incomplete publication readiness.

After deliberate publication, every PR (including a fork PR), `main` push and manual source dispatch has three independent matrix jobs. Each installs the lockfile's Node dependencies **with native install scripts enabled**, installs the existing Python 3.12 deterministic-engine requirements, typechecks, runs offline server/shared/client/script tests and desktop source contracts, runs all `test_*.py` deterministic-engine tests, and builds the client/server/desktop restore worker. The reused `script/run_project_tests.mjs` discovers nested project-owned tests without shell globs, rejects empty groups, bounds file concurrency to two, batches below Windows command-line limits and propagates errors/signals/nonzero exits. No platform is optional or `continue-on-error`; matrix fail-fast is disabled so one failure does not cancel the other platforms. Every platform job must succeed; a skipped, cancelled, timed-out or unexecuted job is not a pass.

This bounded source regression baseline supplements V0/V1 and relevant V2; it is **not** the complete V3 Quality Gate. It does not establish signed/notarized installer acceptance, native GUI/interactive terminal/PTY behavior, Docker isolation/resource enforcement, multicast/device discovery, live PostgreSQL/RLS, clean installation/upgrades, provider/live-model acceptance or any packaged SP/MSJ. Source tests may report their own target-dependent skips; record those explicitly as uncovered evidence rather than treating an OS job as packaged qualification. P11 lifecycle/device TLS qualification remains a deliberate manual target gate. Actual OS failures must be fixed or recorded as blockers, never masked by dropping a platform/test or converting failure into success.

Hosted-source safety and cost requirements:

- read-only `contents` token permissions; no persisted checkout credentials, secrets, production environment, signing, deployment or release steps;
- ordinary `pull_request`, never `pull_request_target` or a privileged `workflow_run` bridge;
- standard ephemeral hosted runners only for untrusted PR code; no shared owner Mac, privileged caches or owner credentials;
- no native AI CLI install/login/invocation; fail closed if `codex`, `claude`, `cursor-agent` or `acpx` is present on PATH. Current-main ACP only inventories native runtime availability and does not execute those providers;
- real supported `PYTHON_EXECUTABLE` is set from the selected interpreter's `sys.executable`, including native Windows paths; no guessed Python environment keys;
- provider credential/endpoint environment is empty; no live-provider acceptance or paid inference. Offline contracts use their own local fixtures/mocks, not production credentials;
- action revisions pinned to full upstream commit IDs, stale-run cancellation, three matrix jobs maximum, two concurrent Node test files, one numerical-library thread, and a 60-minute ceiling per platform;
- no source artifact upload or cache publication: retain normal sanitized Actions logs only. If a future failure artifact is necessary, allowlist sanitized reports, never runtime stores/credentials/private documents, and use short explicit retention.

Public standard-hosted Actions eligibility is not unlimited compute or a promise of free private usage. Keep these bounds; do not migrate to larger/paid runners implicitly.

### Self-hosted trust boundary and deliberate hosted qualification

Existing self-hosted specialist workflows remain manual or restricted to their existing trusted in-repository branch pushes; none is enabled for public/fork PRs. Before publication, the owner must also restrict the self-hosted runner group/repository access and workflow approvals in GitHub settings: YAML in an untrusted PR is not a security boundary against a proposed workflow rewrite. Never approve an untrusted PR workflow that targets the owner Mac or forwards its output into a privileged workflow. Keep manual V3/SP/release execution restricted to reviewed trusted commits.

Hosted target lifecycle, native package and final release/certification jobs remain deliberate/manual when their evidence is required. They do not become automatic PR jobs merely because the source baseline exists.

### One heavy job at a time

On the owner Mac, avoid concurrent heavy packaging, Docker/PostgreSQL, browser/Electron, Python full-suite and full Quality Gate jobs.

Parallel coding is encouraged. Parallel heavy CI on the same 16 GB development Mac is not.

Existing workflow concurrency cancellation should be preserved where stale results have no value.

## 8. Failure and rerun discipline

A full gate is a confirmation mechanism, not a debugging loop.

If V3 fails:

```text
V3 fails
  ↓
identify first real failing subsystem
  ↓
reproduce with V0/V1 focused command
  ↓
fix
  ↓
run relevant V2 integration pack
  ↓
repeat targeted work until clean
  ↓
run one final V3 confirmation
```

Do not repeatedly rerun the entire Quality Gate without diagnosing and fixing the actual failure.

Infrastructure/runner/billing failures that prevent code from executing are not code passes or code failures. Record them separately.

## 9. Runner hygiene and resource protection

Every heavy self-hosted workflow must preserve cleanup-on-failure behavior.

Requirements include, where applicable:

- disk preflight before heavy work;
- deterministic temporary paths;
- `docker rm -fv` or equivalent volume-clean removal for ephemeral databases;
- cleanup of temporary DBs/containers/processes;
- cleanup of temporary Python environments/package artifacts when safe;
- bounded artifact retention;
- preservation of useful dependency caches instead of blind cache deletion;
- cleanup in `always()`/failure paths;
- no overlapping heavy workflows on the same owner Mac when avoidable.

Do not trade GitHub-minute savings for uncontrolled local disk/RAM exhaustion.

## 10. Artifact and evidence retention

### V0/V1

Normally retain only the PR/handoff command/outcome record. Large CI artifacts are unnecessary.

### V2

Retain relevant logs/failure evidence and small reports needed to reproduce the integration result. Use short retention where configurable.

### V3/V4

Retain durable evidence appropriate to the milestone:

- exact SHA/build/release identifier;
- runner/OS/environment/topology;
- Quality Gate result;
- exact MSJ and outcome;
- target/package evidence;
- known limitations;
- regression status for prior SPs;
- release/signing/cross-platform evidence when applicable.

Shipping Point and P14 evidence form part of LiOS product history.

## 11. PR and handoff requirements

Every substantial implementation PR/handoff records:

- SI phase/workstream;
- canonical GM/TC/CA/P owner;
- target SP/MSJ contribution;
- risk class `R0`…`R4`;
- validation levels actually run (`V0`…`V4`);
- exact focused test commands and outcomes;
- whether V2 is required and, if not, why not;
- whether a full V3/V4 gate is required now or deferred to the Shipping Point;
- truth level reached;
- known gaps/blockers.

A PR must never imply “fully validated” merely because full V3 was intentionally deferred.

## 12. Shipping Point regression policy

Once an SP is accepted, later Shipping Gates protect it.

The current V3 candidate must run:

1. the current SP MSJ;
2. the complete repository Quality Gate appropriate to that milestone;
3. critical smoke MSJs for previously accepted SPs, or equivalent stronger evidence already contained in the gate.

If an accepted journey regresses, reproduce and repair it before continuing to claim that Shipping Point remains accepted.

## 13. Release policy

`SP-07` does not replace P14.

The sequence is:

> **SI-07 candidate → V3 → SP-07 evidence → V4 release qualification → P14 → production**

Cross-platform hosted **source** validation follows §7 after deliberate publication. P11 lifecycle, native packaged SP and release qualification workflows remain deliberate/manual and are invoked only when their target evidence is required.

## 14. Immediate workflow behavior

Effective with this policy:

- `LIOS Quality Gate` is manual/deliberate instead of automatic on every PR and `main` push;
- default full-gate execution targets the owner's self-hosted macOS runner, with self-hosted Linux and hosted Linux available only when deliberately selected;
- `LiOS Hosted Source Validation` supplies three bounded standard-hosted OS jobs for public PRs/`main` pushes and manual source dispatch, with all jobs disabled while private and no current hosted/platform acceptance claimed from configuration;
- specialist visual/RLS/P11-lifecycle/native-packaged/release workflows remain manual or retain their existing trusted branch-only triggers; none gains public/fork PR access to self-hosted runners;
- stale runs remain cancellable where their result is no longer useful;
- ordinary PRs depend on truthful V0/V1 evidence, all three hosted source results after publication, and V2 where risk requires it, not an automatic V3 run.

## 15. Non-negotiable summary

> **No agent may skip focused testing because a Shipping Point gate exists later.**

> **No agent may trigger the full gate merely because it is convenient.**

> **R3 shared-core changes receive relevant V2 integration proof before stacking more work.**

> **V3 is the normal complete-gate boundary for SP-01 through SP-07.**

> **V4 is reserved for real release qualification.**

> **GitHub-hosted compute provides the owner's bounded three-platform source baseline after deliberate publication; native target/SP/release evidence remains a separate deliberate qualification.**

This contract optimizes for fast development **and** strong shipping truth; neither objective may erase the other.
