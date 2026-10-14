# LiOS Capability Assimilation Workstream

**Status:** OWNER-APPROVED PARALLEL EXECUTION WORKSTREAM  
**Effective:** 2026-10-02  
**Program name:** Capability Assimilation (**CA**)  
**Canonical parents:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` (final execution authority), `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` (mandatory shipping evidence), `docs/LIOS_MASTER_PLAN.md`, `docs/LIOS_ARCHITECTURE.md`, `docs/LIOS_EXECUTION_ROADMAP.md`, `AGENTS.md`
**Machine truth registry:** `third_party/capability-assimilation.json`  
**Parallel structural program:** Goldmine / OpenClaw User-Owned Runtime (`GM-00` → `GM-25`)

## 1. Decision

Capability Assimilation is an owner-approved parallel capability workstream under the SI-01–SI-07 execution program, not subordinate to TC as a separate execution roadmap. TC owns experience, GM platform and CA donor capability depth behind existing canonical P/GM owners. S0–S10 are validation journeys only; CP labels are historical evidence references.

It turns useful permissively licensed open-source donors and already-designed LiOS bridges into **real LiOS capabilities** while preserving existing architecture.

> **Goldmine builds the operator. Capability Assimilation enlarges what the operator can operate.**

CA is **not** a second master plan, architecture, engine fabric or product. Every implementation maps back to an existing LiOS owner and uses existing contracts, state, policy, provenance and UX.

Goldmine retains GM-00–GM-25 ownership under SI strategic outcomes and dependency-driven pull-forward. CA may proceed in parallel wherever the owning LiOS contract is stable and the work does not collide with the current GM structural owner. Multiple coordinated bounded owners are allowed; each shared-core authority remains singular.

## 2. Canonical ownership

| CA area | Canonical LiOS owner | Typical scope |
| --- | --- | --- |
| CA-Artifacts | **P4 Artifact & Professional Workspace OS** | Univer, Perspective, ECharts, Tiptap, entity graphs, timelines, diagrams, large tables |
| CA-Data | **P5 Universal Data Fabric / Global Instrument Master** | entity resolution, data quality, governed adapters, SQL/data interoperability |
| CA-Finance | **P11 Engine Fabric** | FinanceToolkit, skfolio, Riskfolio, CVXPY, QuantLib extensions, Arelle, LEAN/ORE/Strata/Qlib where justified |
| CA-Outputs | **P11 Reporting & Modeling** | PPTX, XLSX, DOCX, PDF and professional work-product renderers |
| CA-Multimodal | **P12 Voice & Multimodal** | local speech/document/image capabilities not already complete |
| CA-Extensions | **P13 Plugin/MCP authority** | capability exposure, plugin packaging and MCP interoperability |
| CA-Runtime | **Goldmine GM tasks** | execution, devices, browser/computer use, local AI, memory, skills, agent runtime |

CA may discover, evaluate, pin, benchmark, import, adapt, integrate, package and prove a capability. It does **not** become the canonical owner.

## 3. One-app / zero-technical-setup rule

The customer installs and experiences **LiOS**, not a bag of OSS products. Ordinary users must not be told to install Python packages, donor servers, renderers, runtimes or command-line dependencies manually.

```text
Ask LiOS
   ↓
LiOS resolves capability
   ↓
LiOS verifies/provisions the internal component
   ↓
execute
   ↓
Result + provenance + Artifact
```

Donor names belong in source/provenance/open-source notices and advanced diagnostics, not ordinary product chrome.

### Packaging classes

**Built-in application components:** ship in the desktop bundle when footprint/security justify it.

**LiOS-managed runtime components:** native/Python/other components remain modular internally, but LiOS pins, installs, verifies, activates, updates and rolls them back.

**Heavy opt-in components:** large engines/GPU runtimes/model weights may be provisioned on first enable/use after showing download size/storage/rights. No silent multi-GB download.

**User-owned external providers:** BYOAI, BYOD APIs, databases and enterprise services remain user-owned; LiOS provides connection/validation UX.

Internal packs remain useful engineering boundaries. A normal user enables a LiOS capability, not a donor pack.

## 4. Capability-facing architecture

```text
User / Conversation
        ↓
Goldmine Agent + Conversation Runtime
        ↓
LiOS Capability / Runtime Registry
        ↓
Data/P5 ─ Engines/P11 ─ Artifacts/P4 ─ Outputs/P11
        ↓
Evidence / receipts / versions / provenance
```

Examples: `entity.resolve`, `pricing.bond`, `artifact.spreadsheet`, `artifact.data.explore`, `artifact.chart.advanced`, `artifact.export.pptx`, `local-ai.invoke`.

The model/agent must not depend on donor-specific APIs or state.

## 5. Implementation truth

The repository historically mixed approval with implementation. From this workstream onward they are separate.

```text
DISCOVERED
  ↓
LICENSE VERIFIED
  ↓
CAPABILITY GAP CONFIRMED
  ↓
CANONICAL OWNER ASSIGNED
  ↓
PINNED
  ↓
POC / BENCHMARK
  ↓
ASSIMILATION APPROVED
  ↓
DEPENDENCY OR SOURCE PRESENT
  ↓
LIOS ADAPTER INTEGRATED
  ↓
TESTED
  ↓
PACKAGED
  ↓
USER ACCESSIBLE
  ↓
VERTICAL FLAGSHIP PASSED
  ↓
SHIPPING POINT ACCEPTED
  ↓
RELEASE PROVEN
```

Do not infer implementation from donor mention, candidate registry presence, `launch:true`, commit pin, renderer enum, projection helper, a capability implemented by another engine, or documentation labels.

For **integrated**, require a real dependency/import/vendor/managed-runtime path plus a production LiOS call path.  
For **packaged**, require applicable desktop/runtime packaging or deterministic LiOS-managed provisioning.  
For **user accessible**, require a supported product journey.  
For **shipping point accepted**, require the applicable SP-01–SP-07 Minimum Shippable Journey and all five mandatory gates: real user outcome, applicable packaged/target execution, no fake success, regression protection and exact build/commit/environment/outcome/limitations evidence. Qualification runs continuously through SI-01–SI-07, not only CA-10/GM-25/SI-07. No existing donor status or partial smoke establishes SP acceptance; P14 remains final release authority.
For **release proven**, require packaged/release acceptance evidence.

Machine truth: `third_party/capability-assimilation.json`.

## 6. Clean audit snapshot — 2026-10-02

The dated audit is retained with bounded 2026-10-03 updates below; later evidence supersedes the former Univer-absent and GM-08-onward-pending narratives, not their outstanding qualification obligations.

### Real/executable
- Dockview — direct dependency/current workspace renderer.
- QuantLib — managed Python runtime and real fixed-income execution.
- EdgarTools — managed runtime and real SEC full-text search.
- Docling — real optional managed runtime/document adapter.
- DuckDB — direct Node dependency and real Parquet/query path.
- LSE Data — real governed provider adapter with tests.
- whisper.cpp — real optional P12 voice runtime path.
- statsmodels / SciPy / scikit-learn — real Python engines.
- Ollama adapter — real provider path; Ollama runtime itself is externally managed today.

### Partial
- OpenClaw — GM-00–09 foundations now have recorded utility/security/provider, Gateway protocol/client/conversation and device pairing/TLS/discovery evidence (blueprint §33–47); major GM-10 process/journal/native-backend pieces are recorded in §48. This remains partial assimilation, not full execution. Interactive session/attach/replay/upload consumers and privileged `exec.*` remain blocked on GM-11 exact-operation authority, sandbox and trust receipts. GM-11 is the immediate structural priority; open PR #227 is not merged-main implementation or SP-01 acceptance. Agent/coding/browser/node/mobile, memory/Dreaming, skills/MCP, managed local models and deployment/provisioning remain downstream.
- Univer — actual dependency and P4-backed editor now exist. Blueprint §48.6 records browser edit/revision/reload; §48.8 records an unsigned/ad-hoc macOS arm64 packaged-shell CSP, formula and revision-save smoke. This supersedes the 2026-10-02 renderer-absent finding, but not packaged footprint/performance, Windows, signed/notarized clean-install or release qualification.

### Bridge/contract only — first CA completion wave
- Perspective.
- ECharts.
- Tiptap.

Perspective, ECharts and Tiptap Artifact projections/preferences exist; their actual runtime renderers remain absent in this evidence snapshot. Univer is partial above, not part of this absent-package claim.

### Documented/candidate but not donor-integrated
assistant-ui/tool-ui; TanStack Table/Virtual; xyflow; Monaco; FinanceToolkit; skfolio; Riskfolio-Lib; PyPortfolioOpt; QuantStats; CVXPY; ORE; Strata; py_vollib; Qlib; StatsForecast; XGBoost; Optuna; LEAN; LSE Terminal; Brue; Arelle; sqlite-vec; Polars; SQLGlot; Pandera; XlsxWriter; python-docx; python-pptx; PydanticAI; LangGraphJS; OpenTerminalUI; OpenTerminal; TradingAgents; Dexter; LangAlpha; fin-agent; backtest-kit; HQ TUI.

A corresponding LiOS capability may already exist through LiOS code or another library; that does not make the named donor integrated.
assistant-ui/tool-ui interaction-pattern adaptations do not establish donor-runtime integration. The locked optional node-pty dependency has a backend and packaged-layout probe (blueprint §48.7–48.8), but no shipped-server caller or interactive terminal. It is tracked separately from the preserved 92-entry CA baseline, not silently counted as a 93rd baseline donor. `third_party/imported-oss-regression.json` now records coverage paths and lineage for the later OpenClaw, Univer and supplemental native node-pty imports; these entries are not fresh PASS results. Exact-release regression execution, upstream reconciliation and packaging acceptance remain required; recorded provenance/test lineage is not automatic release qualification.

### Standards implemented without donor SDK
LiOS currently emits OTLP-compatible observability without the OpenTelemetry JS SDK, and OpenLineage-compatible events without integrating the OpenLineage library. Do not add SDKs merely to increase donor count.

### New discovery targets
Splink (P5 entity resolution); AntV G6 (P4 entity graph); vis-timeline (P4 TimelineArtifact); Mermaid (P4 DiagramArtifact); MapLibre/deck.gl (optional P4 GeoArtifact); React-PDF (P11 output fallback if needed); llama.cpp/MLX (GM-22 local AI). These are discovery targets until exact pin/license/dependency/benchmark review.

## 7. CA coordination IDs

CA IDs coordinate evidence; they never transfer ownership.

- **CA-00 — Governance + implementation-truth audit.**
- **CA-01 — Artifact visual engines** (P4).
- **CA-02 — Professional outputs** (P11 Reporting & Modeling).
- **CA-03 — Entity intelligence** (P5).
- **CA-04 — Finance capability expansion** (P11).
- **CA-05 — Research/document expansion** (P11/P5).
- **CA-06 — Data/analytics expansion** (P11/P5).
- **CA-07 — AI-operability exposure** through existing LiOS capability contracts.
- **CA-08 — Zero-setup provisioning.**
- **CA-09 — Benchmark + overlapping-donor consolidation.**
- **CA-10 — Packaged/release proof.**

Every CA PR names both its CA coordination ID and canonical P/GM owner.

## 8. Initial priority

1. CA-00 keep truth aligned to code.
2. CA-01/P4: deepen/qualify partial **Univer**, then integrate **Perspective → ECharts → Tiptap** under stable P4 contracts.
3. CA-02/P11: **python-pptx → XlsxWriter → python-docx**; evaluate richer PDF only if needed.
4. CA-03/P5: close entity/no-ticker gaps; evaluate Splink.
5. CA-01/P4: entity graph + timeline after the four existing bridges are real.
6. CA-04/P11: capability-diff FinanceToolkit/skfolio/Riskfolio/CVXPY; do not bulk-install overlap.
7. CA-05/06: deepen research/data only where benchmarks justify it.
8. Advance remaining Goldmine dependencies under SI, with **SI-01.11 / GM-11** immediate structural priority before privileged `exec.*`; independent CA work may continue behind stable contracts.
9. GM-22 owns local-model runtime expansion; CA tracks readiness but creates no second local-AI program.
10. GM-23 exposes all capability as one conversation-first product.

## 9. Parallel rules with Goldmine

CA may proceed when the canonical owner contract is stable, it consumes rather than rewrites GM seams, and no duplicate registry/router/store/gateway/permission system is created.

Examples of independent contract consumers include P4 ECharts, P11 PPTX and P5 entity resolution alongside remaining GM work. Local-AI runtime changes belong to GM-22. Prior GM-08/09 foundation records do not close GM-10/11 execution or later provisioning.

If CA depends on an unmerged GM contract, pause the structural part and work on isolated adapter/tests/benchmarks.

## 10. License/donor policy

Preferred commercially permissive code includes MIT, Apache-2.0, BSD-2-Clause and BSD-3-Clause, plus already-approved compatible licenses after exact review.

Every import requires exact repo/pin/path, dependency review, notices, code-vs-data/API/model/asset/trademark rights separation, destination contract, validation and rollback/removal path.

GPL/AGPL/Commons-Clause/source-available/custom-commercial-restriction code does not enter proprietary core merely because it is attractive. Existing reject decisions remain.

## 11. Integration requirements

Before code: prove the gap, inspect current implementation, identify owner, compare candidate to baseline, define measurable benefit, pin upstream, classify reuse and declare state/permission/data boundaries.

During integration: donor state/types never become canonical LiOS state; donor networking/secrets obey LiOS policy; quantitative imports get known-answer/reconciliation tests; normal UI uses LiOS capability names.

After integration: test source + failure path + packaging/provisioning + user journey + AI/tool access where appropriate; update notices/SBOM/upstream locks and the CA truth registry.

## 12. User-experience invariant

```text
"Build a three-statement model, value the company,
compare peers, chart sensitivities and make a presentation."
        ↓
Entity/Data           P5
Finance Engines       P11
Spreadsheet           P4
Charts                P4
Presentation          P11 Reporting
Agent/Orchestration   Goldmine/P2
        ↓
one conversation
one set of Artifacts
one provenance trail
```

Users do not choose donor technologies or manually compose the pipeline.

## 13. Definition of success

- donor inventory no longer overstates implementation;
- existing bridges become real packaged functionality;
- mature permissive code is reused instead of rebuilding commodity components;
- one canonical owner and one primary implementation per capability;
- normal users do not manually install donor runtimes;
- heavy optional capability is self-provisioned with consent/verification;
- AI operates capabilities through LiOS-owned structured contracts;
- calculations/data remain reproducible and provenance-aware;
- donor implementations remain replaceable;
- Goldmine and CA move in parallel without architectural duplication;
- the customer experiences one coherent LiOS application.

## 14. Agent handoff requirement

Every CA issue/PR records: SI phase/workstream; target SP or `none/direct enabler` with explanation; MSJ contribution; affected S validation journeys; CA ID; canonical owner/task; donor + exact pin or discovery-only state; current/target truth state; gap; files/contracts; reuse method; license/notices/data-rights; GM dependencies; tests/benchmarks; packaging impact; exact evidence; and CA truth-registry update.

If this document conflicts with a canonical owner document, the canonical owner wins. Update CA to match rather than forking the architecture.

## 15. Mandatory donor-first implementation gate — 2026-10-03

**Owner-approved and mandatory across TC, GM and CA whenever a substantial capability/feature has a relevant entry in `third_party/capability-assimilation.json`.** This is a reuse gate, not a fourth program and not permission to bypass canonical LiOS ownership.

Before designing or coding a substantial capability, agents must search/review the registry and use this decision order:

> **ANALYZE → DECOMPOSE → REUSE → ADAPT → REPURPOSE → COMBINE → GENERALIZE → INNOVATE → WRAP → BUILD LAST → REJECT ONLY WITH EVIDENCE**

Prefer full useful package/subsystem reuse when the exact license, security posture, architecture fit, maintenance quality, footprint/performance and product fit are acceptable. Do **not** rewrite mature permissive donor functionality merely to make its internals look LiOS-native.

Inspect every meaningful registered donor/subsystem at four levels: product purpose, useful subsystems, underlying mechanisms and potential LiOS transformations. Record direct reuse, adaptation, repurposing, cross-donor combinations, generalization and innovation opportunities, canonical owner, security/privacy/performance/footprint, packaging, upstream tests and final disposition. Allowed dispositions are `DIRECT_REUSE`, `IMPORT`, `ADAPT`, `REPURPOSE`, `COMBINE`, `GENERALIZE`, `INNOVATE`, `REFERENCE_VALIDATOR`, `DEFER_WITH_TRIGGER`, `REJECT_WITH_EVIDENCE`. Original-domain mismatch, a current S journey or historical phase boundary alone cannot justify rejection.

If a relevant donor exists but the implementation is built from scratch, the issue/PR must record the exact rejection reason. Valid reasons include: incompatible license/data/model/asset/trademark rights; security risk; poor quality or maintenance; architecture/state-authority conflict; unacceptable performance/footprint; platform incompatibility; harmful overlap with a stronger selected donor; or a demonstrably stronger existing LiOS implementation.

Every substantial issue/PR must contain a **Donor-first check** section with:
- relevant registry donor IDs/names searched and reviewed;
- selected donor and reuse mode, or `no relevant donor`;
- exact upstream repository + pin/version + imported path + license before source/dependency import;
- canonical LiOS owner and state/permission/data boundary;
- overlapping alternatives considered and why rejected/deferred;
- material modifications made to donor code;
- upstream tests reused/ported where practical;
- notices, SBOM, provenance and packaging/provisioning implications;
- truthful current implementation state on the CA truth ladder.

A donor-first check must not block unrelated work when the registry has no relevant donor. Record `no relevant donor` and continue under the normal canonical owner.

### 15.1 Full donor coverage and suitable-donor integration

**Owner decision 2026-10-03:** OpenClaw is the primary donor; integrate every suitable registered donor. Review all 92 entries while preserving their IDs/source registries. The baseline counts entries, not unique installations.

Suitability requires an identifiable user benefit plus acceptable rights/license, security, quality/maintenance, architecture/state boundaries, supported platforms and performance/footprint. Inspect useful whole subsystems and creative combinations before rejecting overlap. Functionality outside the donor's original purpose must be investigated for useful LiOS repurposing, not automatically discarded as unrelated. There is no arbitrary ceiling on exploration or useful integration. New product-scope ideas go to the owner for a decision; approved adaptations retain canonical LiOS authorities.

For each suitable donor, record the canonical implementation task, SI phase/workstream and shared-platform responsibility, selected reuse mode, exact pin/path/license, target SP/MSJ contribution, validation journey, evidence level and delivery milestone. A suitable donor deferred for a dependency remains planned with a blocker and revisit trigger; reference-only is not fulfillment of its integration obligation.

For unsuitable donors, record the concrete rejection reason and evidence. A stronger existing implementation may justify rejection only after complementary, replacement, combination and challenger roles have been considered.

Before `NOT NEEDED`, reference-only or overlap rejection, record direct reuse, repurposing, replacement, combination and challenger opportunities, the user outcome considered and the evidence-backed obstacle. Prefer complete useful subsystem/package imports over thin copies or unnecessary rewrites; adapt and modify for LiOS with upstream tests/provenance retained.

Preserve duplicate/shared-upstream entries, explicitly link overlaps and select one integration authority. The same installed subsystem may satisfy multiple entries when their coverage is evidenced; complementary roles may justify multiple components. Never install overlapping packages solely to increase counts.

CA-00 owns registry/disposition truth; existing P/GM owners retain implementation authority. Do not promote an entry's truth status from a plan or donor selection alone.

### 15.2 Authority and provenance invariants

Donor-first reuse never transfers canonical state authority. Donor-native Project/Chat/Artifact/Data/context/memory/permission/identity state must remain behind LiOS-owned contracts or be mapped into the existing canonical authority. Do not create duplicate Gateways, routers, stores, capability registries, Artifact authorities, context/memory systems, engine authorities, plugin/MCP stacks or permission systems.

Every imported/adapted donor keeps exact attribution, license, repository, pin/path, modification record, notices and relevant upstream-test lineage. `candidate`, `documented`, `bridge`, `integrated`, `packaged`, `user-accessible` and `release-proven` remain distinct states; this donor-first rule must never inflate implementation truth.

Current delivery gaps remain explicit: provider seams do not install every provider or converge every state store; GM-19/23 durable-memory/session convergence, GM-20 skills/MCP, GM-22 managed local inference and CA-08/GM-24 provisioning remain incomplete. External Ollama and optional missing browser/runtime packages are not zero-manual-install completion. Public-iOS fully suspended wake without a LiOS relay remains a technical/platform limitation; Apple-native/private/user-managed alternatives require real validation, not an everywhere-notification claim.
