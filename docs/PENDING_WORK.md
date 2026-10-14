# pending work

> **Live execution checklist — SI-01 through SI-05 only.** Rechecked **2026-10-13** against `main` `95c50120271674f1363e93c67b328848b3bb8a38`, canonical [SI plan](LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md), [shipping contract](technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md), [validation contract](technical/LIOS_PROGRESSIVE_VALIDATION_CI_STRATEGY.md), [source audit #696](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/696), and [coordination #192](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/192). **This is an agent-readable operational index, not a new SI plan, issue authority, architecture, owner or acceptance ledger.**

## Rechecked truth — do not inflate progress

- **138 target workstreams** (17+20+30+31+40). Source-code audit: **35 READ** (module body inspected), **69 FOUND** (anchor identified, deeper verification needed), **34 PARTIAL** (concrete open limitation). **104 have source identified/inspected**, *not* 104 completed. All 138 remain unchecked for fully proven acceptance in audit #696.
- The audit's source tree was pinned to `1b4c70000f25700085dd588f22b89ea0fd165f34`; current `main` is two documentation-only commits ahead (README and OpenClaw AI-access directive). Workstream statuses are the audit classifications, *not* freshly executed runtime/build results.
- At recheck: **54 open PRs (51 draft, 3 non-draft)**. Most consequential work is still unmerged. A mergeable draft PR is not a tested or accepted capability.
- No current-head GitHub check runs were visible for `main`; existing focused self-hosted/temporary PR evidence does not replace exact-head V1/V2 or packaged V3. **SP-01 to SP-05 are not certified by this document.**
- Donor scope: **92 baseline donors** plus **10 controlled forks**; partial integrations exist, but forks/pins/registered paths do not equal full source assimilation or packaged shipping proof. All new material reuse follows [donor rights policy](technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md), exact file/pin/rights/notice and existing LiOS contracts.
- SI-06 and SI-07 are **outside this checklist**; don't remove their continuing requirements from the authoritative plan.

## Verified engineering progress after the original source audit

- **2026-10-13 — SI-01.12 bounded raw-path security fix MERGED:** [PR #697](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/697) → `main` commit `460cd470f945338ce004b4fe7d986974c092ffe9`. The shared GM-11/P13 relative-path helper now rejects raw empty/dot/traversal segments before normalization; workspace input/output and P13 broker tests cover real valid nested files, denied aliases, symlink and scope denials. Actual [self-hosted macOS V1/V2 run #38419313123](https://github.com/kiranvbiim-coder/lios-v1.0.0/actions/runs/38419313123) finished **success** (focused tests, `npm run check`, GM-11/P13 integrated tests). The temporary workflow is **NEVER MERGE**. **SI-01.12 remains PARTIAL/unaccepted**: full broker activation, tenant/revocation and packaged SP-01 proof under [#260](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/260) are still open.


- **2026-10-13 — SI-02.06 bounded checkpoint-secret repair MERGED:** [PR #530](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/530) → `main` commit `c9d6933abfd3153ade252620b4b2c04648582d73`. The native GM-12 continuation producer now rejects credential-shaped tool inputs; GM-10b clears a stale owner-bound checkpoint without ending the live run. [Self-hosted macOS V1/V2 run #38420859339](https://github.com/kiranvbiim-coder/lios-v1.0.0/actions/runs/38420859339) reported **passed focused checkpoint/journal tests, TypeScript and shared restart integration tests**. A same-head duplicate run was automatically cancelled by concurrency (#38420770756), not by a test failure. **SI-02.06 remains PARTIAL/unaccepted**: stale/conflicting resume-binding PR #358, full restart/reapproval and packaged SP-02 gates remain open. The temporary validation workflow is **NEVER MERGE**.

- **2026-10-13 — SI-02.06 native role/objective/budget resume binding MERGED:** [PR #709](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/709) → `main` commit `bdda88657c551b974488f843aecfebfe0a66bbed`. Current native GM-12/GM-10b checkpoint snapshots now integrity-bind server execution role, SHA-256 of the **original initiating user objective**, and actual server-resolved step/AI/revision/time budget. Original objective text is **not** written to the checkpoint. Version-1 native checkpoints remain readable but refuse unsafe resume. Resume checks occur at both preparation and atomic reopen. Self-hosted macOS [V1/TypeScript/native restart V2 run #38423391055](https://github.com/kiranvbiim-coder/lios-v1.0.0/actions/runs/38423391055) recorded **all substantive test and cleanup steps PASS**. The source-identical validation wrapper adds only a **NEVER MERGE** workflow. **Still PARTIAL:** old [#358](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/358) contains additional legacy generic-adapter assumptions and remains merge-conflicted; packaged SP-02 real-model journey and current native approvals/role guards still need owner acceptance.

- **2026-10-13 — SI-01.12 P13 live read-only broker enabler MERGED:** [PR #711](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/711) → `main` `bcb21b9fd053617182e688a4cd1cf9a4fc8dccff`. Signed/trusted Node plugins can use existing host-side filesystem.read auxiliary only when installation supplies a **server-owned scope authorizer** that is evaluated on the active user/org/Project, component and exact root before and after every read. No direct Project/user-selected Node FS flags; no host paths/bytes on denial; filesystem writes remain disabled. Actual [macOS V1/TypeScript/V2 run #38425349706](https://github.com/kiranvbiim-coder/lios-v1.0.0/actions/runs/38425349706) reported **all substantive security, supervised child, TypeScript, GM-11/P13 integration and cleanup steps PASS**. TEMP CI wrapper was not merged. **SI-01.12 is still PARTIAL**: no default production root resolver is yet supplied, plus write-return/cancellation/packaged SP-01 remains.

- **2026-10-14 — source portability and running-application stabilization, not SP acceptance:** In the separate sanitized public source repository, [hosted run #38540661425](https://github.com/kiranvbiim-coder/lios-terminal/actions/runs/38540661425) at `a78dcfc3fe3b42c3baa60a72763186a90bffe509` passed **Linux and macOS**; **Windows failed 21 tests** after the gateway timing/cleanup hang was repaired. Remaining diagnosed causes are native ASAR path separators, a migration-fixture path matcher, ESM loader file URLs, donor snapshot CRLF checkout bytes, executable-permission fixture semantics and managed Python target-platform paths. The isolated built application also exercised owner creation, authenticated Project/chat creation and visible refusal of an unconfigured strict sandbox; these are source-runtime smoke observations, not packaged SP-01 or SP-05 qualification. **All 138 workstreams remain unchecked.** Public CI uses only standard GitHub-hosted runners; independent approval remains required for public PR #1.
  - **Additional source-runtime observation:** After a real graceful process stop and restart using the same isolated PGlite data root, the authenticated owner session and the created Project/chat reopened with the same IDs. Missing strict-sandbox configuration remained an explicit denial, and disabled Master AI remained an explicit request failure rather than a fabricated answer. No approval-required execution, packaged sandbox or full SP journey was qualified by this smoke.

## Agent usage / coordination

1. Read `AGENTS.md`, the canonical SI plan, shipping/CI contracts, issue [#192](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/192) and source [#696](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/696) **before** selecting a checkbox. Confirm `main` and active PRs live.
2. Select one bounded unchecked SI workstream, locate its listed **actual source file**, trace UI/API → server/engine → persistence/permission → error/denial and inspect relevant tests; do not rely only on a document or test filename.
3. Claim the existing canonical GM/TC/CA/P issue/PR through [#192](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/192). **Do not create a duplicate owner, store, router, model engine, agent stack or competing PR.** Preserve stacked PR dependencies; do not merge temporary RED/GREEN or NEVER MERGE validation wrappers.
4. For material donor work, inspect OpenClaw and applicable full 92-baseline/controlled fork packages by useful subsystem, source/pin/license/notice, substitute canonical LiOS authorities, and reconcile full test/packaging. Treat `fork verified` as *not* `integrated`.
5. Apply risk-based V0/V1, V2 for shared-security/integration, V3 at Shipping Point, V4 only release. Record **exact SHA, runner/target, commands, pass/fail, manual/product journey, limitations, risks and proofs** on the canonical issue/PR.
6. Change `[ ]` to `[x]` **only when** the relevant scoped acceptance proof has been recorded and the canonical owner has closed/accepted it. For workstream-wide checks below, require actual full-scope acceptance (including applicable SP/protected regression); otherwise keep unchecked and update next step/evidence link.
7. Update this **index** when a real PR is merged, an accepted capability regresses, or the next blocker changes. Source audit #696 remains detailed audit history; #192 remains coordination. No unverified percentage-complete claims.

## Next work, in safe dependency order

| Queue | Owner/work | What to do next | Exit gate |
|---|---|---|---|
| **P0.1** | SI-01.12 / GM-11/P13 — [#260](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/260), [#697 MERGED](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/697), [#711 MERGED](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/711) | Raw aliases fixed; read-only supervised plugin FS transport **supported only with supplied server-owned scope authorizer**, with live pre/post read checks. **Next:** wire canonical Project/tenant resolver into production installation, adversarial TOCTOU/revocation, write-return finalization, packaged isolation | #697/#711 bounded security enablers done; **SI-01.12/SP-01 still OPEN** until actual deployed and packaged gates pass |
| **P0.2** | SI-02.06 / GM-12/GM-10b — [#530](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/530) + [#709](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/709) **MERGED** | Credential and owner-scoped checkpoint guards **and native role/objective/budget resume bindings** are tested and integrated. **Next:** old conflicting [#358](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/358) generic adapter convergence and real packaged resume/reapproval journey | Both bounded repairs verified; **SI-02.06/SP-02 still OPEN** until all acceptance gates |
| **P0.3** | SI-01.16/.17 — [#275](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/275), [#276](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/276), [#277](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/277) | Wheel hash-lock/zero-setup rollback, shared authority integration, restore + packaged SP-01 | Clean-target secure local MSJ, exact evidence |
| **P0.4** | SI-02.03 + SI-02.10/13/14 — [PR #537](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/537), [#281](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/281) | Reconcile planner repair conflicts; real-model tool and approval behavior; browser runtime + native computer-use gap | Packaged agentic SP-02 MSJ, real tools and no fake UI action success |
| **P0.5** | SI-03 — [PR #393](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/393), [#539](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/539), [#540](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/540), [#451](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/451) | Reconcile research/memory and private-company branches; prove entitlement, source citations, document formats, restart | Packaged research SP-03 MSJ; evidence/revisions and unknowns retained |
| **P1.1** | SI-04 — [#468](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/468) | Finance-grade XLSX/DOCX/PPTX import-edit-export-reopen, actuals/formula/source preservation, professional report/review | Packaged SP-04, numerical/citation fidelity |
| **P1.2** | SI-05 numerical — [#554](https://github.com/kiranvbiim-coder/lios-v1.0.0/issues/554), [#572](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/572), [#579](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/579), [#694](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/694) | Sequential independent RI/EVA, risk, derivatives, QuantLib and truth-class known-answer qualification | Current-head finite outputs and independent reconciliation |
| **P1.3** | SI-05 action/deals — [#541](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/541), [#575](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/575), [#680](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/680), [#683](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/683), [#684](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/684), [#685](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/685) | Resolve finance branch stack in dependency order; tenant-safe paper ledger, private fund and credit/covenant math | Packaged SP-05 real financial journeys, receipt and no live brokerage |
| **P1.4** | SI-05 expansion | Finish model autopilot, financial twins, natural-language screens, advisor/wealth and evidence-backed deal decisions | Source-backed, numerical and permissioned SP-05 acceptance |

**Important active dependency chains:** finance base [#541](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/541) → #542 → #543 → #544 → #545 → #546 → #547 → #548 → #550 → #551 → #555 → #562 → #567 → #575 → #680 → #683 → #684 → #685 (many PRs remain draft, some have security companion fixes); independently evaluate #556, #558, #563, #566 and #573 relative to their target base. More recent OpenClaw/BYOAI work [#699](https://github.com/kiranvbiim-coder/lios-v1.0.0/pull/699) → #701 → #703 → #705 is SI-06-related/pulled-forward dependency, **not** proof of SI-01–05 closure. Never merge a chain wholesale without per-commit provenance and exact-head validation.

## Full 138-item code-first acceptance backlog

Each row is deliberately **unchecked**. `READ` means the audit inspected the implementation body; `FOUND` means a code anchor exists but deeper audit is still due; `PARTIAL` means a named limitation is known. **None is equivalent to fully shipped/accepted.** Do not mark a row complete because it was found or an unmerged PR says tests passed.

### SI-01 — Foundation / SP-01 Secure Local Alpha (17 items)

**Canonical implementation ownership:** GM (Home/Gateway/execution), P13 (plugin isolation), P10 (runtime packs). Exact responsibility is recorded in the assigned canonical issue/PR. **Shipping point:** SP-01; accept only after real integrated MSJ + packaged target + honest unavailable states + protected regressions + exact evidence.

- [ ] **SI-01.01 — Donor provenance and subsystem inventory** · **PARTIAL** · Source: `third_party/capability-assimilation.json`
  - **Close:** Verify exact source pins, path-level licenses, notices and dependency closure for the 92-donor registry and 10 controlled forks; fork existence is not integration.
- [ ] **SI-01.02 — LiOS Home** · **FOUND** · Source: `src/dataRootCore.cjs`
  - **Close:** Trace and validate implementation against the canonical requirement: one zero-configuration local runtime with canonical data root, storage, database, secrets, execution, Gateway and services. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.03 — Runtime provider seams** · **READ** · Source: `src/server/runtimeProviders.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: Desktop Local first, while preserving migration to user NAS/server/VPS/cloud. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.04 — Database portability** · **FOUND** · Source: `src/server/databaseConnector.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: PGlite default; user PostgreSQL as advanced target; migration/relocation without changing product identity. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.05 — Storage fabric** · **FOUND** · Source: `src/server/storageProvider.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: local files, user storage/object providers, safe path ownership and integrity. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.06 — Encryption and secret ownership** · **FOUND** · Source: `src/server/credentialVault.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: SecretRef authority, OS-protected secrets, no secret leakage into prompts/logs/Artifacts. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.07 — Backup/restore/Home migration** · **READ** · Source: `src/server/backupService.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: complete user-owned portability and recovery. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.08 — Gateway** · **FOUND** · Source: `src/server/gatewayHub.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: canonical local/remote protocol and capability communication using approved donor mechanisms where useful. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.09 — Device trust fabric** · **READ** · Source: `src/server/devicePairingService.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: identity, pairing, discovery, trust, revocation and node capability advertisement. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.10 — Execution kernel** · **READ** · Source: `src/server/exec/authority/governed-command.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: jobs, processes, PTY/backend execution, streaming, timeout, cancellation, reconnect and lifecycle. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.11 — Execution authority** · **READ** · Source: `src/server/exec/authority/governed-command-journal.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: exact-operation permissions, sandboxing, policy, approval and trust receipts. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.12 — Isolation boundaries** · **PARTIAL** · Source: `src/server/p13PluginHost.ts` · **Tracker:** #260, PR #697 and #711 MERGED
  - **Close:** Raw path alias defect merged #697 (`460cd470`) and **read-only P13 broker activation** behind explicit server-owned per-read authorizer merged #711 (`bcb21b9`) with real supervised-plugin V1, TypeScript and shared GM-11/P13 V2 **PASS** [run #38425349706](https://github.com/kiranvbiim-coder/lios-v1.0.0/actions/runs/38425349706). **Remaining:** production canonical tenant/Project root resolver and revocation qualification, adversarial symlink identity/rename timing, memory-staged write-return authorization and actual owner-side commit/rollback, cancellation, packaged/target SP-01 proof. Read-only code is not automatically enabled without a host authorizer; write activation remains blocked. Keep unchecked.
- [ ] **SI-01.13 — Resource controls** · **READ** · Source: `src/server/si01ResourceReservation.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: CPU/RAM/storage/time bounds, graceful degradation and hardware-aware safety. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.14 — Execution receipts and observability** · **FOUND** · Source: `src/server/p10Observability.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: what ran, why, where, with which permission and result; diagnostics without secret leakage. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.15 — Offline baseline** · **READ** · Source: `src/server/si01OfflineBaseline.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: useful deterministic/local capability without LiOS-operated infrastructure. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-01 journey.
- [ ] **SI-01.16 — Zero-setup dependency provisioning** · **PARTIAL** · Source: `src/server/managedRuntimeReconciler.ts` · **Tracker:** #275
  - **Close:** P0: prove deterministic wheel hash locks, internal dependency verification, activation and rollback; issue #275.
- [ ] **SI-01.17 — Canonical authority convergence** · **PARTIAL** · Source: `src/server/runtimeFoundation.ts` · **Tracker:** #276, #277
  - **Close:** P0: converge all canonical authorities and current-head SP-01 owner evidence; issue #276 and checklist #277.

### SI-02 — Agentic Intelligence / SP-02 Agentic Alpha (20 items)

**Canonical implementation ownership:** GM-11 (execution), GM-12 (agents), P13 (skills/MCP), TC (UX). Exact responsibility is recorded in the assigned canonical issue/PR. **Shipping point:** SP-02; accept only after real integrated MSJ + packaged target + honest unavailable states + protected regressions + exact evidence.

- [ ] **SI-02.01 — Canonical agent runtime** · **READ** · Source: `src/server/agentLoop.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: goal → plan → act → inspect → revise → complete. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.02 — Governed tool layer** · **FOUND** · Source: `src/server/governedTools.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: tools exposed through one LiOS permission/runtime authority. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.03 — Planning/decomposition** · **FOUND** · Source: `src/server/aiPlannerFallback.ts` · **Tracker:** PR #537
  - **Close:** P0: reconcile/rebase conflicting planner repair PR #537; test real small-model tool-ID repair, no denied-tool disclosures and packaged SP-02 journey.
- [ ] **SI-02.04 — Action policy** · **FOUND** · Source: `src/server/exec/approval-continuation.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: automatic vs approval-required vs prohibited operations. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.05 — Retry/recovery** · **FOUND** · Source: `src/server/exec/agent-idempotency.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: idempotent retry semantics and side-effect protection. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.06 — Checkpoint/resume** · **PARTIAL** · Source: `src/server/agent-checkpoint-runtime.ts` · **Tracker:** PR #530 and #709 MERGED; PR #358 (stale/conflicting, generic adapter work remains)
  - **Close:** Credential/clearing patch #530 (`c9d6933`) and exact native original role/objective/budget v2 checkpoint/reopen binding #709 (`bdda886`) **MERGED**, tested by macOS V1+TypeScript+V2 #38420859339 and #38423391055. **Remaining:** evaluate old #358's generic-adapter API without merging obsolete candidate state, prove actual packaged SP-02 restart/reapproval and previous-SP regressions. Keep unchecked until full workstream acceptance.
- [ ] **SI-02.07 — Cancellation** · **FOUND** · Source: `src/server/conversationRunCancel.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: reliable user stop for tasks, agents and subjobs. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.08 — Delegation** · **READ** · Source: `src/server/agent-delegation.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: specialized subagents/tools without losing canonical Project/Chat/Artifact context. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.09 — Multi-agent coordination** · **READ** · Source: `src/server/conversationRuntime.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: bounded parallel work with shared evidence and explicit ownership. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.10 — Coding intelligence** · **PARTIAL** · Source: `src/server/acp/coding-runtime.ts`
  - **Close:** Complete governed ACP coding repo edits, diff/tests, approvals and accepted caller/CLI integration; do not promote unmerged candidate.
- [ ] **SI-02.11 — Python/data execution** · **FOUND** · Source: `src/server/pythonRuntimeManager.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: governed scientific/data/quant execution. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.12 — Shell/PTY intelligence** · **READ** · Source: `src/server/exec/authority/governed-command.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: trusted command execution behind canonical execution authority. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.13 — Browser intelligence** · **PARTIAL** · Source: `src/server/playwrightBrowserAdapter.ts`
  - **Close:** Qualify approved optional Playwright Browser Runtime Pack, governed navigation/download/extraction, offline and denied capabilities; no fake browser success.
- [ ] **SI-02.14 — Computer-use intelligence** · **PARTIAL** · Source: `src/server/computer/governed-computer.ts`
  - **Close:** Implement a policy-governed native GUI transport, capture/input grants, user confirmation and recovery; existing computer.assess returns nativeAvailable:false.
- [ ] **SI-02.15 — Session placement** · **PARTIAL** · Source: `src/server/runtimeProviders.ts`
  - **Close:** Qualify actual user-owned remote/session placement and migration without creating a second agent/runtime authority.
- [ ] **SI-02.16 — Skills** · **READ** · Source: `src/server/skillRuntime.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: reusable procedures and domain skills behind P13/GM authority. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.17 — MCP convergence** · **READ** · Source: `src/server/externalMcpClient.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: MCP capabilities behind canonical tool/permission/runtime contracts. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.18 — Agent receipts** · **FOUND** · Source: `src/server/exec/agent-run-events.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: concise visible action/tool/source/assumption records without chain-of-thought exposure. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.19 — External side-effect safety** · **FOUND** · Source: `src/server/exec/agent-idempotency.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: exact authorization, idempotency and reconciliation patterns for consequential operations. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.
- [ ] **SI-02.20 — General-purpose capability** · **READ** · Source: `src/server/capabilityRegistry.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: agent infrastructure must remain useful beyond finance. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-02 journey.

### SI-03 — Memory & Research / SP-03 Research Alpha (30 items)

**Canonical implementation ownership:** P5 (entity/provider), P7 (research), GM (memory), P4 (Artifact). Exact responsibility is recorded in the assigned canonical issue/PR. **Shipping point:** SP-03; accept only after real integrated MSJ + packaged target + honest unavailable states + protected regressions + exact evidence.

- [ ] **SI-03.01 — Durable memory** · **FOUND** · Source: `src/server/aiMemory.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: long-lived user/project memory distinct from live Working Context. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.02 — Dreaming/reflection assimilation** · **FOUND** · Source: `src/server/memoryReflectionTool.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: derive useful durable summaries/patterns under user control. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.03 — Memory inspect/correct/delete** · **FOUND** · Source: `src/server/memoryLifecycleTool.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: memory must be observable and correctable. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.04 — Project knowledge** · **READ** · Source: `src/server/p7ProjectIntelligence.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: files, conversations, Artifacts and research retrievable as governed context. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.05 — Cross-project retrieval** · **READ** · Source: `src/server/p7CrossProjectRetrieval.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: permission-aware retrieval only where explicitly allowed. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.06 — Hybrid retrieval** · **READ** · Source: `src/server/p7ProjectIntelligence.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: semantic, lexical, structured and entity-aware retrieval. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.07 — Web research** · **FOUND** · Source: `src/server/researchSearch.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: search/browse/collect/compare/cite public evidence. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.08 — Deep research orchestration** · **FOUND** · Source: `src/server/researchIntelligenceEngines.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: research plans, source diversity, evidence gaps and bounded continuation. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.09 — Evidence ledger** · **FOUND** · Source: `src/server/provenance.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: source, time, excerpt/field, transformation and downstream usage. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.10 — Provenance** · **FOUND** · Source: `src/server/provenanceTrace.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: important outputs traceable to source data or explicit inference. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.11 — As-of/freshness semantics** · **FOUND** · Source: `src/server/sourceSnapshotStore.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: distinguish retrieval time, observation time and model period. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.12 — Contradiction detection** · **FOUND** · Source: `src/server/providerConflictService.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: conflicting facts/data surfaced, not silently flattened. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.13 — Source quality** · **FOUND** · Source: `src/server/providerDepthAudit.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: authority/first-party/secondary/community distinctions where useful. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.14 — Entity intelligence** · **FOUND** · Source: `src/shared/globalInstrumentMaster.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: company/security/listing/instrument/person/entity resolution behind P5. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.15 — No-ticker/private entity research** · **FOUND** · Source: `src/server/privateEntityResearchTool.ts` · **Tracker:** PR #539 → PR #540
  - **Close:** Reconcile private/no-ticker resolution and cited brief branches PRs #539 then #540; prove no invented ticker/quotes and source-verified identity choice.
- [ ] **SI-03.16 — Document intelligence** · **PARTIAL** · Source: `src/server/p7DocumentIntelligence.ts`
  - **Close:** Prove packaged Docling PDF/DOCX/PPTX/XLSX parsing cases with passage-level citations, format fallbacks and rights/size controls.
- [ ] **SI-03.17 — Structured extraction** · **FOUND** · Source: `src/server/p7StructuredExtraction.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: tables, sections, units, relationships and financial structures. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.18 — Timeline intelligence** · **FOUND** · Source: `src/server/p7TimelineIntelligence.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: events, filings, decisions, transactions and changes over time. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.19 — Thesis/counter-thesis** · **FOUND** · Source: `src/server/p7ThesisEngine.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: supporting evidence, counter-evidence, risks and open questions. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.20 — Research branching** · **READ** · Source: `src/server/p7ResearchBranching.ts` · **Tracker:** PR #393
  - **Close:** Trace and validate implementation against the canonical requirement: alternate hypotheses without contaminating canonical state. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.21 — Known/unknown model** · **FOUND** · Source: `src/server/projectEvidenceTruth.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: explicit uncertain, inaccessible, unavailable, stale and unentitled states. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.22 — Research Artifact** · **FOUND** · Source: `src/server/webResearchArtifactTool.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: durable evolving research output with citations and revisions. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.23 — Universal Provider & Entitlement Fabric** · **PARTIAL** · Source: `src/server/providerRuntimeHub.ts` · **Tracker:** PR #393 (partial overlap)
  - **Close:** Qualify provider entitlement/rights checks through actual request/routing paths; preserve unentitled, stale, unavailable and AI-transmission restrictions.
- [ ] **SI-03.24 — Financial Event & Relationship Intelligence** · **FOUND** · Source: `src/server/projectFinancialEvents.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: first-class earnings, filing, guidance, recommendation, corporate-action, financing, deal, rating, macro/policy and regulatory events plus relationship/impact graph context. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.25 — Broker / Expert / Internal Research Composition** · **FOUND** · Source: `src/server/researchSourceComposition.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: combine permitted external research, expert content, user files and proprietary/internal research while preserving entitlement and source identity. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.26 — Numerical Evidence Lineage** · **FOUND** · Source: `src/server/numericalEvidenceTool.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: trace material values from provider/document/field/period through normalization/transformation into model/output usage. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.27 — Living Investment Thesis** · **READ** · Source: `src/server/p7LivingThesis.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: persistent claims, counterclaims, evidence, assumptions, confidence, catalysts, risks, invalidation conditions and changed-since-last-review state. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.28 — Filing / IR Change Intelligence** · **FOUND** · Source: `src/server/p7FilingDiff.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: filing, transcript, presentation and disclosure comparison with material-change extraction and historical context. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.29 — Estimates / Recommendation Evidence** · **FOUND** · Source: `src/server/consensusProviderCapture.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: analyst identity, estimate/rating/target revisions, consensus inputs and historical evidence without hiding source differences. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.
- [ ] **SI-03.30 — Alternative & Private-Market Evidence Adapters** · **READ** · Source: `src/server/alternativeEvidenceAdapter.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: permitted alternative/private evidence normalized into the same provenance/entitlement/entity fabric. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-03 journey.

### SI-04 — Professional Work / SP-04 Professional Work Alpha (31 items)

**Canonical implementation ownership:** P4 (Artifact), TC (editor UX), P11 (financial models), CA (renderers). Exact responsibility is recorded in the assigned canonical issue/PR. **Shipping point:** SP-04; accept only after real integrated MSJ + packaged target + honest unavailable states + protected regressions + exact evidence.

- [ ] **SI-04.01 — Canonical Artifact identity/versioning** · **READ** · Source: `src/server/artifactStore.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: P4 remains the only Artifact authority. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.02 — Chat-to-Artifact** · **FOUND** · Source: `src/server/artifactRoutes.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: convert useful results into structured living work. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.03 — Shared edit state** · **FOUND** · Source: `src/server/artifactComposition.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: direct manipulation and conversational edits modify the same underlying Artifact. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.04 — Revision history** · **READ** · Source: `src/server/artifactRevisionMerge.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: compare, restore, branch and reconcile work. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.05 — Spreadsheet intelligence** · **FOUND** · Source: `src/server/spreadsheetArtifactImport.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: import, inspect, calculate, revise, format and export. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.06 — Spreadsheet/editor donor integration** · **FOUND** · Source: `src/client/src/lib/spreadsheetXlsx.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: use approved high-quality editing/rendering implementations behind P4 contracts where beneficial. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.07 — Large analytical tables** · **PARTIAL** · Source: `src/server/columnarArtifactStore.ts`
  - **Close:** Prove paging/virtualization and large-table memory/render performance on target.
- [ ] **SI-04.08 — Chart intelligence** · **FOUND** · Source: `src/client/src/components/terminal/EChartsArtifactPlot.tsx`
  - **Close:** Trace and validate implementation against the canonical requirement: interactive analytical visuals where appropriate. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.09 — Rich documents** · **READ** · Source: `src/client/src/lib/nativeArtifactDocx.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: suitable editor implementation behind canonical Artifact state. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.10 — Professional reports** · **FOUND** · Source: `src/server/professionalWorkPackage.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: research, consulting, investment and analytical reports. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.11 — Presentation generation** · **READ** · Source: `src/client/src/lib/nativeArtifactPptx.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: PPTX with narrative, charts, tables and evidence. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.12 — XLSX generation** · **FOUND** · Source: `src/client/src/lib/exportXlsx.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: production-grade spreadsheets and models. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.13 — DOCX generation** · **READ** · Source: `src/client/src/lib/nativeArtifactDocx.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: professional document export. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.14 — PDF publishing** · **FOUND** · Source: `src/client/src/lib/exportPdf.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: reliable final/presentation/print path. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.15 — Citation preservation** · **FOUND** · Source: `src/server/artifactReviewPackage.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: evidence survives into exported work products. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.16 — Engine-to-Artifact** · **FOUND** · Source: `src/server/artifactIntegratedModelInput.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: deterministic outputs become usable tables/charts/models. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.17 — Artifact-to-engine** · **FOUND** · Source: `src/server/artifactIntegratedModelInput.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: Artifact data can feed governed analytical engines. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.18 — Template intelligence** · **FOUND** · Source: `src/server/artifactPackage.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: reusable structures without module/template maze UX. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.19 — Round-trip integrity** · **PARTIAL** · Source: `src/server/spreadsheetArtifactReturn.ts`
  - **Close:** Execute real Office import→edit→export→reopen and compare formulas, references, charts, styles, sheets and evidence; no synthetic-only acceptance.
- [ ] **SI-04.20 — Multimodal composition** · **FOUND** · Source: `src/server/artifactComposition.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: text, tables, charts, images and structured data in one work product. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.21 — Professional styling** · **FOUND** · Source: `src/server/artifactPackage.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: coherent layouts, typography and data presentation. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.22 — Agent-maintained work** · **FOUND** · Source: `src/server/artifactMaintenance.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: agents update existing Artifacts instead of recreating them. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.23 — Decision Object Artifact** · **FOUND** · Source: `src/server/scenarioDecisionArtifact.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: persistent objective, evidence, assumptions, alternatives, scenarios, recommendation, dissent, approval, action, outcome and follow-up. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.24 — Source-Linked Financial Model Cells** · **FOUND** · Source: `src/server/artifactModelMaintenance.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: material model values can retain source/period/lineage metadata where available. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.25 — Financial Model Maintenance / Update Engine** · **PARTIAL** · Source: `src/server/artifactModelMaintenance.ts`
  - **Close:** Prove sourced actual-period updates preserve formulas, cell references, assumptions, reconciliation and user edits.
- [ ] **SI-04.26 — Model Change / Restatement Report** · **FOUND** · Source: `src/server/artifactModelChangeReport.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: show what source/model cells changed, why, and which downstream outputs moved. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.27 — Finance-Grade Office Round Trip** · **PARTIAL** · Source: `src/server/officeArtifactReturn.ts`
  - **Close:** Qualify finance-grade XLSX/PPTX/DOCX OOXML semantic fidelity, source/period lineage and real Office reopen.
- [ ] **SI-04.28 — IC / Credit / Deal Memo Workflows** · **FOUND** · Source: `src/server/artifactReviewPackage.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: evidence-backed institutional decision packages from canonical data/models. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-04 journey.
- [ ] **SI-04.29 — Banking Pitch / Board Materials** · **PARTIAL** · Source: `src/client/src/components/panels/MnaDealDeskPanel.tsx`
  - **Close:** Prove real board/banking pitch deck narrative, deterministic numbers, legibility and edit/reopen acceptance.
- [ ] **SI-04.30 — Advisor / Client Proposal & Reporting** · **PARTIAL** · Source: `src/client/src/components/panels/AdvisoryPanel.tsx`
  - **Close:** Prove advisor/client proposal with source-backed goals/portfolio, disclosure, entitlement and exported report.
- [ ] **SI-04.31 — Review / Annotation / Collaborative Decision Package** · **PARTIAL** · Source: `src/server/artifactRevisionMerge.ts`
  - **Close:** Complete review/comments/approval RBAC, version collision handling, ownership and audit receipts.

### SI-05 — Financial Super Intelligence / SP-05 Financial Intelligence Alpha (40 items)

**Canonical implementation ownership:** P11 (finance math), P5 (market/provider), P7 (evidence), P4 (Artifact), GM (actions). Exact responsibility is recorded in the assigned canonical issue/PR. **Shipping point:** SP-05; accept only after real integrated MSJ + packaged target + honest unavailable states + protected regressions + exact evidence.

- [ ] **SI-05.01 — Market intelligence** · **FOUND** · Source: `src/server/marketData.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: quotes, history, returns, volatility, market context and availability truth. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.02 — Company fundamentals** · **READ** · Source: `src/python-service/company_fundamentals_snapshot.py`
  - **Close:** Trace and validate implementation against the canonical requirement: statements, ratios, trends, segments and evidence. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.03 — Company/security/listing/instrument mapping** · **FOUND** · Source: `src/server/conversationInstrumentResolution.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: canonical identity before provider calls. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.04 — DCF/FCFF/FCFE/APV** · **PARTIAL** · Source: `src/python-service/advanced_valuation.py`
  - **Close:** Prove FCFF, FCFE and APV model variants with known-answer conventions, units and exposure through canonical P11.
- [ ] **SI-05.05 — Relative valuation** · **FOUND** · Source: `src/python-service/valuation_specialized.py`
  - **Close:** Trace and validate implementation against the canonical requirement: comps/transactions where permitted evidence exists. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.06 — Residual income/EVA** · **PARTIAL** · Source: `src/python-service/valuation_specialized.py` · **Tracker:** #569, PR #572
  - **Close:** Rebase/qualify PR #572, P11 known-answer RI/EVA tests, non-finite input rejection; close #569 only after current-head evidence.
- [ ] **SI-05.07 — Scenario modeling** · **READ** · Source: `src/server/p8ScenarioEngine.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: base/bull/bear and arbitrary user-defined scenarios. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.08 — Sensitivity** · **READ** · Source: `src/python-service/advanced_valuation.py`
  - **Close:** Trace and validate implementation against the canonical requirement: WACC/growth, operating, rate/price and multidimensional sensitivities. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.09 — Assumption ledger** · **FOUND** · Source: `src/server/assumptionRoutes.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: material assumptions visible, sourced, revisable and versioned. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.10 — Portfolio intelligence** · **READ** · Source: `src/server/portfolioAnalytics.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: holdings, allocation, performance, attribution and exposure. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.11 — Risk** · **FOUND** · Source: `src/python-service/advanced_risk.py` · **Tracker:** PR #579
  - **Close:** Review PR #579 tail-risk numerical correctness, non-finite/stress conditions and independent calibration.
- [ ] **SI-05.12 — Optimization** · **READ** · Source: `src/python-service/portfolio_optimization.py`
  - **Close:** Trace and validate implementation against the canonical requirement: efficient frontier, constrained optimization, Black-Litterman where validated. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.13 — Factor models** · **FOUND** · Source: `src/server/factorRiskModel.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: CAPM, Fama-French and validated extensions. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.14 — Fixed income** · **READ** · Source: `src/python-service/advanced_fixed_income.py`
  - **Close:** Trace and validate implementation against the canonical requirement: pricing, yield, duration, convexity, curves and spreads. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.15 — Derivatives** · **PARTIAL** · Source: `src/python-service/advanced_derivatives.py` · **Tracker:** #632, PR #688/#689 (temp)
  - **Close:** Review derivatives defect/qualification #632 and never-merge temp #688/#689 evidence; require finite output and conventions under target tests.
- [ ] **SI-05.16 — Quantitative donor integration** · **PARTIAL** · Source: `src/server/qlibRiskChallenger.mjs` · **Tracker:** #690, PR #694; #695 TEMP
  - **Close:** Qualify QuantLib challenger PR #694 on its exact head, verify managed runtime/pin rights and cross-engine known answers; temporary PR #695 must not merge.
- [ ] **SI-05.17 — Macro/FX** · **FOUND** · Source: `src/python-service/advanced_macro.py`
  - **Close:** Trace and validate implementation against the canonical requirement: GDP, inflation, rates, labor, FX and policy series. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.18 — Corporate actions/events** · **FOUND** · Source: `src/server/corporateActionIngestion.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: dividends, splits, buybacks, issues and event context. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.19 — Alternative assets** · **READ** · Source: `src/server/alternativeEvidenceAdapter.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: permitted commodities, REITs, digital assets and other alternatives. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.20 — Personal finance** · **READ** · Source: `src/server/p6PersonalFinance.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: budget, cash flow, debt, savings, goals, loans and retirement. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.21 — Wealth scenarios** · **FOUND** · Source: `src/server/p6RetirementStress.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: deterministic long-horizon planning where conventions/data permit. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.22 — Research-to-model composition** · **FOUND** · Source: `src/server/artifactIntegratedModelInput.ts` · **Tracker:** PR #543/#563
  - **Close:** Reconcile unverified assumption/output guards in PR #563 with provenance and deterministic model input boundaries.
- [ ] **SI-05.23 — Engine reconciliation** · **READ** · Source: `src/server/quantTruthAudit.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: donor/engine outputs compared against independent known-answer cases. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.24 — Numerical trust** · **FOUND** · Source: `src/server/modelValidationHarness.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: units, scaling, conventions, tolerances and non-convergence explicit. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.25 — Living financial Artifacts** · **FOUND** · Source: `src/server/artifactModelMaintenance.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: valuations, portfolios and plans remain revisable persistent work. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.26 — Earnings & Estimate Intelligence** · **FOUND** · Source: `src/server/projectFinancialEvents.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: results/guidance/transcript/KPI/consensus comparison with materiality and assumption impact. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.27 — Broker Research Intelligence** · **PARTIAL** · Source: `src/server/researchSourceComposition.ts` · **Tracker:** PR #393 (research core)
  - **Close:** Complete permissioned broker/analyst research composition and entitlement coverage, with source citations and stale/unentitled handling.
- [ ] **SI-05.28 — Universal Natural-Language Screening** · **PARTIAL** · Source: `src/server/semanticFinanceService.ts` · **Tracker:** PR #550
  - **Close:** Integrate approved natural-language screener/metric contract (PR #550 stack) with P5 entity identity, provider entitlements and bounded result set.
- [ ] **SI-05.29 — Consensus & Disagreement Engine** · **FOUND** · Source: `src/server/consensusService.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: compare provider/broker consensus, management guidance, internal model, market-implied expectations and historical accuracy where evidence permits. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.30 — Financial Model Autopilot** · **PARTIAL** · Source: `src/server/artifactModelMaintenance.ts` · **Tracker:** PR #547
  - **Close:** Qualify governed model maintenance PR #547 and finish actuals refresh, formula preservation, replay and user review.
- [ ] **SI-05.31 — Financial Twins** · **PARTIAL** · Source: `src/server/companyIntelligenceSpine.ts`
  - **Close:** Prove five canonical persistent Financial Twin views (Company, Security, Portfolio, Fund, Household) without duplicate state.
- [ ] **SI-05.32 — Scenario & Counterfactual Propagation** · **READ** · Source: `src/server/p8ScenarioEngine.ts`
  - **Close:** Trace and validate implementation against the canonical requirement: propagate macro/market/company assumption changes through models, securities, portfolios and decisions. Verify real callers, authorizations, relevant error/denial paths, persistence, focused regression tests and the SP-05 journey.
- [ ] **SI-05.33 — Private Markets & Deal Intelligence** · **PARTIAL** · Source: `src/client/src/components/panels/MnaDealDeskPanel.tsx` · **Tracker:** PR #575 → #680 → #683
  - **Close:** Serialize private-fund/cap-table waterfall stack #575→#680→#683; independent numerical cases, historical assumptions and legal/entitlement boundaries.
- [ ] **SI-05.34 — Investment Banking / Corporate Finance** · **PARTIAL** · Source: `src/client/src/components/panels/MnaDealDeskPanel.tsx` · **Tracker:** PR #684; #551/#555
  - **Close:** Qualify corporate finance LBO PR #684 and related comps/precedent/deal engines, models and professional outputs.
- [ ] **SI-05.35 — Credit Intelligence** · **PARTIAL** · Source: `src/python-service/advanced_credit.py` · **Tracker:** PR #685
  - **Close:** Validate non-positive EBITDA covenant correction in PR #685, credit models and honest headroom/denials.
- [ ] **SI-05.36 — Wealth & Advisor Intelligence** · **PARTIAL** · Source: `src/server/p6PersonalFinance.ts` · **Tracker:** PR #562
  - **Close:** Finish household goal-funding/advisor tool #562 with source-backed suitability and actual client Artifact.
- [ ] **SI-05.37 — Governed Broker / Execution Semantics** · **PARTIAL** · Source: `src/server/p6FinanceRoutes.ts` · **Tracker:** PR #541, #542, #556, #558
  - **Close:** P0 for finance integration: validate simulated-paper proposal base #541, quote basis #542, idempotency #556, replay provenance #558 and tenant isolation; no live broker execution.
- [ ] **SI-05.38 — Corporate-Action Decisioning** · **PARTIAL** · Source: `src/server/bseCorporateActions.ts` · **Tracker:** PR #548, #555
  - **Close:** Integrate corporate-action impact #548/#555 and verify holdings-model decision evidence.
- [ ] **SI-05.39 — Expectation / Surprise Intelligence** · **PARTIAL** · Source: `src/server/consensusService.ts`
  - **Close:** Combine consensus/history/result/guidance with exact as-of and source rights to qualify expectation/surprise attribution.
- [ ] **SI-05.40 — Financial Truth & Cross-Engine Reconciliation** · **PARTIAL** · Source: `src/server/quantTruthAudit.ts` · **Tracker:** PR #545, #573, #567
  - **Close:** P0 numerical trust: reconcile truth classes #545 and fail-closed reconciler #573, including #567 model-submitted evidence class protections, independent values and nonconvergence.

## Mandatory closure evidence per row

```text
Workstream: SI-0x.nn
Canonical owner / issue / PR:
Base SHA → exact tested head SHA → merged SHA:
Actual code call chain (entry, permission, engine, state, UI):
Donor subsystem, exact pin/path/license/notice and adopted/declined reason:
Defect/gap reproduced and implementation diff:
V0/V1 tests commands + pass/fail; relevant V2 results:
Packaged/real MSJ target and SP acceptance evidence (or explicit pending):
Negative/security/tenant/error/unavailable/freshness tests:
Owner acceptance + regression link:
Next remaining blocker / proof required:
```

## Closeout discipline

- Phase acceptance requires all 5 shipping gates; **SP-01 → SP-05 is progressive**, but earlier accepted behavior remains guarded while later phases expand capabilities.
- Update the checkbox here and the matching detailed audit #696 only after proof, or leave it open with the exact remaining gap. Continue execution claims on issue #192; link to existing PRs rather than creating a parallel task board.
- No unreviewed donor code, no duplicate canonical authority, no silent main-branch merge of conflicting/stale PRs, no live trading, and no statements that a temporary CI fixture, root license, source pin or draft PR proves release readiness.
