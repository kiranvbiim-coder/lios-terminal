# LiOS Finance Intelligence-to-Action Blueprint

**Status:** OWNER-DIRECTED FINANCE CAPABILITY BLUEPRINT  
**Effective:** 2026-10-05  
**Strategic parent:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`  
**Shipping authority:** `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`  
**Donor authority:** `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`  
**Canonical implementation authorities remain:** GM, TC, CA, P4, P5, P11, P13 and existing owned subsystem contracts

---

## 0. Purpose and precedence

This document defines the intended **Finance product capability envelope** and how it is distributed across `SI-01` through `SI-07`.

It does **not** define a new donor policy, donor preference hierarchy, donor boundary, implementation-source hierarchy, or second architecture.

All decisions about whether a capability should be implemented through existing LiOS code, OpenClaw/Goldmine, another approved donor, a combination of donors, adaptation, wrapping, import, modification, extension, or new LiOS code are governed exclusively by:

> `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`

The canonical donor policy takes precedence over any implementation example in this document.

In particular:

- no donor is artificially restricted to a horizontal or vertical role;
- a mature approved donor implementation may be reused substantially, including as a complete useful subsystem, when that produces the strongest maintainable LiOS result;
- OpenClaw/Goldmine may be used wherever its implementation is valuable and suitable, including capabilities that directly enable Finance workflows;
- specialist donors may likewise be used wherever they provide the strongest suitable implementation;
- multiple donors may be combined behind one LiOS-owned contract;
- building new remains a deliberate decision under the canonical donor policy, not an automatic preference;
- existing LiOS architectural authorities remain canonical even when the implementation behind an authority is substantially donor-derived.

**Capability ownership and donor selection are different questions.**

For example, P11 may remain the canonical deterministic-finance authority while a mature donor engine supplies substantial implementation behind a P11-owned contract. P4 may remain Artifact authority while a donor supplies a full spreadsheet/rendering subsystem behind P4. GM may remain execution/device authority while substantial runtime mechanisms are imported or adapted from OpenClaw. The existence of a LiOS authority does not imply that LiOS must rewrite the implementation from scratch.

This document therefore answers:

> **What must LiOS Finance become, and where does each capability belong in the Super Intelligence program?**

The donor policy answers:

> **What is the strongest compliant implementation path?**

---

# 1. Finance north star

LiOS Finance shall become a **provider-neutral, model-neutral, broker-neutral, user-owned Financial Intelligence-to-Action Operating System**.

The target product loop is:

> **CONNECT → SENSE → UNDERSTAND → RESEARCH → MODEL → DECIDE → APPROVE → ACT → VERIFY → MONITOR**

The operating promise is:

> **Your AI. Your data. Your providers. Your files. Your brokers. Your devices. Your compute. One governed financial intelligence system.**

Finance is the launch proving ground. If this architecture is executed deeply in Finance, the same underlying LiOS platform can later support other domains by changing domain objects, tools, models, evidence rules, action semantics and workflows rather than rebuilding the operating system.

This blueprint does not create `SI-08`, a second roadmap, a second runtime, a second finance engine, or a new system of record.

---

# 2. Product strategy

LiOS does not need to own every dataset, model, broker relationship, database or compute environment.

Users may bring or connect, where supported and permitted:

- AI/model providers;
- premium and public financial-data providers;
- broker and custodial relationships;
- internal databases and enterprise systems;
- files, spreadsheets, models and research;
- proprietary APIs;
- local models;
- workstations, servers and GPUs;
- mobile/tablet/watch devices;
- user-owned Home/server/cloud infrastructure.

LiOS composes these resources through canonical product and governance contracts including:

- Projects and Chats;
- Working Context and durable memory;
- P5 entity/instrument identity;
- P4 Artifacts and revisions;
- P11 deterministic finance engines;
- GM execution, device, permission and runtime authority;
- P13/GM skills, MCP and plugin authority;
- provider/connector and entitlement contracts;
- evidence/provenance;
- decision/action state;
- reconciliation;
- automation and monitoring.

The strategic value is not merely aggregation. LiOS should turn fragmented information and tools into a coherent, inspectable decision-and-action workflow.

---

# 3. Competitive-superset target

The companion research baseline is:

> `docs/technical/LIOS_FINANCE_COMPETITIVE_CAPABILITY_MATRIX.md`

That matrix is a **research/reference document**, not an implementation authority.

Publicly observable product/workflow concepts from Bloomberg, AlphaSense/Tegus, FactSet, S&P Capital IQ Pro, LSEG Workspace/REDI, OpenBB, Koyfin, Morningstar, PitchBook, Daloopa, Quartr, BamSEC and AI-native finance systems should be evaluated as benchmarks where legally permissible.

LiOS may emulate or improve publicly observable workflow concepts and product mechanisms. It must not copy proprietary source code, restricted datasets, confidential implementation, protected branding, or pixel-identical branded interfaces without rights.

The capability envelope to match or exceed includes:

1. universal financial search and command;
2. multi-document and multi-source research;
3. broker, expert and internal research workflows;
4. filings, transcripts and investor-relations intelligence;
5. estimates, recommendations, consensus and revisions;
6. screening and discovery;
7. source-linked financial modeling;
8. portfolio construction, risk, attribution and optimization;
9. fixed income, derivatives, macro and FX;
10. private-market, fund, deal and investor intelligence;
11. investment-banking and corporate-finance workflows;
12. credit intelligence;
13. wealth, advisor and client workflows;
14. Office/spreadsheet/report/presentation round trip;
15. continuous monitoring and alerts;
16. collaborative research and approval workflows;
17. research-to-action/execution workflows;
18. mobile and multi-device continuity;
19. agent/template/workflow libraries;
20. custom data, model, tool and plugin ecosystems;
21. source-level auditability and numerical lineage.

No single item above is the moat. The intended advantage is their composition under LiOS governance, user ownership, deterministic finance and professional workflow continuity.

---

# 4. Ten permanent Finance capability primitives

Future Finance capability should map to these primitives instead of creating another architecture.

## F1 — Provider & Entitlement Fabric

A normalized provider capability contract should be able to represent public, premium, internal and user-owned sources.

A provider capability descriptor should support, where applicable:

- provider identity;
- authentication and SecretRef;
- user/org entitlement;
- supported asset/entity/data capability;
- geography and market scope;
- schema/version;
- freshness and observation time;
- request cost/credits where knowable;
- rate limits;
- provenance requirements;
- cache/storage restrictions;
- redistribution restrictions;
- AI-transmission restrictions;
- residency/locality requirements;
- offline availability;
- node/device placement requirements;
- permitted operations and side-effect class;
- explicit unavailable/denied/stale/unentitled/unsupported/ambiguous states.

Provider-neutral does not mean lowest-common-denominator. Better customer entitlements should make LiOS deeper.

## F2 — Entity, Event & Relationship Fabric

P5 remains canonical identity authority.

LiOS should understand entities including:

- company and issuer;
- security/listing/instrument;
- fund/ETF/index;
- bond/loan;
- currency/commodity;
- portfolio/account/household;
- broker/custodian;
- analyst/research provider;
- investor/fund/manager;
- private company/deal;
- country/sector/industry;
- document/data series.

Financial events should become first-class context, including:

- earnings;
- guidance;
- filing;
- estimate/recommendation revision;
- dividend/split/buyback/rights issue;
- financing/refinancing;
- M&A/deal/funding event;
- management change;
- rating change;
- policy/macro release;
- regulatory event;
- covenant/liquidity event.

Relationship intelligence should support impact propagation such as:

> company → subsidiary → supplier → geography → commodity → security → portfolio.

## F3 — Financial Truth & Numerical Lineage

Material financial values should be classifiable as:

- `OBSERVED`;
- `CALCULATED`;
- `MANAGEMENT_GUIDANCE`;
- `ANALYST_ESTIMATE`;
- `USER_ASSUMPTION`;
- `AI_INFERENCE`;
- `MARKET_IMPLIED`;
- `UNKNOWN`.

Where source support exists, important values should be traceable through:

> provider/source → document/dataset → field/page/table/period → normalization/transformation → formula/engine → model/Artifact cell → decision/output.

A user should be able to inspect an important output and understand where the number came from.

AI must never silently convert inference into observed or deterministic financial truth.

## F4 — Thesis, Decision & Financial Twin Objects

### Living Thesis

A persistent thesis may contain:

- claims and counterclaims;
- evidence and counter-evidence;
- assumptions;
- confidence;
- catalysts;
- risks;
- invalidation conditions;
- bull/base/bear cases;
- linked model/valuation;
- portfolio relevance;
- last-reviewed state;
- changed-since-last-review state.

### Decision Object

A persistent institutional decision may contain:

- objective/question;
- evidence;
- assumptions;
- calculations;
- alternatives;
- scenarios;
- recommendation;
- dissent/counter-case;
- risks;
- approval;
- action proposal;
- execution result;
- reconciliation;
- outcome/follow-up.

### Financial Twins

Persistent computational representations may include:

- Company Twin;
- Security Twin;
- Portfolio Twin;
- Fund Twin;
- Household Twin.

These remain structured states behind Projects/Chats/Artifacts rather than new top-level product silos.

## F5 — Agent, Tool, Skill & Workflow Fabric

SI-02/GM/P13 remain the single agent/tool/skill authority.

Finance adds domain capabilities to that fabric rather than creating a finance-specific agent runtime.

Representative workflows include:

- Earnings Prep;
- Earnings Flash;
- Company Initiation;
- Living Thesis Review;
- Broker Research Digest;
- DCF Update;
- Comps;
- Credit Review;
- Portfolio Morning Brief;
- Portfolio Risk Review;
- Macro Impact;
- M&A Target Screen;
- IC Memo;
- Client Proposal;
- Rebalance Proposal;
- Filing Change Review.

The implementation behind these workflows may use any approved donor or combination permitted by the canonical donor policy.

## F6 — Deterministic Finance Fabric

P11 remains calculation authority.

AI may orchestrate, explain, challenge and help select assumptions, but material quantitative outputs should use validated deterministic engines where available.

Core families include:

- valuation;
- statement normalization;
- scenario/sensitivity;
- portfolio analytics;
- risk;
- optimization;
- factor models;
- fixed income;
- derivatives;
- macro/FX transformations;
- wealth/personal-finance planning;
- credit analytics;
- transaction/corporate-finance analytics.

Every engine must preserve units, conventions, as-of semantics, tolerances, failure/non-convergence truth and reconciliation evidence.

A P11-owned capability may be substantially donor-implemented when the canonical donor policy supports that path.

## F7 — Living Professional Work & Model Fabric

P4 remains Artifact authority.

Professional outputs should remain living and editable rather than static AI responses.

Target classes include:

- spreadsheet/financial model;
- analytical table;
- chart/dashboard;
- research report;
- IC memo;
- credit memo;
- pitchbook/board material;
- advisor/client proposal;
- PPTX/XLSX/DOCX/PDF export;
- reusable report templates.

Source-linked model maintenance should support:

> source update → actual-period update → preserved formulas → assumption-impact detection → recalculation → model-change report → review/approval.

No silent destructive overwrite of user assumptions.

## F8 — Governed Action Fabric

Consequential actions should use one generic lifecycle:

> **PROPOSE → VALIDATE → AUTHORIZE → PREPARE → EXECUTE → CONFIRM → RECONCILE → RECEIPT**

Examples include:

- external API mutation;
- broker order proposal/execution;
- cancel/replace;
- portfolio rebalance action;
- report/email distribution;
- controlled file mutation;
- task/automation creation;
- remote-node operation.

The action layer should support:

- exact operation binding;
- current authorization revalidation;
- side-effect classification;
- idempotency key;
- known/unknown outcome handling;
- no automatic duplicate external effect;
- provider/broker confirmation;
- reconciliation;
- durable receipt.

Paper/simulated execution should precede live financial execution for Shipping Point proof.

Live brokerage execution is an eventual governed capability, not conversationally inferred authority. Where technically, contractually and legally permitted, users may connect broker-neutral adapters. LiOS does not become the user's broker or custodian merely by providing an adapter. No copy-trading or manipulative-engagement mechanics.

## F9 — Continuous Financial Intelligence

Any meaningful object should be able to become a monitor where appropriate:

- company;
- portfolio;
- thesis;
- filing clause;
- KPI;
- estimate;
- recommendation;
- valuation;
- spread;
- factor;
- corporate event;
- model assumption;
- screen;
- risk condition.

The target continuous loop is:

> event/data change → entitlement/freshness recheck → research → model update → materiality → thesis/portfolio impact → notification → governed action proposal.

## F10 — Distributed Intelligence Fabric

A user-owned device/node may contribute:

- data/provider access;
- credentials;
- files;
- compute;
- GPU/local model;
- browser session;
- software/Excel environment;
- internal-network access;
- broker connectivity;
- specialist tools.

LiOS should reason about **where** a capability may execute rather than requiring all resources to move into a vendor cloud.

---

# 5. Donor-use rule for all Finance work

This blueprint deliberately contains **no separate Finance donor decision sequence**.

For every Finance workstream, agents must follow the canonical repository-wide donor policy as written.

That policy permits, where appropriate:

- direct reuse;
- substantial/full subsystem reuse;
- import;
- modification;
- adaptation;
- wrapping;
- combination of donors;
- extraction of valuable mechanisms;
- extension/innovation;
- new LiOS-native implementation when it creates real value.

OpenClaw/Goldmine is an important approved donor with broad relevance to LiOS, but this blueprint does not prescribe that OpenClaw must be limited to a particular architectural layer or capability category.

Likewise, this blueprint does not require OpenClaw to be used when another approved implementation, combination, or LiOS-native approach is stronger under the canonical donor policy.

The implementation question for every Finance capability is therefore:

> **Under the canonical donor policy, what combination of existing LiOS capability and approved donor implementation produces the strongest maintainable LiOS result?**

The answer must be evidence-based and must preserve existing canonical LiOS authorities unless an explicit architecture decision changes them.

For OpenClaw-specific implementation research, see:

> `docs/technical/OPENCLAW_FINANCE_CAPABILITY_REFERENCE.md`

That document is a capability/reference inventory only. It does not modify donor policy.

---

# 6. SI-02 closure: freeze generic contracts, not the Finance vertical

SI-02 should not be extended indefinitely by implementing the full Finance product early.

Before SI-02 closes, verify that the generic runtime contracts are sufficient for later Finance capabilities.

The following cross-cutting contracts should be stable enough for downstream SI phases:

1. **Canonical Tool Descriptor** — stable tool/capability identity, side-effect class, policy, placement and receipt metadata.
2. **Generic Action Lifecycle** — proposal, validation, authorization, prepared/dispatch/confirmation/reconciliation states.
3. **Durable Idempotency/Reconciliation** — protection against duplicate consequential external effects.
4. **Delegation/Parallelism Contract** — bounded specialist/subagent execution without a second runtime.
5. **Skill/MCP/Plugin Contract** — future Finance workflows/providers can publish capability without creating new registries.
6. **Placement Capability Contract** — capability may exist only on a particular user-owned node/device/environment.
7. **Agent Receipt Contract** — compact model/tool/source/action evidence without chain-of-thought.
8. **Consequential Action Policy Contract** — later Finance actions can require stronger approval and revalidation.

These are **generic platform contracts**. SI-02 does not need Bloomberg, broker, private-market, wealth, credit or other Finance-specific implementations to close.

---

# 7. SI-03 — Knowledge, Research & Evidence expansion

Add/retain the following Finance-oriented outcomes under the existing SI-03 authority and canonical owners:

- **SI-03.23 — Universal Provider & Entitlement Fabric**
- **SI-03.24 — Financial Event & Relationship Intelligence**
- **SI-03.25 — Broker / Expert / Internal Research Composition**
- **SI-03.26 — Numerical Evidence Lineage**
- **SI-03.27 — Living Investment Thesis**
- **SI-03.28 — Filing / IR Change Intelligence**
- **SI-03.29 — Estimates / Recommendation Evidence**
- **SI-03.30 — Alternative & Private-Market Evidence Adapters**

Representative product outcomes include:

- multi-source company research;
- broker/internal/public research comparison;
- filing and transcript diffs;
- management wording/guidance change detection;
- contradiction and source-gap visibility;
- analyst estimate/rating revision evidence;
- persistent thesis evidence linked to entities/events;
- permitted private-company/deal evidence;
- source/freshness/entitlement truth.

Donor implementation choices remain governed exclusively by the canonical donor policy.

---

# 8. SI-04 — Professional Work expansion

Add/retain:

- **SI-04.23 — Decision Object Artifact**
- **SI-04.24 — Source-Linked Financial Model Cells**
- **SI-04.25 — Financial Model Maintenance / Update Engine**
- **SI-04.26 — Model Change / Restatement Report**
- **SI-04.27 — Finance-Grade Office Round Trip**
- **SI-04.28 — IC / Credit / Deal Memo Workflows**
- **SI-04.29 — Banking Pitch / Board Materials**
- **SI-04.30 — Advisor / Client Proposal & Reporting**
- **SI-04.31 — Review / Annotation / Collaborative Decision Package**

Target behavior:

> evidence/data → editable model/work product → deterministic calculations → revisions → professional output → reopen/refresh with state and lineage preserved.

Existing mature donor implementations for spreadsheets, documents, rendering, charts, Office formats or model maintenance should be evaluated under the canonical donor policy rather than rebuilt automatically.

---

# 9. SI-05 — Financial & Analytical Super Intelligence expansion

SI-05 is the main vertical convergence point for the Finance product.

Preserve existing families and add/retain:

- **SI-05.26 — Earnings & Estimate Intelligence**
- **SI-05.27 — Broker Research Intelligence**
- **SI-05.28 — Universal Natural-Language Screening**
- **SI-05.29 — Consensus & Disagreement Engine**
- **SI-05.30 — Financial Model Autopilot**
- **SI-05.31 — Financial Twins — Company/Security/Portfolio/Fund/Household**
- **SI-05.32 — Scenario & Counterfactual Propagation**
- **SI-05.33 — Private Markets & Deal Intelligence**
- **SI-05.34 — Investment Banking / Corporate Finance**
- **SI-05.35 — Credit Intelligence**
- **SI-05.36 — Wealth & Advisor Intelligence**
- **SI-05.37 — Governed Broker / Execution Semantics**
- **SI-05.38 — Corporate-Action Decisioning**
- **SI-05.39 — Expectation / Surprise Intelligence**
- **SI-05.40 — Financial Truth & Cross-Engine Reconciliation**

## 9.1 Company / earnings intelligence

Target loop:

> company → filings/results/transcript/research → estimate/guidance comparison → changed assumptions → deterministic model → valuation/scenario → thesis/portfolio impact.

## 9.2 Screening

A user should be able to describe a financial universe in natural language and receive a deterministic, evidence-backed screen across supported asset/entity families.

## 9.3 Consensus and disagreement

Compare, where evidence permits:

- analyst consensus;
- management guidance;
- internal/user assumptions;
- market-implied expectations;
- deterministic model outputs;
- historical forecast accuracy.

The purpose is not a single opaque score but visibility into material disagreement.

## 9.4 Model autopilot

Target behavior:

> new reported data → map actual periods → preserve formulas → identify affected assumptions → recalculate → expose changes → require review where material.

No silent destructive assumption changes.

## 9.5 Scenario propagation

Allow scenarios to propagate, where supported, through:

> macro/market assumption → sector/company effects → model assumptions → securities → portfolio/risk.

## 9.6 Private markets and deal intelligence

Support appropriate workflows such as:

- company/deal/fund/investor discovery;
- market maps;
- comps and valuation;
- deal sourcing;
- diligence packages;
- buyer/target lists;
- fund benchmarking;
- portfolio-company monitoring;
- exit scenarios.

## 9.7 Investment banking / corporate finance

Target workflows include:

- trading comps;
- precedent transactions;
- DCF;
- LBO;
- merger/accretion-dilution;
- capital structure;
- debt schedules;
- ECM/DCM support;
- target/buyer screens;
- pitchbooks, board and management materials.

## 9.8 Credit intelligence

Target workflows include:

- issuer financials;
- capital structure;
- bonds/loans;
- ratings and spreads;
- covenants;
- default/recovery scenarios;
- liquidity and refinancing analysis;
- credit memo;
- continuous monitoring.

## 9.9 Wealth / advisor intelligence

Target workflows include:

- household/account views;
- goals and suitability;
- model portfolios;
- current-vs-proposed analysis;
- risk and fee analysis;
- proposal generation;
- client reports;
- meeting preparation;
- CRM/enterprise integration where appropriate.

## 9.10 Broker/action semantics

Live execution is future governed scope, not a current SI-02 blocker.

Start with paper/simulated action proof. Later, where technically, contractually and legally permitted, broker adapters may support user-directed actions through the generic governed action lifecycle.

LiOS must not infer trading authority from ordinary conversation.

---

# 10. SI-06 — Autonomous & Everywhere Finance expansion

Add/retain:

- **SI-06.26 — Continuous Financial Intelligence**
- **SI-06.27 — Thesis Invalidation Monitoring**
- **SI-06.28 — Earnings/Filings/Estimate Event Automation**
- **SI-06.29 — Continuous Model Refresh**
- **SI-06.30 — Portfolio Materiality Monitor**
- **SI-06.31 — Entitlement-Aware Provider Routing**
- **SI-06.32 — Model + Provider + Compute Joint Routing**
- **SI-06.33 — Cross-Device Financial Review & Approval**
- **SI-06.34 — Node-Local Financial Capability Placement**

Target behavior:

> accepted one-shot workflow → Save as Monitor/Task → event/condition → permission/entitlement/freshness recheck → research/recalculation → materiality → notification → optional governed action proposal.

Multi-device should be capability-aware rather than merely cloud-sync oriented. Different user-owned devices/nodes may contribute data access, software, credentials, models, compute or approval surfaces.

The implementation source for device, automation, routing or monitoring mechanisms remains governed by the canonical donor policy.

---

# 11. SI-07 — Product convergence

Add/retain:

- **SI-07.29 — Global Financial Command / Search**
- **SI-07.30 — Unified Source / Truth / Lineage Inspector**
- **SI-07.31 — Unified Decision / Action Review Surface**
- **SI-07.32 — Role-Aware Progressive Finance UX**
- **SI-07.33 — Governed Finance Capability Marketplace / Extension Surface**
- **SI-07.34 — Institutional Audit / RBAC / Policy Convergence**

The final UX must not expose the underlying breadth as hundreds of disconnected modules.

A request such as:

> **What changed in my portfolio today?**

may require market data, earnings, filings, broker research, portfolio positions, valuation, risk, AI and deterministic engines. LiOS should compose those capabilities through one coherent experience and expose source/methodology/action detail progressively.

---

# 12. Shipping Point strengthening

## SP-02 — Agentic Alpha

Keep SP-02 generic.

Prove:

> multi-step request → bounded plan → governed tools/browser/Python as applicable → pause/approval where required → checkpoint/resume/cancel → failure recovery → no duplicate side effects → persistent useful result/receipt.

No Finance-specific live brokerage requirement.

## SP-03 — Research Alpha

Strengthen the Finance-relevant example journey to prove:

> real entity/topic → permitted multi-source evidence → entitlement/freshness/as-of truth → contradictions/gaps → citations/provenance → durable research/thesis Artifact → restart/reopen.

## SP-04 — Professional Work Alpha

Require at least one finance-grade round trip:

> source evidence/data → editable model/spreadsheet/work product → deterministic table/chart → revision → professional export → reopen/round-trip with lineage/revision state preserved.

## SP-05 — Financial Intelligence Alpha

Flagship Finance MSJ:

> canonical company/security → permitted market/fundamental/filing/research evidence → identify material event/change → compare estimates/guidance/assumptions → deterministic valuation/scenario → portfolio impact where applicable → Living Thesis + Decision Object → professional Artifact → governed action proposal → paper execution or explicit no-execution decision → reconciliation → source/numerical/action receipt.

Live broker execution is not required for SP-05 acceptance.

## SP-06 — Autonomous LiOS Beta

Flagship Finance automation journey:

> accepted SP-05-style workflow → Save as Monitor/Task → material event arrives → permission/entitlement/freshness recheck → research/model update → thesis/portfolio impact → notification → review/approval from supported device → optional governed action → reconciliation → history/receipt.

---

# 13. Product rules that protect the Finance architecture

1. **No fabricated financial truth.** Missing, stale, ambiguous, unavailable or unentitled information remains explicit.
2. **Deterministic calculations remain inspectable.** AI does not silently replace quantitative engines.
3. **Source and transformation lineage matter.** Important outputs should be traceable.
4. **AI and deterministic output are distinguishable.** Inference must be labelled.
5. **Provider-neutral does not erase provider depth.** Premium entitlement can expose deeper fields/capabilities.
6. **Conversation is the primary interface, not a limitation.** Deep capability may exist behind a simple intent-driven UX.
7. **Professional work remains editable.** Reports/models/decks/tables are living Artifacts where appropriate.
8. **Consequential action requires explicit authority.** Conversation alone never creates permission.
9. **Multi-device is capability-aware.** Data/credentials/compute can remain where they are permitted to live.
10. **Donor choice follows one policy only.** This document must not be interpreted as overriding `LIOS_DONOR_IMPORT_REUSE_POLICY.md`.

---

# 14. Implementation and donor research references

Use these together:

- `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md` — **only donor-use authority**;
- `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md` — existing OpenClaw/Goldmine repository research and pin context;
- `docs/technical/OPENCLAW_FINANCE_CAPABILITY_REFERENCE.md` — Finance-relevant OpenClaw capability/reference inventory, non-governing;
- `docs/technical/LIOS_FINANCE_COMPETITIVE_CAPABILITY_MATRIX.md` — competitor/product capability research baseline, non-governing;
- `third_party/capability-assimilation.json` — donor registry truth where applicable;
- canonical `GM/TC/CA/P*` docs — implementation ownership and contracts.

If an implementation reference conflicts with the canonical donor policy, the donor policy wins unless it is explicitly amended through the repository's policy-change process.

---

# 15. Final architecture lock

LiOS Finance should transform permitted data, research, models, tools, AI, devices, compute and action systems into one governed professional decision loop:

> **CONNECT → SENSE → UNDERSTAND → RESEARCH → MODEL → DECIDE → APPROVE → ACT → VERIFY → MONITOR**

The Super Intelligence program defines when and where these Finance capabilities mature.

The canonical donor policy defines how we obtain the strongest implementation.

Those two concerns must remain separate.
