# P8 — Branching, Scenario and Formula Intelligence

Supporting technical specification. The [SI execution plan](../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md) governs strategic execution; [LIOS_EXECUTION_ROADMAP.md](../LIOS_EXECUTION_ROADMAP.md) retains canonical task and historical evidence detail. P8 supports SI-03 research branching, SI-04 revisions and SI-05 scenarios; S0–S10 are validation journeys only.

P8 makes alternative analysis first-class without creating a second model store, a separate scenario database, or an ungoverned AI editing path. Project, Artifact, version, proposal, reference and Ledger contracts from P1-P4 remain canonical. P8 adds scenario semantics and review workflows on top of them.

## Architecture lock

- Artifact forks are model/scenario branches. Fork ancestry is the branch graph.
- Artifact versions are immutable pre/post snapshots. P8 does not copy model state into a second persistence layer.
- Scenario comparison is deterministic and compares explicit assumption/output fields from retained Artifact versions.
- Selected-assumption copy is always a proposal against a target head. It never silently mutates a parent or sibling branch.
- Formula Studio uses the existing deterministic finance formula parser. It never uses eval, Function, generated JavaScript, shell execution or arbitrary Python.
- A formula is Draft → Validated → Explicitly Approved/Published. Publication creates a versioned Strategy Artifact and an Artifact reference to the intended target when supplied.
- AI/user model edits converge on the P4 Artifact proposal path. Review/accept/reject semantics stay identical regardless of who drafted the change.
- Decision Objects remain Decision Artifacts and retain user choice, uncertainty and linked evidence/models.
- The Artifact pane is the primary P8 UI. The added P8 surface is collapsible to preserve the simple Projects → Chats → Artifacts operating model.

## Canonical task implementation

| Task | Implementation |
| --- | --- |
| LIOS-P8-01 | Artifact fork ancestry plus p8ScenarioService/p8ScenarioEngine implement branch creation, immutable snapshots and cross-branch comparison. |
| LIOS-P8-02 | validateP8FormulaDraft delegates to financeFormula; publish requires the unchanged validation fingerprint plus explicit approved=true before a Strategy Artifact is created. |
| LIOS-P8-03 | proposeP8ModelDraft produces a deep change review and persists the change only as an Artifact proposal. Existing ProposalCard accept/reject creates the next immutable version only after review. |
| LIOS-P8-04 | buildSelectedAssumptionPatch copies only named paths. proposeP8AssumptionMerge creates a review proposal and a P3 lineage event; parent/sibling state is not directly mutated. |
| LIOS-P8-05 | ScenarioComparison emits Base/Bull/Bear/custom matrix rows and numeric assumption-delta waterfall items. UI shows changed fields rather than a separate dashboard. |
| LIOS-P8-06 | DecisionArtifact is extended additively to hold the full Decision Object: objective, constraints, assumptions, alternatives, selection, implementation and monitoring. |
| LIOS-P8-07 | DecisionArtifact stores prescriptive sections in the canonical order: what changed → why → scenarios → options/alternatives → trade-offs → next actions → monitoring. |
| LIOS-P8-08 | Decision linkedRefs connects models, sources, scenarios, backtests and monitors; sourceRefs on the Artifact preserve inspectable links. |
| LIOS-P8-09 | uncertainties and selectedAlternativeId remain explicit. LiOS structures options and evidence but does not silently choose or imply certainty. |

## Supported structured scenario state

P8 intentionally fails loudly for Artifact kinds that do not expose a safe structured assumption surface.

- Valuation: assumptions; outputs are compared.
- Backtest: assumptions; metrics are compared.
- Strategy: parameters.
- Screen: state.
- Portfolio can participate in output comparison but is not currently a mergeable assumption target.

This boundary can be expanded later only when an Artifact kind has a typed deterministic state contract.

## Formula Studio safety

Formula Studio accepts the arithmetic/function grammar already implemented by shared/financeFormula.ts. Validation derives dependencies and performs a parser probe with bounded numeric values. The validation fingerprint covers expression, target surface, target key, target Artifact and dependencies. Publication recomputes validation and rejects stale fingerprints.

Missing sample values do not make a syntactically valid formula unsafe; they only prevent a sample result. Runtime calculation must still fail closed when required dependencies are unavailable.

## Change review and AI drafts

P8 does not grant AI a privileged write path. AI-originated patches are marked as conversation drafts and pass through the same projectArtifactProposals table and P3 interaction/Ledger receipts as user-originated proposals. The current Artifact head must still equal the proposal base when accepted.

## Scenario merge semantics

Selected assumption paths are copied from one branch into another only when both Artifacts:
1. belong to the same Project;
2. have the same Artifact kind;
3. resolve to the same fork root; and
4. expose compatible assumption containers.

The merge operation creates a proposal. Accept/reject remains a separate user action.

## Decision Object order

The product surface should present:
1. What changed
2. Why
3. Scenarios
4. Options and expected outcomes
5. Risks / trade-offs
6. Uncertainties
7. Next actions
8. Implementation
9. Monitoring

A selected option is user state, not an AI conclusion.

## Gate

P8 is closed only when a user can branch a structured model, change branch assumptions, compare Base/Bull/Bear/custom state, selectively propose assumption copies, review AI/user model drafts, validate and explicitly publish a deterministic formula, and persist an evidence-linked Decision Object without mutating parent state or executing unvalidated generated code.

This subsystem gate is not Shipping Point acceptance. SP-04/SP-05 require the [Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md): a real bounded branch/review/formula/financial-work MSJ, applicable target execution, no fake success, regression protection and exact commit/build/topology/outcome/limitations evidence. The formula parser probe proves neither full financial numerical assurance nor professional export round-trip.
