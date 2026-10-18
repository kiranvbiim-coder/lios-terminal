# LiOS product postmortem — 2026-10-18

## Verdict

**The full product goal has not been achieved.** Public LiOS has substantial integrated implementation and meaningful local macOS execution/recovery/export proof. It is not a completed Super Intelligence product or production-qualified release. Apple signing is owner-deferred due cost, but removing that requirement would not close the other gaps.

Baseline: public `kiranvbiim-coder/lios-terminal`, `main` `68a1fc8927cedecd930d0a3b48c3f79186246d9c` after PR #76; clean at audit start and no open PRs. Private repositories were not audited or imported. This is a point-in-time postmortem, not another execution authority: the SI plan, shipping contract, P14 and existing `PENDING_WORK.md` remain authoritative.

### Goal and scope

The product contract is conversation-first, local/user-owned professional intelligence and finance: **ask → understand → research/execute → inspect → refine → save → monitor**, with canonical permissions, deterministic calculations, evidence and recoverable state (`AGENTS.md:169–207`). The canonical SI plan has **206 workstreams**: SI-01 17, SI-02 20, SI-03 30, SI-04 31, SI-05 40, SI-06 34, SI-07 34. The historical 138 count covers SI-01–05 only.

No completion percentage is justified. “Implemented supported source path,” test counts, donor registrations, historical private PRs and accepted full workstreams are different measures. The collapsed SI-01–05 ledger is a historical inventory, not a current public acceptance audit.

## Evidence and method

Three independent read-only domain investigations inspected current public contracts, implementation and consumers; parent verified critical findings and executed current code. Sampling plus targeted tracing is not line-by-line security certification of the entire repository.

Previously observed on the PR #76 code candidate:
- 854 local source test files: 5,272 passed, zero failed, four explicit skips; 103 desktop checks; 114 manifests and 870 routes.
- Required hosted Linux/macOS/Windows PR checks passed: [run 39122938837](https://github.com/kiranvbiim-coder/lios-terminal/actions/runs/39122938837). Post-merge main run is separate evidence and must not be assumed from the PR pass.
- Actual ad-hoc macOS arm64 package passed all nine existing SP-01 harness checks: owner/Project/Chat, exact operation, denial, Docker output (UID 10001), reconnect, receipt digests, cancellation/extinction, restart/history without replay.
- Actual encrypted backup/test restore matched 124 tables/312 rows. Normal LaunchServices restore automatically restarted, reversed a post-backup Project rename, and retained exact Artifact/version/hash/receipt.
- Actual normal-UI JSON/PDF exports were retained and independently inspected, using an explicitly owned verification balance, not live market data.
- Final package seal remained valid after verification/execution; this is ad-hoc integrity, not Developer ID trust/notarization. Exact hashes are in `PENDING_WORK.md`.

Newly executed during this audit:
- `npm run audit:quant`: structural audit passed, 176 registry entries, 156 quant compute endpoints, 157 Python endpoints, 98 exported model functions, 33 analytical surfaces and 16 provider classifications. **It does not validate numerical answers or installed provider success.** It explicitly lists unseeded experimental simulation paths.
- Three new public-consumer valuation regressions failed before the fix, with seven failing cases. Independent flat-revenue calculation expected 10/share; engine returned 20/share.
- After the correction, actual authenticated source-sidecar HTTP returned 10/share, reverse-DCF growth approximately zero with zero repricing error, and expectation matrix `[[0,0,0],[9,10,11]]`. Missing-token HTTP returned 401. No model or paid provider invoked.
- Full local Python suite after correction: 205 passed and 52 subtests passed; two warnings (Pydantic configuration deprecation and a robust-regression perfect-fit convergence warning). These warnings are not numerical-family acceptance.
- 26 current strict-provisioning/lifecycle/computer-policy checks passed, including refusal without a trusted runner and assessment-only computer behavior.

The source-sidecar correction is **not in the previously generated frozen Python executable or app**. A new target-built sidecar and exact-candidate package proof are required before shipping corrected valuation behavior. Existing saved outputs are immutable historical calculations; do not relabel or rewrite them as corrected runs.

## Phase scorecard

| Phase | What exists / achieved | What prevents full goal acceptance |
|---|---|---|
| SI-01 — Foundation | User-owned Home, persistent local DB, secret custody, Gateway/device trust, exact governed execution, resources/receipts, actual packaged cancellation/restart and encrypted restore | Default strict runtime provisioning has no constrained production runner; clean-target install, target-specific optional packs, broader isolation/storage/DB/deployment and Windows qualification remain |
| SI-02 — Agentic | Real bounded plan/act/inspect runtime, governed tools, checkpoints/resume/cancel, action policies, delegation and receipts | No complete packaged real-model SP-02 journey; native computer-use transport absent; executable plugin activation consumer missing; browser is bounded retrieval, not full automation; saved durable agents disable parallel-read batches |
| SI-03 — Knowledge/research | Scoped durable memory/reflection, lexical/hybrid retrieval, source snapshots/provenance/contradictions, document/research/thesis mechanisms | Real multi-source cited research→Artifact→restart campaign absent; semantic quality not established by synthetic vectors; document pack availability blocked; real-model reflection/user correction/deletion journey unqualified |
| SI-04 — Professional work | Canonical P4 revisions/proposals, professional renderers, source-bound review, actual PDF/JSON retention/export and exact revision inspection | Full Office edit/export/reopen semantics unproved; source-bound XLSX return rejects new/renamed sheets, charts/pivots/external links; returned formulas not recalculated/verified; living-model monitor is review-only, not accepted automatic model refresh |
| SI-05 — Finance | Broad deterministic engine implementations, identity/provider/lineage contracts, portfolio/thesis/Decision/monitor composition, actual personal-finance calculation and retained work | Reproduced material DCF defect demonstrates broad green suites do not certify finance; independent conventions/known answers/cross-engine coverage and real-company flagship loop absent; unseeded experimental paths remain outside reproducible claims |
| SI-06 — Autonomous/everywhere | 34 rows labeled implemented, bounded to supported source paths: recipes/schedules/events, low-noise notifications, restart/no replay, provider policies, node diagnosis/P6, actual native source and deployment renderers | No full SP-06 acceptance; real AI/model quality, integrated entitled monitor→refresh→second-device review journey, native UI builds, deployed topology, generic remote/model/GPU breadth unqualified or unsupported |
| SI-07 — Convergence/release | 22 implemented/source-recovery rows, one documentation row, three partial, eight open; actual shell/Doctor/navigation/review/backup/packaging progress | Three implemented labels depend on missing provision/install/upgrade prerequisites; security/privacy/numerics/provenance/performance/accessibility, clean targets, S0–S10 and P14 evidence remain incomplete |

These queue counts classify claims; they are not accepted-capability counts. No full SP-02–SP-07 or final P14 acceptance is established by the inspected public evidence. The bounded nine-check SP-01 local journey is real, but does not alone certify every foundation workstream or a clean-install release.

## Confirmed implementation gaps and impact

### 1. Material DCF input semantics were wrong — repaired in this change, release replacement pending

`src/python-service/advanced_valuation.py` `_dcf_value` applied `reinvestmentPctOfRevenue` to `max(0, nextRevenue - previousRevenue)`, despite public schemas/UI declaring a percentage of revenue. At zero or negative growth it charged no reinvestment. Shared callers are probabilistic DCF, reverse DCF and `valuation_specialized.py` expectation surface. The repair charges forecast revenue, retains the same APIs, updates the three model revisions to 1.0.1 so input custody hashes differ, and adds independent positive/zero/negative-growth, debt, reverse and matrix cases. A previous monotonic-growth test used negative FCFF but asserted growth always increased value; its economic invariant is corrected, not preserved as a wrong result.

Impact: prior outputs from these three paths may be overstated or imply wrong expectations. Historical receipts remain intact. Users need an explicit fresh run under the corrected revision; material-decision use requires broader independent validation. Registry validation remains `benchmark_required`, not upgraded by a handful of known answers.

### 2. Zero-setup managed provisioning is not delivered

`runtimeLifecycle.ts:54–95` defaults to missing authority; `pythonRuntimeManager.ts:348–355` refuses; `strictProvisioningAuthority.ts:114–120` requires injection. Confirmation and wheel hashes cannot make this default succeed. Fixed argv and host staging paths are not OS confinement. Reintroducing generic host `runCommand` would repeat the rejected PR #74 design.

Required: one target-compatible, genuinely constrained authority or reviewed immutable native runtime distribution through the existing P10 installer/activation/rollback owner. Docker-built Linux wheels/venvs cannot be activated as native macOS/Windows Python. Preserve all current custody/consent/lifecycle locks and qualify denied access, cancellation, activation failure and rollback. Independently provision the sandbox prerequisite to avoid bootstrap circularity.

### 3. Computer use is assessment only

`src/server/computer/governed-computer.ts:22–44` registers `computer.assess`, returns `nativeAvailable:false`, and never captures/input-controls the screen. Native GUI execution is genuinely missing, not just untested. Implement only behind the existing exact approval, OS permission, scope, cancellation and receipt authority; never relabel browser retrieval as computer use.

### 4. Plugin and parallel-agent breadth is incomplete

The canonical Project root authorizer exists (`p13ProjectRootAuthorizer.ts`), but audited installation/update consumer searches found definitions/tests rather than production activation. Its positive-organization requirement also needs deliberate handling for null-organization desktop owners. Do not silently broaden grants.

`agentLoop.ts` disables parallel read batching when checkpointing is active; saved runs checkpoint. Durable delegation exists, but general parallel multi-agent execution is not established. Journal-safe parallel batches require changing the current one-unfinished-step restart invariant, not simply removing the guard.

### 5. Living professional-work promises need bounded completion

`spreadsheetArtifactReturn.ts:16–58` refuses unsupported worksheet/OOXML features and explicitly does not recalculate/verify returned formulas. `officeArtifactReturn.ts` correctly stages review instead of overwriting P4. DOCX chart caches are read-only; PPTX support is Artifact-kind bounded. Model monitoring records review-only changes, not automatic application/recalculation. Finish supported semantics with real roundtrip tests and preserve explicit unsupported states; do not advertise universal Office fidelity or autopilot.

### 6. Everywhere is currently bounded capability placement

`remoteNodeWorker.ts` advertises diagnosis and optional P6 finance, not generic provider/model/broker subprocesses or GPU scheduling. Apple/Android/watch/Wear source exists; protocol tests and source parsing are not native UI execution. Cloud packs render deployment resources but do not deploy a Home. These are separate extensions or qualification tasks, not reasons to rewrite existing clients/state/routers.

## Why the delivery process overstated maturity

1. **Code integration was confused with product acceptance.** Supported-source labels and many green tests masked missing integrated/native proof. Remedy: keep coding, journey, target and acceptance evidence separate.
2. **Historical inventory became a misleading current ledger.** Private PR counts and 138-workstream classifications survived next to newer public implementation. Remedy: preserve history clearly as history and use a current exact-public-baseline summary.
3. **Self-consistency tests missed an incorrect financial contract.** Reproducible Monte Carlo and monotonic grids could pass with wrong economics. Remedy: independent analytical cases, adverse/zero conditions, explicit units/conventions and cross-engine checks before numerical promotion.
4. **Fail-closed prerequisites were described as implemented end-to-end.** Approval/preview code existed without a production constrained installer. Remedy: classify orchestration and usable activation separately; complete the real writer authority.
5. **Developer-machine success was overgeneralized.** Existing runtime/Docker/Keychain/caches are not clean installation. Initial frozen startup exceeded 90s. Remedy: fresh-account and independent target cold-start evidence.
6. **Verification tooling could invalidate its subject.** Sidecar evidence was written inside signed Contents; ASAR creation needed stream completion. Both were repaired and exercised in PR #76. Remedy: retain external evidence and validate seal after real use.
7. **Disk headroom was not durable.** A nine-check final run stalled after four checks with 8.2 GiB free; unchanged package passed after owner-approved old-generated-output removal restored 14 GiB. This supports environment sensitivity, not a reason to lower the 10 GiB reserve.

## Completion order and exit criteria

| Order | Existing owner / scope | Exit evidence |
|---|---|---|
| 1 | P11 / SI-07.15 material numeric corrections | Corrected code and receipt revisions; independent answers, current Python suite, real authenticated endpoints; protected 3-OS PR; rebuilt frozen runtime before packaged claims |
| 2 | GM-11/P10 / SI-07.08–10 provisioning | Fresh Home→preview→explicit approval→target-constrained install→real imports/computation→restart readiness→failed-upgrade rollback; no host fallback |
| 3 | SI-02 / GM-12/P13 bounded agent and tool closure | Real configured model→multi-step approved tool work→failure/revision→checkpoint/restart/cancel→retained output without duplicate effects; explicit supported browser/plugin/computer scope |
| 4 | P7/P4 / SI-03–04 research and professional work | Permitted multi-source evidence→cited Artifact→edit/revision→real Office/PDF export/reopen; source/assumption/formula rights and semantic integrity retained |
| 5 | P5/P11/P4/P9 / SI-05–06 flagship | Real entitled company/portfolio evidence→material change→independent valuation/risk→thesis/Decision→explicit no-action/paper proposal→monitor event→quiet notification→authorized second-device review→restart |
| 6 | SI-07 qualification | Measured startup/long-session resources, VoiceOver/keyboard/contrast, network/provider/crash/recovery, tenant/privacy/isolation and actual target installers; record exact scope and failures |
| 7 | P14 distribution | Rights-approved target-built artifacts, clean macOS/Windows evidence, update/rollback, all 14 required evidence categories, Apple signing/notarization when owner funds it, explicit release approval |

Do not run the whole expensive shipping campaign for each small change. Use focused V0/V1, relevant V2 boundary smoke, one full candidate V3 and final V4/P14. Preserve accepted journeys and never replace unavailable proof with mocks or fake providers.

## Owner prerequisites versus engineering work

**No spending required for current numerical/source, local UI, security, resource and fresh-account work.** Owner input is required later for a standard fresh macOS account, an independent target/Windows machine for those claims, a deliberately chosen real AI provider with approved usage limits, lawfully permitted real data and any native SDK/device setup. No secrets in chat; no paid inference without approval.

Apple Developer ID/notarization and normal signed-update distribution are **deferred**, not waived. Owner selected future public GitHub Releases hosting; no release/feed is live merely because URL syntax passes. A fresh account is not a new Mac. Full P14 currently requires macOS and Windows, not only the first macOS milestone.

Public `third_party/source-distribution.json` intentionally withholds release workflows/datasets. Its NOT_RUN values refer to full qualification/distribution, not denial that local ad-hoc packages were exercised. Existing validators require withheld inputs and cannot certify this snapshot alone. Resolve a legitimate public-compatible qualification/release path or separately authorized release environment; never copy private workflows or provider catalogs wholesale or weaken validators to manufacture a pass.

## What is complete, and what is not

Completed evidence includes a portable green source baseline, actual local secure execution, canonical receipts, persistence/restart, native encrypted restore and retained PDF/JSON. It is incorrect to call this “nothing done.” It is equally incorrect to call all coding, all 206 workstreams, all devices, numerical finance or production readiness finished.

**The next deliverable is corrected numerical behavior plus a truthfully reconciled completion ledger. The full product remains open until the existing acceptance contracts are exercised end to end and remaining implementation gaps are closed.**
