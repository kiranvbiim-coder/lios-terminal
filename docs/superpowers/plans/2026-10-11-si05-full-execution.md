# SI-05 Full Execution Implementation Plan

> **For agentic workers:** Use the Superpowers execution workflow task-by-task. Track completion with checkboxes and exact-head evidence.

**Goal:** Close all 40 SI-05 Financial & Analytical Super Intelligence lanes behind existing canonical LiOS authorities and prove SP-05 Financial Intelligence Alpha with immutable packaged evidence.

**Architecture:** Issue #554 is the execution board and `docs/technical/LIOS_FINANCE_INTELLIGENCE_TO_ACTION_BLUEPRINT.md` is the finance capability blueprint. P11 remains deterministic finance authority, P5 identity authority, P7 evidence authority, P4 Artifact authority, and GM/SI-02 action authority. One Agent 2 primary implementation claim is active at a time; shared P11/GM/P5/P4 seams serialize behind their canonical owner.

## Global constraints

- Refresh `main` before each bounded lane.
- Never create a second data/entity, evidence, finance-engine, Artifact, action/approval, router, provider or brokerage authority.
- No fabricated market/fundamental/macro/estimate/identifier/provenance values.
- Preserve explicit truth classes: observed, calculated, management guidance, analyst estimate, user assumption, AI inference, market implied, unknown.
- Reuse existing active PR work; integrate in dependency order rather than rewriting it.
- TDD feature/bug work: RED → verify RED → minimal GREEN → verify GREEN → refactor.
- R2 normally V0+focused V1; R3 shared-core changes get relevant V2; V3 is SP-05 candidate proof, not a per-PR debugging loop.
- Local/self-hosted validation first; conserve hosted GitHub Actions minutes.

## Review focus

1. NaN/Infinity financial inputs fail closed and never leak invalid JSON.
2. Unit/currency/period/entity/listing/as-of mismatches remain explicit.
3. Missing/stale/unentitled evidence produces unavailable/not-computable states, never invented defaults.
4. Shared-core integration must not bypass canonical permission/action/evidence semantics.
5. Seeded stochastic/challenger output remains distinct from deterministic P11 truth.

### Task 1 — SI-05.11 tail-risk numerical trust (#576)

Files: `src/python-service/fixtures/risk_tail_known_answers.json`, `src/python-service/test_risk_tail_known_answers.py`, and only if RED proves necessary `src/python-service/advanced_risk.py`.

- [x] Write independent known-answer, finite/JSON-safe, seeded-repeatability, weights and dimensions tests.
- [x] Verify RED: non-finite `portfolioValue` accepted while six other behaviors passed.
- [x] Apply minimal finite scalar guard; no registry/router change.
- [x] Verify focused GREEN: 7/7.
- [ ] Obtain exact refreshed-head review/evidence and integrate before marking current-main complete.

### Task 2 — Reconcile and integrate existing SI-05 stack

Primary chain: #541 → #542 → #543 → #544 → #545 → #546 → #547 → #548 → #550 → #551 → #555. #556 hardens #541. #552 remains a Qlib challenger/reference and #553 is temporary evidence only.

- [ ] Refresh every PR base/head/diff against current `main`.
- [ ] Requalify #541/#556 on the current test contract; historical V2 failures are not carried forward blindly.
- [ ] Diagnose/repair only current reproducible blockers.
- [ ] Serialize P11 manifest/router promotion behind #555.
- [ ] Retain Qlib source pin/provenance/goldens while porting any accepted capability behind P11 rather than creating a second authority.
- [ ] Close temporary evidence wrappers after immutable evidence capture.
- [ ] Update #554 only from exact merged/current-head proof.

### Task 3 — Fundamentals and valuation closure

- [x] SI-05.02 deterministic company-fundamentals snapshot landed on `main` via #606.
- [ ] Rebase/qualify #569/#572 Residual Income/EVA on current main.
- [ ] Integrate/qualify trading comps through #550 → #551 → #555 without invented peer facts.
- [ ] Add arbitrary governed scenario modeling by reusing existing P11 sensitivity/probabilistic primitives, not a second valuation engine.
- [ ] Close expectation/surprise reconciliation using only permitted observed/estimate/guidance/internal-model inputs.

### Task 4 — Portfolio, risk, optimization and factor closure

- [ ] Finish SI-05.11 integration after exact refreshed-head evidence.
- [ ] Audit existing P11 optimization/factor engines before adding code.
- [ ] Add independent known-answer corpora where conventions are not already proven.
- [ ] Integrate portfolio-impact/counterfactual stack after ancestors land.
- [ ] Reconcile approved challengers/donors against P11 without silent authority replacement.

### Task 5 — Fixed income, derivatives, macro/FX, events and alternatives

- [ ] Audit current deterministic engines and provider-neutral input contracts.
- [ ] Fill only bounded capability gaps with explicit units/as-of/conventions/known answers.
- [ ] Keep provider ingestion/evidence separate from deterministic calculation authority.
- [ ] Integrate corporate-action impact/decision semantics only with entitlement/event truth.

### Task 6 — Personal finance and wealth

- [ ] Preserve the merged deterministic budget foundation.
- [ ] Add goal/retirement/debt/wealth scenarios with explicit assumptions and no hidden return/inflation defaults.
- [ ] Reuse canonical Household/Project/Artifact state; no separate personal-finance database/runtime.
- [ ] Distinguish scenario output from guaranteed outcomes and keep risk/suitability context explicit.

### Task 7 — Research, models, Financial Twins and professional decision objects

- [ ] Integrate source-pinned research/analyst donors only behind GM/P5/P7/P11.
- [ ] Finish screening, consensus/disagreement and model-maintenance paths from existing work.
- [ ] Implement Financial Twins as structured persistent representations behind Projects/Chats/Artifacts, not a new state authority.
- [ ] Add private-markets/deal, IB/corporate-finance and credit workflows only where evidence rights permit.
- [ ] Make important outputs revisable P4 Artifacts/Decision Objects with source and numerical lineage.

### Task 8 — Governed action and finance truth convergence

- [ ] Land paper/simulated action semantics through canonical SI-02/GM authority.
- [ ] Preserve operation binding, current authorization re-check, idempotency/reconciliation and receipts.
- [ ] Land truth classes/cross-engine reconciliation without laundering estimates/inference into observed truth.
- [ ] Keep live brokerage outside SP-05 acceptance unless separately authorized.

### Task 9 — SP-05 packaged Financial Intelligence Alpha

- [ ] Freeze a candidate SHA after required SI-05 lanes/shared-core integrations are accepted.
- [ ] Use V0/V1/V2 to diagnose final subsystem blockers before the shipping gate.
- [ ] Run one deliberate V3 Quality Gate on the real/self-hosted packaged target.
- [ ] Execute the flagship journey: named company/security/portfolio → dated permitted evidence → material change → explicit assumptions → deterministic valuation/risk/portfolio impact → Living Thesis/Decision Object → professional Artifact/export → governed paper action/no-action → restart/reconciliation.
- [ ] Record exact SHA/build/environment/truth/limitations and owner acceptance on #554/#192.
- [ ] Mark SI-05/SP-05 complete only from merged/current-head packaged evidence.
