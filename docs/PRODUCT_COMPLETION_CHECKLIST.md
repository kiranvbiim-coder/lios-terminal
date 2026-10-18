# Complete product closure checklist

Requested 2026-10-18 after public PR #77; source baseline main 87d35169fd6b5c0e1386ff93c2e550a30985f89f.

This is a complete acceptance checklist derived from the existing SI plan, not a new architecture, roadmap authority or claim of absent code. The canonical SI plan defines scope; PENDING_WORK.md owns current execution/status; the postmortem records evidence and gaps; the Shipping Point contract and P14 own acceptance.

## Rules for completion

Each unchecked canonical item means full closure is not recorded here, not that nothing has been built. Reuse existing implementation and prior valid exact-candidate evidence. Do not redo working features merely to fill checkboxes. No percentage follows from source labels or tests.

An item closes only when: requirement and supported boundary are explicit; all actual consumers are connected; representative real-user success, refusal, failure and recovery work; persistence/restart and relevant security/privacy/rights/numerical invariants hold; applicable target is exercised; and exact source/build/environment/evidence/limitations are recorded. Carry supported partial evidence forward without promoting it to broader acceptance.

For the full original goal, an unavailable device/provider is BLOCKED, not DONE. Defer or remove a promised capability only with explicit owner-approved scope change. Apple signing is deferred due cost; production certification is not waived. Live brokerage execution is not required and remains outside current scope; explicit no-action/paper execution can satisfy the governed finance journey.

## Immediate execution queue

- [ ] **Partial — corrected binary rebuilt and exercised, normal strict calculation still blocked.** Current `87d3516` sidecar/app rebuilt from isolated 109-wheel hash lock. Actual in-package frozen endpoints returned corrected DCF/reverse/matrix, rejected invalid growth (400) and unauthenticated access (401); packaged Home refused historical model revision with 422 and retained version 1.0.0/no runs. Deep ad-hoc seal passed. **Remaining:** normal packaged valuation API returns 502 because canonical strict mode intentionally refuses the long-lived host HTTP sidecar (`pythonService.ts:439–442`); complete isolated execution through existing authority, not an isolation-mode downgrade. Cold first launch still exceeded 90s; subsequent packaged binary startup measured 57.893s and warm staged runtime 2.134s. See `PENDING_WORK.md` for exact hashes/evidence. This item is deliberately not checked complete.
- [ ] Finish target-compatible constrained runtime provisioning or rights-verified immutable native-runtime delivery through existing P10/GM authority. Preserve consent, custody, locks, activation and rollback; never substitute generic host commands or a Linux venv for native macOS/Windows.
- [ ] Qualify fresh standard macOS account installation, cold sidecar startup, permission prompts and retained-state migration; investigate the observed first frozen launch exceeding 90 seconds. Separate-account evidence is not independent-machine evidence.
- [ ] Select and configure an owner-authorized actual model/provider locally for agent/research tests; enforce hard attempt/output limits and obtain approval before paid use. No Ollama/fake-provider substitution for an unavailable required capability.
- [ ] Close confirmed executable-plugin activation, native computer-use transport and checkpoint-safe parallel-agent gaps through existing owners, or obtain explicit scope changes; do not silently downgrade the goal.
- [ ] Run the integrated research/work/finance/monitor/device campaign below; repair actual failures before broad feature expansion.
- [ ] Perform current-candidate numerical, security/privacy, performance, accessibility and installed-target campaigns.
- [ ] Assemble valid SP/P14 evidence; publish only after the final release gates and owner approval.

## Canonical feature closure inventory — all 206 workstreams

### SI-01 — Foundation (17)

- [ ] **SI-01.01 — Donor provenance and subsystem inventory:** maintain exact donor pins, licenses, imported/adapted paths, upstream tests and notices where applicable.
- [ ] **SI-01.02 — LiOS Home:** one zero-configuration local runtime with canonical data root, storage, database, secrets, execution, Gateway and services.
- [ ] **SI-01.03 — Runtime provider seams:** Desktop Local first, while preserving migration to user NAS/server/VPS/cloud.
- [ ] **SI-01.04 — Database portability:** PGlite default; user PostgreSQL as advanced target; migration/relocation without changing product identity.
- [ ] **SI-01.05 — Storage fabric:** local files, user storage/object providers, safe path ownership and integrity.
- [ ] **SI-01.06 — Encryption and secret ownership:** SecretRef authority, OS-protected secrets, no secret leakage into prompts/logs/Artifacts.
- [ ] **SI-01.07 — Backup/restore/Home migration:** complete user-owned portability and recovery.
- [ ] **SI-01.08 — Gateway:** canonical local/remote protocol and capability communication using approved donor mechanisms where useful.
- [ ] **SI-01.09 — Device trust fabric:** identity, pairing, discovery, trust, revocation and node capability advertisement.
- [ ] **SI-01.10 — Execution kernel:** jobs, processes, PTY/backend execution, streaming, timeout, cancellation, reconnect and lifecycle.
- [ ] **SI-01.11 — Execution authority:** exact-operation permissions, sandboxing, policy, approval and trust receipts.
- [ ] **SI-01.12 — Isolation boundaries:** Python, browser, document processors, finance packs and risky tools isolated from core state.
- [ ] **SI-01.13 — Resource controls:** CPU/RAM/storage/time bounds, graceful degradation and hardware-aware safety.
- [ ] **SI-01.14 — Execution receipts and observability:** what ran, why, where, with which permission and result; diagnostics without secret leakage.
- [ ] **SI-01.15 — Offline baseline:** useful deterministic/local capability without LiOS-operated infrastructure.
- [ ] **SI-01.16 — Zero-setup dependency provisioning:** package/download/verify/activate/rollback internal components.
- [ ] **SI-01.17 — Canonical authority convergence:** no donor may introduce a second router/runtime/permission/state authority unintentionally.

### SI-02 — Agentic intelligence (20)

- [ ] **SI-02.01 — Canonical agent runtime:** goal → plan → act → inspect → revise → complete.
- [ ] **SI-02.02 — Governed tool layer:** tools exposed through one LiOS permission/runtime authority.
- [ ] **SI-02.03 — Planning/decomposition:** bounded multi-step planning and dependency ordering.
- [ ] **SI-02.04 — Action policy:** automatic vs approval-required vs prohibited operations.
- [ ] **SI-02.05 — Retry/recovery:** idempotent retry semantics and side-effect protection.
- [ ] **SI-02.06 — Checkpoint/resume:** durable recovery for interrupted long workflows.
- [ ] **SI-02.07 — Cancellation:** reliable user stop for tasks, agents and subjobs.
- [ ] **SI-02.08 — Delegation:** specialized subagents/tools without losing canonical Project/Chat/Artifact context.
- [ ] **SI-02.09 — Multi-agent coordination:** bounded parallel work with shared evidence and explicit ownership.
- [ ] **SI-02.10 — Coding intelligence:** Codex/ACP-style repository understanding, editing, debugging, test execution and patch review.
- [ ] **SI-02.11 — Python/data execution:** governed scientific/data/quant execution.
- [ ] **SI-02.12 — Shell/PTY intelligence:** trusted command execution behind canonical execution authority.
- [ ] **SI-02.13 — Browser intelligence:** web navigation, retrieval, download and workflow automation.
- [ ] **SI-02.14 — Computer-use intelligence:** controlled GUI interaction where APIs/connectors are absent.
- [ ] **SI-02.15 — Session placement:** local desktop, user Home, remote node or user cloud based on policy/capability.
- [ ] **SI-02.16 — Skills:** reusable procedures and domain skills behind P13/GM authority.
- [ ] **SI-02.17 — MCP convergence:** MCP capabilities behind canonical tool/permission/runtime contracts.
- [ ] **SI-02.18 — Agent receipts:** concise visible action/tool/source/assumption records without chain-of-thought exposure.
- [ ] **SI-02.19 — External side-effect safety:** exact authorization, idempotency and reconciliation patterns for consequential operations.
- [ ] **SI-02.20 — General-purpose capability:** agent infrastructure must remain useful beyond finance.

### SI-03 — Knowledge, memory and research (30)

- [ ] **SI-03.01 — Durable memory:** long-lived user/project memory distinct from live Working Context.
- [ ] **SI-03.02 — Dreaming/reflection assimilation:** derive useful durable summaries/patterns under user control.
- [ ] **SI-03.03 — Memory inspect/correct/delete:** memory must be observable and correctable.
- [ ] **SI-03.04 — Project knowledge:** files, conversations, Artifacts and research retrievable as governed context.
- [ ] **SI-03.05 — Cross-project retrieval:** permission-aware retrieval only where explicitly allowed.
- [ ] **SI-03.06 — Hybrid retrieval:** semantic, lexical, structured and entity-aware retrieval.
- [ ] **SI-03.07 — Web research:** search/browse/collect/compare/cite public evidence.
- [ ] **SI-03.08 — Deep research orchestration:** research plans, source diversity, evidence gaps and bounded continuation.
- [ ] **SI-03.09 — Evidence ledger:** source, time, excerpt/field, transformation and downstream usage.
- [ ] **SI-03.10 — Provenance:** important outputs traceable to source data or explicit inference.
- [ ] **SI-03.11 — As-of/freshness semantics:** distinguish retrieval time, observation time and model period.
- [ ] **SI-03.12 — Contradiction detection:** conflicting facts/data surfaced, not silently flattened.
- [ ] **SI-03.13 — Source quality:** authority/first-party/secondary/community distinctions where useful.
- [ ] **SI-03.14 — Entity intelligence:** company/security/listing/instrument/person/entity resolution behind P5.
- [ ] **SI-03.15 — No-ticker/private entity research:** useful research without fabricated identifiers or quotes.
- [ ] **SI-03.16 — Document intelligence:** PDFs, filings, reports, contracts, spreadsheets, presentations and text.
- [ ] **SI-03.17 — Structured extraction:** tables, sections, units, relationships and financial structures.
- [ ] **SI-03.18 — Timeline intelligence:** events, filings, decisions, transactions and changes over time.
- [ ] **SI-03.19 — Thesis/counter-thesis:** supporting evidence, counter-evidence, risks and open questions.
- [ ] **SI-03.20 — Research branching:** alternate hypotheses without contaminating canonical state.
- [ ] **SI-03.21 — Known/unknown model:** explicit uncertain, inaccessible, unavailable, stale and unentitled states.
- [ ] **SI-03.22 — Research Artifact:** durable evolving research output with citations and revisions.
- [ ] **SI-03.23 — Universal Provider & Entitlement Fabric:** normalize capability, authentication/SecretRef, entitlement, freshness, restrictions, locality, AI-transmission rights and unavailable states across public, premium, internal and user-owned sources.
- [ ] **SI-03.24 — Financial Event & Relationship Intelligence:** first-class earnings, filing, guidance, recommendation, corporate-action, financing, deal, rating, macro/policy and regulatory events plus relationship/impact graph context.
- [ ] **SI-03.25 — Broker / Expert / Internal Research Composition:** combine permitted external research, expert content, user files and proprietary/internal research while preserving entitlement and source identity.
- [ ] **SI-03.26 — Numerical Evidence Lineage:** trace material values from provider/document/field/period through normalization/transformation into model/output usage.
- [ ] **SI-03.27 — Living Investment Thesis:** persistent claims, counterclaims, evidence, assumptions, confidence, catalysts, risks, invalidation conditions and changed-since-last-review state.
- [ ] **SI-03.28 — Filing / IR Change Intelligence:** filing, transcript, presentation and disclosure comparison with material-change extraction and historical context.
- [ ] **SI-03.29 — Estimates / Recommendation Evidence:** analyst identity, estimate/rating/target revisions, consensus inputs and historical evidence without hiding source differences.
- [ ] **SI-03.30 — Alternative & Private-Market Evidence Adapters:** permitted alternative/private evidence normalized into the same provenance/entitlement/entity fabric.

### SI-04 — Professional work (31)

- [ ] **SI-04.01 — Canonical Artifact identity/versioning:** P4 remains the only Artifact authority.
- [ ] **SI-04.02 — Chat-to-Artifact:** convert useful results into structured living work.
- [ ] **SI-04.03 — Shared edit state:** direct manipulation and conversational edits modify the same underlying Artifact.
- [ ] **SI-04.04 — Revision history:** compare, restore, branch and reconcile work.
- [ ] **SI-04.05 — Spreadsheet intelligence:** import, inspect, calculate, revise, format and export.
- [ ] **SI-04.06 — Spreadsheet/editor donor integration:** use approved high-quality editing/rendering implementations behind P4 contracts where beneficial.
- [ ] **SI-04.07 — Large analytical tables:** scalable analytical views where fit is proven.
- [ ] **SI-04.08 — Chart intelligence:** interactive analytical visuals where appropriate.
- [ ] **SI-04.09 — Rich documents:** suitable editor implementation behind canonical Artifact state.
- [ ] **SI-04.10 — Professional reports:** research, consulting, investment and analytical reports.
- [ ] **SI-04.11 — Presentation generation:** PPTX with narrative, charts, tables and evidence.
- [ ] **SI-04.12 — XLSX generation:** production-grade spreadsheets and models.
- [ ] **SI-04.13 — DOCX generation:** professional document export.
- [ ] **SI-04.14 — PDF publishing:** reliable final/presentation/print path.
- [ ] **SI-04.15 — Citation preservation:** evidence survives into exported work products.
- [ ] **SI-04.16 — Engine-to-Artifact:** deterministic outputs become usable tables/charts/models.
- [ ] **SI-04.17 — Artifact-to-engine:** Artifact data can feed governed analytical engines.
- [ ] **SI-04.18 — Template intelligence:** reusable structures without module/template maze UX.
- [ ] **SI-04.19 — Round-trip integrity:** import → edit → export → reopen with minimal semantic loss.
- [ ] **SI-04.20 — Multimodal composition:** text, tables, charts, images and structured data in one work product.
- [ ] **SI-04.21 — Professional styling:** coherent layouts, typography and data presentation.
- [ ] **SI-04.22 — Agent-maintained work:** agents update existing Artifacts instead of recreating them.
- [ ] **SI-04.23 — Decision Object Artifact:** persistent objective, evidence, assumptions, alternatives, scenarios, recommendation, dissent, approval, action, outcome and follow-up.
- [ ] **SI-04.24 — Source-Linked Financial Model Cells:** material model values can retain source/period/lineage metadata where available.
- [ ] **SI-04.25 — Financial Model Maintenance / Update Engine:** update reported periods and source-linked actuals while preserving formulas and user assumptions.
- [ ] **SI-04.26 — Model Change / Restatement Report:** show what source/model cells changed, why, and which downstream outputs moved.
- [ ] **SI-04.27 — Finance-Grade Office Round Trip:** preserve useful semantics across XLSX/PPTX/DOCX workflows and refresh/reopen cycles.
- [ ] **SI-04.28 — IC / Credit / Deal Memo Workflows:** evidence-backed institutional decision packages from canonical data/models.
- [ ] **SI-04.29 — Banking Pitch / Board Materials:** professional transaction/corporate-finance presentation workflows.
- [ ] **SI-04.30 — Advisor / Client Proposal & Reporting:** current-vs-proposed, portfolio/goal context and branded client work products.
- [ ] **SI-04.31 — Review / Annotation / Collaborative Decision Package:** comments, review state, approvals and revision history without creating a second collaboration authority.

### SI-05 — Financial and analytical intelligence (40)

- [ ] **SI-05.01 — Market intelligence:** quotes, history, returns, volatility, market context and availability truth.
- [ ] **SI-05.02 — Company fundamentals:** statements, ratios, trends, segments and evidence.
- [ ] **SI-05.03 — Company/security/listing/instrument mapping:** canonical identity before provider calls.
- [ ] **SI-05.04 — DCF/FCFF/FCFE/APV:** deterministic valuation with explicit conventions.
- [ ] **SI-05.05 — Relative valuation:** comps/transactions where permitted evidence exists.
- [ ] **SI-05.06 — Residual income/EVA:** additional deterministic methods.
- [ ] **SI-05.07 — Scenario modeling:** base/bull/bear and arbitrary user-defined scenarios.
- [ ] **SI-05.08 — Sensitivity:** WACC/growth, operating, rate/price and multidimensional sensitivities.
- [ ] **SI-05.09 — Assumption ledger:** material assumptions visible, sourced, revisable and versioned.
- [ ] **SI-05.10 — Portfolio intelligence:** holdings, allocation, performance, attribution and exposure.
- [ ] **SI-05.11 — Risk:** VaR/CVaR, drawdown, stress, factor and scenario risk.
- [ ] **SI-05.12 — Optimization:** efficient frontier, constrained optimization, Black-Litterman where validated.
- [ ] **SI-05.13 — Factor models:** CAPM, Fama-French and validated extensions.
- [ ] **SI-05.14 — Fixed income:** pricing, yield, duration, convexity, curves and spreads.
- [ ] **SI-05.15 — Derivatives:** options/futures/swaps, Greeks and scenario analytics.
- [ ] **SI-05.16 — Quantitative donor integration:** approved finance/quant engines behind P11 with reconciliation evidence.
- [ ] **SI-05.17 — Macro/FX:** GDP, inflation, rates, labor, FX and policy series.
- [ ] **SI-05.18 — Corporate actions/events:** dividends, splits, buybacks, issues and event context.
- [ ] **SI-05.19 — Alternative assets:** permitted commodities, REITs, digital assets and other alternatives.
- [ ] **SI-05.20 — Personal finance:** budget, cash flow, debt, savings, goals, loans and retirement.
- [ ] **SI-05.21 — Wealth scenarios:** deterministic long-horizon planning where conventions/data permit.
- [ ] **SI-05.22 — Research-to-model composition:** evidence feeds engines only through validated canonical mappings.
- [ ] **SI-05.23 — Engine reconciliation:** donor/engine outputs compared against independent known-answer cases.
- [ ] **SI-05.24 — Numerical trust:** units, scaling, conventions, tolerances and non-convergence explicit.
- [ ] **SI-05.25 — Living financial Artifacts:** valuations, portfolios and plans remain revisable persistent work.
- [ ] **SI-05.26 — Earnings & Estimate Intelligence:** results/guidance/transcript/KPI/consensus comparison with materiality and assumption impact.
- [ ] **SI-05.27 — Broker Research Intelligence:** analyst/research revisions, consensus, divergence and thesis/model implications using permitted sources.
- [ ] **SI-05.28 — Universal Natural-Language Screening:** governed screens across supported public/private securities, funds, instruments, portfolios and related entities.
- [ ] **SI-05.29 — Consensus & Disagreement Engine:** compare provider/broker consensus, management guidance, internal model, market-implied expectations and historical accuracy where evidence permits.
- [ ] **SI-05.30 — Financial Model Autopilot:** orchestrate source updates, actual-period mapping, preserved formulas, assumption-impact detection and recalculation through canonical work/engine authority.
- [ ] **SI-05.31 — Financial Twins:** persistent Company, Security, Portfolio, Fund and Household computational representations behind canonical Projects/Chats/Artifacts/state.
- [ ] **SI-05.32 — Scenario & Counterfactual Propagation:** propagate macro/market/company assumption changes through models, securities, portfolios and decisions.
- [ ] **SI-05.33 — Private Markets & Deal Intelligence:** private companies, deals, funds/investors, market maps, screening, diligence, benchmarking and monitoring where entitled.
- [ ] **SI-05.34 — Investment Banking / Corporate Finance:** comps, precedents, DCF/LBO/merger models, accretion/dilution, capital structure, target/buyer screening and transaction materials.
- [ ] **SI-05.35 — Credit Intelligence:** capital structure, ratings, spreads, covenants, liquidity, default/recovery scenarios, refinancing and credit memo workflows.
- [ ] **SI-05.36 — Wealth & Advisor Intelligence:** household/account/goal/model-portfolio/proposal/report workflows with suitability/risk context where applicable.
- [ ] **SI-05.37 — Governed Broker / Execution Semantics:** broker-neutral order/action semantics behind SI-02 authority; paper/simulated path first; live adapters only where technically, contractually and legally permitted with explicit user authority, confirmation and reconciliation.
- [ ] **SI-05.38 — Corporate-Action Decisioning:** explain economic impact, entitlements/options and governed response workflows.
- [ ] **SI-05.39 — Expectation / Surprise Intelligence:** compare reported, consensus, guidance, internal/thesis and market-implied expectations where supported.
- [ ] **SI-05.40 — Financial Truth & Cross-Engine Reconciliation:** preserve observed/calculated/estimate/guidance/user-assumption/AI-inference/market-implied/unknown classes and reconcile material engine outputs.

### SI-06 — Autonomous and everywhere intelligence (34)

- [ ] **SI-06.01 — Save as Task/recipe:** convert successful work into reusable procedures.
- [ ] **SI-06.02 — Scheduled automation:** recurring analyses, refreshes and reports.
- [ ] **SI-06.03 — Conditional automation:** event/data/state-triggered workflows.
- [ ] **SI-06.04 — Monitoring:** companies, portfolios, markets, documents, tasks and system state.
- [ ] **SI-06.05 — Notification intelligence:** useful low-noise notifications without assuming LiOS customer servers.
- [ ] **SI-06.06 — Permission recheck:** recurring work revalidates credentials/authority before execution.
- [ ] **SI-06.07 — Long-running continuity:** recover jobs across restart/disconnect where supported.
- [ ] **SI-06.08 — Proactivity:** surface material changes while preserving user control and avoiding manipulative engagement.
- [ ] **SI-06.09 — BYOAI:** user-selected external model providers.
- [ ] **SI-06.10 — Local AI:** local inference for private/offline/specialized workflows.
- [ ] **SI-06.11 — Model routing:** choose model based on capability, cost policy, privacy and availability.
- [ ] **SI-06.12 — Model fallback:** graceful provider/model failure handling.
- [ ] **SI-06.13 — Local embeddings/retrieval:** private knowledge workflows where useful.
- [ ] **SI-06.14 — Desktop maturity:** strong macOS/Windows local experience.
- [ ] **SI-06.15 — User Home server:** NAS/server/VPS as user-owned always-on Home.
- [ ] **SI-06.16 — User cloud packs:** AWS/Azure/GCP/Kubernetes where user-owned.
- [ ] **SI-06.17 — Headless Home:** server operation without desktop UI.
- [ ] **SI-06.18 — Remote execution nodes:** governed user machines/servers as capability nodes.
- [ ] **SI-06.19 — iPhone/iPad:** native/mobile access to the same Home and canonical state.
- [ ] **SI-06.20 — Android:** same canonical Project/Chat/Artifact model.
- [ ] **SI-06.21 — Watch/Wear:** notifications, lightweight actions and status.
- [ ] **SI-06.22 — Offline outbox:** queue safe actions/work while disconnected.
- [ ] **SI-06.23 — Cross-device continuity:** same state, permissions and Artifact history everywhere.
- [ ] **SI-06.24 — Intelligent compute placement:** choose local/Home/remote node based on capability and policy.
- [ ] **SI-06.25 — Hardware awareness:** adapt execution/model/resource choices to machine capability.
- [ ] **SI-06.26 — Continuous Financial Intelligence:** turn accepted Finance workflows into governed monitors that rerun research/model/decision logic on material change.
- [ ] **SI-06.27 — Thesis Invalidation Monitoring:** continuously test Living Thesis conditions and counter-evidence without silently changing the user's decision.
- [ ] **SI-06.28 — Earnings / Filings / Estimate Event Automation:** event-triggered research and impact workflows with entitlement/freshness rechecks.
- [ ] **SI-06.29 — Continuous Model Refresh:** refresh source-linked actuals/models through canonical Artifact/engine paths with reviewable change reports.
- [ ] **SI-06.30 — Portfolio Materiality Monitor:** detect portfolio-relevant company/market/risk changes and suppress immaterial/noisy updates.
- [ ] **SI-06.31 — Entitlement-Aware Provider Routing:** choose among permitted sources based on entitlement, freshness, rights, locality and capability rather than silently substituting unavailable data.
- [ ] **SI-06.32 — Model + Provider + Compute Joint Routing:** choose suitable model, data source and execution placement using capability, privacy, rights, cost, latency and availability policy.
- [ ] **SI-06.33 — Cross-Device Financial Review & Approval:** review/approve/reject governed decisions/actions from authorized devices while execution remains on eligible nodes.
- [ ] **SI-06.34 — Node-Local Financial Capability Placement:** expose provider, database, broker, local-model or specialist-software capability from the user-owned environment where it is permitted to run.

### SI-07 — Convergence and release (34)

- [ ] **SI-07.01 — One-app convergence:** users see LiOS, not donor brands or infrastructure fragmentation.
- [ ] **SI-07.02 — Conversation-first experience:** intent is primary; capabilities appear contextually through progressive disclosure.
- [ ] **SI-07.03 — Cross-capability composition:** dynamically combine browser, agents, memory, coding, finance, documents, Artifacts and automation.
- [ ] **SI-07.04 — Capability discovery:** LiOS knows what capabilities are installed, permitted, connected, healthy and available.
- [ ] **SI-07.05 — Dynamic execution planning:** select appropriate models/tools/engines/nodes based on task and policy.
- [ ] **SI-07.06 — System Agent:** diagnose LiOS runtime, connectors, packs, permissions, data and configuration.
- [ ] **SI-07.07 — Doctor/repair:** detect and repair missing dependencies, corrupt state and misconfiguration safely.
- [ ] **SI-07.08 — Zero-setup provisioning:** install/verify/configure required components automatically.
- [ ] **SI-07.09 — Lazy capability installation:** heavy engines/assets only when needed, with consent and rollback.
- [ ] **SI-07.10 — Safe upgrades:** side-by-side component/app update and rollback.
- [ ] **SI-07.11 — Migration:** schemas, Artifacts, Home topology and donor versions.
- [ ] **SI-07.12 — Backup/restore qualification:** full recovery exercised, not documented only.
- [ ] **SI-07.13 — Security qualification:** permissions, secrets, sandbox, node trust and external actions.
- [ ] **SI-07.14 — Privacy qualification:** local/private boundaries and cloud-AI consent behavior.
- [ ] **SI-07.15 — Numerical qualification:** finance engines benchmarked/reconciled.
- [ ] **SI-07.16 — Provenance qualification:** evidence, as-of and assumptions survive through final outputs.
- [ ] **SI-07.17 — Performance qualification:** startup, prompt-to-result, research, execution, large files/tables, charts, restore.
- [ ] **SI-07.18 — Resource efficiency:** usable on mainstream hardware with graceful degradation.
- [ ] **SI-07.19 — Failure resilience:** offline, provider/model/tool/node failure, interrupted work and corrupt-state recovery.
- [ ] **SI-07.20 — Accessibility:** keyboard, focus, screen reader, scaling and interaction quality.
- [ ] **SI-07.21 — UX convergence:** remove duplicate workbenches, module mazes, overlapping surfaces and infrastructure-first UX.
- [ ] **SI-07.22 — Packaging/installers:** real desktop and server/user-owned deployment packages.
- [ ] **SI-07.23 — Cross-platform qualification:** macOS, Windows and supported user-owned server targets.
- [ ] **SI-07.24 — S0–S10 validation matrix:** use former slices as end-to-end scenario coverage, not execution limits.
- [ ] **SI-07.25 — P14 qualification:** preserve final existing release authority.
- [ ] **SI-07.26 — Product documentation:** install, privacy, architecture, troubleshooting, capabilities, backups and recovery.
- [ ] **SI-07.27 — Release candidate:** identified reproducible build with evidence.
- [ ] **SI-07.28 — Production release:** only after release truth reaches the agreed target.
- [ ] **SI-07.29 — Global Financial Command / Search:** one conversational/search entry point across supported Finance entities, evidence, models, portfolios, work products and actions.
- [ ] **SI-07.30 — Unified Source / Truth / Lineage Inspector:** inspect source, entitlement, freshness, numerical class, transformation and downstream use from one coherent surface.
- [ ] **SI-07.31 — Unified Decision / Action Review Surface:** review evidence, assumptions, alternatives, risk, approvals, proposed actions and outcomes without jumping between disconnected modules.
- [ ] **SI-07.32 — Role-Aware Progressive Finance UX:** expose appropriate depth for analyst, PM, advisor, finance professional or individual without creating separate product architectures.
- [ ] **SI-07.33 — Governed Finance Capability Marketplace:** provider/tool/skill/workflow/visualization/adapter extensibility behind canonical permission, plugin and donor-policy contracts.
- [ ] **SI-07.34 — Institutional Audit / RBAC / Policy Convergence:** organization controls, auditability and policy surfaces converge with Finance workflows where applicable.

## Seven integrated user journeys — acceptance, not seven more implementations

These journeys connect the inventory above. Earlier passing bounded steps are evidence to retain, not grounds to omit the remaining contract. All five Shipping Point gates apply: real outcome, applicable target, truthful unavailable states, regression protection and exact evidence.

- [ ] **SP-01 secure local:** fresh install → owner → Project/Chat → exact approval and denial → isolated execution/stream → receipt → cancel/extinction → reconnect → persistence/restart/restore. Existing nine-check local package evidence covers substantial steps; clean installation and full V3 contract remain separate.
- [ ] **SP-02 agent:** actual model → bounded plan → approved tools/browser/Python → inspect failure and revise → safe delegation → checkpoint/restart/resume → cancel → useful retained output without duplicate side effects.
- [ ] **SP-03 research:** real permitted public/Project/connected sources → canonical entity/topic → source diversity → contradictions/unknowns → entitlement/as-of truth → cited durable Research Artifact → reopen after restart.
- [ ] **SP-04 living work:** real spreadsheet/document/evidence → canonical Artifact → conversational and direct edits on the same state → formulas/assumptions/citations → deterministic table/chart → version comparison/restore → real export and external reopen/roundtrip without hidden semantic loss.
- [ ] **SP-05 finance:** real company/security/portfolio → permitted filings/market/research → material change → explicit assumptions → independently reconciled valuation/scenario/risk → portfolio impact → thesis/Decision → professional output → explicit no-action or governed paper action → reconciliation/receipts.
- [ ] **SP-06 continuity:** accepted one-shot workflow → saved monitor/task → real event/schedule → current rights/credentials/freshness checks → evidence/model/materiality update → quiet notification → authorized second-device review → optional paper/no-action decision → disconnect/restart continuity.
- [ ] **SP-07 candidate:** reproducible target build → clean install → actual approved data/model → cross-capability output → automation/device continuation → Doctor/install/upgrade/rollback/migration/restore → security/privacy/numerical/provenance/performance/accessibility/failure campaigns → applicable S0–S10 → P14 submission.

## Cross-cutting verification checklist

### Numerical and evidence integrity

- [ ] Independently qualify every supported material-decision engine family: units, currencies, periods, conventions, rounding and tolerances.
- [ ] Include zero/negative/extreme/boundary cases, infeasible assumptions, non-convergence and finite-output checks.
- [ ] Use independent known answers/reference implementations, not only repeatability, monotonicity or registry presence.
- [ ] Record seeds and reproducibility boundaries; label experimental/unseeded paths.
- [ ] Carry observed/calculated/estimate/guidance/assumption/inference/unknown classifications through reports and exports.
- [ ] Preserve immutable historical versions; explicit model-revision incompatibility and recalculation consent.
- [ ] Validate provenance/entitlement/freshness at execution and final-output use, including revocation and disagreement.

### Security, privacy and consequential operations

- [ ] Current account/role/organization/Project ownership checks across HTTP, Gateway, native and background runs.
- [ ] Cross-tenant, revoked-device, stale-grant, expired-approval and replay refusals.
- [ ] Exact operation/input/cwd/environment/source/target/policy binding through approval, execution and receipts.
- [ ] Real sandbox filesystem/process/network isolation, bounded resource use, cancellation and no surviving descendants.
- [ ] Protect credentials at rest and in transit; no secrets in logs, prompts, exports or evidence.
- [ ] Explicit cloud-AI transmission consent, local-only policy, redirect/SSRF/egress refusals and provider-fallback privacy.
- [ ] Proposal/approval/execution/confirmation/reconciliation remain separate; interruption never silently replays consequential work.
- [ ] Supply-chain/advisory review, exact dependency/runtime/model hashes, retained license notices and distribution rights.
- [ ] Independent targeted security review; history/public-surface secret review and incident/backup ownership. No public disclosure of exploitable findings or private data.

### Recovery, usability and resources

- [ ] Network, provider/model, tool, node, disk-full and permission failure remain actionable and truthful.
- [ ] Crash/interruption and partial-publication recovery; failed upgrade/restore leaves a recoverable prior state.
- [ ] Encrypted backup portability/re-key, real restore and supported database/topology migration.
- [ ] Cold/warm startup, time-to-useful-result, long sessions, memory/CPU/disk, large files/tables/charts and restore measured on declared mainstream targets.
- [ ] Resource admission and graceful degradation preserve safety floors without disabling ordinary supported work.
- [ ] Keyboard-only navigation, visible focus, modal handoff, screen-reader labels, scaling and contrast.
- [ ] Actual VoiceOver and Windows Narrator journeys, not only DOM assertions.
- [ ] No duplicated workbenches or provider/runtime setup exposed unnecessarily for ordinary user requests.

## Target qualification checklist

- [ ] macOS arm64 installed package on a fresh account and an independent clean target; cold runtime, Keychain, local data and permissions.
- [ ] Windows x64 installed package: ACL/secret custody, ConPTY, process cancellation, paths/file locks, sandbox image and recovery.
- [ ] Intel macOS or other targets only if explicitly promised; separately qualify them rather than inferring arm64 coverage.
- [ ] Headless/user Home real deployment: persistent storage, bootstrap, TLS, remote access, backup and restart.
- [ ] Each advertised cloud/server topology: real deployment/API validation, storage/CSI, restricted execution and recovery; rendered manifests alone do not pass.
- [ ] iPhone/iPad actual SDK builds and native journeys.
- [ ] Android actual SDK build and native journeys.
- [ ] Watch/watchOS and Wear actual builds, pairing/notification/review journeys.
- [ ] Cross-device same-Home state, offline/outbox, reconnect, revocation and no duplicate action.
- [ ] Target-specific release locks/runtime bundles and optional pack lifecycle; native ABI/platform correctness.

## Final release checklist — P14 remains authoritative

- [ ] Identify exact release tag/version, supported-platform/capability envelope and reproducible build inputs.
- [ ] All 206 workstreams accepted within their declared canonical requirements, or each change/deferment explicitly approved by the owner; no silent scope reduction.
- [ ] Seven Shipping Points accepted with exact evidence and previously accepted behavior regression-protected.
- [ ] Resolve authorized public-compatible qualification/release inputs without importing withheld private workflows/data or weakening checks.
- [ ] Required hosted source checks green at the exact release candidate; no admin bypass or undisclosed skip.
- [ ] Exact installer/runtime/archive hashes, bill of materials, donor provenance/rights and model/data rights reviewed.
- [ ] **P14: mac_clean_install** — actual candidate installed and exercised.
- [ ] **P14: windows_clean_install** — actual candidate installed and exercised.
- [ ] **P14: update_rollback** — N→N+1 update and failure rollback preserve data.
- [ ] **P14: pack_lifecycle** — verified install/lazy/upgrade/rollback/revoke through supported authority.
- [ ] **P14: workspace_restore** — retained Project/Chat/Artifact/version/receipt state restored.
- [ ] **P14: recovery** — representative interruption/failure/restore proof.
- [ ] **P14: security_privacy** — scoped security/privacy campaign and limitations.
- [ ] **P14: release_rights** — exact distributed payload clearance and notices.
- [ ] **P14: performance** — measured supported workloads/targets.
- [ ] **P14: voiceover** — actual macOS assistive-technology journey.
- [ ] **P14: narrator** — actual Windows assistive-technology journey.
- [ ] **P14: keyboard** — complete critical keyboard workflows.
- [ ] **P14: first_use** — new user reaches useful result without developer setup.
- [ ] **P14: flagship** — actual integrated finance/professional workflow with receipts.
- [ ] Developer ID signing/notarization/stapling and approved Windows signing where required. Apple identity currently owner-deferred; not falsely marked complete.
- [ ] Real approved update hosting with verified metadata/artifact delivery; chosen GitHub Releases URL alone is not a live feed.
- [ ] Installation/privacy/security/backup/recovery/troubleshooting documentation matches actual binaries and supported limits.
- [ ] Explicit owner go/no-go approval; publish only reviewed artifacts and never credentials/user/provider data.
- [ ] Verify public download/install/update after publication; retain private operational evidence, support/rollback process and known limitations.

## Information needed from the owner at the relevant step

- [ ] Fresh standard macOS account and later independent clean target access.
- [ ] Authorized actual AI/model choice and spending ceiling; credentials configured locally, never in chat.
- [ ] Lawfully permitted real source/finance data and entitlement for the selected flagship; no fabricated or redistributable-by-assumption data.
- [ ] Windows/native-device/server/cluster targets and appropriate SDKs for claimed platforms.
- [ ] Rights/release decisions that cannot be established from code and existing manifests.
- [ ] Apple membership/signing/notarization only when the owner elects to fund normal signed macOS distribution.

**Finished means the supported product works end to end and its release evidence is accepted—not simply that all code compiles, a PR merges, or this document has checkmarks.**
