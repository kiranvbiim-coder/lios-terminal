# P11 OSS Candidate Decision Matrix

**Status:** GOVERNED P11 CANDIDATE DECISION INVENTORY — PRODUCTIZED PACK INTEGRATIONS OPEN
**Effective:** 2026-09-23  
**Parent:** `docs/technical/P11_ENGINE_FABRIC_SPEC.md`  
**Rule:** this file records target integration posture and current evidence separately. It is not permission to bundle a project without exact commit/version/license/dependency review. SI execution and the mandatory Shipping Point contract govern delivery; P11/GM/P4/P5/CA owners remain singular.

## 1. Decision vocabulary

- **LIBRARY** — install pinned package/source into an isolated LiOS pack and call it only through LiOS adapters.
- **VENDOR** — copy permitted upstream source/subsystems into LiOS-controlled code with exact upstream path/commit attribution.
- **SIDECAR** — package/run a separate local runtime and communicate through LEP/canonical schemas.
- **CONNECTOR** — integrate through LiOS Provider/Connector SDK, not as an analytical engine.
- **REFERENCE** — use for benchmarking/design/tests only; do not ship its code under current decision.
- **REJECT** — do not use in LiOS under current licensing/quality/product posture.

A project may have two modes only when distinct subsystems genuinely require them (for example LIBRARY for analytics but CONNECTOR for its optional data path).

Unless a row explicitly records existing integration, its mode is a target candidate decision, not an imported/bundled/provisioned component. The P11 donor inventory records zero bundled P11 donor projects; existing managed/core implementations are separate evidence. Priority bands are candidate evaluation priorities, not SI phases or proof of SP acceptance. Suitable reference/deferred donors still require full mechanism/repurpose/combine analysis and an owned evidence-based revisit; current overlap alone does not discharge that obligation.

## 2. Pack-level decision matrix

### 2.1 Core Finance Pack

| Project | Repository | License posture verified 2026-09-22 | Decision | Role in LiOS | P11 action |
| --- | --- | --- | --- | --- | --- |
| FinanceToolkit | `JerBouma/FinanceToolkit` | MIT | **LIBRARY** | broad ratios, performance, risk, valuation/econometric finance methods | wrap behind FinanceEngine; disable/avoid provider assumptions where LiOS data is available; port known-answer cases |
| statsmodels | `statsmodels/statsmodels` | BSD-3-Clause | **LIBRARY** | econometrics/statistics/time series | already in managed core; formalize capability adapters rather than direct scattered imports |
| existing LiOS deterministic engines | LiOS | proprietary/internal | **PRIMARY** | calculator-of-record where already stronger/stable | preserve; donor engines complement/validate rather than automatically replace |
| TA-Lib Python | `ta-lib/ta-lib-python` | BSD-2-Clause | **LIBRARY** | standard technical indicators | use behind TechnicalEngine registry; parity-test conventions |
| pandas-ta-classic | `xgboosted/pandas-ta-classic` | exact release/license requires fresh verification | **REFERENCE** | extended-indicator benchmark | TA-Lib/current LiOS are the launch path; no bundle in initial P11 |

### 2.2 Portfolio Pack

| Project | Repository | License | Decision | Role | P11 action |
| --- | --- | --- | --- | --- | --- |
| skfolio | `skfolio/skfolio` | BSD-3-Clause | **LIBRARY** | advanced portfolio optimization/risk/model evaluation | high-priority pack engine; canonical LiOS request/result adapters |
| Riskfolio-Lib | `dcajasn/Riskfolio-Lib` | BSD-3-Clause | **LIBRARY** | broad optimization/risk measures | use for capabilities where stronger/distinct; no duplicate default path without routing decision |
| PyPortfolioOpt | `PyPortfolio/PyPortfolioOpt` | MIT | **LIBRARY** | efficient frontier, Black-Litterman, HRP, expected returns/covariance | likely primary for classic Black-Litterman/EF capability; validate against skfolio |
| QuantStats | `ranaroussi/quantstats` | Apache-2.0 | **LIBRARY** | performance/risk analytics and tear-sheet metrics | use calculations/output data; LiOS owns visual/report presentation |
| CVXPY | `cvxpy/cvxpy` | Apache-2.0 | **LIBRARY** | optimization modeling layer | use behind portfolio/optimization engines; audit each solver dependency/license separately |
| bt | `pmorissette/bt` | MIT | **REFERENCE** | portfolio/backtest construction | benchmark against LiOS BacktestEngine and selected strategy pack; do not add redundant runtime by default |

### 2.3 Pricing & Risk Pack

| Project | Repository | License | Decision | Role | P11 action |
| --- | --- | --- | --- | --- | --- |
| QuantLib | `lballabio/QuantLib` | QuantLib permissive license | **LIBRARY** | core fixed-income/derivative pricing, term structures, day-count/calendar primitives | already approved/managed; formalize as PricingEngine |
| Open Source Risk Engine (ORE) | `OpenSourceRisk/Engine` | permissive BSD-style license confirmed from `license.txt` | **SIDECAR** | institutional simulation/risk/XVA/scenario analytics built on QuantLib ecosystem | highest-priority native sidecar proof; exact third-party/submodule audit required |
| OpenGamma Strata | `OpenGamma/Strata` | Apache-2.0 | **SIDECAR** | Java pricing/risk, rates/FX/instrument analytics | JVM sidecar only for capabilities that improve/validate LiOS; no Java leakage into core |
| py_vollib | `vollib/py_vollib` | MIT | **LIBRARY** | lightweight option pricing/IV/Greeks | validator/fast path behind option capability |
| py_vollib_vectorized | `marcdemers/py_vollib_vectorized` | MIT | **REFERENCE** | vectorized options benchmark | py_vollib + QuantLib are the initial option paths; no initial bundle |
| exchange_calendars | `gerrymanoim/exchange_calendars` | Apache-2.0 | **LIBRARY** | trading sessions/holidays/special closes | standard calendar service candidate; avoid hand-maintaining exchange schedules |
| pandas_market_calendars | `rsheftel/pandas_market_calendars` | MIT | **REFERENCE** | market schedules; potential fallback candidate | P11/P5 must compare exact session/holiday/special-close coverage with exchange_calendars; fallback selection remains pending a reproduced coverage gap and conformance evidence, not currently enabled |

### 2.4 Quant & Forecast Pack

| Project | Repository | License | Decision | Role | P11 action |
| --- | --- | --- | --- | --- | --- |
| Microsoft Qlib | `microsoft/qlib` | MIT | **LIBRARY in isolated Quant environment** | quantitative research/ML pipelines/features/experiments | do not let Qlib own LiOS data or Project state; adapter converts canonical datasets |
| StatsForecast | `Nixtla/statsforecast` | Apache-2.0 | **LIBRARY** | fast statistical forecasting | primary candidate for ARIMA/ETS/Theta-style capabilities |
| statsmodels | `statsmodels/statsmodels` | BSD-3-Clause | **LIBRARY** | econometrics/time-series baseline | shared capability but pack dependency stays controlled |
| scikit-learn | `scikit-learn/scikit-learn` | BSD-3-Clause | **LIBRARY** | classical ML | core Quant engine dependency |
| XGBoost | `dmlc/xgboost` | Apache-2.0 | **LIBRARY** | boosted-tree modeling | optional Quant capability; no default model claims without validation |
| LightGBM | `microsoft/LightGBM` | exact current release/license not fully pinned in this branch audit | **REFERENCE** | efficient gradient boosting benchmark | XGBoost covers the launch capability; do not bundle until a later explicit candidate decision with exact verified license/version |
| Optuna | `optuna/optuna` | MIT | **LIBRARY** | hyperparameter/search optimization | use through governed experiment capability |
| Prophet | `facebook/prophet` | MIT | **REFERENCE** | trend/seasonality forecasting benchmark | not bundled in initial P11 because StatsForecast/statsmodels already cover the launch forecasting surface |
| sktime | `sktime/sktime` | BSD-3-Clause | **REFERENCE** | broader time-series benchmark | not bundled in initial P11 to avoid a second forecasting framework |
| FinRL | `AI4Finance-Foundation/FinRL` | MIT candidate; exact current release review required | **REFERENCE** | RL finance research | no default production dependency; only if a concrete research workflow passes data/quality/reproducibility gates |

### 2.5 Strategy & Backtest Pack

| Project | Repository | License | Decision | Role | P11 action |
| --- | --- | --- | --- | --- | --- |
| LSE Terminal | `londonstrategicedge/lse-terminal` | MIT | **VENDOR target; current non-bundled reference/pattern use** | backtest/engine/indicator/ML/workspace implementation donor | follow `LSE_TECHNOLOGY_ASSIMILATION.md`; P11/CA-04 selects exact source paths only after measured capability-gap and numerical evidence |
| Brue | `londonstrategicedge/brue` | MIT | **VENDOR target; current non-bundled optional evaluation** | constrained strategy language/runtime/conformance | P11/CA-04 must qualify StrategyArtifact runtime and exact imported paths before promotion; no credentials/data ownership or live execution |
| LSE Data | `londonstrategicedge/lse-data` | MIT client; data rights separate | **CONNECTOR** | optional market/reference provider | Provider SDK only; user-owned key; no central redistribution |
| QuantConnect LEAN | `QuantConnect/Lean` | Apache-2.0 | **SIDECAR** | advanced multi-asset algorithm/backtest runtime | Advanced Quant pack sidecar; do not make core dependent on .NET |
| Zipline Reloaded | `stefan-jansen/zipline-reloaded` | Apache-2.0 | **REFERENCE** | event-driven historical simulation | benchmark against LiOS/LSE/LEAN; not bundled in the current P11 launch set |
| bt | `pmorissette/bt` | MIT | **REFERENCE** | strategy/portfolio backtest | avoid redundant backtest engines |
| QSTrader | `quantstart/qstrader` | MIT but stale upstream activity | **REFERENCE** | architecture/test ideas | do not choose as primary current runtime without renewed maintenance evidence |
| Backtrader | `mementum/backtrader` | GPL-3.0 | **REJECT for proprietary core** | reference only | no source assimilation |
| backtesting.py | `kernc/backtesting.py` | AGPL-3.0 | **REJECT for proprietary core** | reference only | no source assimilation |
| VectorBT | `polakowo/vectorbt` | Apache-2.0 + Commons Clause | **REFERENCE** | benchmark/vectorized ideas | do not bundle/sell-dependent product without separate rights decision |
| Freqtrade | `freqtrade/freqtrade` | GPL-3.0 | **REJECT for proprietary core** | reference only | no source assimilation |
| NautilusTrader | `nautechsystems/nautilus_trader` | LGPL-3.0 | **REFERENCE** | high-quality architecture benchmark | no default bundling; any separate-process use requires explicit legal/distribution review |

### 2.6 Research & Documents Pack

| Project | Repository | License | Decision | Role | P11 action |
| --- | --- | --- | --- | --- | --- |
| EdgarTools | `dgunning/edgartools` | MIT | **LIBRARY** | SEC filing/statement/XBRL objects | primary SEC research helper; obey SEC access policy |
| Arelle | `Arelle/Arelle` | Apache-2.0 core; included components/plugin licenses vary | **Target LIBRARY or SIDECAR; subtype pending** | XBRL/iXBRL validation/taxonomy semantics | P11/CA-05 must select reviewed required modules and exact dependency/isolation packaging after validation workload proof; preserve notices; neither alternative is presently a shipped P11 pack |
| Docling | `docling-project/docling` | MIT | **LIBRARY/WORKER** | document/PDF/table/layout parsing | primary general document intelligence candidate |
| Unstructured | `Unstructured-IO/unstructured` | Apache-2.0 | **REFERENCE** | broad document partitioning | fallback/specialist capability only if Docling path insufficient |
| Camelot | `camelot-dev/camelot` | MIT | **REFERENCE** | PDF table extraction | specialist fallback |
| pdfplumber | `jsvine/pdfplumber` | MIT | **REFERENCE** | low-level PDF text/table extraction | specialist fallback/debugging |
| sqlite-vec | `asg017/sqlite-vec` | MIT OR Apache-2.0 | **REFERENCE** | embedded semantic vector search | local Project search only where useful; avoid standalone vector service by default |

### 2.7 Data Lab Pack

| Project | Repository | License | Decision | Role | P11 action |
| --- | --- | --- | --- | --- | --- |
| DuckDB | `duckdb/duckdb` | MIT | **LIBRARY / EXISTING CORE** | embedded local analytical SQL | remain primary local analytical store/query engine |
| Apache Arrow | `apache/arrow` | Apache-2.0 | **Target LIBRARY / DATA-PLANE STANDARD; execution deferred** | columnar interchange | P11/CA-06 isolated cross-process benchmark and typed handoff proof required; current high-volume baseline is DuckDB+Parquet |
| Polars | `pola-rs/polars` | MIT | **LIBRARY** | high-volume DataFrame transforms | enable where benchmarked workloads justify it |
| Ibis | `ibis-project/ibis` | Apache-2.0 | **REFERENCE** | backend-neutral analytical benchmark | DuckDB/Polars/SQLGlot remain the initial Data Lab path; no initial bundle |
| SQLGlot | `tobymao/sqlglot` | MIT | **LIBRARY** | SQL parse/transpile/normalize | strong candidate for generic SQL/database connector support |
| Pandera | `unionai-oss/pandera` | MIT | **LIBRARY** | DataFrame/schema validation | Data Quality/connector normalization validation |
| Apache DataFusion | `apache/datafusion` | Apache-2.0 | **REFERENCE** | Arrow-native query benchmark | DuckDB remains the initial local query engine; no initial bundle |
| Perspective | `perspective-dev/perspective` | Apache-2.0 | **LIBRARY** | streaming/high-volume data visualization | P4 DataArtifact surface, packaged footprint benchmark required |
| TanStack Table/Virtual | `TanStack/table`, `TanStack/virtual` | MIT | **LIBRARY** | virtualized headless grids | artifact/UI layer only |
| Apache ECharts | `apache/echarts` | Apache-2.0 | **LIBRARY** | advanced analytical visualization | artifact renderer, not source of financial truth |

### 2.8 Market Data Pack

| Project | Repository | License/data posture | Decision | Role | P11 action |
| --- | --- | --- | --- | --- | --- |
| LSE Data | `londonstrategicedge/lse-data` | MIT client; hosted data rights separate | **CONNECTOR** | market/reference/macro/options data | existing P5/P6 LSE plan |
| FinanceDatabase | `JerBouma/FinanceDatabase` | MIT repository; bundled/reference dataset provenance and redistribution rights are separate | **REFERENCE** | universe/reference benchmark | do not bundle its dataset in initial P11; LiOS canonical universe/OpenFIGI/provider feeds remain authoritative |
| OpenFIGI | external service | API/service terms | **CONNECTOR** | identifier enrichment | existing built-in user-key connector; never treat as market-data feed |
| exchange_calendars | `gerrymanoim/exchange_calendars` | Apache-2.0 | **LIBRARY** | market calendars | shared canonical calendar utility |
| public/regulatory sources | SEC/FRED/etc. | source-specific | **CONNECTOR** | public data | remain provider-specific connectors under Data Fabric |

### 2.9 Broker & Execution Pack

| Project | Repository | License | Decision | Role | P11 action |
| --- | --- | --- | --- | --- | --- |
| ib_async | `ib-api-reloaded/ib_async` | BSD-2-Clause | **CONNECTOR target; current unbundled/reference evaluation** | Interactive Brokers async read/inspection candidate | P5/P11 must qualify local credentials, rights and actual read-only inspection; no order writes |
| CCXT | `ccxt/ccxt` | MIT | **CONNECTOR target; current unbundled/reference evaluation** | unified crypto/exchange read APIs | P5/P11 selects supported read-only venue capabilities after entitlement/terms and real connector proof; no order writes |
| vn.py / VeighNa | `vnpy/vnpy` | MIT | **REFERENCE** | gateway/trading architecture benchmark | do not bundle the full framework in initial P11; any future gateway is treated as its own separately audited candidate |
| Hummingbot | `hummingbot/hummingbot` | Apache-2.0 | **REFERENCE** | exchange connector architecture benchmark | CCXT/current connector candidates require separate read-only selection proof; no Hummingbot runtime in initial P11 |
| LEAN brokerage adapters | QuantConnect repos | repo-specific; exact adapter license must be verified | **REFERENCE** | brokerage connectivity benchmark | no brokerage adapter is bundled from this umbrella entry; each future adapter requires its own explicit candidate record |
| unverified Brue Connect source | unavailable/unclear during LSE audit | unverified | **REJECT until verifiable** | broker adapter | no source incorporation without exact source/license |

Current product scope prohibits brokerage execution and all trade/order writes. SAFE_AUTO, USER_CONFIRM, ADMIN approval or reserved manifest `brokerWrite` metadata cannot override this prohibition. Read/inspection remains a separate candidate path, currently deferred in the P11 catalog.

### 2.10 Reporting & Modeling Pack

| Project | Repository | License | Decision | Role | P11 action |
| --- | --- | --- | --- | --- | --- |
| Univer OSS | `dream-num/univer` | Apache-2.0 OSS core | **LIBRARY** | SpreadsheetArtifact/live model editing | OSS-core only; paid extensions not assumed |
| XlsxWriter | `jmcnamara/XlsxWriter` | BSD-2-Clause | **LIBRARY target; unbundled** | professional XLSX output | P11/CA-02 server export deferred until reviewed runtime, real cited Artifact export and reopen/round-trip proof |
| python-docx | `python-openxml/python-docx` | MIT | **LIBRARY target; unbundled** | DOCX generation | P11/CA-02 server export deferred until reviewed runtime and actual export/reopen proof |
| python-pptx | `scanny/python-pptx` | MIT | **LIBRARY target; unbundled** | PPTX generation | P11/CA-02 server export deferred until reviewed runtime and actual export/reopen proof; existing client PPTX is a distinct path |
| Tiptap OSS | `ueberdosis/tiptap` | MIT | **LIBRARY** | live ReportArtifact/ResearchArtifact | OSS core only |
| ECharts | `apache/echarts` | Apache-2.0 | **LIBRARY** | charts in reports/artifacts | canonical data remains LiOS-owned |
| Perspective | `perspective-dev/perspective` | Apache-2.0 | **LIBRARY** | analytical data exploration | P4 DataArtifact adapter |

### 2.11 Conversation/UI/runtime support already in LiOS strategy

These are not analytical P11 engines, but P11 must coexist with them and may package their optional runtime pieces correctly.

| Project | License | Decision |
| --- | --- | --- |
| assistant-ui | MIT | existing conversational UI donor; core UI integration, not hidden analytical pack |
| assistant-ui/tool-ui | MIT | existing tool-result/approval component donor |
| Dockview OSS | MIT | existing Living Workspace renderer |
| Tiptap OSS | MIT | Report/Research Artifact adapter |
| xyflow / React Flow | MIT | optional graph/workflow surface |
| OpenTelemetry | Apache-2.0 | observability support, local/redacted defaults |
| OpenLineage | Apache-2.0 | optional lineage schema influence |
| `uv` | Apache-2.0/MIT ecosystem posture | **P11 pack-build/runtime environment manager candidate** |

## 3. Priority bands

### Priority A — build into first P11 proof

This heading preserves the historical anchor; the list is now target foundation and Python/data capability evaluation, not a claim of first-proof completion.

- P11 Pack Manager/LEP/manifest/signing infrastructure;
- FinanceToolkit;
- skfolio;
- Riskfolio-Lib;
- PyPortfolioOpt;
- QuantStats;
- CVXPY;
- QuantLib;
- EdgarTools;
- Docling;
- Arrow;
- DuckDB;
- SQLGlot;
- Pandera.

Reason: mostly Python/permissive candidates with potential capability return. These priorities do not claim installed isolated environments; Arrow execution remains deferred and legacy Python wheel-lock/hash proof remains open.

### Priority B — prove cross-language/heavy runtime architecture

- ORE;
- OpenGamma Strata;
- Qlib;
- StatsForecast;
- XGBoost/scikit-learn/Optuna;
- Arelle;
- LSE/Brue;
- LEAN advanced runtime.

Reason: these prove sidecars, bigger dependencies, numerical validation and runtime lifecycle.

### Priority C — reference-only candidates for this P11 launch

This historical heading retains its anchor. Its blanket reference-only wording is superseded by the current unbundled/target distinctions below and in the family rows.

- CCXT;
- ib_async;
- vn.py gateway code;
- Hummingbot/LEAN broker adapters where unique;
- Prophet/sktime;
- Unstructured/Camelot/pdfplumber;
- DataFusion/Ibis;
- extended technical indicator libraries;
- reporting helpers.

These are not bundled P11 donor integrations. Reference rows retain their current REFERENCE decision; ib_async/CCXT and reporting helpers retain the target CONNECTOR/LIBRARY modes in their family rows, not a contradictory reference-only final disposition. P5/P11/CA-02/04/05/06 as applicable must revisit on a reproduced capability gap, reviewed exact source/rights, real execution and relevant SP journey evidence. Promotion requires an explicit current decision, not inferred launch approval.

## 4. Explicit rejection/reference list

| Project | Reason | Decision |
| --- | --- | --- |
| VectorBT | Commons Clause restricts ordinary commercial assimilation | REFERENCE |
| backtesting.py | AGPL-3.0 | REJECT for proprietary core |
| Backtrader | GPL-3.0 | REJECT for proprietary core |
| Freqtrade | GPL-3.0 | REJECT for proprietary core |
| NautilusTrader | LGPL-3.0 creates distribution/compliance complexity | REFERENCE unless separate explicit decision |
| OpenBB V5 only | V5 (2026-09-30) changed licensing from AGPL-3.0-only to Apache-2.0; V4 remains AGPL. LiOS previously removed OpenBB runtime and has an active no-OpenBB regression. Re-evaluate *only* isolated provider implementation modules after exact V5 source/pin/dependency, API-data rights, packaging, DX/UX and benchmark audit. No silent runtime resurrection. | REFERENCE / CONDITIONAL REASSESSMENT; **not installed or approved** |
| unverified/ambiguous license projects | exact rights unknown | REJECT until verified, never assumed permissive |
| donor branding/screenshots/logos | trademark/asset rights separate | REJECT from product bundle unless separately licensed |

## 5. Rules preventing OSS bloat

1. One primary engine per capability.
2. Add validator/fallback only when it materially improves quality/reliability.
3. No package enters base app solely because it is popular.
4. No second full framework when a small library solves the exact requirement.
5. Heavy ML/native/JVM/.NET runtimes are optional packs/sidecars.
6. Remove redundant overlapping dependencies after benchmarks.
7. Measure installer size, cold start, warm start, memory and disk.
8. Pack candidates must be removable without Project/Artifact migration.
9. Data/API rights are reviewed separately from software licenses.
10. Every approved project gets a concrete integration mode before code starts.

## 6. Intake record required before implementation

For every project moved from candidate to bundled P11 component, record:

```text
repository
exact commit/tag/package version
license
dependency/license scan
integration mode
pack id
capabilities
primary/validator/fallback role
source paths if vendored
destination paths
modifications
data/service/model/asset/trademark rights
known-answer tests
security permissions
resource footprint
supported platforms
notice obligations
rollback/removal test
```

This matrix is an exploration-to-execution inventory. Selected release/import pins belong in `third_party/upstream-lock.json`; research `observedCommit` values in `third_party/p11-candidates.json` remain research provenance and may differ without authorizing a mixed-source import. Reconcile exact chosen release/version/path/license before implementation. Target modes are not present shipping truth. Relevant SP-01/02/04/05/07 closure requires a real MSJ, applicable target execution, no fake success, regression protection and exact evidence; no acceptance is inferred here.

## 7. October 26, 2026 — breadth/depth activation review

These recommendations update **execution priority only**, not current package/install truth. Code ownership remains P5 for legal/security identities, P11 for deterministic finance, CA for capability adapters and GM/P13 for providers/agents. Use the existing 92-donor registry and Shipping Point gates; do not invent a new capability authority.

| Sequence | Gap with highest user benefit | Candidate already reviewed | One LiOS-owned acceptance journey | Classification |
|---|---|---|---|---|
| D1 | Complete global reference symbols without implying market-data entitlement | FinanceDatabase + P5 (PR #217, unmerged) | Real-data 300k dedup count, source-age, disk/RSS, symbol/venue, update/rollback and desktop smoke | P5 source work; release unverified |
| D2 | Legal-entity hierarchy and LEI/ISIN bridges outside traded tickers | GLEIF Global LEI Index, CC0 public data, direct API | Search by LEI or legal name, see candidates with jurisdiction/registration status, provenance and **no ticker inference**; source adapter in adjacent PR | P5, read-only source |
| D3 | Day-count, calendars, market holidays and trading-session accuracy | exchange_calendars (Apache-2.0) + QuantLib (BSD-style) | NYSE/LSE/NSE same-date and DST/half-day known answers; prices never fabricated | P11, validator first |
| D4 | Classical portfolios and scenario risk | PyPortfolioOpt MIT + skfolio BSD-3 + Riskfolio-Lib BSD-3 | Black–Litterman/EF/HRP, covariance validation and leverage/risk constraints from user-owned price history, with alternate solver known-answers | P11, one primary per method |
| D5 | Institutional fixed income and derivatives | Existing QuantLib + ORE (dependency/submodule audit) | Bonds, curves, volatility smile, Greeks and stress values reconcile across engines | P11, optional native sidecar |
| D6 | SEC company intelligence beyond ticker lookup | EdgarTools MIT (where existing SEC parser lacks forms) | Source-attributed 10-K/XBRL/13F/insider/8-K with SEC fair-access, caching and mismatch denial | P5/P7, no second entity resolver |
| D7 | Reproducible factor research/ML | Qlib MIT, StatsForecast Apache-2.0, Optuna MIT | No-lookahead pipeline, train-test split, data lineage, research revision and local CPU/RAM budget | P11, isolated optional pack |
| D8 | Broader cross-asset provider *connectors* | OpenBB V5 Apache-2.0 (not older AGPL V4) | Map only reviewed V5 provider-owned modules to existing Provider SDK, verify legal data access, no second server/terminal/auth runtime | CA/P5, re-evaluation only |

The OpenBB license and platform architecture change is documented by its own V5 license FAQ (`https://docs.openbb.co/odp/python/faqs/license` and `https://docs.openbb.co/odp/python/migration-from-v4`). Apache-2.0 licenses **software**, not provider data. Keep `src/script/openbb_removal.test.mjs` active until a specific owner-reviewed policy revision with concrete benchmark and legal evidence. No source files from V5 are bundled in this change.

GLEIF legal-entity data is explicitly CC0 per its official access terms (`https://www.gleif.org/en/meta/lei-data-terms-of-use`). A legal entity ID does not count as a security ticker or live market data. For this initial integration, do **not** bulk-snapshot millions of LEIs: start with a bounded, on-demand, source-attributed read-only P5 lookup. Crosswalk to P5 canonical identifiers is a later explicitly reviewed reconciliation, not an automatic name match.

**Current capability bottleneck:** `third_party/p11-candidates.json` describes target modes, not actually bundled engines. Before upgrading D3–D8 to “available”, audit actual installed package/sidecar, exact commit/version, license/dependency chain, existing consumer route, relevant known-answer tests, native packaging, and user journey. The intended sequence is **mechanisms consumed and proven**, not the count of imported repositories.
