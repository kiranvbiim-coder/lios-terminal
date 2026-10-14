# London Strategic Edge Technology Assimilation Plan

**Status:** donor assimilation contract and historical V1 intake evidence; subordinate to the SI execution program and mandatory Shipping Point contract; target adoption is not current shipped truth
**Effective:** 2026-09-22  
**Repository:** `kiranvbiim-coder/lios-v1.0.0`
**Canonical parents:** `../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`, `SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`, `../LIOS_MASTER_PLAN.md`, `../LIOS_ARCHITECTURE.md`, `../LIOS_CONNECTOR_SPEC.md`, `../LIOS_EXECUTION_ROADMAP.md`

> **Decision:** London Strategic Edge is an approved high-priority V1 OSS donor and optional BYOD data-provider target. LiOS should reuse verified MIT-covered code aggressively where it is stronger than, or accelerates, the existing implementation. LiOS must not confuse software rights with rights to LSE-hosted data, branding, trademarks, or unavailable broker-adapter code.

## 1. Why this fits LiOS V1

LiOS already owns the higher-level product model: Projects, Conversations, Artifacts, governed execution, Universal Data Fabric, canonical identity, deterministic finance, BYOD/BYOAI, local-first desktop security and the LiOS visual system. The LSE family can accelerate implementation underneath those contracts.

This is **not** a second terminal architecture and it does **not** reopen P1-P4. Existing LiOS contracts remain authoritative.

SI-01–SI-07 are the strategic execution phases; S0–S10 are validation journeys only and CP phases are historical maturity/evidence references. P5 owns data/identity, P11 owns deterministic engines, P4 owns Artifact state, P13/GM owns skills/MCP/plugin authority, GM owns agent/runtime infrastructure and TC owns visible UX; CA deepens capability behind those owners. Existing P5/P6/P7/P10 task IDs below remain intact, not a competing execution sequence. Dependencies may be pulled forward behind stable contracts, with one owner per shared authority. SI-01.11 / GM-11 authority, sandbox and trust receipts must be proven before privileged interactive `exec.*`; no donor may bypass this gate.

LiOS operates no normal customer intelligence/data runtime cloud. General intelligence and professional work can cover any topic; all eleven finance launch families and native/user-owned deployment scope remain intact. LSE is a specialist donor, not a product-scope limit or a new architecture.

The assimilation rule is:

> **LiOS contract first -> inspect upstream -> adopt/adapt verified MIT implementation -> normalize behind LiOS interfaces -> test -> harden -> ship.**

The objective is to save engineering time while increasing capability in V1.

## 2. Verified upstream sources and pins

Audited on 2026-09-22:

| Component | Repository | Pinned commit | Verified repository license | V1 posture |
| --- | --- | --- | --- | --- |
| LSE Terminal | `londonstrategicedge/lse-terminal` | `62c48a5ce6de37a1c115d6270dfd0eee75166d8b` | MIT | High-priority donor |
| LSE Data Python SDK | `londonstrategicedge/lse-data` | `564c63dd99e3b447777cb396314ec6c4342f82ff` | MIT | Provider SDK donor / optional connector |
| Brue language | `londonstrategicedge/brue` | `a846522fe8af0e11ee7739ef8b6b8a4c0f7922cb` | MIT | Strategy-runtime donor candidate |

### Current implementation versus target adoption

The 2026-09-22 pin/license audit above is dated intake evidence, not a new upstream audit or shipping certificate. P11's `VENDOR` target for LSE Terminal and Brue authorizes evaluation of suitable verified code; it does not establish vendored source, installed packages or an active engine. Current `src/server/p6RuntimeRegistry.ts` records LSE backtest as `research_only` and Brue as `qualified_optional`, both `bundled: false` and `active: false`. Reference/parity/conformance use and optional draft strategy contracts are distinct from an imported working donor runtime.

The LSE Data implementation is a LiOS-owned protocol adaptation, recorded in `third_party/imported-oss-regression.json` for `server/lseDataProvider.ts`, `server/lseRoutes.ts` and `client/src/lib/useLse.ts`; it is not a verbatim import of the pinned Python SDK. An optional connector does not prove every audited SDK endpoint, entitlement, live provider journey, packaged behavior or rights-reviewed public release.

Suitable donor work remains open under LIOS-P6-17–22 / P11 and CA-09/10: compare product/subsystems/mechanisms/transformations, demonstrate a material gap or complementary/challenger benefit, then record exact imported source/destination paths, pins, notices, tests, provisioning and integrated evidence before promoting the target posture. Revisit Terminal/Brue adoption when that analysis identifies a suitable measured capability and rights/security gates pass; reference-only use is not final fulfillment by default.

### Brue Connect warning

The LSE Terminal README references `londonstrategicedge/brue-connect`, but that standalone repository was not retrievable during this audit. The current `brue-language` package metadata also does not declare a `brue-connect` dependency, despite README text describing Brue Connect.

Therefore:

- do **not** assume Brue Connect source is covered by the verified Brue MIT grant;
- do **not** copy or distribute unavailable/unverified Brue Connect code;
- treat any broker-adapter inspection as a separate future source/rights intake gate; current brokerage/order writes remain prohibited even if code rights are later verified;
- reassess if a verifiable source repository/package and license become available.

## 3. Rights boundary

### 3.1 What the verified MIT grants enable

For code actually contained in the verified MIT repositories, LiOS may, subject to preserving required notices:

- use;
- copy;
- modify;
- merge;
- publish;
- distribute;
- sublicense;
- sell copies;
- vendor substantial portions;
- maintain proprietary LiOS code around or on top of the imported components.

Before bundling any copied source, record exact upstream file paths, destination paths, commit SHA, modifications and required copyright/license notice in the LiOS third-party registry.

### 3.2 What MIT does not grant

The repository license does not automatically grant rights in:

- LSE-hosted market/reference data;
- API/service entitlements;
- third-party datasets;
- London Strategic Edge names, logos or trademarks;
- screenshots/marketing artwork where separate rights apply;
- third-party dependency assets outside their own licenses;
- broker integrations whose source/license has not been verified.

### 3.3 LSE-hosted data boundary

The `lse-data` README expressly distinguishes the MIT client library from the data obtained through it. It states that retrieved data may be used for the key-holder's own research, trading and model training, including commercial purposes, but may not be redistributed, resold or made available to third parties through a competing feed/download service/interface sourced from LSE.

User-owned data policy (retaining the V1 rights boundary):

- LiOS may implement the software adapter and SDK integration.
- The user supplies and controls their own LSE key.
- Credentials remain local and must use the LiOS secret-store contract.
- Data is fetched directly for that user's permitted Project/session on Desktop Local or their own Home/runtime; no LiOS customer-runtime relay is introduced.
- LiOS must not operate a central LSE redistribution service.
- LiOS must not cache LSE data centrally for unrelated users.
- Public release/marketing of an LSE-powered connector remains behind a provider-terms review gate because "competing ... interface" language is broad.
- If terms are not compatible, retain the generic provider architecture and disable the LSE-specific production connector without losing any other LiOS capability.

## 4. V1 phase placement

### P1-P4 — preserve, do not reopen

Do not replace:

- Project/Chat/Session hierarchy;
- Conversation Runtime;
- permission model;
- Ledger/reproducibility model;
- Artifact Operating System;
- Living Workspace;
- canonical LiOS UI state.

LSE UI or engine code may only enter through existing replaceable interfaces.

### P5 — primary LSE data integration

P5 is the canonical data entry point, contributing to SI-03 research and SI-05 financial intelligence behind existing identity/data authority. The following remain capability targets, not blanket implementation or provider-entitlement claims:

1. LSE provider adapter behind the LiOS Provider SDK.
2. user-supplied LSE key using local secret storage;
3. runtime capability discovery rather than hard-coded marketing claims;
4. LSE catalogue ingestion into federated instrument discovery;
5. OpenFIGI/canonical identity mapping where applicable;
6. REST historical requests;
7. WebSocket streaming;
8. replay-to-live semantics where useful;
9. bulk Parquet history/import path;
10. quota/usage/entitlement reporting;
11. health states and rate-limit behavior;
12. provenance on every normalized datum;
13. local cache policy that obeys provider rights;
14. provider precedence/fallback without making LSE mandatory;
15. feature flags for any capability still awaiting rights review.

### P6 — quantitative/backtest/strategy acceleration

Evaluate LSE Terminal and Brue code against existing LiOS engines.

Targets:

- `lse_terminal/backtest`;
- `lse_terminal/engine`;
- `lse_terminal/indicators`;
- `lse_terminal/ml`;
- Brue parser/runtime/strategy/conformance code;
- upstream tests relevant to imported behavior.

Adopt only behind LiOS-owned `BacktestEngine`, Strategy/Formula execution, finance-engine and Artifact contracts.

### P7 — research/agent tool acceleration

Study/adapt LSE's assistant-to-engine patterns, workspace-file access and research-tool patterns, but keep the LiOS Agent Runtime, permissions, context envelope, Project state and BYOAI router authoritative.

### P10 — release and OSS hardening

The retained P10 tasks supply OSS/release evidence to P14. Qualification applies continuously throughout SI execution, not only at the end:

- exact imported-file inventory;
- MIT notices;
- third-party notices inherited from copied LSE portions;
- dependency review;
- known-answer/regression tests;
- local-desktop packaging validation;
- provider-data-rights release gate;
- upstream update policy;
- no LSE branding or trademark confusion.

## 5. LSE Terminal subsystem evaluation matrix

| Upstream area | LiOS target | Candidate action (not implementation status) | Intake rule |
| --- | --- | --- | --- |
| `lse_terminal/contracts` | runtime/provider ideas | ADAPT | Map to LiOS contracts; never replace canonical schemas silently |
| `lse_terminal/providers` | Provider SDK/Data Fabric | ADOPT/ADAPT | High priority in P5 |
| `lse_terminal/engine` | local execution sidecar | ADAPT | Use only where stronger than current runtime |
| `lse_terminal/backtest` | BacktestEngine | ADAPT | Compare against current LiOS + approved backtest donors |
| `lse_terminal/indicators` | deterministic technical analytics | ADOPT selectively | Require parity/known-answer tests |
| `lse_terminal/ml` | optional Quant/ML pack | ADAPT | Keep heavy ML/deep dependencies out of base install unless justified |
| `lse_terminal/ui` | interaction reference / reusable widgets | SELECTIVE ADAPT | LiOS UX/theme remains authoritative |
| `frontend/src` | charts/options/screener/workspace patterns | SELECTIVE ADAPT | No LSE branding; reuse code only where it improves LiOS |
| `desktop` | packaging/update reference | COMPARE/ADAPT | Existing LiOS desktop security/release system wins unless upstream is better |
| `tests` | regression/parity suite | ADOPT/PORT | Port tests tied to imported behavior |
| LSE assistant/MCP patterns | LiOS Agent Runtime | ADAPT | Provider-neutral BYOAI and LiOS permissions remain authoritative |

These actions describe candidate reuse behind canonical owners. They are not imported-path inventories or evidence of packaged/provisioned capability. Before adoption, apply the total donor-analysis rule in §17; LSE Terminal/Brue's current inactive/non-bundled posture and the protocol-adapted Data connector are recorded separately in §2.

## 6. LSE Data capability mapping

The audited SDK exposes or documents the following provider capabilities. LiOS should model them as discoverable capabilities rather than guaranteed permanent entitlements:

- instrument catalogue;
- live tick streaming;
- historical candles across multiple timeframes;
- deep/tick history;
- bulk Parquet history/export;
- economic/macro series;
- economic calendar;
- insider trades;
- dividends;
- splits;
- COT positioning;
- financial statements/reports;
- company profiles;
- fundamentals;
- government bond yields;
- options chains;
- options flow;
- option candles;
- option subscriptions;
- provider usage/quota status.

### Normalization targets

Map into existing LiOS canonical families:

- MarketQuote / Tick;
- OHLCVSeries;
- Instrument;
- Company;
- FundamentalMetric;
- FinancialStatement;
- CorporateAction;
- EconomicSeries;
- EconomicEvent;
- YieldSeries / CurvePoint;
- DerivativeContract;
- OptionChain;
- OptionTrade/Flow;
- ProviderUsage;
- DatasetArtifact.

Do not expose raw provider field names as the long-term LiOS semantic contract.

## 7. Proposed LSE provider architecture

```text
User / Project
   |
   v
LiOS Conversation / Artifact / Workspace
   |
   v
Universal Data Router
   |
   +--> Capability Registry
   +--> Identity Resolver / OpenFIGI
   +--> Entitlement + Quota Policy
   |
   v
LSEProviderAdapter
   |
   +--> local credential handle (never plaintext Project state)
   +--> lse-data SDK or protocol-compatible client
   +--> REST historical/reference calls
   +--> WebSocket stream
   +--> Parquet bulk path
   +--> health/usage
   |
   v
Normalization + provenance + local cache
   |
   v
Deterministic engines / artifacts / AI tools
```

Rules:

- no frontend component calls LSE directly;
- no LSE API key enters normal chat/model context;
- provider errors become typed Data Gap / Provider Health states;
- source, timestamp, as-of, frequency and provider identity travel with normalized values;
- project/provider pinning must work;
- another provider may satisfy the same capability without code changes above the Provider SDK;
- LSE is an accelerator, not a single point of failure.

## 8. Catalogue and identity strategy

LSE catalogue discovery can materially improve breadth, but symbol strings are not canonical identity.

Pipeline:

```text
LSE catalogue result
   -> parse asset class / exchange / name / symbol
   -> LiOS local candidate
   -> OpenFIGI / official identifier enrichment when applicable
   -> canonical SecurityId / InstrumentId
   -> provider symbol mapping
   -> searchable local/federated universe
```

Requirements:

- preserve provider symbol as an alias, not the canonical primary key;
- handle multiple listings;
- distinguish underlying vs option contract;
- retain provider-native category and history-span metadata;
- never fabricate mappings;
- unresolved mappings remain explicit.

## 9. Streaming strategy

The LSE WebSocket path should plug into the P5 stream hub rather than creating an LSE-specific UI channel.

Required behavior:

- connect/disconnect/reconnect state;
- dynamic subscribe/unsubscribe;
- bounded subscription management;
- backpressure;
- heartbeat/health;
- timestamp normalization;
- duplicate detection where necessary;
- replay/live marker preservation;
- local cache/windowing;
- quota awareness;
- entitlement failure visibility;
- failover to another configured provider only when policy allows it.

## 10. Bulk history strategy

Use provider-supported Parquet history only through the generic bulk-dataset path.

Requirements:

- job state;
- resumable/local download where upstream supports it;
- quota budgeting;
- storage-size warning;
- user-selected local destination/cache;
- Arrow/DuckDB ingestion where useful;
- provenance retained after import;
- no central redistribution.

## 11. Backtester assimilation strategy

Do not replace the LiOS BacktestEngine contract.

Evaluation order:

1. inventory current LiOS backtest implementation;
2. benchmark LSE `lse_terminal/backtest`;
3. compare with existing approved Backtest Kit / LEAN candidates;
4. identify unique LSE behavior worth importing;
5. port upstream tests;
6. add LiOS known-answer cases;
7. test look-ahead bias, fill timing, commissions, slippage, walk-forward, Monte Carlo and date boundaries;
8. normalize results into LiOS BacktestResult / Artifact schemas;
9. preserve execution receipts and provenance;
10. import substantial code if it is the best implementation.

Expected reusable concepts include walk-forward folds, Monte Carlo resampling, costs/slippage, trade lists, equity/drawdown and risk metrics, subject to code-level verification.

## 12. Indicator and model assimilation

### Indicators

LSE indicator code is a candidate for selective adoption where it closes capability gaps or improves correctness/performance.

Requirements:

- exact upstream path/commit recorded;
- numerical parity tests;
- period/timeframe edge cases;
- missing-data behavior;
- no duplicate competing implementations without a registry decision.

### ML/model tools

LSE Terminal documents/contains ML areas including classical/statistical and optional deep-learning dependencies. Treat these as an optional Quant/ML Runtime Pack candidate, not mandatory base-desktop weight.

Prefer:

- GARCH/statistical volatility;
- Kalman/state-space tooling;
- regime models;
- anomaly/forecast helpers;

before adding multi-gigabyte deep-learning dependencies to the default installer.

All model output must be clearly identified as model-derived, with training window/input/source visible in Show Work.

## 13. Brue evaluation

Brue's verified MIT repository is valuable because it defines a constrained strategy language, runtime, indicators, historical simulation and a conformance corpus.

Potential LiOS use:

- StrategyArtifact language option;
- safe sandboxed strategy logic;
- parser/runtime donor;
- conformance-testing pattern;
- same-strategy historical/live-intent abstraction;
- indicator scripting.

Do not make Brue the only strategy language. Python and future strategy/formula paths remain valid.

Before adoption:

- compare with current Strategy/Formula execution boundary;
- assess security/sandbox properties;
- port conformance corpus;
- confirm fill semantics;
- map commands/results to LiOS schemas;
- keep data fetching outside the strategy runtime;
- keep credentials outside strategy source.

Current LiOS scope prohibits brokerage execution, copy trading and all broker/order writes, irrespective of user confirmation or verified software rights. Strategy/backtest outputs and execution-intent drafts must remain non-executing; historical/live-intent abstraction is not live trading. Brue Connect source/license remains independently unverified and cannot be copied, bundled or activated. A future source/rights audit alone does not change the product prohibition.

## 14. UI assimilation

MIT allows reuse of covered UI source, but LiOS should not become an LSE visual clone.

Allowed:

- copy/adapt useful chart widgets;
- options/screener interaction patterns;
- workspace ergonomics;
- terminal components;
- keyboard/command patterns;
- reusable React primitives where technically superior.

Required:

- LiOS color/theme/system;
- LiOS navigation and Projects/Chats model;
- LiOS terminology;
- no LSE logos/names/marketing assets;
- accessibility acceptance;
- no second workspace state model;
- Artifact and Session state remain canonical in LiOS.

## 15. Desktop/runtime assimilation

Compare LSE desktop packaging/update/sidecar approach with the existing LiOS desktop system.

Adopt only if it improves:

- Python sidecar packaging;
- macOS/Windows build simplicity;
- update reliability;
- startup/recovery;
- local process supervision.

Do not downgrade:

- secret handling;
- CSP/context isolation;
- signed-release goals;
- existing LiOS permission boundaries;
- rollback/recovery controls.

## 16. Concrete V1 execution tasks

These IDs are mirrored into the canonical execution roadmap. Their original P-family labels identify subsystem ownership/history, not a replacement for SI execution phases. They may progress in parallel behind stable contracts; no task below authorizes broker writes or declares an SP accepted.

### P5

- **LIOS-P5-25** — register LSE Data as a Provider SDK donor/optional provider behind LiOS interfaces.
- **LIOS-P5-26** — implement LSE catalogue discovery -> canonical universe/OpenFIGI mapping.
- **LIOS-P5-27** — implement REST/WebSocket/Parquet capability adapters with normalized schemas and provenance.
- **LIOS-P5-28** — implement local LSE credential, health, usage/quota and entitlement handling.
- **LIOS-P5-29** — implement LSE rights/redistribution release gate; no central redistribution.
- **LIOS-P5-30** — integrate LSE with provider precedence/fallback/data-gap logic without provider lock-in.
- **LIOS-P5-31** — integrate replay-to-live stream semantics into the generic stream fabric.

### P6

- **LIOS-P6-17** — audit/benchmark `lse_terminal/backtest` and assimilate superior MIT code behind BacktestEngine.
- **LIOS-P6-18** — audit/port useful LSE indicators with parity tests.
- **LIOS-P6-19** — evaluate LSE ML modules as optional Quant/ML Runtime Pack components.
- **LIOS-P6-20** — audit Brue parser/runtime/conformance suite behind Strategy/Formula contracts.
- **LIOS-P6-21** — implement portable strategy -> backtest -> governed execution-intent contract; no unverified LSE broker connector.
- **LIOS-P6-22** — port relevant LSE/Brue upstream regression tests and add LiOS known-answer tests.

### P7

- **LIOS-P7-11** — assimilate useful LSE assistant/MCP/research-tool patterns behind LiOS Agent Runtime and permissions.

### P10

- **LIOS-P10-11** — final LSE imported-path/notices/modification inventory.
- **LIOS-P10-12** — release validation of LSE data-rights configuration, provider feature flags and upstream regression pins.

## 17. Adoption decision rules

For each meaningful donor/subsystem, analyze product purpose, decomposed components, underlying mechanisms and LiOS transformations before choosing a disposition:

> **ANALYZE → DECOMPOSE → REUSE → ADAPT → REPURPOSE → COMBINE → GENERALIZE → INNOVATE → WRAP → BUILD LAST → REJECT ONLY WITH EVIDENCE**

Allowed dispositions are `DIRECT_REUSE`, `IMPORT`, `ADAPT`, `REPURPOSE`, `COMBINE`, `GENERALIZE`, `INNOVATE`, `REFERENCE_VALIDATOR`, `DEFER_WITH_TRIGGER` and `REJECT_WITH_EVIDENCE`. Record exact source/path/pin, rights, canonical owner, direct/adapted/repurposed/combined/generalized/innovative opportunities, security/privacy/performance/footprint, provisioning, upstream evidence and final decision. The 92-entry donor baseline remains a complete deep-analysis obligation, not an installation quota.

The older V1 `ADOPT`/`ADAPT`/`REFERENCE`/`REJECT` vocabulary describes historical intake intent, not sufficient final SI analysis. Prefer suitable verified imports/adaptations; before overlap or reference-only dismissal, evaluate replacement, complementary and challenger roles. Deferral needs a canonical task, acceptance journey, blocker and revisit trigger; rejection needs evidence, never merely “we can build it ourselves” or the donor's original domain.

## 18. Acceptance gate for each imported LSE subsystem

A subsystem is done only when:

1. exact source path and upstream SHA are recorded;
2. license/notice is recorded;
3. external data/service rights are separated;
4. LiOS canonical state/contracts remain authoritative;
5. tests from upstream are ported where relevant;
6. LiOS known-answer/security tests pass;
7. packaging footprint is acceptable;
8. no upstream branding leaks into LiOS;
9. failure modes integrate with LiOS health/data-gap UX;
10. removal/replacement of the donor would not require a Project persistence rewrite.

Material quantitative adoption also requires explicit units/conventions/tolerances, look-ahead/PIT/fill/cost semantics and reproducible independent known-answer/reconciliation evidence. Current optional/reference source records are not proof of those numerical, sandbox or provisioning gates. Normal users must not install donor Python/strategy runtimes manually: CA-08 and canonical runtime owners must provision/verify/activate/update/rollback required components, with visible size/storage/rights/consent for heavy optional dependencies.

For an SP-01–SP-07 contribution, the canonical issue/PR must define a real Minimum Shippable Journey (such as permitted evidence → canonical identity → deterministic analysis → cited persistent Artifact → restart/export/reopen). All five SP gates apply: real user journey, packaged/target execution where applicable, no fake success, protection of accepted behavior from regression, and exact evidence (commit/build, target/topology, journey, checks/outcomes, permissions/provenance/numerical evidence, limitations, truth level and next dependency). Neither a pin, `VENDOR` target, SDK capability list nor isolated parity test establishes `shipping point accepted`; no SP acceptance is asserted here. P14 remains final release authority.

## 19. V1 product outcome

The target is not "LiOS with an LSE screen."

The target is:

```text
User-connected data
    |
    +-- LSE (optional)
    +-- public/regulatory sources
    +-- broker/provider read-only APIs (no execution/order writes)
    +-- files/databases/cloud
    +-- other premium/free providers
    |
    v
LiOS Universal Data Fabric
    |
    +-- canonical identity
    +-- semantic finance
    +-- deterministic analytics
    +-- backtesting / strategy
    +-- valuation / portfolio / risk
    +-- research / artifacts
    +-- governed AI
    |
    v
LiOS Projects / Conversations / Artifacts
```

London Strategic Edge should accelerate suitable lower-layer capabilities. LiOS remains the provider-neutral Super Intelligence product above them: any-topic intelligence and professional work, with deterministic finance specialization and user-owned runtime.
