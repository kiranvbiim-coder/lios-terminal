# P10 — Production Hardening, Runtime Packs, OSS Governance & Release

Supporting technical specification. [SI-01–SI-07](../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md) is the active execution program; [LIOS_EXECUTION_ROADMAP.md](../LIOS_EXECUTION_ROADMAP.md) preserves canonical task IDs and historical/detailed evidence. P10 owns the hardening/release-capability baseline; P14 remains final release authority.

## Goal

P10 hardens the existing P1→P9 foundations and supports SI convergence without creating parallel runtime, telemetry, lineage, packaging or governance stacks. P10 source capability completion is not exact-package release certification.

The release loop is:

> build exact source → audit dependencies/licenses/OSS/runtime packs → test P1→P10 → render packaged experience evidence → sign/notarize → native self-test → checksum → clean-machine install → publish recoverable update evidence.

LiOS remains local-first/BYOD/BYOAI. Release hardening must not turn diagnostics, lineage, provider connectors or optional runtime packs into new data-custody surfaces.

The [Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md) requires progressive `SP-01`–`SP-07` proof, not a final-only release backlog. Each defined Minimum Shippable Journey (MSJ) needs real user execution, packaged/target execution where applicable, no fake success, protection of accepted journeys and exact evidence. Record commit/build/release, target/topology, MSJ, checks/outcomes, permissions/provenance/numerical proof, limitations, truth level and gaps/next dependency. P10 supplies canonical hardening/packaging enablers; neither its source gate nor this specification establishes an accepted SP. `S0`–`S10` are validation coverage; CP phases remain historical evidence.

## P10 principles

1. **Canonical systems win.** Existing Electron updater/recovery, P5 lineage, P3 Ledger, managed Python runtime and Provider SDK remain authoritative.
2. **Capability checks are not packaged evidence.** CI validates source/contracts; production release must validate actual signed/notarized package, native self-test, rendered visuals and clean install.
3. **Core-only default.** Optional Research/Quant/Modeling/Data Lab/Local AI capability packs are not silently enabled.
4. **No silent model download.** Local AI remains BYO/local; Master AI and Project approvals remain authoritative.
5. **Observability is local/redacted by default.** Remote OTLP export requires explicit redacted-only opt-in; raw prompts, bodies, credentials and provider payloads are excluded.
6. **OpenLineage is optional interoperability.** Canonical P5 DataLineageReceipt remains authoritative; exported references are fingerprinted.
7. **OSS reuse is exact and auditable.** Repository, SHA, license, destination/adaptation, regression evidence and notices must reconcile before release.
8. **Code rights ≠ data rights.** LSE MIT code/reference rights do not grant hosted data redistribution rights.
9. **LSE stays optional/fail-closed.** User-owned key, local-use policy, explicit entitlement/quota/health, no central redistribution, other providers remain eligible.
10. **Security scanners are release gates.** Node/Python vulnerability scans and license audits run in CI and production release.

## Runtime Packs

P10 defines six user-facing/release packs above the existing signed low-level managed Python allow-list:

| Pack | Purpose | Default |
| --- | --- | --- |
| Core | Project/Artifact/deterministic foundation | Yes |
| Research | SEC research + opt-in local document intelligence | No |
| Quant | Fixed income, econometrics, forecasting, optimization, ML | No |
| Modeling | Valuation/scenario/formula/model-change workflows | No |
| Data Lab | Advanced local analysis/high-volume/provider-connected experimentation | No |
| Local AI | BYO/local AI capability; no silent model install | No |

The implementation is `server/p10RuntimePacks.ts`. It expands into the stable low-level manifest in `server/runtimeManifest.ts`; it does not replace it. The existing `/api/setup/python-runtime` surface exposes the six release packs, and `/api/setup/python-runtime/install` accepts `releasePackIds`, expands them into low-level signed pack IDs, then reuses the existing consent, install, audit and rollback path. Low-level `packIds` remain supported for compatibility. Connection Center presents these six capability packs as the primary managed-runtime choice and persists the user-facing selection alongside the expanded low-level pack state. The separate first-run Environment Setup continues to describe low-level engine configuration rather than pretending it is the installer. Community Yahoo/yfinance remains a separately consent-gated advanced managed add-on, not a seventh release pack. Managed-runtime installs snapshot both the expanded low-level pack state and the six-pack user selection inside the runtime; rollback restores the previous environment and its matching selection metadata atomically.

## Observability

`server/p10Observability.ts` provides:

- bounded local JSONL trace/metric/log records;
- HTTP boundary spans with method/path/status only;
- P9 workflow spans with template/trigger/action only;
- credential/content-key filtering and credential-value redaction;
- optional OTLP/JSON export to `/v1/traces`, `/v1/metrics`, `/v1/logs`, including protocol-correct JSON byte encoding for trace/span identifiers;
- remote export disabled unless explicit `redacted-only` confirmation is configured.

## Lineage interoperability

`server/p10OpenLineage.ts` projects an already-validated P5 `DataLineageReceipt` into a non-authoritative OpenLineage-style COMPLETE event.

Raw entity/dataset references are fingerprinted. Local projection is optional, bounded/rotated and non-critical; remote export is disabled by default and requires explicit `fingerprinted-only` confirmation.

## Experience Center

The P10-era anonymous Experience Center is a read-only 5–10 minute product explanation, retained as a guided-demo/source contract:

1. Connect your data
2. Ask in Project context
3. Inspect evidence and models
4. Save the workflow

It makes no live provider/AI calls, requires no key/login and explicitly labels all previews as static—not live financial data.

It is not the current first-use authority. P14-11 qualifies `PublicProductPreview → authentication → Project/Quick/Temporary conversation → optional Connection Center`, including asking with zero connections and returning to the preserved task. Static preview evidence cannot close first-use or flagship acceptance.

## Packaged acceptance

`script/validate_p10_packaged_acceptance.ts` has two modes.

### CI capability mode

Requires:

- guided Experience Center;
- performance budgets;
- accessibility source contracts;
- 15 UX and 12 analytical visual-smoke workflow contracts;
- signed/notarized release workflow;
- updater/recovery coverage;
- six-pack runtime contract;
- local-first observability.

### Release evidence mode

The current validator checks the following release-evidence inputs; these checks do not independently verify signing/notarization:

- a directory whose path ends in `.app`;
- a native desktop self-test report with `status: "verified"` and `native_protected` secret custody;
- a UX manifest of **13** cases and at least 13 PNGs;
- an analytical manifest of 12 cases and at least 12 PNGs;
- checksum text containing a SHA-256-shaped DMG/ZIP entry.

The macOS production workflow separately verifies codesign, Gatekeeper, notarization and clean-machine installation. Windows uses its existing production workflow for Authenticode packaging, sidecar signature checks, native self-test, checksums and clean-machine installation, with shared P10 audit/acceptance prerequisites. It has no analogous P10 visual/release-mode validator step. `acceptance:p10` alone is neither signing proof nor cross-platform packaged/visual proof.

### Unresolved visual-count contract

The inspected capture `src/script/visual_smoke_capture.cjs` defines 15 UX cases. `.github/workflows/ux-visual-smoke.yml` checks 15 PNGs and 15 manifest cases; the validator's CI mode requires that workflow count. However, `.github/workflows/production-release-readiness.yml` checks **9** UX PNGs, while `src/script/validate_p10_packaged_acceptance.ts` release mode requires **13** manifest cases and its output advertises 13. Analytical coverage remains 12.

`[INFERENCE]` Those checks cannot accept the same 15-case capture as configured. No failing workflow was executed here, and documentation does not fix this source/configuration defect. The canonical P10 packaging/workflow owner (`LIOS-P10-01/02`) must reconcile capture, workflow checks, release validator and reported counts without dropping cases or weakening acceptance. Closure requires exact-build captured files/manifest and successful production/release-validator evidence, plus separate real Windows rendered/manual qualification.

### Publication evidence integrity

Both signed workflows publish `release-checksums.txt`, `python-sidecar-evidence.json` and `desktop-self-test-report.json` using `gh release upload --clobber`. macOS checksum contents cover DMG/ZIP; Windows covers EXE/update metadata/blockmaps. `[INFERENCE]` Sequential/concurrent publication can replace the other platform's raw evidence or checksum file consumed by clean-install jobs. The overwrite outcome is unmeasured and the risk remains unfixed.

The same P10 packaging/publication owner must preserve non-colliding or equivalently integrity-bound per-platform assets and demonstrate both clean-install consumers against one exact release tag/version/commit. Retain each platform's package hashes, sidecar/native reports and typed evidence. Platform-specific typed clean-install filenames do not repair collisions in the shared raw files.

## OSS and LSE governance

Machine sources:

- `third_party/components.json`
- `third_party/upstream-lock.json`
- `third_party/imported-oss-regression.json`
- `third_party/lse-release-inventory.json`
- `THIRD_PARTY_NOTICES.md`

`script/audit_p10_release.ts` reconciles those files with real destination/test paths, release workflows and the LSE provider source contract.

LSE current-release truth:

- LSE Terminal: reference-only in current release; no upstream source/branding bundled.
- LSE Data: LiOS-owned protocol-compatible Provider SDK adapter; no verbatim SDK source copied.
- Brue: pinned/reference-only; no source bundled.
- Hosted LSE data rights remain separate and are not centrally redistributed by LiOS.

### Packaged notice retention and copied dependency boundary — 2026-10-14

`src/script/afterPackCopyNodeModules.cjs` rebuilds the real `app.asar` from the original archive plus a dereferenced copy of the installed `src/node_modules`. This copy includes installed **development dependencies**, scoped/nested packages and packages absent from the lockfile; it is not electron-builder's production-only dependency graph. The existing dependency copy and `dist/**` / `node_modules/**` unpacking remain in place.

The rebuild explicitly includes root `LICENSE` (proprietary original-code rights), `THIRD_PARTY_NOTICES.md` and the entire `third_party/licenses/` tree inside `app.asar`. Dependency `LICENSE`/`LICENCE`, `COPYING`, `NOTICE` and their suffix/case variants survive Markdown pruning. Complete legal directories, including third-party license directories, survive ordinary documentation/test/source-extension pruning beneath those directories. Missing root notice sources fail packaging rather than producing a package without them. The macOS embedded ASAR header hash is refreshed after the rebuild and before signing; this change does not disable the integrity fuse or qualify native loading.

Before replacing the archive, the hook invokes the existing supply-chain audit on the **actual staged copied Node graph**, using `--packaged-node-modules <staged-node_modules> --project-dir <src>`. It includes dev-only, scoped/nested and other retained package manifests, reconciles installed versions/locations against `package-lock.json`, and blocks unknown/unrecognized/restricted terms, missing/invalid metadata, lock drift and untracked packages. Ordinary `audit:licenses` now inventories the installed paths the hook would copy, not only lock entries marked production; it remains metadata triage when manual reviews remain. The strict copied-graph mode excludes optional managed-runtime manifest entries because they are a different inventory, not evidence of what this Node copy contains.

**Unqualified boundaries:** filenames and permissive metadata are not complete redistribution permission, proof of every required NOTICE/source offer, or rights to native binaries, Python/sidecar/sandbox components, datasets, assets, models, APIs or trademarks. Those obligations must reconcile with the existing component/upstream/rights records and the exact candidate bytes. `audit:prod` scans the production lock graph only and does **not** qualify the dev packages copied into a binary; a candidate requires a full copied-graph vulnerability review as well. No real application build, signing, native package probe or binary distribution qualification is established by these source changes. Unresolved metadata/rights and missing exact-candidate evidence remain release blockers; no blanket license exception is introduced.

Focused local behavior checks (from `src/`, run only by the integration owner):

- `node --test script/afterPackCopyNodeModules.test.cjs` — real fixture ASAR notice bytes, unpacked native bytes, retained dependencies, fail-closed notice/metadata handling and macOS embedded integrity.
- `node --import tsx --test script/audit_supply_chain.test.ts` — copied dev/scoped/nested inventory, omitted platform packages, unknown/restricted terms and lock/metadata blockers.
- `node --import tsx script/audit_supply_chain.ts --static` — installed-copy metadata inventory; warnings are not binary clearance.
- For an already-built macOS candidate: `node --import tsx script/audit_supply_chain.ts --packaged-node-modules "dist-app/mac-arm64/LiOS Intelligence Terminal.app/Contents/Resources/app.asar.unpacked/node_modules"` (adjust the actual target path). This strict metadata gate is still not full legal or vulnerability qualification.


## Vulnerability and license policy

P10 release gates use existing scanners rather than inventing replacements:

- `audit:prod` — locked production npm high/critical advisory gate.
- `audit:licenses` — Node + managed-runtime static license gate.
- `audit:oss` — donor pin/license/notices registry.
- Python release/CI scan — `pip-audit` against the pinned Python requirements.
- `audit:p10-release` — P10 runtime/OSS/LSE/release reconciliation.

## Canonical task mapping

| ID | Implementation |
| --- | --- |
| LIOS-P10-01 | Performance/accessibility contracts + full 15 UX/12 analytical capture coverage; unresolved production 9/validator 13 UX mismatch must be repaired before release-mode packaged acceptance. |
| LIOS-P10-02 | Existing signed/notarized updater/recovery/clean-install workflow plus P10 packaged evidence validation. |
| LIOS-P10-03 | Six-pack runtime catalog + npm/Python/license/OSS/release reconciliation audits. |
| LIOS-P10-04 | Read-only guided Experience Center/first-use demonstration acceptance. |
| LIOS-P10-05 | THIRD_PARTY_NOTICES + components registry + exact upstream lock reconciliation gate. |
| LIOS-P10-06 | Core / Research / Quant / Modeling / Data Lab / Local AI product/release pack layer over signed managed-runtime subpacks. |
| LIOS-P10-07 | Local-first redacted OpenTelemetry-compatible trace/metric/log runtime with explicit remote opt-in. |
| LIOS-P10-08 | Optional fingerprinted OpenLineage-style projection over canonical P5 lineage. |
| LIOS-P10-09 | Mandatory npm and Python vulnerability scanning plus license scanning in CI and production release. |
| LIOS-P10-10 | Imported/adapted OSS regression registry and upstream-update review rule. |
| LIOS-P10-11 | Final machine LSE path/license/notices/modification inventory reconciled to registry/lock. |
| LIOS-P10-12 | LSE rights/local-only/optional-provider/upstream-pin/disable/fallback release posture validation. |
| LIOS-P10-13 | Secret-safe optional `doctor` CLI covering status, runtime packs, connectors, observability/logs, jobs/agents capability, data diagnostics and release governance without tenant enumeration. |
| LIOS-P10-14 | Portable workspace backup excludes secret filenames/credential-shaped content and does not export absolute source paths. |
| LIOS-P10-15 | OSS/runtime footprint gate, redundant workspace dependency removal and bounded P10 resource/startup-scale benchmarks. |
| LIOS-P10-16 | `release-rights-matrix.json` + release audit separates software licenses, hosted data/API rights, model weights, datasets and trademarks/assets. |

## Diagnostic / portable security / footprint hardening

`script/lios_doctor.ts` provides the optional P10 diagnostic surface. It intentionally reports capability/system state instead of enumerating tenant jobs, workflows or credential values.

`desktopWorkspaceBackup.cjs` now excludes secret-shaped filenames and credential-shaped text from portable backups, records only the source directory basename, and reports an excluded-sensitive-file count.

`script/validate_p10_oss_footprint.ts` removes/rejects overlapping/unapproved runtime packages and keeps the P10 hardening source footprint reviewable. `server/p10ResourceBudget.test.ts` bounds runtime-pack expansion, redaction/OTLP projection and OpenLineage projection under diagnostic-scale load.

`third_party/release-rights-matrix.json` is the cross-category release-rights source: software-code licensing, external data/API terms, model-weight licensing, dataset rights and trademarks/assets are reviewed separately.

## Acceptance gate

P10 is complete only when:

- each LIOS-P10-01…P10-16 roadmap row exists exactly once;
- P1→P10 tests/acceptance remain green;
- production dependency, OSS and static license audits pass;
- mandatory Python vulnerability scan passes;
- P10 release reconciliation audit passes;
- TypeScript/server/client/trust/provider suites pass;
- live Postgres tenant-isolation contracts pass;
- production build and release capability preflight pass;
- the 15-case UX capture, production count gate, release-mode validator and reported counts agree without dropping coverage;
- publication preserves exact per-platform evidence without shared `--clobber` replacement affecting either clean-install consumer;
- the production release workflow contains real signed/notarized/package/self-test/visual/checksum/clean-install evidence gates.

Actual external signing/notarization credentials and a production release tag are not fabricated in PR CI; release workflows require those real inputs. Workflow presence and source checks do not establish successful execution or repair the gaps above. The authoritative Quality Gate defaults to the owner's `[self-hosted, Linux, lios-docker]` runner, with explicit manual `ubuntu-latest` or `[self-hosted, macOS]` choices and no implicit hosted fallback. Cross-platform/signing/final certification workflows are manual qualification, not the normal implementation loop.
