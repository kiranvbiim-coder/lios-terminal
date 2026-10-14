# LiOS Super Intelligence — Final Execution Plan

**Owner decision:** 2026-10-03  
**Reconciled:** 2026-10-05  
**Program:** LiOS Super Intelligence  
**Execution phases:** `SI-01` through `SI-07`  
**Status:** FINAL EXECUTION AUTHORITY  

## 0. Executive lock

LiOS is the **Super Intelligence product**. It is not a collection of narrow finance modules, not a thin chat wrapper, and not an OpenClaw skin. LiOS must become one coherent intelligence system that can understand intent, research, reason, execute, calculate, create professional work, remember, automate, operate across user-owned infrastructure, and continuously improve the quality of its own work while preserving deterministic authority, permissions, provenance, privacy and user control.

This document is the final top-level execution program for implementation planning.

The authority hierarchy is:

> **Super Intelligence (`SI-01`–`SI-07`) → Shipping Point Contract (`SP-01`–`SP-07`) → domain capability blueprints such as LiOS Finance → canonical LiOS subsystem authorities (`GM`, `TC`, `CA`, `P*`) → implementation sourcing under the canonical donor policy → validation journeys (`S0`–`S10`) → P14 release qualification.**

The mandatory donor-use authority is:

> `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`

This Super Intelligence plan does **not** define a second donor hierarchy, donor preference sequence, OpenClaw-only boundary, horizontal/vertical donor split, or competing reuse policy. OpenClaw/Goldmine remains an important approved donor and may contribute wherever its implementation is valuable and suitable, including substantial or complete subsystems, exactly as permitted by the canonical donor policy. The same rule applies to other approved donors.

For the Finance proving ground, the canonical capability envelope is:

> `docs/technical/LIOS_FINANCE_INTELLIGENCE_TO_ACTION_BLUEPRINT.md`

Its companion research references are:

- `docs/technical/LIOS_FINANCE_COMPETITIVE_CAPABILITY_MATRIX.md`
- `docs/technical/OPENCLAW_FINANCE_CAPABILITY_REFERENCE.md`

Those research references do not create implementation authority or donor policy.

The old Product Slice catalog remains valuable, but `S0`–`S10` are now **validation and coverage journeys**, not the primary execution headings. Combined Product Phases `CP1`–`CP7` remain historical maturity/evidence references where useful. Existing `GM-*`, `TC-*`, `CA-*`, `LIOS-P*` tasks and canonical subsystem authorities remain valid implementation ownership IDs and must not be duplicated.

The mandatory progressive-shipping authority is `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`. Read it immediately after this plan and before the Master Plan/Architecture. `SI-*` classifies strategic phases/workstreams; `SP-01`–`SP-07` identifies their integrated shipping milestones; neither creates new implementation owners.

### Mandatory progressive Shipping Points

Use **BUILD → INTEGRATE → SHIPPING POINT → FREEZE ACCEPTED BEHAVIOR → CONTINUE**. Each phase must define at least one bounded, reproducible **Minimum Shippable Journey (MSJ)** before its Shipping Point can be accepted. The following are required milestones and example MSJs, not recorded passes:

| Phase | Shipping Point | Minimum Shippable Journey contribution |
|---|---|---|
| SI-01 | SP-01 — Secure Local Alpha | install/start and owner identity → Project chat → approval-required exact operation → canonical approval/denial → execution/stream → receipt → persistence → restart/restore, without vendor customer runtime |
| SI-02 | SP-02 — Agentic Alpha | multi-step request → bounded plan → approved browser/Python/tool execution and canonical delegation → checkpoint/resume/cancel → representative failure recovery without duplicate side effects → persistent useful result/receipts |
| SI-03 | SP-03 — Research Alpha | real entity/topic → permitted multi-source evidence → entitlement/freshness/as-of truth → contradictions/gaps/unknowns → entity/event/thesis context → cited durable Research Artifact → restart/reopen |
| SI-04 | SP-04 — Professional Work Alpha | source evidence or real XLSX/document → canonical living Artifact/model → inspect/edit → deterministic chart/table where applicable → source/citation preservation → professional export → reopen/round-trip with revisions/lineage intact |
| SI-05 | SP-05 — Financial Intelligence Alpha | real company/security/portfolio context → permitted data + filings/research evidence → material change/assumptions → deterministic valuation/scenario/risk → portfolio impact → Living Thesis/Decision Object → professional Artifact → governed action proposal or explicit no-action → paper/simulated execution where used → reconciliation/receipts |
| SI-06 | SP-06 — Autonomous LiOS Beta | accepted one-shot Finance/professional workflow → Save as Task/monitor → event/condition → permission/entitlement/freshness recheck → research/model/materiality update → notification → cross-device review/approval → optional governed action → reconciliation → restart/disconnect/user-owned topology continuity |
| SI-07 | SP-07 — Production Release Candidate | identified clean install → real data/AI → cross-capability professional output → automation/device continuation → Doctor/provisioning/upgrade/migration/rollback/backup-restore → security/privacy/numerical/provenance/performance/accessibility/failure qualification → applicable S0–S10 evidence → P14 |

Live brokerage execution is **not required** to accept SP-05 or SP-06. Paper/simulated execution may prove the governed action lifecycle. Any later live financial action must remain user-directed, broker/provider-permitted, explicitly authorized, revalidated, confirmed, reconciled and receipted.

Every SP requires **all five gates**: (1) a real end-to-end user journey, not isolated tests/adapters/pins; (2) packaged/target execution where the claim depends on it, without promoting source truth; (3) no fake success—missing, unsupported, stale, ambiguous, unentitled, denied, offline and unavailable states stay explicit; (4) regression protection of accepted behavior; and (5) an exact evidence record.

The evidence record identifies commit/build/release, environment/topology, exact MSJ, executed checks and outcomes, applicable packaged/target and permissions/provenance/numerical evidence, limitations/unsupported paths, truth level, remaining gaps and next dependency. A milestone label, historical CP pass, template, false checkpoint, or earlier subsystem evidence cannot establish SP acceptance.

Once accepted, the user-visible journey is protected during later SI work: reproduce any regression, record the failing accepted behavior, assign its canonical owner and repair it before claiming continued acceptance. Never redefine the earlier SP to hide a regression. SP-01–SP-06 are progressive milestones; SP-07 is a release-candidate milestone, not production certification. P14 remains final release authority.

## 1. Non-negotiable Super Intelligence principles

1. **Canonical donor policy governs implementation sourcing.** Reuse, import, adaptation, modification, combination, wrapping, extension, substantial/full subsystem reuse and new implementation decisions follow `LIOS_DONOR_IMPORT_REUSE_POLICY.md` only.
2. **Capability ownership and implementation source are different questions.** A LiOS-owned contract may be substantially donor-implemented without creating a second product authority.
3. **Do not evaluate donors only by their original product purpose.** A donor built for another domain may contain complete subsystems, components or mechanisms that can be transformed into valuable LiOS capability.
4. **Canonical LiOS authorities remain singular.** Donor implementation must integrate behind or through existing LiOS state, permission, Artifact, entity, engine, agent/tool and runtime contracts unless an explicit architecture decision changes those authorities.
5. **Cross-capability composition is the product advantage.** Browser + agent + memory + Python + finance engine + spreadsheet + report + automation + devices should compose into one user request when appropriate.
6. **Conversation is the primary interface, not the architecture.** LiOS may contain deep internal systems while presenting a simple conversational experience.
7. **Deterministic engines remain authoritative for material quantitative calculations.** AI orchestrates, interprets, challenges and drafts; it does not silently replace deterministic financial truth.
8. **No fabricated data.** Missing, unavailable, ambiguous, stale, unentitled or inaccessible information must be explicit.
9. **User-owned runtime remains locked.** LiOS operates no normal customer intelligence/data runtime cloud. Desktop Local / LiOS Home is default; users may move Home to their own NAS/server/VPS/cloud.
10. **Zero-manual-install is the normal experience.** LiOS provisions and verifies internal dependencies. Heavy optional assets require explicit user-visible size/rights/consent.
11. **Finance is the first deep proving ground, not a separate architecture.** The Finance blueprint expands capabilities inside SI-03–SI-07 while reusing the same runtime, evidence, Artifact, entity, engine, action, automation and device fabrics.
12. **Release truth is continuous.** Security, permissions, numerical correctness, provenance, persistence, restore, failure handling, performance and packaging are tested throughout SI-01–SI-07.

---

# 2. Donor-policy precedence and implementation sourcing

## 2.1 Sole donor-use authority

This plan deliberately contains **no separate donor decision sequence**.

For every SI workstream, implementation sourcing must follow:

> `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`

That policy already requires reuse before unnecessary rewrite, permits substantial/full subsystem reuse where appropriate, supports adaptation and cross-donor combination, preserves licensing/provenance, and keeps LiOS architectural authorities canonical.

OpenClaw/Goldmine remains highly relevant to runtime, Gateway, nodes/devices, agents, tools, skills, MCP, plugins, browser/computer-use, coding, local models, automation, recovery, diagnostics and other capabilities. Those examples are **not a boundary**. If OpenClaw provides a stronger suitable implementation for a Finance-facing or other capability, it may be reused or adapted under the canonical donor policy. Likewise, another approved donor may provide platform/runtime capability if it is stronger and compliant.

## 2.2 Donor research and evidence

Existing donor registries, CA workstreams, pinned-source provenance and donor analysis remain valid supporting evidence. For significant reuse, agents should record the upstream source/version/path, license, selected subsystem/mechanism, LiOS destination/owner, material modifications and validation evidence as required by the canonical donor policy and relevant task contract.

Current-upstream documentation is research evidence, not proof that a capability exists in the pinned donor source. Where upstream differs from the pinned source, the implementation task must explicitly choose and evidence the appropriate path, such as selective backport, approved donor update, adaptation, alternate donor, LiOS-native implementation or defer-with-trigger.

## 2.3 No accidental policy drift

Issue comments, temporary prompts, Finance documents, OpenClaw reference matrices, task descriptions and PR comments must not silently redefine donor strategy. Any material donor-policy change must be made explicitly in the canonical donor policy itself.

---

# 3. Seven-phase Super Intelligence execution

## SI-01 — Super Intelligence Foundation

### Mission

Build the secure, user-owned operating substrate on which every later intelligence capability depends.

### Primary canonical scope

Mainly `GM-00` through `GM-11`, including already-merged foundations and remaining authority/security work.

### Workstreams

- **SI-01.01 — Donor provenance and subsystem inventory:** maintain exact donor pins, licenses, imported/adapted paths, upstream tests and notices where applicable.
- **SI-01.02 — LiOS Home:** one zero-configuration local runtime with canonical data root, storage, database, secrets, execution, Gateway and services.
- **SI-01.03 — Runtime provider seams:** Desktop Local first, while preserving migration to user NAS/server/VPS/cloud.
- **SI-01.04 — Database portability:** PGlite default; user PostgreSQL as advanced target; migration/relocation without changing product identity.
- **SI-01.05 — Storage fabric:** local files, user storage/object providers, safe path ownership and integrity.
- **SI-01.06 — Encryption and secret ownership:** SecretRef authority, OS-protected secrets, no secret leakage into prompts/logs/Artifacts.
- **SI-01.07 — Backup/restore/Home migration:** complete user-owned portability and recovery.
- **SI-01.08 — Gateway:** canonical local/remote protocol and capability communication using approved donor mechanisms where useful.
- **SI-01.09 — Device trust fabric:** identity, pairing, discovery, trust, revocation and node capability advertisement.
- **SI-01.10 — Execution kernel:** jobs, processes, PTY/backend execution, streaming, timeout, cancellation, reconnect and lifecycle.
- **SI-01.11 — Execution authority:** exact-operation permissions, sandboxing, policy, approval and trust receipts.
- **SI-01.12 — Isolation boundaries:** Python, browser, document processors, finance packs and risky tools isolated from core state.
- **SI-01.13 — Resource controls:** CPU/RAM/storage/time bounds, graceful degradation and hardware-aware safety.
- **SI-01.14 — Execution receipts and observability:** what ran, why, where, with which permission and result; diagnostics without secret leakage.
- **SI-01.15 — Offline baseline:** useful deterministic/local capability without LiOS-operated infrastructure.
- **SI-01.16 — Zero-setup dependency provisioning:** package/download/verify/activate/rollback internal components.
- **SI-01.17 — Canonical authority convergence:** no donor may introduce a second router/runtime/permission/state authority unintentionally.

### Acceptance

A clean Desktop Local install can perform:

> request → governed exact operation → canonical execution → streamed state → result → trust receipt → persistence → restart → restored state

without a LiOS-operated customer runtime server.

---

## SI-02 — Agentic Intelligence

### Mission

Turn SI-01's secure runtime into an intelligent operator that can plan, use tools, act, recover and complete multi-step work.

### Primary canonical scope

Mainly `GM-12`, `GM-13`, `GM-14`, `GM-20`, supported by `GM-10/11` and approved donor implementations under the canonical donor policy.

### Workstreams

- **SI-02.01 — Canonical agent runtime:** goal → plan → act → inspect → revise → complete.
- **SI-02.02 — Governed tool layer:** tools exposed through one LiOS permission/runtime authority.
- **SI-02.03 — Planning/decomposition:** bounded multi-step planning and dependency ordering.
- **SI-02.04 — Action policy:** automatic vs approval-required vs prohibited operations.
- **SI-02.05 — Retry/recovery:** idempotent retry semantics and side-effect protection.
- **SI-02.06 — Checkpoint/resume:** durable recovery for interrupted long workflows.
- **SI-02.07 — Cancellation:** reliable user stop for tasks, agents and subjobs.
- **SI-02.08 — Delegation:** specialized subagents/tools without losing canonical Project/Chat/Artifact context.
- **SI-02.09 — Multi-agent coordination:** bounded parallel work with shared evidence and explicit ownership.
- **SI-02.10 — Coding intelligence:** Codex/ACP-style repository understanding, editing, debugging, test execution and patch review.
- **SI-02.11 — Python/data execution:** governed scientific/data/quant execution.
- **SI-02.12 — Shell/PTY intelligence:** trusted command execution behind canonical execution authority.
- **SI-02.13 — Browser intelligence:** web navigation, retrieval, download and workflow automation.
- **SI-02.14 — Computer-use intelligence:** controlled GUI interaction where APIs/connectors are absent.
- **SI-02.15 — Session placement:** local desktop, user Home, remote node or user cloud based on policy/capability.
- **SI-02.16 — Skills:** reusable procedures and domain skills behind P13/GM authority.
- **SI-02.17 — MCP convergence:** MCP capabilities behind canonical tool/permission/runtime contracts.
- **SI-02.18 — Agent receipts:** concise visible action/tool/source/assumption records without chain-of-thought exposure.
- **SI-02.19 — External side-effect safety:** exact authorization, idempotency and reconciliation patterns for consequential operations.
- **SI-02.20 — General-purpose capability:** agent infrastructure must remain useful beyond finance.

### SI-02 closure contracts for downstream Finance

Before SI-02 closes, verify that the generic platform contracts are sufficiently stable for later Finance capabilities without implementing the Finance vertical early:

1. canonical tool/capability descriptor including side-effect class, policy, placement and receipt metadata;
2. generic action lifecycle covering proposal, validation, authorization, preparation, execution, confirmation and reconciliation;
3. durable idempotency/reconciliation protection against duplicate consequential effects;
4. bounded delegation/parallelism contract;
5. Skill/MCP/plugin publication contract behind canonical registries;
6. placement/capability contract for node/device/environment-specific capability;
7. agent receipt contract for compact model/tool/source/action evidence;
8. consequential-action policy contract supporting stronger approval/revalidation later.

SI-02 does **not** need Bloomberg, brokerage, private-market, wealth, credit or other Finance-specific integrations to close.

### Acceptance

LiOS can complete a bounded task such as:

> research a company → obtain evidence → run permitted calculations/code → inspect failures → revise approach → create a persistent result

while keeping every privileged action governed and traceable.

---

## SI-03 — Knowledge, Memory & Research Intelligence

### Mission

Give LiOS durable context, evidence discipline, search/retrieval depth and research intelligence.

### Primary canonical scope

Mainly `GM-14`, `GM-19`, `GM-20`, plus CA/P5/P7 document/data/entity capabilities and the Finance F1–F4 research/evidence requirements.

### Workstreams

- **SI-03.01 — Durable memory:** long-lived user/project memory distinct from live Working Context.
- **SI-03.02 — Dreaming/reflection assimilation:** derive useful durable summaries/patterns under user control.
- **SI-03.03 — Memory inspect/correct/delete:** memory must be observable and correctable.
- **SI-03.04 — Project knowledge:** files, conversations, Artifacts and research retrievable as governed context.
- **SI-03.05 — Cross-project retrieval:** permission-aware retrieval only where explicitly allowed.
- **SI-03.06 — Hybrid retrieval:** semantic, lexical, structured and entity-aware retrieval.
- **SI-03.07 — Web research:** search/browse/collect/compare/cite public evidence.
- **SI-03.08 — Deep research orchestration:** research plans, source diversity, evidence gaps and bounded continuation.
- **SI-03.09 — Evidence ledger:** source, time, excerpt/field, transformation and downstream usage.
- **SI-03.10 — Provenance:** important outputs traceable to source data or explicit inference.
- **SI-03.11 — As-of/freshness semantics:** distinguish retrieval time, observation time and model period.
- **SI-03.12 — Contradiction detection:** conflicting facts/data surfaced, not silently flattened.
- **SI-03.13 — Source quality:** authority/first-party/secondary/community distinctions where useful.
- **SI-03.14 — Entity intelligence:** company/security/listing/instrument/person/entity resolution behind P5.
- **SI-03.15 — No-ticker/private entity research:** useful research without fabricated identifiers or quotes.
- **SI-03.16 — Document intelligence:** PDFs, filings, reports, contracts, spreadsheets, presentations and text.
- **SI-03.17 — Structured extraction:** tables, sections, units, relationships and financial structures.
- **SI-03.18 — Timeline intelligence:** events, filings, decisions, transactions and changes over time.
- **SI-03.19 — Thesis/counter-thesis:** supporting evidence, counter-evidence, risks and open questions.
- **SI-03.20 — Research branching:** alternate hypotheses without contaminating canonical state.
- **SI-03.21 — Known/unknown model:** explicit uncertain, inaccessible, unavailable, stale and unentitled states.
- **SI-03.22 — Research Artifact:** durable evolving research output with citations and revisions.
- **SI-03.23 — Universal Provider & Entitlement Fabric:** normalize capability, authentication/SecretRef, entitlement, freshness, restrictions, locality, AI-transmission rights and unavailable states across public, premium, internal and user-owned sources.
- **SI-03.24 — Financial Event & Relationship Intelligence:** first-class earnings, filing, guidance, recommendation, corporate-action, financing, deal, rating, macro/policy and regulatory events plus relationship/impact graph context.
- **SI-03.25 — Broker / Expert / Internal Research Composition:** combine permitted external research, expert content, user files and proprietary/internal research while preserving entitlement and source identity.
- **SI-03.26 — Numerical Evidence Lineage:** trace material values from provider/document/field/period through normalization/transformation into model/output usage.
- **SI-03.27 — Living Investment Thesis:** persistent claims, counterclaims, evidence, assumptions, confidence, catalysts, risks, invalidation conditions and changed-since-last-review state.
- **SI-03.28 — Filing / IR Change Intelligence:** filing, transcript, presentation and disclosure comparison with material-change extraction and historical context.
- **SI-03.29 — Estimates / Recommendation Evidence:** analyst identity, estimate/rating/target revisions, consensus inputs and historical evidence without hiding source differences.
- **SI-03.30 — Alternative & Private-Market Evidence Adapters:** permitted alternative/private evidence normalized into the same provenance/entitlement/entity fabric.

### Acceptance

LiOS produces evidence-backed research in which users can inspect what is known, what is inferred, what conflicts, what is missing, where claims and important numbers came from, what changed over time, and how permitted provider entitlements affected the answer.

---

## SI-04 — Professional Work Intelligence

### Mission

Transform intelligence into persistent, editable, revisable and exportable professional work products.

### Primary canonical scope

P4 Artifact authority plus approved professional-output/rendering/model donors where suitable under the canonical donor policy.

### Workstreams

- **SI-04.01 — Canonical Artifact identity/versioning:** P4 remains the only Artifact authority.
- **SI-04.02 — Chat-to-Artifact:** convert useful results into structured living work.
- **SI-04.03 — Shared edit state:** direct manipulation and conversational edits modify the same underlying Artifact.
- **SI-04.04 — Revision history:** compare, restore, branch and reconcile work.
- **SI-04.05 — Spreadsheet intelligence:** import, inspect, calculate, revise, format and export.
- **SI-04.06 — Spreadsheet/editor donor integration:** use approved high-quality editing/rendering implementations behind P4 contracts where beneficial.
- **SI-04.07 — Large analytical tables:** scalable analytical views where fit is proven.
- **SI-04.08 — Chart intelligence:** interactive analytical visuals where appropriate.
- **SI-04.09 — Rich documents:** suitable editor implementation behind canonical Artifact state.
- **SI-04.10 — Professional reports:** research, consulting, investment and analytical reports.
- **SI-04.11 — Presentation generation:** PPTX with narrative, charts, tables and evidence.
- **SI-04.12 — XLSX generation:** production-grade spreadsheets and models.
- **SI-04.13 — DOCX generation:** professional document export.
- **SI-04.14 — PDF publishing:** reliable final/presentation/print path.
- **SI-04.15 — Citation preservation:** evidence survives into exported work products.
- **SI-04.16 — Engine-to-Artifact:** deterministic outputs become usable tables/charts/models.
- **SI-04.17 — Artifact-to-engine:** Artifact data can feed governed analytical engines.
- **SI-04.18 — Template intelligence:** reusable structures without module/template maze UX.
- **SI-04.19 — Round-trip integrity:** import → edit → export → reopen with minimal semantic loss.
- **SI-04.20 — Multimodal composition:** text, tables, charts, images and structured data in one work product.
- **SI-04.21 — Professional styling:** coherent layouts, typography and data presentation.
- **SI-04.22 — Agent-maintained work:** agents update existing Artifacts instead of recreating them.
- **SI-04.23 — Decision Object Artifact:** persistent objective, evidence, assumptions, alternatives, scenarios, recommendation, dissent, approval, action, outcome and follow-up.
- **SI-04.24 — Source-Linked Financial Model Cells:** material model values can retain source/period/lineage metadata where available.
- **SI-04.25 — Financial Model Maintenance / Update Engine:** update reported periods and source-linked actuals while preserving formulas and user assumptions.
- **SI-04.26 — Model Change / Restatement Report:** show what source/model cells changed, why, and which downstream outputs moved.
- **SI-04.27 — Finance-Grade Office Round Trip:** preserve useful semantics across XLSX/PPTX/DOCX workflows and refresh/reopen cycles.
- **SI-04.28 — IC / Credit / Deal Memo Workflows:** evidence-backed institutional decision packages from canonical data/models.
- **SI-04.29 — Banking Pitch / Board Materials:** professional transaction/corporate-finance presentation workflows.
- **SI-04.30 — Advisor / Client Proposal & Reporting:** current-vs-proposed, portfolio/goal context and branded client work products.
- **SI-04.31 — Review / Annotation / Collaborative Decision Package:** comments, review state, approvals and revision history without creating a second collaboration authority.

### Acceptance

LiOS can take evidence/data/calculations from conversation and produce a professional spreadsheet/document/report/presentation that remains editable, versioned, cited, source-aware where available, exportable and reopenable without silently destroying formulas, assumptions or review history.

### SI-04.02 implementation boundary (#460)

Successful Project Conversation Runtime Artifact drafts automatically enter the existing P4 store before the saved-output event and completed result. Ordinary text responses are not promoted. Cancelled and approval-paused attempts do not auto-retain drafts.

Retention binds owner, organization, Project, request and draft identity. Concurrent replay creates one initial version, interaction receipt and Ledger event; a changed payload under that identity fails instead of replacing prior work. Recorded sources, execution receipts and the completed run's TrustManifest survive retention and database reopen. The saved event carries the canonical Artifact/version reference, updates Working Context and invalidates the existing Artifact view.

Quick and Temporary outputs remain ephemeral. Explicit **Keep in Project** uses the existing destination preview; it does not move the conversation or silently select a Project. Persistence refusal visibly fails the run and never emits a saved-output claim.

This reuses Conversation Runtime normalization and P4 transactions, versions, receipts and Ledger authority. No donor store, retention table or second Artifact identity authority is introduced. Focused native runtime/store and isolated renderer proof establish this enabler; they do not qualify SP-04 or replace packaged Shipping Point acceptance.

### SI-04.02 refresh provenance follow-up (#462)

Automatic retention preserves the existing validated conversation refresh specification: source scope, execution mode, message, selected referent and completed-plan capability IDs. Draft sources, capability references and final TrustManifest dependencies enter the existing P4 dependency resolver. The normalized refresh specification participates in immutable retention replay identity; changed replay metadata cannot silently replace prior work.

Native proof exercises a saved report's governed rerun after database reopen and an explicit same-Artifact version save, retaining immutable v1 and fresh v2 receipts. The version-save bridge returns the Artifact/version detail expected by its existing client rather than a bare version row. Refresh does not automatically replace the original head. Existing replay metadata does not capture personal-finance profiles, approvals, attachments or arbitrary runtime state; missing structured inputs remain an explicit data gap.

Donor disposition: direct reuse/extension of canonical P4 refresh contracts, dependency resolution, version transactions and TC/P5 report assembly. No external code import, new dependency, runtime or retention authority. This is SP-04 enabling behavior, not packaged SP-04 acceptance.

### SI-04.11/.15 evidence-preserving publishing (#463/#464)

Document-like `research`, `report`, `decision` and `thesis` Artifacts share one client semantic/evidence projection across Markdown, PPTX, DOCX and PDF. Markdown preserves recorded citations, claim posture, source/evidence references and Artifact/version/hash lineage as literal metadata; unsafe evidence URLs are not activated as generated links. PPTX publishes readable semantic sections and an evidence appendix rather than the former generic Artifact JSON table. Long content continues across bounded slides; oversize documents fail visibly without partial export.

Donor disposition: adapt/combine the existing LiOS DOCX/PDF projections and OOXML PPTX writer; directly reuse installed MIT `fflate` 0.8.3 (`src/package-lock.json`, npm tarball integrity pinned). No upstream source modification, dependency addition or new P4/citation authority. Existing notice/packaging paths remain unchanged. Registered `python-pptx` and `python-docx` remain challenger/fallback candidates under the Foundation donor map if a measured Office fidelity requirement defeats this path; no Python Office runtime is installed for this change.

Native proof: canonical P4 creation and database reopen produced a real export plan; Chromium downloaded Markdown/PPTX via the actual dispatcher. Reopened PPTX contained six semantic slides with exact source, Artifact ID and content hash and no JSON fallback. macOS Quick Look rendered the downloaded PPTX title slide. This establishes generated-byte and native-preview behavior, not full PowerPoint editing fidelity or packaged SP-04 acceptance.

### SI-04.03 shared edit convergence

The built-in document editor edits individual canonical blocks instead of flattening and reconstructing them. Block IDs, types, citation attributes and report section membership survive text edits. Direct saves and reviewed conversation proposals use the same P4 head/version transactions; stale direct saves return an explicit conflict. Native renderer plus real P4 HTTP/embedded-Postgres proof exercised direct v2 save, conversation proposal acceptance into v3, stale-v2 rejection (409), reload, comparison and undo into immutable v4.

Donor disposition: reuse existing P4 native document editor and version/proposal authority; no new editor/store/runtime. Optional rich-editor donors remain a separate measured editing-depth decision. This bounded convergence is not packaged SP-04 acceptance.

### SI-04.04 selected revision restoration

The history inspector restores an explicitly selected earlier revision as a new P4 version. It carries that revision's content, sources, receipts, assumptions, trust, dependencies and refresh metadata; prior versions remain immutable. The caller binds the observed head version, and a moved head fails closed rather than overwriting newer edits. Existing one-step Undo delegates to the same restore implementation. Native UI restore-v1-as-v3 and reload proof passed; focused real-database stale-head/foreign-owner/lineage checks and TypeScript passed.

Generic direct-fork reconciliation now reuses P4 reviewed proposals and the P8 lineage-recording pattern. The branch's immutable fork point is the common ancestor. Non-conflicting top-level fields merge into a proposal; compound fields remain one review unit, and fields changed on both sides require explicit current/branch choices with bounded value previews and visible truncation. Acceptance binds the observed target head; unrelated/cross-Project branches and unknown conflict choices are denied. Source/target immutable versions and content hashes enter P3 lineage. Metadata removal requires an explicit content revision rather than silently discarding it. Native history UI conflict inspection → choice → proposal → acceptance → reload proof passed.

### SI-04.05/.12/.19 uncached formula round-trip repair

Native XLSX → P4 → Univer reviewed A2 edit (100 → 200) → recalculation (C2 = 230) → revision save → UI XLSX download → reload retained both sheets, formulas, percentage format and text code `007`. That journey exposed SheetJS's numeric-without-value serialization as an Excel error-typed formula. Export now emits a valid formula with no fabricated cache, and both canonical import paths retain uncached formula stubs. Formula XML and canonical reimport regressions cover the repair. This does not claim unsupported workbook features or complete Office styling fidelity.

### Full SI-04 completion gate (#468)

Owner requires all 31 listed workstreams completed, not just a six-item convergence subset. Bounded completion receipts above do not certify remaining workstreams. Audited remaining gaps include rich styling, interactive charts, multimodal report composition, source-linked spreadsheet cells, preserved-formula actuals updates, downstream restatement reports, Decision approval/dissent/outcome/follow-up, and complete IC/credit/deal, banking/board and advisor workflows. Finish each under its canonical owner with native evidence; qualify packaged SP-04 afterward. Foundation Lock additionally requires accepted SP-01, SP-02 and SP-03.

### SI-04.07 analytical table paging (#471)

Canonical TableArtifact and DataArtifact surfaces render at most 100 rows per page with accessible Previous/Next controls and exact recorded values. Counts distinguish shown rows, available rows and the reported source total. Inline previews never pretend to contain unrecorded source rows. Identity/version changes discard pending query updates; query refusal preserves the displayed page and exposes Retry.

The P4 data-query bridge now forwards offsets to existing tenant-isolated DuckDB/Parquet scans. Immutable physical row order breaks date ties, while aggregate statistics and filtered available-row counts cover the full query, not just the sample. Native proof exercised a 50,000-row Table's next/previous pages, a 250-row preview reporting 10,000 total rows, end-of-preview, server query, stale-response discard and refusal/retry. Real Parquet tests traversed all 525 tied-date rows without repeats, filtered totals, end pages and foreign-tenant denial. Existing native table/DuckDB paths are reused; Perspective remains a challenger for future measured pivot/interactive analytical depth, not another store.

### SI-04.08 canonical chart intelligence (#473)

The P4 chart surface now lazily reuses installed MIT Recharts 2.15.4 and existing shared-axis/tooltip panel conventions for line, area, bar and scatter. Exact union-X alignment preserves signed values and explicit gaps; unsupported types, duplicate same-series X values and invalid numerical data fail visibly rather than falling back to bars. One full-source Y range remains stable across series visibility changes and 250-X-position windows. No sampling, invented zero, interpolation or per-series normalization is applied.

Keyboard point inspection, exact hover values, local series visibility and bounded Previous/Next windows operate on the recorded canonical data. Chart-type previews save through the existing head-bound P4 version API; failed saves remain visible and do not claim success. Renderer preferences and uninterpreted options stay recorded and disclosed. Native ArtifactPane/PGlite/HTTP proof exercised sparse values -2500 / gap / 2500, stable shared domain, viewport paging, four render types, keyboard gap inspection and saved bar configuration after reload. Twelve projection regressions and TypeScript passed. No new dependency, store or chart authority; ECharts/lightweight alternatives remain measured-depth choices.

### SI-04.09 canonical rich documents (#475)

Registered MIT Tiptap OSS is activated as a lazy local editing projection, packages pinned to 3.31.4 / upstream `d9af9c6a16e17438b06b2266765b9c1a21a3d7a0`. Canonical P4 block IDs, types, unknown attributes, citations and report sections remain authoritative. Inline bold/italic/underline/code/link formatting is recorded as bounded coherent UTF-16 ranges in `attrs.richText`; stale ranges cannot format unrelated edited text. Opaque table/callout/chart/reference blocks retain their payload and identity rather than flattening.

Native pinned-editor → P4 save → reload proof retained bold markup, original block IDs, custom metadata, quote source/hash, reference and section anchors. The explicit built-in editor preserves unsaved drafts. A newer server revision while dirty shows a conflict, keeps local text and blocks save until explicit reload. A refused save keeps local formatting and reports failure without success. Sixteen mapping/bridge regressions, TypeScript, zero-warning OSS registry audit and production build passed. No Tiptap cloud, paid extension, collaboration service or second document store; full professional styling/export fidelity and packaged SP-04 remain separate workstreams.

### SI-04.10 source-preserving professional reports (#485)

Existing P5 report assembly and eight report templates now share one semantic block projection instead of whole-Artifact JSON code sections. Authored narrative remains authored; metrics, assumptions and recorded values become named readable fields/tables. Exact decimal text, recorded column labels/order, source-version references, receipts and reconciliation metadata are preserved without analytical recalculation. Missing sections and unavailable charts are explicit, not invented.

Typed canonical table payloads render as bounded read-only rich document tables; unknown/nonfinite legacy payloads retain their original caption/attributes with a warning. The shared Markdown/PPTX/DOCX/PDF paragraph projection exports every recorded table row within existing bounds. Native governed Project report creation → P4 retention → rich table → MD/DOCX/PPTX download/reopen → reload retained exact authored values `9007199254740993.25` and `10000000000000000.5`, source version and execution receipt. Forty server/runtime checks and 52 view/export checks passed. Native Office tables/charts and full presentation fidelity remain the following .11/.27 work, not falsely claimed by readable paragraph exports.

### SI-04.11 native Office presentation generation (#487)

Supplemental MIT PptxGenJS 4.0.1 is reused behind existing P4/export projections (upstream `3c9ec1b687c174952166f6a34b5e87ebf69fa469`; historical 92-donor count unchanged). Recorded document tables become editable native Office tables with bounded row/column continuation. Recorded chart payloads and direct ChartArtifacts become editable line/area/bar/scatter charts plus embedded XLSX, preserving signed values, genuine zero and absent observations as gaps. Unavailable chart references stay explicit and never trigger remote fetching. Narrative, exact decimal text, citations, Artifact/version/hash/source/receipt appendices remain recorded.

Actual donor defects required boundary adaptations: zero-valued workbook cells are passed as exact numeric literals; empty numeric-cache observations are omitted; category labels use a category axis rather than date interpretation; process-global chart counters are normalized into package-local part names with matching OPC references. Outer and embedded ZIP/core timestamps are normalized, preserving deterministic bytes. Native browser report export contained 16 slides, nine native tables, a chart and embedded workbook with the final exact high-precision cell; direct chart export retained negative/zero/gap data. macOS Quick Look opened the generated PPTX. Async generation and stale-version/download errors propagate through the actual export UI; no false success or new presentation store.

### SI-04.12 production XLSX continuity (#491)

Existing SheetJS/Univer/P4 bridges retain real sheet-scoped names, formulas, active worksheet and automatic/manual calculation metadata through both trusted and isolated import snapshots. Named ranges register in Univer's actual defined-name resource and survive donor save/reopen. Unsupported ambiguous/formula/external names fail explicitly; skipped print/filter metadata is disclosed rather than silently dropped.

Number formats never authorize rounding exact source text: explicit `@`, numeric-looking codes and values beyond Excel's 15-digit precision remain text in both editor projection and XLSX generation. Formula caches are not invented. Actual export-plan ID/version/hash/source references enter a collision-safe, clearly labelled metadata-only provenance worksheet. Native imported Revenue named-formula calculation displayed 115; P4 save/download/reopen preserved exact `9007199254740993.25`, `007`, formula, local name, number format, active Inputs worksheet and provenance. Twenty-two real workbook/resource/worker-boundary regressions and TypeScript passed. The host worker test is serialization proof, not sandbox-enforcement qualification; comprehensive Office styling remains .21/.27.

### SI-04.13 native rich DOCX generation (#494)

The existing deterministic OOXML/fflate writer now consumes the common typed document projection. Recognized tables become editable `w:tbl` with every recorded row, repeating headers and page-bounded widths; exact decimal strings are not converted. Coherent canonical rich runs become native bold/italic/underline/strike/code and safe recorded hyperlinks, with actual heading levels, list numbering/restarts, quotes and code styles. Source/version/hash/citation/receipt metadata and unknown attrs remain preserved; invalid XML/layout/runs fail visibly.

Native ArtifactPane DOCX download/reopen contained one native table with 152 rows (header + all 151 source rows), repeating header, exact last-cell `9007199254740993.25`, native bold/italic/underline and citation reference. macOS Quick Look rendered the rich document and table. This reuses existing P4 and serialization authorities without a new dependency/document runtime; Python-docx remains an optional validation challenger, not an assumed installed runtime.

### SI-04.14 reliable rich PDF publishing (#497)

Existing jsPDF/autotable now consumes canonical typed items for complete paginated tables and coherent rich text. Recorded chart payloads and direct ChartArtifacts publish signed line/area/bar/scatter vector charts with explicit gaps, actual numeric X spacing, categorical type labels and stable full-source Y domain; all observations are represented or oversized/unsupported input fails. No image capture, remote source resolution, interpolation or fabricated zero is used.

Native report/direct-chart PDF downloads reopened with the exact final table cell, source/version/hash and signed graph labels. The report's 151 rows span repeated-header pages with Page X of N furniture; macOS Quick Look rendered the rich table document. Actual parsed font-width overflow exposed jsPDF rounded-metric underestimation; conservative per-glyph fit and batched same-format runs now preserve long text within page margins. Unsupported standard-font glyphs fail explicitly instead of transliteration/corruption. Forty-four focused PDF/export checks and TypeScript passed; no new dependency or publishing authority.

### SI-04.15/.16 citation custody and engine workbooks (#501)

Cross-format retention/citation coverage was re-exercised across canonical P4, Markdown, native DOCX/PPTX and PDF: 65 checks passed, supplementing the actual export/reopen journeys above. Integrated model runs now explicitly retain into a selected owned Project via the existing deterministic P4 keeper. Actual run owner, current role/org, Project ownership, snapshot tenant boundary and linked current display/derived-output/export rights are checked before source projection; missing rights fail closed.

The nine-sheet canonical workbook records assumptions, history, forecast statements/schedules, checks and exact run/dataset/hash/source identity without recalculation, inferred decimal evidence or fabricated execution receipts. Concurrent repeats return one initial Artifact/version/P4 receipt/Ledger entry. Model Studio's explicit destination/save/open uses the actual returned P4 identity, and delayed earlier-run saves never claim to belong to the current result. Native authored snapshot → actual production engine POST → Project retention → ArtifactPane → XLSX download/reopen showed all nine analytical/provenance sheets plus export metadata. Sixteen actual DB/HTTP/consumer-state checks and TypeScript passed. Broader legacy global model-run readers are not certified by this bounded new endpoint.

### SI-04.17 reviewed Artifact-to-engine inputs (#503)

Integrated-model workbooks feed only their declared schema-backed assumption and schedule cells into the existing deterministic engine. Review binds the saved head/version/content hash, actual source run/snapshot/policy, normalized inputs and canonical engine revision. Blank/formula/unknown/duplicate/inexact inputs and invented null/empty schedule context are denied. Historical/forecast edits remain derived workbook content, never inferred engine inputs.

Explicit Run rechecks the review and current source rights before computing. It saves an actual owned run and a new canonical P4 output with the original Artifact@version in existing lineage; source work is not silently replaced. Replay is deduplicated, and foreign global saver identities fail closed rather than adopting ownership. Native reviewed revenue-growth edit 0.05 → 0.2 produced actual forecast revenue 1200, left source v3 intact, and opened the new output Artifact. Thirty-four real DB/HTTP/review-state checks and TypeScript passed. No provider refresh, host authorization or second execution/approval store is introduced.

### SI-04.18 contextual template intelligence (#505)

The existing eight reportEngine templates remain the only catalogue. Artifact-context requests carry the explicitly chosen structure through planning, report title/template/order and receipt hashes/evidence; kind defaults remain recommendations. Conflicting or unknown explicit choices fail visibly. An active-Artifact template request routes only to the source-preserving report assembler, not company/provider research, ticker lookup or analytical recalculation.

ArtifactPane's catalogue-backed Report structure control stages the existing My Data/deterministic composer request for user review; it does not send or execute. Preparation displays the observed source revision/hash, while sending rechecks and records the actual current source version. Native Risk Report selection → prepared unsent request → explicit send → production Project runtime → canonical P4 report returned `risk_report`, exactly one `research.report` capability and the source@version/decimal value intact. Fifty-two catalogue/planner/runtime/choice checks and TypeScript passed; no new template registry/store or module maze.

### SI-04.19 genuine Office return integrity (#507)

Native DOCX/PPTX exports carry bounded standard OPC custom XML source custody and deterministic bindings to actual Word bookmarks, PowerPoint paragraph/table slices, chart caches and embedded workbooks. Return reads the native parts—not a restoration of embedded source that ignores Office edits. Unchanged canonical IDs, types, attrs, section anchors, citations, truth and exact scalar types survive; modified quotations/claims become explicitly user-authored, and changed table cells lose stale numerical evidence bindings.

The local ZIP/XML reader rejects unsafe paths, macros/active content, DOCTYPE/entities, ambiguous parts/bindings, unsupported structures, external non-link relationships and declared/actual expansion overruns. Home rechecks the owned immutable source content hash, observed head and linked rights, then stages the existing P4 proposal for explicit acceptance. Native UI exported files, edited real Word/PowerPoint text and table cells while leaving custody metadata unchanged, uploaded/read/inspected/staged/accepted them, and reopened canonical v2/v3 with actual edits and original quoted source/hash/exact decimal intact. Fifty-two reader/writer/Home checks and TypeScript passed. Unknown non-LiOS Office files and unsupported structural edits are explicit, not false round-trip success; PDF remains final publication.

Read-only parser review identified a concrete numeric-string binding-index bypass that could preserve stale source-backed edit claims. Array traversal now requires numeric indices, object traversal string keys, and all bindings pass a canonical editable-field allowlist before edits. Home independently derives changed quotation/claim provenance from the owned immutable baseline, regardless of file-supplied paths or claims. Both actual-format tamper regressions and server-side forged-source-backed edit cases cover the correction; the focused reviewer confirmed no surviving finding in that assigned boundary.

### SI-04.20 canonical multimodal composition (#509)

Explicit Project-source selection captures immutable owned table/chart/Artifact versions and bounded PNG/JPEG attachment bytes into reviewed report/research append proposals. Caption provenance remains user-authored; captured source versions/hashes enter canonical P4 version dependencies and P3 lineage. Image signatures, stream structure, SHA-256, dimensions and 1 MiB individual / 3 MiB aggregate limits are enforced; current linked source rights are rechecked at capture and acceptance without chasing moving/deleted source attachments.

One rich work product displays authored text, exact tables, a read-only captured graph and local image. PPTX, DOCX and PDF embed real local media and recorded charts, preserving aspect/capture hash and source evidence; no remote image/HTML/SVG fetch or second asset store. Office return validates actual media bytes/geometry and readonly Word chart caches, rejecting modified/unbound/external pictures rather than restoring stale embedded source. Native UI selected/reviewed/accepted chart → table → image into v4, displayed a 64×32 image and signed graph, and reopened Word/PPTX media with identical SHA-256 plus native chart/table parts and exact decimal cells. Eighty-four capture/custody checks, 83 exporter/projection checks, TypeScript and production build passed.

### SI-04.21 coherent professional presentation (#511)

Existing Tiptap/Word/PowerPoint/PDF renderers now distinguish semantic title/headings, body, quote, code and subdued provenance, with readable leading and heading/following-content reservations. Declared numeric columns align numerically without parsing or modifying literal strings; contrasting repeat headers, zebra rows, cell padding and bounded table pagination retain complete data. The rich document has constrained readable prose width and keyboard-accessible, sticky-header table scrolling at narrow widths. No style store, second renderer authority or dependency was added.

Actual UI displayed authored heading hierarchy, quote/code treatment, 12 rows and the exact `9007199254740993.25` cell; 414px viewport inspection proved horizontal overflow rather than hidden data. Native DOCX/PPTX downloaded and returned through Home as unchanged, with no new P4 proposal/revision. Actual two-page PDF raster/text inspection retained all 12 rows, declared numeric alignment, exact decimal and source refs. Styled heading/paragraph/blank-line/long-table custody and export suites passed 162 checks plus TypeScript; this is source/native presentation proof, not packaged SP-04 acceptance.

### SI-04.22 governed existing-Artifact maintenance (#513)

The existing agent catalogue exposes owned selected-target inspection and bound `lios.artifact.propose_update` operations. Working Context target refs remain out-of-band; P4 rechecks ownership/Project/current source rights, immutable version/hash and guarded scalar/appended edits. Bounded source inspection reaches the real agent observation channel with honest partial-snapshot metadata; captured media bytes are omitted. Source references, immutable captures, deterministic engine outputs and unrelated workbook formulas cannot be silently rewritten. Changed model prose/claims receive inference/open truth; historical source/receipt custody does not verify revised content.

Request/step/target identity is persisted through the existing P4 proposal primary key, with concurrent winner-only receipts/ledger entries, changed-payload rejection and accepted replay across head changes/database reopen. No new Artifact is created. P4 explicit acceptance advances the original identity and clears inherited current-content trust; prior versions retain historical trust. The existing native proposal review now shows actual bounded before/after paths, separately visible provenance changes, immutable base/current hashes and complete-content inspection; stale/unavailable bases disable acceptance.

Actual bounded agent-loop smoke, using a scripted model transport rather than claiming provider intelligence, produced one pending proposal and zero new output Artifacts, with head still v1 and private/no-fallback model calls. Native explicit review accepted revised recommendation into the same identity at v2, retaining the exact `9007199254740993.25` table cell and source ref. Forty-five maintenance/privacy/agent/Office/composition/revision checks plus TypeScript passed. Smoke services and scaffolds were removed; packaged SP-04 remains unaccepted.

### SI-04.23 persistent Decision Object lifecycle (#515)

Existing P4 Decision content now carries optional recommendation, dissent, authored actions/outcome/follow-up and existing case references. Optional root fields preserve historical immutable body hashes and package/Office source custody; empty defaults exist only in the native editor read projection. Complete native authoring retains exact/opaque assumptions, alternatives, scenarios and linked evidence, with conflict-aware revision saves. Authored statuses and action completion dates are not execution receipts.

Approval linkage reuses existing Decision cases/receipt versions/review rows, with exact owner/organization, current receipt/hash, real latest approval, completeness/assurance/expiry checks. A server-only version/body/source-bound interaction reference links an existing reviewed receipt; it does not approve the authored Artifact. Generic content/reference/package paths cannot mint or transfer that authority. Live server inspection detects body changes, replaced/revoked reviews and unavailable ownership; stale linkage is explicitly non-current. No new case/review/execution authority is created.

Native UI authored/saved/reopened recommendation, dissent, actions, outcome and follow-up under the same identity, retaining exact `9007199254740993.25` and nested assumptions. DOCX/PPTX reopened with all lifecycle fields; actual format edits preserve the independent reference-only approval semantics. A genuine canonical-table routine-waiver fixture exercised explicit link → WAIVED → authored revision → STALE → explicit clear → UNLINKED; this isolated fixture is not a real owner review. The observed JSONB key-order save acknowledgment bug was fixed with order-insensitive draft comparison while preserving actual conflicts. Sixty-eight lifecycle/receipt/maintenance/Office/UI-state checks plus TypeScript passed; production build passed before that narrow draft-state fix. Smoke services/scaffolds removed. Packaged SP-04 and Foundation acceptance remain separate.

### SI-04.24 source-linked financial model cells (#517)

Optional per-cell lineage binds present reported actuals to exact owned immutable dataset/period/canonical paths, forecasts to persisted run/result paths and resolved assumptions to their honest persisted-input origin. Initial server bindings are reprojected against owned source/run data; generic writes cannot mint trusted bindings. Exact captured raw/format/hash and bounded source/rights references remain historical after edits, with derived edited/unverified status rather than a live freshness or original-decimal claim. Historical raw/format-only snapshots and prior run retention remain unchanged.

Builtin/Univer adapters retain lineage, formula text, formats and sheet/cell identity. Native worksheet navigation preserves one local draft across sheets; source inspection shows exact capture/current values and paths. XLSX retains a visible, collision-safe per-cell appendix; existing bounded import downgrades declarations to unverified imported history, never owned current-source authority. Actual native engine retention, revenue inspection/edit/save v2 and forecast path inspection passed. Reopened native XLSX retained edited `1200.25`, captured `1000.125`, exact snapshot/run references and edited status. Sixty-four source/engine/input/donor/XLSX/import/worker checks plus TypeScript passed. Worker subprocess proof is not new sandbox qualification; finance-grade source reconciliation remains SI-04.27. Smoke services/scaffolds removed.

### SI-04.25 reviewed reported-period model maintenance (#519)

Explicit owned/licensed immutable snapshot selection and complete old/new reported-period review bind source hashes, current model head, user assumptions/schedules, engine revision and live rights. Existing P11 recalculates only from the reviewed canonical dataset and exact scalar inputs; formula engine inputs are refused rather than replaced by old assumptions. Existing P4 records one new version of the same model, preserving user formulas, raw overrides, custom sheets, formats and names while updating untouched actual/forecast bindings by semantic source paths. Unsaved draft and in-flight guards prevent silent editor loss or repeated apply.

Actual native review displayed the 2023 revenue restatement `1000.125 → 1010.25` and added FY2024 revenue `1120.5`; explicit Apply retained the same Artifact at v2 and preserved growth `0.075`. Thirty-five maintenance/engine/replay/rights/draft-state checks and TypeScript passed, including durable replay after subsequent revisions/database reopen. Review identity excludes the apply token itself; no auto-provider fetch, new Artifact, fallback inputs or new authority is introduced. Smoke services/scaffolds removed; packaged SP-04 remains separate.

### SI-04.26 recorded model change/restatement report

Explicit earlier/current immutable model version selection generates one replay-deduplicated P4 report with complete exact old/new values, reported actual versus downstream engine versus authored change categories, semantic period/metric paths and both source hashes. Current source rights and owned persisted run references are rechecked; no provider refresh, recalculation, inferred causation or execution receipt is fabricated. Native creation opens the retained editable/exportable report without replacing the source model.

Actual native version selection/create/open displayed `1000.125 → 1010.25`, downstream output rows and the no-recalculation method note. Direct producer smoke reopened real Word bytes preserving exact changes, unrelated formula and precision-sensitive text. Eleven real model/retention/report/rights/replay checks plus TypeScript passed. Temporary native fixture and scaffolds were removed.

### SI-04.27 source-bound financial Office return

Native XLSX return now complements existing genuine DOCX/PPTX return: the existing governed SheetJS importer parses uploaded files under current isolation policy, owned immutable workbook identity/version/hash and linked source rights. Analytical sheets/formulas/formats/scoped names and original precision-sensitive strings are reconciled against the actual recorded source; returned lineage cannot mint trusted bindings. Actual edits enter existing P4 review, not automatic acceptance or a replacement workbook. Renamed/new analytical sheets and unsupported charts/pivots/external links fail explicitly rather than being silently discarded.

Actual native XLSX upload → complete review → explicit Accept advanced the same workbook to v2 with `2.5`, formula `=A1*3`, format `0.000` and untouched exact text `9007199254740993.25`. Ninety XLSX/Word/PowerPoint source-custody checks and TypeScript passed. Existing no-field multipart limits remain unchanged; immutable source binding uses validated query fields. Local unsaved drafts block staging. Smoke scaffolds/services removed; this is bounded source-linked finance return, not unrestricted Office editing or packaged acceptance.

### SI-04.28 institutional IC/credit/deal packages

Explicit native workflow, audience, reporting period, authored recommendation and frozen owned source selection create replay-deduplicated P4 IC, credit or deal packages. Existing report templates/renderers retain exact source tables, charts, full model raw/formula observations, Decision/evidence records and source version/hash custody. Required analysis not present is disclosed as a data gap, never invented ratios, covenants, return scenarios, approval or execution. Native create/open for all three workflows retained exact `9007199254740993.25`; seven shared package/native Word custody tests plus TypeScript passed.

### SI-04.29 banking pitch and board materials

The same existing P4 source assembly supports explicitly selected banking pitch and board material structures, with authored engagement/board action, brand/audience/period context, alternatives/valuation/financial/risk sections and exact source appendices. Native create/open proved both source-backed workflows; existing native PPTX/DOCX/PDF publication stays authoritative. Absent valuation/fairness/financing analysis remains explicitly unavailable; assembly does not create a fairness opinion or board approval.

### SI-04.30 advisor/client proposals and reporting

Native client reports and proposals retain advisor brand, audience/client, reporting period and goal/portfolio/source context. Proposals require distinct explicitly selected current and proposed snapshots; no allocation, performance, suitability or client approval is inferred. Exact recorded sources and authored recommendations remain editable/exportable under P4. Actual native create/open passed both workflows, including current/proposed selection and precision-sensitive source text. Original source Artifacts remain unchanged. Shared assembly services/scaffolds were removed; these source-backed professional workflows do not establish packaged SP-04 acceptance.

### SI-04.31 recorded review/annotation and decision package

Version/hash-bound anchored annotations and attributed resolutions append to existing P4 interaction history and P3 lineage; original notes are never overwritten. Existing scope governs access, and only the original author can resolve their note. Comments do not approve content or authorize execution. A retained review package combines exact source content, complete recorded review history, current server-resolved Decision receipt linkage when applicable and version references without introducing a collaboration store or second approval authority.

Actual native note → resolution → create/open review package retained exact `9007199254740993.25`, annotation, resolved history and explicit no-approval disclaimer. Thirty-two review/model/package/Decision-authority checks, TypeScript and complete production build passed. All smoke scaffolds/services were removed; packaged Shipping Point and owner acceptance remain separate.

### SP-04 qualification prerequisite repair

The first integrated local gate reported high-severity transitive `image-size` parser infinite-loop advisories and a timed-out real terminal pipe pause/resume regression. The existing native image parser is overridden to fixed `2.0.4` without downgrading PptxGenJS; production dependency audit now reports zero vulnerabilities. The real stream regression uses a synchronously owned filesystem watcher rather than awaiting an aborted asynchronous iterator's return on macOS. Sixty-eight native exporter/terminal checks plus TypeScript passed. The interrupted full gate is not a pass; exact repaired-head V3/package journeys still require fresh evidence.

The repaired-head V3 completed server/client tests and production build but rejected a stale route manifest and obsolete P4/P8 source-spelling/exclusion assertions. The route inventory was regenerated (867 routes, 14 anonymously reachable, zero unprobed guards). Obsolete wording, component-name, donor-exclusion and source-copy checks were removed rather than repinned; active P4 review/retention/restore/merge acceptance now runs 29 real behavioral persistence/UI-state checks. P4/P8 acceptance, route/script manifests and the complete trust/security suite passed. This remains prerequisite proof, not packaged or owner acceptance.

Exact head `d19fd9ed` passed all 34 mirrored local-gate steps in 419s; five runner-only steps were skipped. Server offline tests passed 3297 with four explicit skips; client tests passed 1113. The resulting unsigned/ad-hoc macOS package `app.asar` SHA-256 was `84888d24235697b10022a14d3c627c19611ced21a4e7d191884afab11c530dcd`. Packaged SP-01 passed 9/9. Actual strict packaged XLSX import → review assumption edit → v2 → native export/reopen → cold app restart retained formula `=B1*(1+B2)`, assumption `0.09`, exact text `9007199254740993.25`, two revisions and import source hashes. Evidence: `/tmp/lios-sp04-d19fd9ed-evidence.json`. This is journey evidence, not owner acceptance.

SP-02 remains failed: the available real local `llama3.2:3b` emitted unavailable tool ID `ios.project.continuity`, and a separate configured-cloud-provider probe returned `not_configured`. No fake planner/publication substitute was used. Early launch timeouts were traced to selecting an installed image different from the actual packaged immutable digest; the harness now compares the embedded manifest before launch and retains CDP diagnostic errors. SP-03 probing exposed a real multi-instruction subject-precedence bug: the later phrase “Resolve its canonical entity” displaced Microsoft with ticker `ITS`. Command-style legacy symbol extraction is now anchored to the actual leading command; the canonical named-company resolver remains authoritative. Thirty-nine real planner/capability tests, direct structured-plan smoke and TypeScript passed. Prior package/gate evidence remains bound to `d19fd9ed`, not this subsequent repair; SP-02/SP-03 and Foundation remain unaccepted.

---

## SI-05 — Financial & Analytical Super Intelligence

### Mission

Make Finance the first deep Intelligence-to-Action proving ground: combine permitted evidence, deterministic analytics, living professional work, persistent decisions and governed action semantics while keeping AI as orchestrator rather than hidden calculator-of-record.

### Primary canonical scope

P5 entity/instrument identity; P6/P8 analytical state; P11 deterministic engines; P4 living work; SI-03 evidence/provider fabric; SI-02 governed action substrate; CA finance donor expansion.

### Canonical Finance blueprint

All SI-05 work must remain consistent with:

> `docs/technical/LIOS_FINANCE_INTELLIGENCE_TO_ACTION_BLUEPRINT.md`

### Workstreams

- **SI-05.01 — Market intelligence:** quotes, history, returns, volatility, market context and availability truth.
- **SI-05.02 — Company fundamentals:** statements, ratios, trends, segments and evidence.
- **SI-05.03 — Company/security/listing/instrument mapping:** canonical identity before provider calls.
- **SI-05.04 — DCF/FCFF/FCFE/APV:** deterministic valuation with explicit conventions.
- **SI-05.05 — Relative valuation:** comps/transactions where permitted evidence exists.
- **SI-05.06 — Residual income/EVA:** additional deterministic methods.
- **SI-05.07 — Scenario modeling:** base/bull/bear and arbitrary user-defined scenarios.
- **SI-05.08 — Sensitivity:** WACC/growth, operating, rate/price and multidimensional sensitivities.
- **SI-05.09 — Assumption ledger:** material assumptions visible, sourced, revisable and versioned.
- **SI-05.10 — Portfolio intelligence:** holdings, allocation, performance, attribution and exposure.
- **SI-05.11 — Risk:** VaR/CVaR, drawdown, stress, factor and scenario risk.
- **SI-05.12 — Optimization:** efficient frontier, constrained optimization, Black-Litterman where validated.
- **SI-05.13 — Factor models:** CAPM, Fama-French and validated extensions.
- **SI-05.14 — Fixed income:** pricing, yield, duration, convexity, curves and spreads.
- **SI-05.15 — Derivatives:** options/futures/swaps, Greeks and scenario analytics.
- **SI-05.16 — Quantitative donor integration:** approved finance/quant engines behind P11 with reconciliation evidence.
- **SI-05.17 — Macro/FX:** GDP, inflation, rates, labor, FX and policy series.
- **SI-05.18 — Corporate actions/events:** dividends, splits, buybacks, issues and event context.
- **SI-05.19 — Alternative assets:** permitted commodities, REITs, digital assets and other alternatives.
- **SI-05.20 — Personal finance:** budget, cash flow, debt, savings, goals, loans and retirement.
- **SI-05.21 — Wealth scenarios:** deterministic long-horizon planning where conventions/data permit.
- **SI-05.22 — Research-to-model composition:** evidence feeds engines only through validated canonical mappings.
- **SI-05.23 — Engine reconciliation:** donor/engine outputs compared against independent known-answer cases.
- **SI-05.24 — Numerical trust:** units, scaling, conventions, tolerances and non-convergence explicit.
- **SI-05.25 — Living financial Artifacts:** valuations, portfolios and plans remain revisable persistent work.
- **SI-05.26 — Earnings & Estimate Intelligence:** results/guidance/transcript/KPI/consensus comparison with materiality and assumption impact.
- **SI-05.27 — Broker Research Intelligence:** analyst/research revisions, consensus, divergence and thesis/model implications using permitted sources.
- **SI-05.28 — Universal Natural-Language Screening:** governed screens across supported public/private securities, funds, instruments, portfolios and related entities.
- **SI-05.29 — Consensus & Disagreement Engine:** compare provider/broker consensus, management guidance, internal model, market-implied expectations and historical accuracy where evidence permits.
- **SI-05.30 — Financial Model Autopilot:** orchestrate source updates, actual-period mapping, preserved formulas, assumption-impact detection and recalculation through canonical work/engine authority.
- **SI-05.31 — Financial Twins:** persistent Company, Security, Portfolio, Fund and Household computational representations behind canonical Projects/Chats/Artifacts/state.
- **SI-05.32 — Scenario & Counterfactual Propagation:** propagate macro/market/company assumption changes through models, securities, portfolios and decisions.
- **SI-05.33 — Private Markets & Deal Intelligence:** private companies, deals, funds/investors, market maps, screening, diligence, benchmarking and monitoring where entitled.
- **SI-05.34 — Investment Banking / Corporate Finance:** comps, precedents, DCF/LBO/merger models, accretion/dilution, capital structure, target/buyer screening and transaction materials.
- **SI-05.35 — Credit Intelligence:** capital structure, ratings, spreads, covenants, liquidity, default/recovery scenarios, refinancing and credit memo workflows.
- **SI-05.36 — Wealth & Advisor Intelligence:** household/account/goal/model-portfolio/proposal/report workflows with suitability/risk context where applicable.
- **SI-05.37 — Governed Broker / Execution Semantics:** broker-neutral order/action semantics behind SI-02 authority; paper/simulated path first; live adapters only where technically, contractually and legally permitted with explicit user authority, confirmation and reconciliation.
- **SI-05.38 — Corporate-Action Decisioning:** explain economic impact, entitlements/options and governed response workflows.
- **SI-05.39 — Expectation / Surprise Intelligence:** compare reported, consensus, guidance, internal/thesis and market-implied expectations where supported.
- **SI-05.40 — Financial Truth & Cross-Engine Reconciliation:** preserve observed/calculated/estimate/guidance/user-assumption/AI-inference/market-implied/unknown classes and reconcile material engine outputs.

### Acceptance

A representative flagship user can move through:

> real company/security/portfolio context → permitted market/fundamental/filing/research evidence → material event or earnings change → assumptions/model update → deterministic valuation/scenario/risk → portfolio impact → Living Thesis + Decision Object → professional Artifact/export → governed action proposal or explicit no-action decision → paper/simulated execution where used → reconciliation → complete source/numerical/action receipts.

The accepted journey must not require live brokerage execution.

---

## SI-06 — Autonomous & Everywhere Intelligence

### Mission

Make LiOS proactive, continuous and available across user-owned infrastructure and devices.

### Primary canonical scope

Mainly `GM-15`–`GM-24` plus canonical automation, model-routing, node/device and Finance F9–F10 requirements, using approved donor implementations under the donor policy.

### Workstreams

- **SI-06.01 — Save as Task/recipe:** convert successful work into reusable procedures.
- **SI-06.02 — Scheduled automation:** recurring analyses, refreshes and reports.
- **SI-06.03 — Conditional automation:** event/data/state-triggered workflows.
- **SI-06.04 — Monitoring:** companies, portfolios, markets, documents, tasks and system state.
- **SI-06.05 — Notification intelligence:** useful low-noise notifications without assuming LiOS customer servers.
- **SI-06.06 — Permission recheck:** recurring work revalidates credentials/authority before execution.
- **SI-06.07 — Long-running continuity:** recover jobs across restart/disconnect where supported.
- **SI-06.08 — Proactivity:** surface material changes while preserving user control and avoiding manipulative engagement.
- **SI-06.09 — BYOAI:** user-selected external model providers.
- **SI-06.10 — Local AI:** local inference for private/offline/specialized workflows.
- **SI-06.11 — Model routing:** choose model based on capability, cost policy, privacy and availability.
- **SI-06.12 — Model fallback:** graceful provider/model failure handling.
- **SI-06.13 — Local embeddings/retrieval:** private knowledge workflows where useful.
- **SI-06.14 — Desktop maturity:** strong macOS/Windows local experience.
- **SI-06.15 — User Home server:** NAS/server/VPS as user-owned always-on Home.
- **SI-06.16 — User cloud packs:** AWS/Azure/GCP/Kubernetes where user-owned.
- **SI-06.17 — Headless Home:** server operation without desktop UI.
- **SI-06.18 — Remote execution nodes:** governed user machines/servers as capability nodes.
- **SI-06.19 — iPhone/iPad:** native/mobile access to the same Home and canonical state.
- **SI-06.20 — Android:** same canonical Project/Chat/Artifact model.
- **SI-06.21 — Watch/Wear:** notifications, lightweight actions and status.
- **SI-06.22 — Offline outbox:** queue safe actions/work while disconnected.
- **SI-06.23 — Cross-device continuity:** same state, permissions and Artifact history everywhere.
- **SI-06.24 — Intelligent compute placement:** choose local/Home/remote node based on capability and policy.
- **SI-06.25 — Hardware awareness:** adapt execution/model/resource choices to machine capability.
- **SI-06.26 — Continuous Financial Intelligence:** turn accepted Finance workflows into governed monitors that rerun research/model/decision logic on material change.
- **SI-06.27 — Thesis Invalidation Monitoring:** continuously test Living Thesis conditions and counter-evidence without silently changing the user's decision.
- **SI-06.28 — Earnings / Filings / Estimate Event Automation:** event-triggered research and impact workflows with entitlement/freshness rechecks.
- **SI-06.29 — Continuous Model Refresh:** refresh source-linked actuals/models through canonical Artifact/engine paths with reviewable change reports.
- **SI-06.30 — Portfolio Materiality Monitor:** detect portfolio-relevant company/market/risk changes and suppress immaterial/noisy updates.
- **SI-06.31 — Entitlement-Aware Provider Routing:** choose among permitted sources based on entitlement, freshness, rights, locality and capability rather than silently substituting unavailable data.
- **SI-06.32 — Model + Provider + Compute Joint Routing:** choose suitable model, data source and execution placement using capability, privacy, rights, cost, latency and availability policy.
- **SI-06.33 — Cross-Device Financial Review & Approval:** review/approve/reject governed decisions/actions from authorized devices while execution remains on eligible nodes.
- **SI-06.34 — Node-Local Financial Capability Placement:** expose provider, database, broker, local-model or specialist-software capability from the user-owned environment where it is permitted to run.

### Acceptance

A user's LiOS can convert an accepted one-shot workflow into a continuing intelligence loop:

> event/condition → permission/entitlement/freshness recheck → research → model/materiality update → thesis/portfolio impact → low-noise notification → authorized cross-device review → optional governed action → reconciliation/receipt,

while preserving Projects/Chats/Artifacts across desktop + user-owned Home + remote nodes + mobile/tablet/watch and without dependence on a LiOS customer runtime cloud.

---

## SI-07 — Super Intelligence Convergence & Release

### Mission

Make SI-01–SI-06 behave as one coherent, trustworthy, releasable LiOS product.

### Primary canonical/release scope

Especially `GM-21`, `GM-23`, `GM-25`, CA-09/10 and existing P14 release authority, plus cross-capability Finance convergence.

### Workstreams

- **SI-07.01 — One-app convergence:** users see LiOS, not donor brands or infrastructure fragmentation.
- **SI-07.02 — Conversation-first experience:** intent is primary; capabilities appear contextually through progressive disclosure.
- **SI-07.03 — Cross-capability composition:** dynamically combine browser, agents, memory, coding, finance, documents, Artifacts and automation.
- **SI-07.04 — Capability discovery:** LiOS knows what capabilities are installed, permitted, connected, healthy and available.
- **SI-07.05 — Dynamic execution planning:** select appropriate models/tools/engines/nodes based on task and policy.
- **SI-07.06 — System Agent:** diagnose LiOS runtime, connectors, packs, permissions, data and configuration.
- **SI-07.07 — Doctor/repair:** detect and repair missing dependencies, corrupt state and misconfiguration safely.
- **SI-07.08 — Zero-setup provisioning:** install/verify/configure required components automatically.
- **SI-07.09 — Lazy capability installation:** heavy engines/assets only when needed, with consent and rollback.
- **SI-07.10 — Safe upgrades:** side-by-side component/app update and rollback.
- **SI-07.11 — Migration:** schemas, Artifacts, Home topology and donor versions.
- **SI-07.12 — Backup/restore qualification:** full recovery exercised, not documented only.
- **SI-07.13 — Security qualification:** permissions, secrets, sandbox, node trust and external actions.
- **SI-07.14 — Privacy qualification:** local/private boundaries and cloud-AI consent behavior.
- **SI-07.15 — Numerical qualification:** finance engines benchmarked/reconciled.
- **SI-07.16 — Provenance qualification:** evidence, as-of and assumptions survive through final outputs.
- **SI-07.17 — Performance qualification:** startup, prompt-to-result, research, execution, large files/tables, charts, restore.
- **SI-07.18 — Resource efficiency:** usable on mainstream hardware with graceful degradation.
- **SI-07.19 — Failure resilience:** offline, provider/model/tool/node failure, interrupted work and corrupt-state recovery.
- **SI-07.20 — Accessibility:** keyboard, focus, screen reader, scaling and interaction quality.
- **SI-07.21 — UX convergence:** remove duplicate workbenches, module mazes, overlapping surfaces and infrastructure-first UX.
- **SI-07.22 — Packaging/installers:** real desktop and server/user-owned deployment packages.
- **SI-07.23 — Cross-platform qualification:** macOS, Windows and supported user-owned server targets.
- **SI-07.24 — S0–S10 validation matrix:** use former slices as end-to-end scenario coverage, not execution limits.
- **SI-07.25 — P14 qualification:** preserve final existing release authority.
- **SI-07.26 — Product documentation:** install, privacy, architecture, troubleshooting, capabilities, backups and recovery.
- **SI-07.27 — Release candidate:** identified reproducible build with evidence.
- **SI-07.28 — Production release:** only after release truth reaches the agreed target.
- **SI-07.29 — Global Financial Command / Search:** one conversational/search entry point across supported Finance entities, evidence, models, portfolios, work products and actions.
- **SI-07.30 — Unified Source / Truth / Lineage Inspector:** inspect source, entitlement, freshness, numerical class, transformation and downstream use from one coherent surface.
- **SI-07.31 — Unified Decision / Action Review Surface:** review evidence, assumptions, alternatives, risk, approvals, proposed actions and outcomes without jumping between disconnected modules.
- **SI-07.32 — Role-Aware Progressive Finance UX:** expose appropriate depth for analyst, PM, advisor, finance professional or individual without creating separate product architectures.
- **SI-07.33 — Governed Finance Capability Marketplace:** provider/tool/skill/workflow/visualization/adapter extensibility behind canonical permission, plugin and donor-policy contracts.
- **SI-07.34 — Institutional Audit / RBAC / Policy Convergence:** organization controls, auditability and policy surfaces converge with Finance workflows where applicable.

### Acceptance

A new user can install LiOS, connect their chosen data/AI, ask a complex Finance or professional request, allow LiOS to research/execute/calculate/create/remember/automate as permitted, inspect source/numerical/action truth, continue across devices, recover from failures and export professional work—without understanding donor infrastructure or manually selecting internal modules.

---

# 4. Strategic execution order vs engineering dependency order

`SI-01` through `SI-07` are the **strategic product phases**; `SP-01` through `SP-07` are their mandatory integrated shipping milestones. They are not hard walls that forbid dependency pull-forward.

Examples:

- SI-03 memory/provider/evidence contracts may begin during SI-02 if the agent runtime requires them.
- SI-04 spreadsheet/model work may progress while SI-03 research work continues.
- SI-05 finance engines may advance behind stable SI-01/SI-02 execution and P11 contracts.
- SI-06 device/server work may advance when its GM dependency is ready even if some SI-04/05 breadth remains incomplete.


### Owner-selected post-SP-02 sequencing

After SP-02 is accepted, begin SI-05 with a vertical flagship Finance journey. Pull the minimum SI-03 evidence/provider and SI-04 living-work dependencies needed by that journey into the implementation; keep those dependencies generic and under their existing canonical owners. Do not require horizontal completion of all SI-03 or SI-04 workstreams before starting the Finance proving ground. Expand breadth after the vertical journey proves the shared contracts.

The rule is:

> **Phase defines the dominant outcome; dependencies determine exact engineering sequence.**

However, pull-forward must never create a duplicate authority or bypass an unsettled canonical shared-core owner.

---

# 5. S0–S10 become validation journeys

The former Product Slices remain required coverage, but no longer limit execution.

| Validation journey | What it proves under Super Intelligence |
|---|---|
| S0 Product Spine | intent → governed execution → result → Artifact/state → restore continuity |
| S1 Company & Entity | entity/research/data/evidence/no-ticker/company intelligence |
| S2 Valuation & Modeling | deterministic modeling + assumptions + revision + export |
| S3 Documents & Outputs | ingestion/editing/Artifact/professional-output intelligence |
| S4 Portfolio & Risk | portfolio/risk/optimization and canonical instruments |
| S5 Deep Research | agent + browser + memory + evidence + documents + quantitative composition |
| S6 Markets/Macro/Events | source-aware/time-aware market/event/macro intelligence |
| S7 Specialist Assets | fixed income/derivatives/alternative specialist engines |
| S8 Personal Finance | privacy + memory + deterministic personal/family planning |
| S9 Monitoring & Automation | tasks, recurrence, conditions, permission recheck and notifications |
| S10 Everywhere | user-owned Home, nodes, mobile/watch, offline and restore continuity |

A useful donor capability does **not** require an S1–S10 justification before being evaluated under the donor policy. If it can strengthen LiOS safely and map to a canonical authority, it may be integrated and then validated through one or more journeys.

---

# 6. Canonical authority preservation

Super Intelligence is an execution program, not a new architecture.

The following remain locked unless changed through an explicit architecture decision:

- TC Working Context = live bounded context; GM memory = durable memory/runtime.
- P4 = Artifact identity/store/version authority.
- P5 = entity/security/listing/instrument identity authority.
- P11 = deterministic finance engine authority.
- GM = runtime/Gateway/execution/device/agent/browser/memory/local-AI platform authority.
- P13/GM = skills/MCP/plugin authority.
- TC = visible conversation-first experience and user-facing journeys.
- CA = donor/renderer/engine/provider depth behind canonical authorities.

A canonical authority identifies the LiOS system-of-record/integration boundary; it does **not** require the underlying implementation to be rewritten natively when a mature approved donor implementation is stronger under the donor policy.

Do not create `SI` routers, stores, runtimes, entity systems, Artifact systems, memory systems, engine registries, permission layers or plugin systems. `SI-*` identifies final execution phases only.

---

# 7. Agent execution protocol under Super Intelligence

Before new substantial implementation work, every agent must:

1. update to current `main`;
2. read `AGENTS.md`;
3. read this Super Intelligence plan;
4. read `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`;
5. read `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`;
6. read `docs/LIOS_MASTER_PLAN.md` and `docs/LIOS_ARCHITECTURE.md`;
7. read the relevant domain capability blueprint; for Finance use `docs/technical/LIOS_FINANCE_INTELLIGENCE_TO_ACTION_BLUEPRINT.md`;
8. read relevant donor/reference documents such as `OPENCLAW_ASSIMILATION_BLUEPRINT.md`, CA workstreams and donor registry only as supporting implementation research;
9. read issue #192 and active PRs;
10. determine the active `SI-0X` phase/workstream, target SP/MSJ contribution, existing canonical task ID and shared-core authority;
11. evaluate implementation sourcing under the canonical donor policy before building new capability;
12. claim one bounded implementation task and declare high-conflict files/contracts;
13. validate locally first and minimize hosted GitHub Actions use;
14. leave reproducible evidence/handoff in GitHub.

### Required task/PR declaration

Every substantial implementation task/PR must state:

- **Super Intelligence phase:** `SI-01`…`SI-07`;
- **SI workstream:** e.g. `SI-05.30`;
- **target Shipping Point:** `SP-01`…`SP-07`, or `none/direct enabler` with explanation;
- **MSJ contribution:** exact integrated journey advanced and protected accepted behavior affected;
- **canonical implementation owner:** existing `GM-*`, `TC-*`, `CA-*`, `LIOS-P*` ID(s);
- **validation journeys affected:** any relevant `S0`–`S10`, optional rather than limiting;
- **donor-policy evaluation:** existing LiOS/donors/subsystems/mechanisms inspected, selected path and provenance/licensing where applicable;
- **shared-core conflict class:** independent / consumer / canonical-core owner;
- **acceptance evidence required**;
- **truth level reached**.

Existing in-flight PRs do not need to be discarded merely because their titles use older slice/workstream language. They should finish under their canonical owners and be reconciled against the current SI/SP/domain blueprint authority.

---

# 8. Truth ladder and definition of done

Use the mandatory Shipping Point truth ladder:

> **contract locked → code integrated → focused tests passed → integration evidence passed where required → packaged/provisioned → user accessible → vertical flagship passed → shipping point accepted → release proven**

A donor pin, copied code, enum, adapter, documentation entry or passing typecheck alone does not mean capability is complete.

For relevant work, done requires:

- correct canonical authority;
- no duplicate state/runtime/router/engine/permission system;
- donor provenance/licensing where donor implementation is used;
- donor-policy evaluation completed where relevant;
- real implementation, not mock-only behavior;
- explicit unavailable/ambiguous/error/unentitled/stale states;
- permission/isolation/security behavior;
- persistence/restart/recovery where relevant;
- numerical known-answer/reconciliation evidence for quantitative logic;
- provenance/as-of/assumption truth;
- packaging/provisioning evidence where required;
- performance/accessibility impact considered;
- local validation first;
- reproducible handoff in issue/PR;
- applicable S0–S10 validation journey identified and eventually exercised;
- target SP and MSJ contribution declared, with all five gates and exact evidence required before SP acceptance;
- accepted Shipping Point behavior preserved or a reproduced regression repaired under its canonical owner.

A task may be technically complete without closing an SP. No phase is genuinely shippable until its SP evidence exists, and no SP acceptance substitutes for P14 final release proof.

---

# 9. Current transition and active frontier

This plan preserves useful work already completed under TC/GM/CA/P and Product Slices. It changes execution hierarchy and capability coverage, not the validity of existing implementation.

The detailed live frontier must be tracked in issue #192 and current PRs rather than frozen as a stale task priority in this long-lived plan.

At this reconciliation point:

- SI-01 provides the accepted/near-accepted secure local substrate and remains regression-protected through SP-01 evidence;
- the active program frontier is SI-02/SP-02 agentic convergence and closure;
- before SI-02 closes, downstream generic contracts listed in the SI-02 closure section must be sufficiently stable;
- Finance F1–F10 and SI-03→SI-07 capability expansion are now part of the canonical Super Intelligence program and should be implemented progressively after/alongside stable dependencies;
- no Finance-specific breadth should delay SI-02 closure unless it exposes a genuine missing generic contract required by downstream phases.

For exact current status, ownership and next task, issue #192 and current `main`/active PRs are authoritative.

---

# 10. Final owner intent

LiOS should become a system where the user can express intent and the product can safely combine every appropriate capability available to it—research, provider data, browser work, coding, deterministic finance, files, spreadsheets, documents, memory, decisions, governed actions, automation, devices and user-owned compute—without exposing the complexity of those subsystems.

For Finance, the target loop is:

> **CONNECT → SENSE → UNDERSTAND → RESEARCH → MODEL → DECIDE → APPROVE → ACT → VERIFY → MONITOR**

The implementation rule is intentionally simple:

> **Define the capability and user outcome in the SI/domain blueprint. Choose the strongest compliant implementation path under the canonical donor policy. Preserve singular LiOS authorities. Validate the real user journey.**

Do not let historical slice labels, donor labels, original repository purpose or artificial horizontal/vertical boundaries limit Super Intelligence capability. Equally, do not let donor reuse create duplicate product authorities or fake integration. LiOS is the product; approved donors provide implementation leverage under the canonical policy.