# FinRobot IC Memo Gate Implementation Plan

**Goal:** Adapt the source-pinned FinRobot IC-memo safety/completeness mechanism into the existing LiOS P4 review package without importing FinRobot runtime, provider, valuation, storage, or approval authority.

**Architecture:** Add one pure read-only FinRobot-derived review gate that consumes an already parsed immutable P4 Artifact body, the existing canonical decision-approval inspection, and the existing immutable FinRobot provenance audit. The adapter can only classify the review posture (`not_applicable`, `review_required`, `governed_review`) and explain gaps; it cannot calculate finance, approve a decision, generate a recommendation, refresh data, or act. Compose its output into the existing `artifactReviewPackage.ts` `ic_memo` package as an additional review section.

**Canonical boundaries:** P4 owns Artifact/version/review package; P11 owns deterministic financial calculations; P7 owns evidence/provenance; existing decision approval linkage owns reviewer authority. FinRobot's 15% sponsor IRR threshold remains donor-specific and is not copied into LiOS policy.

**Donor:** `AI4Finance-Foundation/FinRobot@2717499b8e30f242640af08c4ad9afd1113c2d45` Apache-2.0. Primary source `finrobot_desktop/finrobot/engine/pipelines/ic_memo.py` blob `2a7585e9849570e0591ed52bf9fd8bb50ac32d1e`; upstream numeric-audit test source `finrobot_desktop/tests/artifact/test_numeric_audit_gate.py` blob `4e396172a46125607c1de38bdd187537ed44ffc3`.

## Task 1 — RED pure gate specification

**Files:**
- Create `src/server/finrobotIcMemoGate.test.ts`
- No production implementation yet.

Acceptance cases:
1. non-decision content => `not_applicable`;
2. authored recommendation without an exact current decision approval => `review_required`;
3. stale/unavailable/unlinked approval => explicit review reason;
4. approved exact decision still requires recommendation, thesis/rationale, risks/tradeoffs, recorded source refs, model refs and execution receipts;
5. existing provenance warnings block `governed_review`;
6. recommendation prose cannot override any deterministic/provenance blocker;
7. a complete exact-version approved decision with recorded model/source/receipt support => `governed_review` while preserving the authored recommendation as quoted review content only.

Run: `cd src && node --import tsx --test server/finrobotIcMemoGate.test.ts`
Expected RED: missing `./finrobotIcMemoGate` implementation.

## Task 2 — GREEN pure gate

**Files:**
- Create `src/server/finrobotIcMemoGate.ts`

Implementation rules:
- strict typed input/output;
- no I/O/network/database/LLM imports;
- no threshold/valuation calculation;
- use existing `DecisionArtifactContent`, `DecisionArtifactApprovalInspection`, and FinRobot immutable audit shape;
- fail closed on absent/stale/unavailable/unlinked approval, incomplete authored IC structure, missing recorded model/source/receipt support, or provenance warnings;
- `waived` is visible as a waiver state and remains review-required unless the exact canonical approval contract explicitly permits the bounded review posture; never treat waiver as a computed finance pass.

Run focused gate test and TypeScript.

## Task 3 — Compose into P4 review package

**Files:**
- Modify `src/server/artifactReviewPackage.ts`
- Add focused integration regression if an existing review-package test seam exists; otherwise keep composition minimal and cover via typecheck plus existing P4 tests.

Behavior:
- compute the new gate only from the already loaded exact Artifact version, canonical decision-approval inspection, and existing immutable provenance audit;
- append an `IC memo decision gate` authored section to the existing professional work package;
- do not mutate Artifact, approval, finance, or evidence state.

## Task 4 — Donor provenance / harvesting truth

**Files (only if canonical validator requires promotion evidence):**
- Add a bounded component manifest for the IC gate and reconcile existing FinRobot controlled-fork/universal-donor evidence without changing the 92 baseline or claiming full runtime/exhaustion.

## Task 5 — Validation and handoff

V1 on self-hosted macOS only:
- focused IC gate tests;
- existing `finrobotReportSnapshot.test.ts`;
- relevant P4 review/package tests if present;
- `npm run check`;
- donor harvesting/universal validator if provenance ledgers change;
- diff hygiene and cleanup.

No V3/V4, full hosted Quality Gate, packaged SP-05, or release claim in this bounded package.
