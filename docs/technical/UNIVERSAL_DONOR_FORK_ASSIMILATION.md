# Universal Donor & Fork Assimilation — All 92 + 10

**Date:** 2026-10-11 · **Scope:** every established baseline donor, all controlled forks and registered package subcomponents. **State:** cross-donor work allocation and truth validation, **not** an import-all or SP acceptance claim.

## Why this exists

The owner directed **all** donors to be considered under `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`; focus only on TradingAgents, or count GitHub forks as shipped features, violates that intent.

This work is a **whole-program index**. `third_party/universal-donor-adoption.json` has a specific row for every one of the existing **92** `third_party/capability-assimilation.json` baseline donors and **10** `third_party/controlled-fork-utilization.json` controlled forks (six of which are not baseline members). It preserves rather than overwrites each donor's existing status, upstream repository, canonical owner, rights posture and available pin; carries all **91** registered subsystem definitions across existing component records; and records an owner/action/conditional fork decision per donor. The ledger's `fullPackageSourceAuditComplete=false` on every baseline entry is **intentional**: project metadata review is not a source-tree audit, and it must not masquerade as one.

## Policy order, without exceptions

1. Inspect LiOS current caller/owner and the complete useful upstream donor package, starting with Primary OpenClaw and the relevant secondary/specialist projects.
2. Decompose into coherent package or cross-package capability. Adopt whole useful machinery except separately justified path-level exclusions; do not throw it out just for dependency complexity.
3. Reuse / import / adapt / repurpose / combine / generalize / innovate / wrap; **build last**. Compare other donors when capabilities overlap.
4. Replace competing donor permission, authentication, Project, memory, data/provider, model routing, engine, checkpoint, execution, external broker and Artifact authorities with the canonical LiOS seam. Retain useful internal logic.
5. Pin source commit, license and relevant files. Record every original source path, destination, material modification, omitted path and reason, retained/replaced deps, source/license/model/data rights, upstream test lineage, rollback and supported platform.
6. Qualify deterministic/negative tests, native target, provisioning/installer, user-facing end-to-end journey and owner acceptance. Only then promote machine truth. No direct market-data, AI model-weight, license or broker rights are implied by a repository fork.

## Coverage and truth boundaries (as of ledger creation)

| Category | Recorded baseline count | How to advance |
| --- | ---: | --- |
| Documented only | 45 | Audit coherent useful package, license/deps, implement controlled LiOS path and source/negative/packaged tests |
| Reference only | 15 | Benchmark incumbent/challenger before promotion, or retain explicitly as comparison evidence |
| Discovered | 8 | Verify exact pin and per-path rights, then classify, not auto-fork |
| Integrated runtime | 7 | Inspect unadopted packages plus prove installer, target, regression and customer journey |
| Integrated optional runtime | 2 | Prove opt-in managed provisioning, unavailability, rollback, footprint |
| Integrated connector | 1 | Prove credential/permission/entitlement and user-facing data journey |
| Provider-integrated external runtime | 1 | Prove external install/missing/disconnect/rights, not bundled runtime |
| Partially integrated | 2 | Complete selected coherent subsystem behind existing canonical authority |
| Bridge only | 3 | Connect actual engine/rendering implementation, not just a contract |
| Deferred contract | 1 | Qualify backend/packaged route |
| Standard-compatible, not library | 2 | Prove protocol interop without false library-import claim |
| Rejected | 5 | Do not fork/import by default; revisit only with documented legal/security/fit evidence |

**Important:** The 92 rows are not a target to install 92 runtimes. Some libraries belong in pinned package managers; some are reference-only; some have license or asset restrictions. `third_party/components.json` includes additional nonbaseline components which remain separately accounted for rather than silently expanding the 92 baseline.

## Existing forks — **not** new fork requests

| Controlled mirror | Product owner / selective capability | Current gate |
| --- | --- | --- |
| OpenClaw | GM platform, agent/exec/terminal/device/browser | Already partially source-integrated; compare observed fork vs approved OpenClaw pin, complete coherent missing packs with GM tests |
| Qlib | P11 quant formula, risk research/modeling | P11 challenger work exists in draft #552; serialize with canonical P11 PR #555; no duplicate numerical authority |
| TradingAgents | GM-12/P5/P7 finance analysts and bounded debate | Draft #583 adds source-pinned governed rating/risk logic; larger analyst/data package needs rights/point-in-time and packaged evidence |
| LangAlpha | P7/P4 long-lived thesis and research workflow | Need source-pinned package/rights/dependency closure behind Projects/Artifacts |
| FinRobot | P5/P11/P4 finance agent, reports, deal research | Exact path license and provider/data-rights gate; compare with TradingAgents and other finance agents |
| FinGPT | P11/P7 financial NLP and signals | Models/weights/training dataset rights separately; no bundled unlicensed weight |
| GraphRAG | P7 evidence relationship retrieval | Preserve canonical entity/source/permission store; evaluate graph query/index/retrieval mechanics, not alternate Project DB |
| browser-use | GM-14 browser research and task durability | Use existing isolated browser, policy/permissions, no ambient browser or cookies |
| CUA | GM-14 device/computer-use | Verify exact driver/component license and platform-native permissions, never a second control plane |
| dexter-js | GM-12/P5 research planner/finance tools | Verify **rodionlim/dexter-js** lineage and rights separately from registry's **virattt/dexter** |

All 10 mirror heads are observations, **not** approved imported commit pins. Six have no matching entry in the frozen baseline: handle them through the supplemental fork queue and explicit component record when adopting a real source path; do **not** invent new baseline entries. The already-forked set should be reused, not forked again.

## Execution order: concurrent bounded workstreams, not a whole-product replacement

**Wave 1 — finish existing high-leverage work**: OpenClaw unassimilated GM subsystems; Qlib/P11 numerical handoff; TradingAgents/P5/P7 risk plus source-backed analyst chain; LangAlpha/P7 thesis continuity. Close actual blockers, not PR counts. Preserve current SI-02 historical acceptance versus current-main requalification and SP-05 V3 requirements.

**Wave 2 — adjacent fork finance and research**: FinRobot report/finance computation; FinGPT license-cleared NLP only; GraphRAG source-aware graph retrieval; browser-use and CUA strictly behind GM-14 native approval, isolated session and user-owned nodes. Compare and combine complementary donors under one LiOS API rather than launching ten apps.

**Wave 3 — specialized breadth**: dexter-js source-lineage check against Dexter; fin-agent; selected model/checkpoint/challenger libraries; professional Artifact renderers; document ingestion; platform/extension capabilities. Use the exact `baselineDonors` 92-row queue to prevent skipped donors.

**Wave 4 — dependency-driven remainder**: all baseline rows not selected earlier, sorted by owner, target acceptance gaps, verified rights and performance. Keep rejected/reference entries visible with explicit evidence. Advance one coherent package and real user journey at a time, with owning team concurrency controls.

### Ownership and security stops

- GM runtime, user/Project approval, native capture, agent session and cancellation: **GM-11/GM-12/GM-14** only.
- Market/vendor entitlement, security identity, temporal source truth: **P5/P7**.
- Mathematical calculations, model/scenario/portfolio/reconciliation: **P11**, not server-side donor math.
- Living professional documents and exports: **P4**.
- Packaged runtime installation, large asset consent, health, verification and rollback: existing LiOS installer.
- Never merge unresolved tenant isolation, null-to-zero numerical truth or unapproved source transfers merely to increase donor-integrated counts.

## Machine checks

```sh
cd src
node script/validate_universal_donor_adoption.mjs
node --test script/validate_universal_donor_adoption.test.mjs
```

These checks fail if a baseline row, a controlled fork, an approved lock, an imported-source path, licensing evidence or a registered subsystem changes without revisiting the plan. They also fail on any fabricated global shipped/integrated/full-exhaustion status. They **do not** assert that all donor source trees, upstream tests, model weights, managed assets or packaged features are installed or individually source-audited.

**Next package implementation gate:** select a donor row, read the complete useful upstream subsystem and tests, create source-path dispositions under `third_party/`, adapt behind canonical LiOS authority, native qualify and finally prove one packaged customer journey. Repeat across owners until each donor has an evidence-based reuse/deferral/rejection disposition; owner acceptance is recorded separately.
