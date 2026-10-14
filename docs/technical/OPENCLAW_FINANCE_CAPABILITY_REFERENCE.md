# OpenClaw / Goldmine Finance Capability Reference

**Status:** NON-GOVERNING IMPLEMENTATION RESEARCH REFERENCE  
**Effective:** 2026-10-05  
**Parent Finance blueprint:** `docs/technical/LIOS_FINANCE_INTELLIGENCE_TO_ACTION_BLUEPRINT.md`  
**Canonical donor-use authority:** `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`  
**Pinned OpenClaw source context:** `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md`

---

## 0. Purpose and limits

This document records Finance-relevant OpenClaw/Goldmine capabilities and implementation ideas that may be useful to LiOS.

It is **not** a donor policy, donor priority rule, implementation mandate, or architectural boundary.

All decisions about whether OpenClaw should be reused, imported, modified, adapted, combined, wrapped, extended, replaced, or not used are governed exclusively by:

> `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`

This reference must not be interpreted as saying:

- OpenClaw is limited to horizontal infrastructure;
- OpenClaw may not supply a complete or substantial implementation for a Finance capability;
- Finance-specific code must always be LiOS-native;
- OpenClaw must always be preferred over another approved donor;
- another approved donor may not provide platform/runtime capability;
- LiOS must rewrite a mature donor subsystem merely because LiOS owns the canonical authority around it.

The canonical donor policy explicitly permits substantial/full subsystem reuse where technically appropriate and legally permitted, and it also permits adaptation, modification, combination, wrapping, extension and new implementation when that produces the strongest maintainable LiOS result.

**Capability ownership and implementation source are separate concerns.**

A donor may supply substantial implementation behind a LiOS-owned contract without becoming the canonical product authority.

---

# 1. How to use this reference

For a Finance task:

1. identify the required LiOS capability and canonical owner;
2. read the canonical donor-use policy;
3. inspect existing LiOS implementation;
4. inspect OpenClaw/Goldmine for relevant complete subsystems, components, mechanisms or patterns;
5. inspect other approved donors where relevant;
6. choose the strongest implementation path under the canonical donor policy;
7. record provenance, licensing, pin/version and integration evidence where donor code is adopted.

This document helps with step 4 only.

It does not replace engineering judgment or the donor policy.

---

# 2. OpenClaw capability inventory relevant to Finance

The categories below are organizational aids only. They are **not restrictions on where OpenClaw may be used**.

## Runtime / Gateway / Home

Potentially relevant mechanisms include:

- Gateway protocol/runtime;
- local/headless operation;
- process/job lifecycle;
- session lifecycle;
- reconnect/recovery;
- execution transport;
- diagnostics/Doctor;
- provisioning/configuration patterns;
- user-owned deployment mechanics.

Possible Finance uses include:

- keeping premium/internal data access on user-owned infrastructure;
- coordinating long-running financial analysis;
- connecting desktop/Home/nodes without a LiOS-operated customer-data runtime;
- supervising local finance sidecars/engines;
- restoring interrupted professional workflows.

## Device / Node / Placement

Potentially relevant mechanisms include:

- device identity;
- pairing;
- capability approval;
- capability advertisement;
- remote/headless nodes;
- node invocation;
- node presence/reconnect;
- browser/node placement;
- node-local services;
- node-hosted tools/skills/MCP where supported;
- node-local model inference where supported.

Possible Finance uses include:

- premium provider capability on an entitled office workstation;
- broker software/API connectivity on a specific machine;
- local models on a GPU server;
- Excel/model tooling on a desktop;
- internal database access from an enterprise network;
- review/approval from laptop/tablet/phone while computation remains elsewhere.

## Agent runtime and delegation

Potentially relevant mechanisms include:

- bounded agent lifecycle;
- planning/tool use;
- specialist sub-agents;
- parallel fan-out/Swarm-like patterns;
- agent/session isolation;
- tool policy;
- cancellation;
- checkpoint/recovery;
- structured result collection;
- coding/ACP integration where useful.

Possible Finance uses include:

- company-by-company sector research;
- equity/credit/risk/macro specialist roles;
- bear-case and evidence-auditor passes;
- diligence workstreams;
- large universe research;
- model/update verification.

## Tool, Skill, MCP and Plugin mechanisms

Potentially relevant mechanisms include:

- tool catalogs;
- deferred/dynamic tool discovery;
- compact multi-tool orchestration;
- skills/procedures;
- MCP integration;
- plugin mechanisms;
- hooks;
- policy filtering;
- capability descriptors.

Possible Finance uses include:

- earnings preparation;
- DCF update;
- broker-research digest;
- credit review;
- IC memo;
- portfolio brief;
- screening;
- provider and broker adapters;
- machine-local enterprise integrations.

If a mature OpenClaw subsystem in this family is stronger than a proposed new LiOS implementation, the canonical donor policy requires it to be evaluated seriously rather than rejected because of category labels in this document.

## Browser and computer interaction

Potentially relevant mechanisms include:

- managed browser sessions;
- browser placement;
- downloads;
- controlled web navigation;
- computer-use mechanisms;
- interaction with software that lacks APIs.

Possible Finance uses include permitted workflows with:

- investor-relations sites;
- exchanges/regulators;
- broker/research portals;
- legacy desktop finance tools;
- Excel add-ins;
- internal enterprise software.

Provider terms, rights, user consent, isolation and consequential-action controls remain mandatory.

## Automation and monitoring

Potentially relevant mechanisms include:

- scheduled jobs;
- persisted automations;
- event hooks;
- heartbeat/ambient-monitoring patterns;
- job history;
- retry visibility;
- notifications/delivery mechanisms;
- isolated recurring work.

Possible Finance uses include:

- morning portfolio brief;
- earnings watch;
- filing monitor;
- estimate/recommendation change monitor;
- thesis invalidation monitor;
- valuation/risk threshold monitor;
- continuous model refresh;
- post-event follow-up.

## Models / local AI / provider abstraction

Potentially relevant mechanisms include:

- model-provider abstraction;
- local-model support;
- node-local inference;
- provider routing/fallback concepts;
- model capability metadata;
- privacy-aware placement concepts.

Possible Finance uses include:

- BYOAI;
- local/private inference;
- task-specific model selection;
- restricted-data handling;
- user-owned compute.

Model output remains generative unless a deterministic LiOS authority validates/calculates the result.

## Recovery, repair and operations

Potentially relevant mechanisms include:

- checkpoint/recovery;
- state validation;
- repair/Doctor;
- dependency checks;
- update/migration patterns;
- packaging/provisioning patterns;
- failure diagnosis;
- rollback patterns.

Possible Finance uses include:

- long-running research recovery;
- model job recovery;
- provider/node diagnostics;
- optional engine/sidecar lifecycle;
- zero-setup installation;
- safe upgrades.

---

# 3. Finance transformations worth investigating

These are **examples for donor analysis**, not mandated implementation designs.

## Provider and entitlement access

OpenClaw device/tool/plugin/MCP mechanisms may help expose a capability from the machine where it is legally and technically available.

LiOS Finance then adds the required provider/entitlement/freshness/provenance semantics through its canonical contracts.

A complete donor implementation may be retained where useful; adaptation is only required to the extent necessary for correct LiOS integration.

## Large-scale screening

Useful OpenClaw mechanisms may include dynamic tool discovery, compact orchestration, parallel execution and structured collection.

Combined with P5 identity, provider data and deterministic P11 metrics, these may support large natural-language screening workflows.

## Earnings intelligence

Useful donor mechanisms may include event handling, browser/retrieval, tools, skills, parallel agents and automation.

Combined with Finance evidence/model contracts, these may support:

> earnings/results event → evidence collection → guidance/estimate comparison → model impact → thesis/portfolio impact → Artifact/Decision update.

## Sector and thematic research

Bounded parallelism may support company-level child workstreams plus macro/regulation/evidence-review workstreams, provided cost, evidence and context remain controlled.

## Continuous thesis monitoring

Automation/event mechanisms may be combined with Living Thesis, provider entitlement checks and deterministic recalculation to support:

> new evidence → materiality → thesis/catalyst/invalidation check → calculation update → notification → optional action proposal.

## Multi-device Finance

Device/node capability mechanisms may support a topology where different user-owned devices contribute different capabilities rather than duplicating all data everywhere.

Examples:

- office PC: premium data/research;
- workstation: Excel/broker tooling;
- server: local model/GPU/continuous monitoring;
- Home: canonical local services/state;
- laptop: main product UI;
- phone/tablet: review/approval.

This is a product possibility to evaluate, not a mandate to preserve any donor's original device model unchanged.

---

# 4. Cross-donor combination examples

The canonical donor policy allows combination of approved donors when that produces a stronger LiOS result.

Examples worth evaluating include:

| Finance capability | Possible implementation ingredients |
|---|---|
| quantitative finance | OpenClaw runtime/agent/tool mechanisms + P11 + QuantLib/other approved engines |
| spreadsheets/models | OpenClaw agent/workflow mechanisms + P4 + approved spreadsheet/model donors |
| large analytical tables | orchestration mechanisms + P4/CA + Arrow/DuckDB/Perspective or other approved donors |
| charts/dashboards | orchestration + P4 + approved chart/rendering donors |
| documents/reports | agent/workflow mechanisms + P4 + approved document/PDF tooling |
| presentations | agent/workflow mechanisms + P4 + approved PPTX tooling |
| research | browser/subagent/tool mechanisms + P5/P7 + approved provider/document donors |
| local/private AI | OpenClaw/local-node mechanisms + GM + user-selected local model |
| broker action | donor tool/transport mechanisms + GM-11 + Finance broker/action semantics |
| monitoring | donor automation mechanisms + SI-06 materiality/thesis/portfolio logic |

These examples do not imply that each component is mandatory or that OpenClaw must occupy a particular layer.

A stronger full subsystem from OpenClaw or another approved donor may be used when the canonical donor policy supports it.

---

# 5. Pinned-source truth versus current-upstream research

Current upstream documentation may expose mechanisms not present in LiOS's approved pinned OpenClaw baseline.

Therefore every adoption decision should distinguish:

1. **pinned-source truth** — mechanism verified in the approved donor commit/version;
2. **later approved upstream** — mechanism available in a specifically reviewed later commit/version;
3. **research-only upstream** — useful concept observed in current docs/source but not yet approved for import.

If a useful mechanism is absent from the pinned baseline, the implementation owner may evaluate, under the canonical donor policy and existing version/provenance rules:

- a bounded backport;
- an approved pin/version update;
- adaptation of the mechanism;
- combination with another donor;
- a LiOS-native implementation where justified;
- deferral.

This is source/provenance hygiene, not a preference for or against OpenClaw.

---

# 6. Canonical-authority guardrail

The donor policy permits deep reuse, including substantial/full subsystem reuse.

At the same time, existing LiOS system-of-record authorities remain canonical unless explicitly changed through architecture governance.

Therefore deep OpenClaw reuse may require integration behind or through existing LiOS contracts for areas such as:

- Project/Chat state;
- P4 Artifacts;
- P5 entity/instrument identity;
- P11 deterministic finance authority;
- GM permissions/execution/device authority;
- P13/GM skill/MCP/plugin authority;
- TC visible experience.

This does **not** mean donor implementation must be shallow.

It means the shipped product should avoid accidental duplicate authorities.

---

# 7. Questions for Finance implementation reviews

When OpenClaw may be relevant, reviewers should ask:

- Is there an existing mature OpenClaw subsystem that already solves most or all of this problem?
- Is the useful value a whole subsystem, package, service, algorithm, protocol or mechanism?
- Can it be reused substantially behind the existing LiOS authority?
- Would preserving more of the donor subsystem be stronger than extracting only a small mechanism?
- Is another approved donor stronger for this capability?
- Would a combination of donors produce a better result?
- What modifications are actually necessary for LiOS correctness, security, UX or maintainability?
- Is new implementation genuinely adding value, or merely reproducing mature donor engineering?
- Is the exact donor source/version/license/provenance verified?

The answers should follow `LIOS_DONOR_IMPORT_REUSE_POLICY.md`; this document supplies only research context.

---

# 8. Final reference rule

> **Do not infer donor strategy from this file. Read the canonical donor policy.**

Use this file only to avoid overlooking potentially valuable OpenClaw capabilities when implementing the Finance blueprint.
