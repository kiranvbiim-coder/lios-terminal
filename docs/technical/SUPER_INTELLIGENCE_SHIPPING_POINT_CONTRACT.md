# LiOS Super Intelligence — Shipping Point Contract

**Owner decision:** 2026-10-03  
**Reconciled:** 2026-10-05  
**Applies to:** `SI-01` through `SI-07`  
**Shipping milestones:** `SP-01` through `SP-07`  
**Status:** MANDATORY EXECUTION CONTRACT  

## 1. Purpose

LiOS Super Intelligence is intentionally broad and donor-heavy. That breadth must not postpone real product proof until the end of the program.

Every Super Intelligence phase therefore has a mandatory **Shipping Point**: a real, integrated, usable milestone that proves LiOS can ship progressively while capability depth continues to expand.

The operating lifecycle is:

> **BUILD → INTEGRATE → SHIPPING POINT → FREEZE ACCEPTED BEHAVIOR → CONTINUE**

A Shipping Point is not a claim that the entire SI phase is permanently feature-complete. It is the minimum integrated product state that must work for a real user before the phase can be considered genuinely shippable.

Later SI phases may deepen earlier capabilities, but they may not silently break an accepted Shipping Point.

Validation cadence is governed by `docs/technical/LIOS_PROGRESSIVE_VALIDATION_CI_STRATEGY.md`. Shipping Points are the normal **V3 full-gate boundary**, but V0/V1 focused validation and V2 integration validation continue throughout implementation.

For Finance, Shipping Point interpretation must remain consistent with:

> `docs/technical/LIOS_FINANCE_INTELLIGENCE_TO_ACTION_BLUEPRINT.md`

Implementation sourcing for every Shipping Point follows the sole canonical donor-use authority:

> `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`

This contract does not define a second donor preference sequence.

## 2. Mandatory Shipping Points

### SP-01 — Secure Local Alpha

**Parent phase:** `SI-01 — Super Intelligence Foundation`

A real Desktop Local / LiOS Home path proves:

- user can install/start LiOS on the supported target;
- sign-in / owner identity works according to the current product contract;
- Project/Chat can be opened;
- a governed exact operation can be requested;
- GM execution authority decides whether it is permitted;
- approved execution runs through canonical execution infrastructure;
- streamed state/result is visible;
- a trust/execution receipt exists;
- Project/Chat/Artifact or relevant state persists;
- restart restores the expected state;
- unavailable/denied/error states are explicit;
- normal customer operation does not require a LiOS-operated runtime cloud.

**Critical dependency:** `SI-01.11 / GM-11` execution authority, sandbox and trust receipts.

Privileged interactive `exec.*` exposure remains blocked until the relevant GM-11 authority is proven.

### SP-02 — Agentic Alpha

**Parent phase:** `SI-02 — Agentic Intelligence`

A real multi-step user request proves LiOS can:

- interpret the goal;
- produce a bounded plan;
- select approved tools/capabilities;
- execute through canonical permission/runtime authority;
- use governed Python, shell, browser or computer-use where permitted;
- delegate or parallelize only through canonical agent authority;
- checkpoint/resume where required;
- cancel reliably;
- detect/recover from a representative failure;
- avoid duplicate external side effects;
- return a persistent useful result with concise action/tool/source receipts.

Before SP-02 acceptance, the generic runtime must be sufficiently stable for later domain work to rely on canonical tool descriptors, consequential-action lifecycle, idempotency/reconciliation, bounded delegation, Skill/MCP/plugin publication, placement capability and agent receipt contracts. Finance-specific integrations are not required for SP-02.

The saved Project/Quick chat composer exposes a deliberate **Multi-step agent** opt-in within `ai_assisted` mode; the canonical `conversation.start` body carries `agent: true`. Temporary chat does not offer that runtime. The composer reads the owner-scoped Master AI/setup state and links to Connection Center when AI is off or the provider/model is unavailable; it never manufactures a plan. Governed-tool review, repeated approval pauses, Stop and explicit Resume stay bound to the original request id. Review controls carry the server review id, suppress duplicate clicks while the decision is pending, and disappear after accepted review or terminal completion. These UI bindings are not packaged SP-02 acceptance evidence.
### SP-03 — Research Alpha

**Parent phase:** `SI-03 — Knowledge, Memory & Research Intelligence`

A real multi-source research journey proves LiOS can:

- resolve a real public, private or no-ticker topic/entity without fabricating identifiers;
- discover and use permitted evidence from connected/public/project sources;
- preserve provider/source identity, entitlement posture, retrieval time, observation/as-of semantics and citations;
- preserve explicit unavailable, unentitled, stale, ambiguous or unsupported states;
- ingest relevant user/project knowledge without silently promoting it to external fact;
- identify important contradictions, gaps, unknowns and source disagreements;
- distinguish observed facts, sourced estimates/guidance, explicit inference and missing information;
- resolve relevant entity/event/relationship context through canonical authority;
- build or update thesis/counter-thesis evidence where applicable;
- preserve numerical lineage for material values where source support exists;
- create a durable cited Research Artifact;
- restart/reopen and preserve the research state.

A provider-neutral result does not mean all sources are interchangeable. Better user entitlements may produce deeper results; inaccessible premium data must remain inaccessible rather than being guessed.

### SP-04 — Professional Work Alpha

**Parent phase:** `SI-04 — Professional Work Intelligence`

A real professional-work journey proves LiOS can:

- import a real spreadsheet/document or create one from evidence/analysis;
- inspect and understand the content;
- edit through the canonical Artifact authority;
- keep direct manipulation and conversational edits on the same state;
- preserve formulas and explicit user assumptions where the format/workflow supports them;
- create charts/tables/structured outputs through deterministic engines where applicable;
- preserve evidence/citations and source-linked numerical lineage where available;
- create or update a Decision Object or equivalent structured professional decision package when the journey calls for it;
- produce at least one real professional export format appropriate to the journey;
- reopen/round-trip the output with acceptable semantic integrity;
- preserve version/revision state;
- show a material change/update report when source-linked model maintenance modifies an existing work product.

The milestone should prove **living professional work**, not one-time static AI output.

### SP-05 — Financial Intelligence Alpha

**Parent phase:** `SI-05 — Financial & Analytical Super Intelligence`

The flagship Finance journey proves LiOS can move coherently through the Intelligence-to-Action loop without requiring every Finance feature to be complete.

A representative real journey must prove:

- canonical company/security/instrument/portfolio identity occurs before provider/engine use;
- permitted market/fundamental/filing/research evidence is collected with entitlement, freshness and provenance truth;
- a material event, earnings change, estimate/recommendation change, user question or scenario can be translated into explicit assumption/model impact;
- deterministic engines remain calculation authority for material quantitative outputs;
- units, conventions, as-of posture, tolerances and non-convergence states are explicit;
- scenarios/sensitivities/revisions work where applicable;
- known-answer/cross-engine reconciliation supports material numerical logic;
- portfolio/risk impact is calculated where the journey has portfolio context;
- Living Thesis and/or Decision Object state is created or updated where appropriate;
- output becomes an inspectable persistent professional Artifact/work product;
- a governed action proposal or explicit no-action decision can be produced;
- if the action lifecycle is exercised, paper/simulated execution is sufficient for Shipping Point proof;
- any executed/simulated action is confirmed/reconciled and has durable receipts;
- professional export/reporting works for at least one representative journey.

A recommended flagship MSJ is:

> real company/security → permitted market + fundamental + filing + research evidence → material earnings/event change → assumptions/model update → deterministic valuation/scenario/risk → portfolio impact → Living Thesis + Decision Object → professional Artifact → governed action proposal or explicit no-action → optional paper execution → reconciliation → complete source/numerical/action receipt.

**Live brokerage execution is not required for SP-05.** Any future live path must remain user-directed, technically/contractually/legally permitted, explicitly authorized, revalidated, broker-confirmed, reconciled and receipted.

Representative Finance coverage should continue expanding across company/valuation, portfolio/risk, earnings/estimates, fixed income, derivatives, macro/FX, private markets, credit, wealth/advisor, corporate finance and personal finance on the same product spine. SP-05 does not require all those families to become feature-complete simultaneously.

### SP-06 — Autonomous LiOS Beta

**Parent phase:** `SI-06 — Autonomous & Everywhere Intelligence`

An accepted one-shot professional/Finance workflow proves it can become a governed continuing intelligence workflow:

- Save as Task / reusable recipe works;
- recurrence, condition or material event trigger works;
- permissions, credentials, provider entitlement and action authority are rechecked before execution;
- relevant data/model/source freshness is checked;
- the workflow can re-research/retrieve permitted evidence when the trigger requires it;
- source-linked model/work-product refresh occurs through canonical Artifact/engine paths where applicable;
- materiality/thesis/portfolio impact is recalculated rather than sending every raw change as noise;
- useful notification/result delivery works;
- duplicate/noisy execution is controlled;
- authorized review/approval can continue from another supported device where applicable;
- optional governed action can be proposed after the update;
- executed/simulated actions are confirmed/reconciled and receipted;
- restart/disconnect continuity works where supported;
- BYOAI and/or local AI operates under user policy;
- at least one user-owned Home/server/node/device topology is exercised;
- Project/Chat/Artifact/Decision continuity is preserved across that topology;
- offline/outbox behavior is explicit where applicable.

A recommended Finance continuity MSJ is:

> accepted thesis/portfolio workflow → Save as Monitor → material event arrives → entitlement/permission/freshness recheck → evidence refresh → model update → materiality + thesis/portfolio impact → low-noise notification → review/approval from authorized second device → optional governed action/paper execution → reconciliation → restart/disconnect continuity.

### SP-07 — Production Release Candidate

**Parent phase:** `SI-07 — Super Intelligence Convergence & Release`

An identified reproducible release candidate proves:

- LiOS appears as one product, not donor/infrastructure fragments;
- cross-capability composition works through real user journeys;
- capability discovery/health is truthful;
- global/search/conversational entry does not require users to manually select internal modules for normal workflows;
- source/truth/lineage inspection works for representative professional outputs;
- decision/action review is coherent where consequential workflows are supported;
- System Agent / Doctor diagnostics and repair paths are exercised;
- zero-setup/lazy provisioning works for required components;
- upgrade/migration/rollback behavior is qualified;
- backup/restore is exercised end-to-end;
- permissions/secrets/sandbox/device trust are qualified;
- privacy and cloud-AI consent boundaries are qualified;
- deterministic finance engines are numerically qualified;
- provenance/as-of/assumption integrity survives to final outputs;
- performance/resource behavior is measured on supported targets;
- failure/offline/provider/model/node interruption paths are exercised;
- accessibility and UX convergence are checked;
- supported packaging/installers are real;
- applicable `S0`–`S10` validation journeys are exercised;
- P14 final release authority receives the required evidence.

## 3. Five mandatory Shipping Point gates

Every `SP-01` through `SP-07` requires all five gates.

### Gate 1 — Real user journey

The milestone must prove an end-to-end user outcome. Unit tests, isolated adapters, donor pins, mocks or internal contracts alone are insufficient.

### Gate 2 — Packaged / target execution where applicable

When the product claim depends on a desktop build, server pack, device client or other target environment, validate that target rather than source-only behavior.

Source-built truth must not be silently promoted to packaged truth.

### Gate 3 — No fake success

Missing, unsupported, stale, ambiguous, unentitled, denied, offline and unavailable states remain explicit.

No placeholder/mock value may masquerade as real product success.

### Gate 4 — Regression protection

Once a Shipping Point is accepted, later SI work must preserve the accepted journey.

If a regression occurs:

- reproduce it;
- record the failing accepted behavior;
- assign a canonical owner;
- repair it before claiming the affected Shipping Point remains accepted.

Do not silently redefine the old Shipping Point to hide regressions.

### Gate 5 — Evidence record

Record at minimum:

- exact commit/build/release identifier;
- target environment and topology;
- exact Minimum Shippable Journey exercised;
- tests/checks executed and outcomes;
- packaged/target evidence where applicable;
- permissions/provenance/numerical evidence appropriate to the phase;
- known limitations and unsupported paths;
- truth level reached;
- remaining gaps and next dependency.

## 4. Minimum Shippable Journey (MSJ)

Before a Shipping Point can be accepted, the phase must define at least one **Minimum Shippable Journey**.

An MSJ is a bounded real workflow that exercises multiple subsystems together. It should be small enough to reproduce repeatedly but broad enough to expose integration failure.

Examples:

- **SP-01 MSJ:** Project chat → approval-required exact operation → approve → execute → receipt → save → restart → restore.
- **SP-02 MSJ:** complex request → plan → browser/Python/tool execution → recover from one failure → persistent result.
- **SP-03 MSJ:** real public/private/no-ticker entity → permitted multi-source evidence → entitlement/freshness/as-of truth → contradictions/gaps → entity/event/thesis context → cited Artifact → restart/reopen.
- **SP-04 MSJ:** real XLSX/document or source-linked model → inspect → edit/update → deterministic chart/table where applicable → professional export → reopen → verify formulas/assumptions/revisions/lineage integrity.
- **SP-05 MSJ:** company/security/portfolio → permitted evidence → material event/earnings change → assumption/model update → deterministic valuation/scenario/risk → portfolio impact → Living Thesis/Decision Object → professional Artifact → governed action proposal/no-action → optional paper execution → reconciliation/receipts.
- **SP-06 MSJ:** accepted one-shot workflow → Save as Monitor → material trigger → permission/entitlement/freshness recheck → evidence/model/materiality update → notification → authorized second-device review → optional governed action → reconciliation → restart/disconnect continuity.
- **SP-07 MSJ:** clean install → connect data/AI → complex cross-capability request → inspect source/truth/lineage → persistent professional output/decision → automation/device continuation → backup/restore → release evidence.

The canonical issue/PR may refine the exact MSJ, but it may not replace it with isolated component tests.

## 5. Relationship to donor-heavy execution

Shipping Points do **not** create or modify donor strategy.

All reuse/import/adapt/modify/combine/wrap/extend/build-new decisions follow:

> `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`

The purpose of Shipping Points is to prevent capability exploration and donor-heavy implementation from becoming an endless pre-shipping backlog while preserving maximum useful implementation leverage.

The required balance is:

> **Strongest compliant implementation + minimum architectural duplication + continuous integrated shipping proof.**

Donor work can continue beyond a Shipping Point when it deepens the product, but each accepted SP defines a protected user-visible baseline.

## 6. Relationship to S0–S10 and P14

`S0`–`S10` remain validation/coverage journeys. They may contribute MSJs and release scenarios, but they are not the primary execution headings.

`SP-01`–`SP-06` are progressive product milestones.

`SP-07` is the Super Intelligence production release-candidate milestone.

P14 remains the final existing release authority and is not replaced by this contract.

## 7. Agent / PR requirement

Every new substantial implementation task/PR must state:

- SI phase/workstream;
- target Shipping Point (`SP-01`…`SP-07`) or `none/direct enabler` with explanation;
- MSJ contribution;
- canonical implementation owner ID(s);
- donor-policy evaluation/disposition where relevant;
- shared-core conflict class;
- validation journeys affected;
- **risk class `R0`…`R4`;**
- **planned/actual validation levels `V0`…`V4`;**
- acceptance evidence and truth level.

A task may be technically complete without closing a Shipping Point, but it must be clear what integrated milestone it advances.

## 8. Truth ladder

Use:

> **contract locked → code integrated → focused tests passed → integration evidence passed where required → packaged/provisioned → user accessible → vertical flagship passed → shipping point accepted → release proven**

A phase is not considered genuinely shippable until its Shipping Point evidence exists.

## 9. Progressive validation relationship

The mandatory detailed CI policy is `docs/technical/LIOS_PROGRESSIVE_VALIDATION_CI_STRATEGY.md`.

Shipping Point validation follows:

- **V0 — Fast Check:** continuous local feedback while coding;
- **V1 — Focused Task Gate:** every meaningful bounded implementation task;
- **V2 — Integration Gate:** required for shared-core/high-blast-radius integration and meaningful cross-subsystem milestones;
- **V3 — Shipping Gate:** normal full Quality Gate boundary for `SP-01` through `SP-07`;
- **V4 — Release Gate:** cross-platform/signing/final P14 qualification.

### Mandatory balance

A Shipping Point does **not** permit deferring all testing until the end of an SI phase.

Conversely, an ordinary bounded PR does **not** require the expensive full repository Quality Gate merely because it exists.

The default loop is:

> **CODE → V0 → V1 → MERGE → V2 WHEN REQUIRED → SI CANDIDATE → V3 → MSJ → SP ACCEPTED**

At final release:

> **SI-07 CANDIDATE → V3 → SP-07 → V4 → P14 → PRODUCTION**

### Full gate discipline

The complete `LIOS Quality Gate` is run deliberately for:

1. Shipping Point candidates;
2. release/P14 candidates;
3. explicitly justified exceptional R3 shared-core checkpoints.

It is not the normal automatic PR/push loop.

If a V3 run fails, diagnose and repair through focused V0/V1 and relevant V2 checks first; rerun the complete gate once as confirmation after the failing subsystem is clean.

### Accepted baseline

When an SP is accepted, record the exact SHA/build/environment/evidence and preserve a known-good baseline/tag when the owner chooses to publish one. Later SI work must protect that accepted journey.