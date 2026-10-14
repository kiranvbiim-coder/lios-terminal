# LiOS Finance Competitive Capability Matrix

**Status:** RESEARCH BASELINE / PRODUCT CAPABILITY ENVELOPE  
**Research date:** 2026-10-05  
**Parent:** `docs/technical/LIOS_FINANCE_INTELLIGENCE_TO_ACTION_BLUEPRINT.md`  

---

## 0. Purpose

This matrix records the final competitor-research baseline used to expand LiOS Finance before SI-02 closure. It is not a license to copy proprietary code/data/branding. Publicly observable product workflows and mechanisms may be emulated or improved; restricted content and implementations require rights.

The key market conclusion is:

> **AI + financial data + chat + citations is already table stakes. LiOS must compete as a governed intelligence-to-action operating system, not as another AI terminal.**

---

# 1. Competitor capability map

| Reference product | Publicly observable strengths to match/learn from | LiOS mapping / leapfrog target |
|---|---|---|
| Bloomberg Terminal / ASKB | multi-asset data/research; conversational AI; pre/post-earnings workflows; structured outputs; BQL transparency; broad documents; Excel/BQuant continuation | global financial command; inspectable tool/query lineage; Finance workflows; provider-neutral equivalent across user entitlements; deterministic engines; Decision Objects |
| AlphaSense / Tegus / BamSEC | premium broker/research content; workflow agents; expert-call research; multi-document analysis; filing search/comparison; historical table extraction; alerts | broker/expert/internal research composition; filing/IR intelligence; reusable governed skills; evidence ledger; Living Thesis; cross-provider research |
| FactSet | governed portfolio analytics; performance/attribution/risk; institutional data workflows; agentic/MCP access; Office integration | deterministic Portfolio Twin; P11 analytics exposed through governed tools; audit-ready agent access; source-linked living Artifacts |
| S&P Capital IQ Pro / Visible Alpha | fundamentals, estimates, ownership, private companies, fixed income, transactions; ChatIQ; Document Intelligence; Chart Explainer; screening; linked Excel workflows | universal provider fabric; estimate/recommendation engine; private/deal coverage; NL screen; model update; chart/evidence explanations with lineage |
| LSEG Workspace / REDI | Reuters/news; broker research; estimates/recommendations; portfolio context; options/macro; Deep Research; broker connectivity and execution | research→decision→governed action; broker-neutral execution semantics; portfolio/risk + hedge context; user-directed approval and reconciliation |
| OpenBB Workspace | custom backends; proprietary-data integration; custom agents; composable widgets/dashboards | BYO provider/backend; BYO agent/model; governed plugin/provider SDK; conversation-first instead of dashboard-first; user-owned runtime |
| Koyfin | fast UX; screens/charts; client portfolios/households; custodian imports; statement ingestion; proposals/reports; alerts | role-aware fast Finance UX; household/wealth Twin; advisor workflows; source-linked client reports; continuous intelligence |
| Morningstar Direct | public/private portfolio analysis; portfolio construction; reporting/presentation; model portfolios | portfolio construction; public/private convergence; scenario/optimization; Presentation/Artifact system; advisor/institutional reporting |
| PitchBook | companies/deals/investors/funds/LPs; private-market screening; fund benchmarks; deal sourcing/diligence; Excel/PowerPoint/CRM/API integration | Private Markets Twin; deal/fund/investor ontology; target/buyer/fundraising screens; diligence/IC workflows; user entitlement via provider adapter |
| Daloopa | source-linked financials; spreadsheet/model updates; standardized KPI extraction; traceability | generalized Numerical Lineage; source-linked model cells; formula-preserving model maintenance; model-change report; provider-neutral implementation |
| Quartr | first-party filings/transcripts/slides; live calls; source traceability; messaging/slide-change analysis; event/schedule Automations | Earnings Cockpit; IR event layer; transcript/slide historical diff; automatic event-triggered analysis; thesis/model impact propagation |
| ChatGPT for Financial Services | frontier reasoning + built-in premium datasets + existing subscription entitlement integrations + financial analysis/modeling/client materials | do not compete on chat alone; differentiate with user-owned runtime, BYOAI, provider/broker neutrality, deterministic engines, multi-device placement, governed actions and persistent professional objects |

---

# 2. Research evidence / official product references

These links are reference evidence for capability analysis, not bundled dependencies or permission to redistribute data.

## Bloomberg

- `https://professional.bloomberg.com/products/bloomberg-terminal/ai`
  - ASKB data analysis can expose underlying BQL.
  - supports structured pre-/post-earnings and other agentic workflows.

## FactSet

- `https://investor.factset.com/news-releases/news-release-details/factset-expands-model-context-protocol-suite-portfolio-analytics`
  - June 2026 Portfolio Analytics MCP exposes governed pre-calculated performance/attribution/risk analytics into agentic interfaces.

## S&P Capital IQ Pro

- `https://www.spglobal.com/market-intelligence/en/solutions/products/sp-capital-iq-pro`
  - public/private company coverage, estimates, fixed income, ownership, transactions, macro;
  - ChatIQ, Document Intelligence, Chart Explainer;
  - linked Excel and banking/deal workflows.

## LSEG Workspace / REDI

- `https://www.lseg.com/en/data-analytics/products/workspace/redi-on-workspace-oems/extend-workspace-into-trading-workflow/extend-workspace-into-execution`
  - explicitly connects charts/research/Deep Research/broker routing/liquidity to execution workflows.

## OpenBB

- `https://docs.openbb.co/workspace/developers/data-integration`
  - custom backends integrate proprietary data/APIs and make them available to Workspace/AI.
- `https://docs.openbb.co/workspace/developers/agents-integration`
  - user-supplied agent services integrate through a streaming contract.

## Koyfin

- `https://www.koyfin.com/features/client-portfolios/`
  - household/account organization, integrations/PDF statement import, analytics, reports and alerts.
- `https://www.koyfin.com/features/proposals/`
  - custodian/portfolio-system sync and current-vs-proposed client reporting.

## Morningstar

- `https://www.morningstar.com/business/products/direct/portfolio-management-tool`
  - unified public/private portfolio analysis.
- `https://www.morningstar.com/business/products/direct/presentation-studio`
  - repeatable branded reporting and presentation workflows.

## PitchBook

- `https://pitchbook.com/products`
  - private-capital data, screening, fund analysis, credit/debt, plugins/integrations.
- `https://pitchbook.com/platform-data/deals`
  - deal screening, comps/terms/multiples, sourcing/diligence/valuation/execution workflows.
- `https://pitchbook.com/products/direct-access-data/api`
  - API access for company/deal/investor/fund and related entity data.

## Quartr

- `https://quartr.com/products/quartr-pro`
  - first-party IR search, live calls/transcripts, source tracing, slide-history comparison.
- `https://quartr.com/newsroom/press-release/quartr-launches-automations`
  - event-triggered and scheduled research Automations launched August 2026.

## BamSEC

- `https://www.bamsec.com/features`
  - filing/transcript search, filing comparison, historical tables, collaboration and alerts.
- `https://www.bamsec.com/features/table-tools`
  - prior table versions and direct Excel downloads from filings.

## OpenAI / Financial Services market benchmark

- `https://openai.com/index/introducing-chatgpt-financial-services/`
  - September 2026: financial-services product with built-in premium data, connected/subscription data, financial workflows, models and client materials.
- `https://openai.com/policies/financial-services-terms/`
  - current provider listing demonstrates how multiple licensed data families can coexist behind one AI product while retaining source/timing constraints.

---

# 3. Capability families LiOS must cover

## Research and evidence

- public web and filings;
- premium broker research;
- expert/internal research;
- transcripts and investor presentations;
- document comparison and change detection;
- table/history extraction;
- source quality/conflict detection;
- granular citations/provenance;
- scheduled/custom research workflows.

## Company, market and estimates

- identity/security mapping;
- public/private company intelligence;
- fundamentals and segments;
- estimates and recommendations;
- earnings/guidance;
- ownership/investor relationships where entitled;
- screeners;
- charts/technical context;
- corporate actions.

## Analytical work

- valuation;
- deterministic scenario/sensitivity;
- source-linked models;
- formula-preserving updates;
- model change reports;
- cross-engine reconciliation;
- professional tables/charts.

## Portfolio and risk

- holdings/accounts;
- performance/attribution;
- factor/exposure;
- VaR/stress/liquidity;
- optimization;
- hedging;
- public/private look-through where data exists;
- event/thesis materiality.

## Markets beyond equities

- fixed income;
- rates/curves;
- derivatives;
- futures/commodities;
- FX;
- macro/policy series;
- alternatives.

## Private markets / deals / credit

- companies/deals/funds/investors/LPs;
- market maps;
- deal/fund screens;
- precedent/comps;
- fundraising/target/buyer workflows;
- private-credit/debt/lender workflows;
- diligence;
- portfolio-company monitoring;
- exit scenarios.

## Wealth/advisor

- household/account hierarchy;
- statement/custodian/provider ingestion;
- model portfolios;
- goals/scenarios;
- current-vs-proposed analysis;
- fees/risk/performance reports;
- branded client proposals;
- monitoring.

## Action / execution

- action proposal;
- pre-action risk/policy checks;
- exact user approval;
- broker/provider adapter;
- paper execution first;
- live execution where later permitted;
- cancel/replace where applicable;
- confirmation/reconciliation;
- durable receipt.

---

# 4. LiOS leapfrog requirements

Competitor parity is insufficient. LiOS should go beyond the reference products through:

1. **Provider neutrality** — one system across whichever sources the customer is entitled to use.
2. **Model neutrality / BYOAI** — reasoning provider is independent of LiOS state and deterministic truth.
3. **Broker neutrality** — action layer does not assume one brokerage ecosystem.
4. **User-owned runtime** — data and compute can remain on customer devices/Home/nodes.
5. **Capability-aware multi-device placement** — a device can contribute data, credentials, software, network access, compute or models.
6. **Numerical lineage** — source-to-cell-to-engine-to-decision traceability.
7. **Financial truth classification** — observed/calculated/estimate/guidance/assumption/inference/unknown remain distinct.
8. **Living Thesis + Decision Object + Financial Twins** — persistent professional intelligence objects rather than ephemeral chat answers.
9. **Deterministic + generative composition** — AI orchestrates validated finance engines.
10. **Governed action** — decision-to-action uses exact authorization/idempotency/reconciliation rather than generic autonomous tool calls.
11. **Continuous intelligence** — monitor theses/models/portfolios/events, not merely prices/news.
12. **Cross-donor ecosystem** — maximum reuse of OpenClaw structural mechanisms plus specialist donors behind canonical LiOS owners.

---

# 5. Final strategic conclusion

LiOS should not position itself as:

- a cheaper Bloomberg clone;
- a ChatGPT wrapper for stocks;
- another financial-data dashboard;
- an isolated research agent;
- a collection of finance modules.

The target category is:

> **A user-owned Financial Intelligence-to-Action OS that lets the customer's data, providers, AI, models, tools, brokers, devices and compute work as one governed system with verifiable financial truth.**

That is the competitor-superset target used by the SI-03→SI-07 additions in the parent blueprint.
