# P11 Hidden Engine Pack & OSS Engine Fabric Specification

**Status:** Engine Fabric foundation implemented; productized pack-family scope remains incomplete
**Effective:** 2026-09-23  
**Repository:** `kiranvbiim-coder/lios-v1.0.0`  
**Implementation:** foundational contracts merged to `main`; full pack-family scope remains open
**Canonical authority:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`, `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`, and existing GM/TC/CA/P subsystem contracts; master/architecture/roadmap retain architectural and historical evidence.
**Purpose:** P11-owned Engine Fabric specification supporting SI-01/02 isolation/execution, SI-04 professional work and SI-05 deterministic finance; not a competing phase program.
**Machine-readable candidate inventory:** `third_party/p11-candidates.json`.

> **P11 thesis:** LiOS must be able to exploit tens or hundreds of high-quality open-source engines without turning the desktop application into an unmaintainable monolith. Users see LiOS capabilities. LiOS internally owns the contracts, routing, security, data, identity, artifacts and lifecycle; open-source engines remain hidden, replaceable implementation details.

SI-01–SI-07 are strategic milestones; S0–S10 are validation journeys only and CP phases are historical evidence. P11 remains the singular deterministic finance authority, with GM owning runtime/execution, P4 Artifact state and CA donor depth. Relevant SP-01/02/04/05/07 contributions require a real Minimum Shippable Journey, applicable packaged/target execution, no fake success, regression protection and exact commit/build, topology, outcomes, limitations and truth-level evidence. No Shipping Point acceptance is inferred here; P14 remains final release authority. Privileged interactive `exec.*` remains blocked until SI-01.11/GM-11 authority is proven.

## 1. What P11 is

P11 converts the current preliminary Runtime Pack concept into a complete **Hidden Engine Pack Operating System**.

It is not:
- a public plugin marketplace;
- a second Project/Conversation architecture;
- a second Data Fabric;
- a way for arbitrary upstream code to own LiOS state;
- a reason to expose upstream brands to users;
- a single Python environment containing every library;
- a generic "adapt later" bucket.

Every candidate entering implementation receives an explicit integration decision; candidate target modes below do not establish present import, provisioning or execution:

1. **LIBRARY** — install as a pinned dependency inside an isolated LiOS pack.
2. **VENDOR** — copy permitted source into LiOS-owned engine/adapter code, pinning exact upstream paths/commit/license.
3. **SIDECAR** — run as a separate local process behind the LiOS Engine Protocol.
4. **CONNECTOR** — integrate through the Provider/Connector SDK rather than the analytical engine layer.
5. **REFERENCE** — study/test against it, but ship no code.
6. **REJECT** — do not use because of licensing, security, duplication, quality, maintenance or architectural incompatibility.

There is no unresolved "adapt later" status in an implementation issue. Suitable deferred/reference candidates require mechanism-level reuse/adapt/repurpose/combine analysis, a canonical owner, evidence blocker and revisit trigger; overlap or current journey scope alone is not a final rejection.

## 2. Existing LiOS foundation P11 extends

P11 must extend the existing runtime foundation rather than creating a parallel subsystem.

Current foundations already exist:

- `src/shared/runtimeContracts.ts`
  - `runtime_pack` component kind;
  - component descriptors;
  - capabilities;
  - execution scopes;
  - runtime health states;
  - permission classes;
  - upstream source metadata;
  - jobs, receipts, Backtest/Finance adapter contracts.
- `src/shared/runtimeAdapters.ts`
  - DataProvider, Connector, FinanceEngine, BacktestEngine, JobRuntime, Plugin and other replaceable adapter seams.
- `src/shared/runtimeRegistry.ts`
  - LiOS-owned replaceable runtime registration;
  - capability descriptors;
  - health snapshots.
- `src/server/runtimeFoundation.ts`
  - projection of AI providers, connectors and managed runtime packs into the common runtime registry.
- `src/server/runtimeManifest.ts`
  - signed-allow-list policy;
  - managed Python package inventory;
  - current core/fixed-income/forecasting/econometrics/ML/optimization/research packs.

P11 **promotes these foundations into a production pack lifecycle**, rather than discarding them.

## 3. Architectural invariants

The following are non-negotiable.

### 3.1 LiOS owns product state

No pack or donor owns:
- Projects;
- chats;
- Sessions;
- Conversation Ledger;
- Artifacts;
- source policies;
- user/organization permissions;
- credentials;
- canonical security identity;
- canonical financial semantics;
- user-facing navigation;
- commercial entitlement state.

A pack is a replaceable implementation of one or more capabilities.

### 3.2 Engines request canonical data

P11 engines do not independently become data platforms.

```text
LiOS Universal Data Fabric
        |
canonical request/result
        |
Hidden Engine Pack
        |
calculation only
```

Exceptions are explicit connector capabilities registered through the Provider/Connector SDK. If a third-party analytical library has its own data client, P11 either disables that path or wraps it so LiOS still controls entitlement, identity, provenance and source policy.

### 3.3 Canonical identity stays outside packs

Provider/library symbols are aliases.

```text
LiOS SecurityId / InstrumentId
        |
adapter translation
        |
engine-specific symbol/object
```

No donor symbol vocabulary becomes durable Project identity.

### 3.4 Canonical results stay outside packs

Upstream return types are normalized into LiOS result/artifact contracts. Examples:

- `CalculationResult`;
- `ValuationResult`;
- `PortfolioResult`;
- `RiskResult`;
- `ForecastResult`;
- `BacktestResult`;
- `ResearchResult`;
- `DatasetArtifact`;
- existing P4 typed Artifact kinds.

This prevents UI/product code from depending on donor-specific classes.

### 3.5 Users see capabilities, not donor brands

Normal UX says:
- Advanced portfolio optimization;
- Risk simulation;
- SEC filing analysis;
- Forecasting;
- Option analytics;
- Strategy backtest.

It does not say:
- Run Riskfolio;
- Open ORE;
- Powered by Qlib;
- Use FinanceToolkit.

Required notices live in **Settings → Legal/Open Source Notices** and in packaged license materials, not in ordinary product navigation.

### 3.6 Base LiOS remains useful without optional packs

Core functionality must launch even if advanced packs are absent, broken or intentionally removed.

Unavailability becomes a typed state:
- available;
- installable;
- installing;
- updating;
- degraded;
- incompatible;
- disabled;
- unavailable.

It never becomes a mysterious startup failure.

## 4. Hidden pack topology

Target internal pack families:

| Pack | Purpose | Representative engines/candidates |
| --- | --- | --- |
| **Core Finance Pack** | common deterministic finance/fundamental/econometric calculations | existing LiOS engines, FinanceToolkit, statsmodels |
| **Portfolio Pack** | construction, optimization, risk, allocation and performance | skfolio, Riskfolio-Lib, PyPortfolioOpt, QuantStats, CVXPY |
| **Pricing & Risk Pack** | fixed income, derivatives, curves, scenario risk and institutional analytics | QuantLib, ORE, OpenGamma Strata, py_vollib |
| **Quant & Forecast Pack** | forecasting, statistics, ML/factor research | Qlib, StatsForecast, statsmodels, scikit-learn, XGBoost, LightGBM/approved equivalent, Optuna, Prophet/sktime where useful |
| **Strategy & Backtest Pack** | strategy runtime, robust historical simulation and advanced quant | LiOS BacktestEngine, LSE/Brue, bt/Zipline where selected, optional LEAN sidecar |
| **Research & Documents Pack** | filings, XBRL, documents, tables and evidence extraction | EdgarTools, Arelle, Docling, Unstructured, Camelot/pdfplumber |
| **Data Lab Pack** | local analytical compute, schemas and interchange | DuckDB, Arrow, Polars, Ibis, SQLGlot, Pandera, optional DataFusion |
| **Market Data Pack** | optional source adapters/reference/universe helpers | LSE Data, official/public sources, FinanceDatabase only if data provenance is acceptable, exchange calendars |
| **Broker & Execution Pack** | candidate read/inspection adapters; no current brokerage execution | ib_async/IBKR, CCXT, selected vn.py/LEAN/Hummingbot mechanisms after exact rights/runtime review; order writes prohibited |
| **Reporting & Modeling Pack** | spreadsheets/reports/presentation exports | Univer OSS, XlsxWriter, python-docx, python-pptx, Tiptap/ECharts/Perspective adapters where applicable |
| **Local AI Pack** | optional local inference/tool helpers | existing BYOAI/local runtime integrations; remains provider-neutral |

Pack count should remain intentionally small. Hundreds of repositories may exist **inside** these pack families; the user and core architecture should not face hundreds of pack identities.

## 5. Integration-mode decision tree

For each upstream project:

```text
Is the exact code/license commercially compatible?
  no  -> REFERENCE or REJECT
  yes
   |
Does it expose/fit a normal package/library API?
  yes -> LIBRARY unless vendoring is materially safer
  no
   |
Is it a large/native/different-language runtime?
  yes -> SIDECAR
  no
   |
Is the value primarily data/provider/broker connectivity?
  yes -> CONNECTOR
  no
   |
Is only a coherent subset needed and copying is permitted?
  yes -> VENDOR
  no  -> REFERENCE/REJECT
```

A candidate issue must record the decision before implementation begins.

## 6. One adapter contract per capability boundary

Core code never calls arbitrary donor APIs.

Bad:

```text
Conversation -> Riskfolio.optimize()
```

Correct:

```text
Conversation
   -> capability: portfolio.optimize.cvar
   -> Capability Router
   -> PortfolioPackAdapter
   -> selected engine
```

The LiOS adapter surface remains stable even when the donor changes.

Illustrative Python-facing adapter contract:

```python
class LiOSEngineAdapter:
    def descriptor(self): ...
    def health(self): ...
    def capabilities(self): ...
    def execute(self, request): ...
    def cancel(self, job_id): ...
    def diagnostics(self): ...
    def shutdown(self): ...
```

The actual TypeScript/runtime contract remains authoritative; Python/Java/.NET/native adapters implement protocol-compatible equivalents rather than defining competing schemas.

## 7. Capability Registry

P11 evolves the current runtime registry into a capability-aware routing system.

Example:

```text
portfolio.black_litterman
  primary   -> pypfopt
  validator -> skfolio
  fallback  -> riskfolio

derivatives.option.greeks
  primary   -> quantlib
  validator -> py_vollib

risk.xva
  primary   -> ore-sidecar

forecast.auto_arima
  primary   -> statsforecast

research.sec.xbrl
  primary   -> edgartools
  validator -> arelle where validation is required
```

### 7.1 Router responsibilities

The router considers:
- capability;
- pack installation/health;
- Project/data policy;
- operating system/architecture;
- deterministic vs model-derived classification;
- entitlement;
- resource budget;
- data size/frequency;
- primary/fallback/validator role;
- engine compatibility;
- user/org feature entitlement;
- explicit engine pin only when advanced users/admins need it.

### 7.2 No uncontrolled engine competition

Do not run three engines for every request.

Each capability declares:
- **primary**;
- optional **validator**;
- optional **fallback**.

Validators run for:
- release/known-answer suites;
- high-materiality calculations where configured;
- detected anomalies;
- explicit "cross-check" requests;
- sampled quality monitoring where local privacy policy permits.

## 8. LiOS Engine Protocol (LEP)

P11 defines a versioned local protocol for non-in-process engines.

### 8.1 Control plane

Default control transport for local pack processes:

**newline-delimited JSON over stdin/stdout (NDJSON).**

Reasons:
- no localhost port conflicts;
- no firewall prompts;
- easy process ownership;
- easy startup/shutdown;
- language neutral;
- simple logging isolation;
- works with Python/Java/.NET/C++/Rust wrappers.

Required message families:
- `hello`;
- `capabilities`;
- `health`;
- `execute`;
- `progress`;
- `result`;
- `error`;
- `cancel`;
- `diagnostics`;
- `shutdown`.

Every request carries:
- LEP version;
- request UUID;
- capability;
- execution context reference;
- input schema/version;
- data handles instead of secret/raw huge payloads;
- deterministic/model-derived metadata;
- deadline/resource policy.

### 8.2 Persistent high-throughput option

If NDJSON becomes a measured bottleneck, P11 may use:
- Unix domain sockets on macOS/Linux;
- named pipes on Windows;
- gRPC only where a mature cross-language service materially benefits.

Do not default every local engine to localhost HTTP.

### 8.3 Handshake

A sidecar must prove:
- protocol version;
- pack id/version;
- component id/version;
- supported capabilities;
- input/output schema versions;
- build hash;
- platform/architecture;
- health state;
- optional feature flags.

If incompatible, it remains inactive.

## 9. Control plane vs data plane

Large analytical datasets must not be serialized through giant JSON messages.

### Control plane
- JSON/NDJSON;
- metadata;
- capability requests;
- errors/progress;
- handles/references.

### Data plane
Preferred:
1. Arrow IPC;
2. Parquet;
3. DuckDB/local relation/table handle where safe;
4. compact typed binary/native representation for specialized engines.

Pattern:

```text
LiOS Data Fabric
    |
Arrow/Parquet local immutable snapshot
    |
dataRef
    |
LEP execute request
    |
pack reads dataRef
    |
normalized result
```

Requirements:
- temporary files live in LiOS-controlled directories;
- scoped filenames/permissions;
- cleanup after job/retention;
- hashes for reproducibility;
- as-of/source/identity metadata travels separately;
- no pack receives filesystem-wide access merely because a dataset is local.

## 10. Python runtime strategy

### 10.1 Do not use one giant Python environment

Target:

```text
pack-envs/
  finance/
  portfolio/
  quant/
  research/
  ...
```

Each Python pack receives a pinned, reproducible environment.

This is the target environment contract, not proof that legacy managed Python already satisfies it. The legacy Python runtime records pinned-only dependencies with `hashVerified: false`; full wheel-lock/hash verification and isolated family environments remain delivery gaps. Signed `.lios-pack` metadata does not supply missing legacy wheel-lock evidence.

### 10.2 Use `uv` as the preferred environment/build resolver

P11 should evaluate/standardize `uv` for:
- fast dependency resolution;
- virtual environment creation;
- locked installs;
- wheel caching;
- deterministic pack builds;
- Python version management where suitable.

The Pack Manager must not depend on users manually running pip.

### 10.3 Prebuild packs

Do not compile/resolve large dependency graphs on normal user machines unless no signed artifact exists.

Release process:

```text
resolve -> build -> test -> freeze -> SBOM -> sign -> publish
```

Client:

```text
download -> verify -> install -> health check -> activate
```

### 10.4 Storage discipline

Because local desktops may have constrained disks:
- global download/wheel cache with deduplication where tooling supports it;
- pack-specific environments remain isolated;
- old inactive versions are prunable;
- optional large models are not in base packs;
- user sees estimated download/install disk requirement before large optional packs;
- configurable storage location may be added if platform support is reliable;
- deep-learning packs are separate from normal Quant pack if size materially grows.

## 11. Native and cross-language sidecars

Some engines should not be forced into Python.

Examples:
- ORE: C++/QuantLib ecosystem -> native sidecar/wrapper;
- Strata: Java -> JVM sidecar;
- LEAN: .NET -> .NET sidecar;
- future Rust compute -> native sidecar or library;
- optional WASI/WASM path -> only for stateless components where it improves portability/security and benchmarks well.

Each sidecar speaks LEP and exposes LiOS canonical capabilities.

No sidecar owns Project persistence.

## 12. Process supervisor

P11 Pack Manager owns sidecar lifecycle.

Responsibilities:
- spawn;
- handshake;
- health;
- restart policy;
- timeout;
- cancellation;
- graceful shutdown;
- crash classification;
- stdout/stderr capture with secret redaction;
- CPU/memory/resource telemetry;
- stale-process cleanup;
- platform-specific child-process containment;
- backoff after repeated crash loops.

Supervision and subprocess containment are not an OS-enforced sandbox. Filesystem/network/process/resource isolation must be qualified under GM-11 and P11 permissions on each supported target; lifecycle tests alone cannot establish those boundaries.

A crashing ORE/Java/Python engine cannot crash the Electron renderer or corrupt canonical Project state.

## 13. Pack manifest v1

**P11-01 implementation:** `src/shared/hiddenEnginePackManifest.ts`  
**Contract note:** `docs/technical/P11_PACK_MANIFEST_V1.md`

Manifest v1 is now frozen as a strict Zod contract. Unknown top-level fields fail closed.

Canonical shape:

```yaml
schemaVersion: "1"
id: lios.portfolio
version: 1.0.0
displayName: Portfolio Engine
visibility: internal

publisher:
  id: lios.first-party
  keyId: release-2026-01

liosCore:
  min: 1.0.0
  maxExclusive: 2.0.0

platforms:
  - darwin-arm64
  - darwin-x64
  - win32-x64

runtime:
  kind: python
  version: "3.12"
  entrypoint: lios_portfolio_adapter
  isolation: process

capabilities:
  - portfolio.optimize
  - portfolio.black_litterman
  - portfolio.performance

permissions:
  network:
    allowed: false
    allowedHosts: []
  filesystem:
    mode: scoped_temp
    roots:
      - "$LIOS_PACK_TEMP"
  secretHandles: []
  processSpawn: false
  gpu: false
  externalSideEffects: false
  brokerWrite: false

resources:
  memorySoftMb: 1024
  memoryHardMb: 2048
  cpuMaxCores: 4
  maxConcurrency: 2
  maxWorkers: 2
  defaultTimeoutSec: 300
  maxTimeoutSec: 600
  maxDatasetMb: 4096
  idleShutdownSec: 900

dataPlane:
  - arrow-ipc
  - parquet

licenses:
  sbom: licenses/sbom.cdx.json
  notices: licenses/THIRD_PARTY_NOTICES.txt

integrity:
  manifestSha256: "<64 lowercase hex>"
  payloadSha256: "<64 lowercase hex>"
  signature:
    algorithm: ed25519
    keyId: release-2026-01
    value: "<detached signature>"
```

Manifest v1 freezes metadata only. P11-02 defines capability namespace/routing grammar; P11-06 implements compatibility negotiation; P11-14 enforces permissions; P11-16 verifies signatures/hashes; P11-17 implements activation/rollback. Those tasks must extend this contract without weakening its fail-closed invariants.

## 14. `.lios-pack` distribution artifact

P11 introduces an internal signed pack artifact, conceptually:

```text
portfolio-1.0.0-darwin-arm64.lios-pack
  manifest.json
  adapter/
  runtime/
  payload/
  schemas/
  licenses/
  sbom.cdx.json
  checksums.json
  signature.json
```

Implementation may use a ZIP-compatible archive or another simple deterministic archive. Do not invent a custom binary container unless necessary.

Properties:
- immutable version;
- platform-specific when native code requires it;
- deterministic manifest;
- SHA-256 hashes;
- signature;
- SBOM;
- notices;
- compatibility metadata;
- no credentials;
- no user data.

## 15. Signing, trust and integrity

Minimum V1 pack trust model:
- allow-listed publisher key(s);
- manifest + payload SHA-256;
- Ed25519 or equivalent strong detached signature using platform-supported crypto;
- verify before extraction/activation;
- atomic install into versioned directory;
- no unsigned pack activation in production builds.

Update metadata must prevent simple downgrade/rollback attacks. If the distribution system grows beyond a simple first-party channel, evaluate a TUF-style signed metadata model rather than improvising trust chains.

Developer builds may support explicit local/dev packs behind a clearly separate development policy.

## 16. Install, update and rollback

Pack lifecycle:

```text
ABSENT
 -> DOWNLOADING
 -> VERIFIED
 -> INSTALLED_INACTIVE
 -> HEALTH_CHECK
 -> ACTIVE
 -> UPDATING
 -> ACTIVE(new)
or
 -> ROLLED_BACK(old)
```

Rules:
- versioned directories;
- never overwrite the active pack in place;
- install new version beside old;
- verify + health-check before activation;
- preserve prior known-good version until acceptance;
- rollback automatically on failed startup/health gate where safe;
- database/Project migrations belong to LiOS Core, not donor packs;
- a pack update may migrate its own disposable cache/index but not canonical Project state.

## 17. Lazy/on-demand installation

Base desktop stays Core-first.

If a capability is requested and the pack is absent:

```text
request
 -> capability lookup
 -> pack absent
 -> entitlement + size + policy check
 -> install pack
 -> health check
 -> execute
```

User-facing copy should describe the LiOS capability, e.g.:
- "Preparing advanced risk analytics";
- "Installing Quant Research capability";

not upstream package names.

For large downloads, show:
- download size;
- installed size;
- ability to cancel;
- offline/unavailable state.

Frequently used small packs may ship preinstalled if benchmarks justify it.

## 18. Offline behavior

Pack metadata records whether a capability:
- works fully offline;
- needs user-connected external data;
- needs a remote provider;
- needs model download;
- needs entitlement.

Installed deterministic packs should generally remain usable with local/imported data even when internet access is unavailable.

No pack should require cloud access merely for telemetry/license checking unless an explicit commercial decision says otherwise.

## 19. Permission and sandbox model

Default pack principle:

> **deny unnecessary privilege.**

Manifest permissions include:
- network;
- filesystem scope;
- secret names/capabilities;
- external process spawn;
- GPU;
- broker/write actions;
- external side effects.

Examples:

**Portfolio Pack**
- network: false;
- filesystem: scoped temp;
- secrets: none.

**Market Data Pack**
- network: approved provider domains through connector path;
- secrets: provider credential handle only.

**Broker Pack**
- current product policy prohibits brokerage execution and trade/order writes; USER_CONFIRM/ADMIN approval cannot override that prohibition;
- never exposes broker secrets to AI/chat text.
- `brokerWrite` is reserved schema metadata, not authorization to enable current forbidden execution; candidate read/inspection access still requires its own rights and permission evidence.

Packs receive secret **handles** or narrow operations, not raw vault dumps.

## 20. Resource governance

Each pack declares/receives:
- memory soft/hard budgets;
- CPU/concurrency budget;
- default/max timeout;
- max dataset size or streaming policy;
- GPU optionality;
- max worker count.

Pack Manager prevents accidental simultaneous launch of several multi-GB runtimes when unnecessary.

Heavy packs may be cold-started on demand and stopped after idle policy.

## 21. Capability-level validation and cross-engine checks

Multiple engines are useful only when governed.

### Primary
normal production calculator.

### Validator
independent calculation used for high-materiality or quality checks.

### Fallback
used when primary unavailable/incompatible and semantics are equivalent enough.

Validation records:
- tolerance;
- units;
- conventions;
- dates/calendars;
- curve/source assumptions;
- engine versions;
- discrepancy.

Never silently average disagreeing engines.

If results materially disagree:
- flag discrepancy;
- inspect assumptions/conventions;
- preserve both receipts where relevant;
- do not fabricate consensus.

## 22. Known-answer and conformance corpus

P11 must centralize reusable numerical tests.

Examples:
- Black-Scholes option price/Greeks;
- bond price/YTM/duration;
- swap PV/sensitivity;
- DCF known case;
- Black-Litterman known portfolio;
- efficient frontier constraints;
- VaR/CVaR;
- backtest fill/slippage/look-ahead behavior;
- forecasting seeds/windows;
- XBRL parsing fixtures;
- document table fixtures.

Imported upstream tests are retained/ported where relevant, then supplemented by LiOS canonical known-answer cases.

## 23. Data/semantic conversion adapters

Every engine adapter explicitly maps:
- date/timezone;
- currency;
- frequency;
- units/scaling;
- missing values;
- corporate actions;
- adjusted/unadjusted prices;
- security identifiers;
- curve conventions;
- day counts;
- settlement calendars;
- option contract conventions;
- point-in-time/as-known-on semantics.

This mapping is part of correctness, not glue to be ignored.

## 24. Pack health and diagnostics

Health states expand the existing runtime health contract with actionable diagnostics.

A pack health response may include:
- installed version;
- runtime version;
- adapter version;
- supported capabilities;
- dependency import/load check;
- sidecar handshake;
- filesystem/data-plane check;
- native library availability;
- optional GPU availability;
- last crash;
- last known-good version;
- update available;
- incompatibility reason.

User-level surfaces remain simple; detailed information appears in `lios doctor` / diagnostics.

## 25. OSS governance and SBOM

Every bundled/VENDOR/LIBRARY/SIDECAR candidate records:
- upstream repository;
- pinned commit/tag/package version;
- license;
- imported source paths if copied;
- LiOS destination paths;
- modifications;
- package;
- capabilities;
- transitive dependencies;
- required notices;
- separate data/API/trademark/model rights;
- security scan status;
- last audit date.

Every `.lios-pack` carries:
- CycloneDX or equivalent SBOM;
- third-party notices;
- hashes;
- pack manifest.

The existing `third_party/components.json` and `third_party/upstream-lock.json` remain governance foundations and may be extended rather than replaced.

## 26. Upstream update policy

Do not auto-import upstream HEAD.

Process:
1. detect new upstream release/commit;
2. diff license/dependencies;
3. run security scan;
4. run upstream/imported tests;
5. run LiOS known-answer/conformance tests;
6. benchmark startup/resource/footprint;
7. build signed candidate pack;
8. activate in test channel;
9. promote only after acceptance.

Major upstream API change must not leak into core because the adapter remains stable.

## 27. User-visible product behavior

The pack layer is internal.

Examples:

User:
> Optimize this portfolio for CVaR.

LiOS:
- resolves Project/data;
- capability router selects `portfolio.optimize.cvar`;
- Portfolio Pack runs;
- result becomes Portfolio Artifact;
- conversation explains assumptions/trade-offs.

No donor brand is required.

User:
> Price this swap and stress rates +100 bps.

LiOS:
- Pricing & Risk Pack;
- selected deterministic engine;
- canonical Risk/Valuation Artifact;
- Show Work contains engine/version/inputs if user opens reproducibility details.

Legal attribution remains accessible separately.

## 28. Pack installation is not product-tier gating

Core/Professional/Business commercial entitlements should gate **LiOS capabilities/service entitlements**, not arbitrarily expose dependency names.

A pack may contain capabilities across tiers. Entitlement decisions occur before execution and may determine which registered capability is accessible.

Do not duplicate the same heavy library in multiple commercial-tier packs merely to enforce pricing.

## 29. Candidate pack mapping

Detailed candidate decisions live in `docs/technical/P11_OSS_CANDIDATE_MATRIX.md`.

High-priority first implementation groups:

### Finance
- FinanceToolkit — LIBRARY, wrapped behind LiOS finance contracts.
- statsmodels — LIBRARY; already present in managed runtime.
- existing deterministic LiOS valuation/fundamental calculations remain canonical where stronger.

### Portfolio
- skfolio — LIBRARY, advanced primary/validator depending capability.
- Riskfolio-Lib — LIBRARY, specialized optimization/risk.
- PyPortfolioOpt — LIBRARY, efficient frontier/Black-Litterman/HRP.
- QuantStats — LIBRARY, performance analytics.
- CVXPY — LIBRARY/solver layer; solver license inventory remains separate.

### Pricing & Risk
- QuantLib — existing LIBRARY.
- ORE — SIDECAR high-priority institutional risk candidate.
- OpenGamma Strata — SIDECAR for Java pricing/risk capabilities that materially improve LiOS.
- py_vollib — LIBRARY validator/lightweight options path.

### Quant
- Qlib — isolated LIBRARY/SIDECAR-style Python pack due dependency surface; LiOS owns data/state.
- StatsForecast — LIBRARY.
- scikit-learn/XGBoost/approved boosting libraries — LIBRARY.
- Optuna — LIBRARY.
- Prophet/sktime — use only for distinct capability gaps, not redundant default inclusion.

### Strategy
- LSE/Brue — follow the existing LSE assimilation plan.
- LEAN — optional SIDECAR advanced runtime.
- Zipline/bt — include only where they provide a clearly unique standard capability after benchmark; avoid redundant backtest engines.

### Research
- EdgarTools — LIBRARY.
- Arelle — target reviewed LIBRARY modules or SIDECAR; exact packaging subtype remains pending P11/CA-05 dependency, license and isolation evidence.
- Docling — LIBRARY/worker.
- Unstructured/Camelot/pdfplumber — fallback/specialist only where Docling/own extraction is insufficient.

### Data Lab
- DuckDB — existing core/local engine.
- Arrow — interchange/data plane.
- Polars — LIBRARY when measured workloads justify it.
- SQLGlot — LIBRARY for generic SQL parsing/transpilation.
- Pandera — LIBRARY for DataFrame/schema validation.
- Ibis/DataFusion — include only for concrete backend/query capabilities not already handled better by DuckDB/Polars.

### Connectivity
- LSE Data — CONNECTOR per existing plan.
- CCXT / ib_async — target CONNECTOR candidates; currently unbundled/reference evaluation, not operational broker integrations.
- vn.py/LEAN/Hummingbot adapters — currently REFERENCE; any selected adapter needs its own exact license/dependency and capability-gap decision.
- Brokerage execution and all trade/order writes remain prohibited; neither code presence nor explicit approval enables them.

## 30. Explicit avoid/reference set

The following are not approved for normal proprietary-source assimilation under the same permissive path:

- VectorBT — Apache-2.0 with Commons Clause; REFERENCE unless separate commercial-rights decision.
- backtesting.py — AGPL-3.0; REFERENCE/REJECT for proprietary core.
- Backtrader — GPL-3.0; REFERENCE/REJECT for proprietary core.
- Freqtrade — GPL-3.0; REFERENCE/REJECT for proprietary core.
- NautilusTrader — LGPL-3.0; REFERENCE by default; any process-boundary use requires separate legal/distribution analysis.
- OpenBB — no approved LiOS dependency under current project policy.
- any repository with unclear exact license — REJECT until license is verified; never "assume permissive."

This list is engineering policy, not legal advice; release still receives final license review.

## 31. P11 implementation order

The following groups are subsystem dependency guidance, not a replacement for SI strategic milestones or permission to postpone continuous qualification. P11 must prove infrastructure with real capabilities under the applicable Shipping Point contracts.

**Wave A — pack foundation**
- manifest v1;
- capability registry;
- Pack Manager;
- LEP v1;
- data-plane contract;
- version/install/health state;
- signing/SBOM format.

**Wave B — Python proof packs**
- Portfolio Pack first;
- Finance Pack;
- Research Pack;
- Data Lab integration.

These prove isolated environments, adapters and artifacts without cross-language complexity.

**Wave C — heavy runtime proof**
- Pricing & Risk Pack;
- QuantLib path;
- ORE native sidecar;
- Strata JVM sidecar if benchmark/feature value passes.

This proves LEP across languages.

**Wave D — Quant/Strategy**
- Quant & Forecast Pack;
- Qlib/StatsForecast/ML;
- Strategy/Backtest Pack;
- LSE/Brue/LEAN where selected.

**Wave E — connectors/reporting and hardening**
- Market Data/Broker pack convergence;
- Reporting/Modeling;
- update/rollback/offline;
- storage/resource budgets;
- clean-machine pack tests.

P11 does not end after creating empty pack scaffolds or closing a source-disposition inventory. At least one real capability from each approved launch pack must execute end-to-end behind the common contracts; the V1 deferrals in §36 do not satisfy that full launch-family requirement.

## 32. P11 definition of done

P11 is complete when:

1. Core LiOS launches without optional packs.
2. Pack manifest/schema is versioned and validated.
3. Capability Router selects registered engines without donor-specific UI/core calls.
4. Python packs install into isolated deterministic environments.
5. At least one non-Python sidecar executes through LEP or an explicit reason records why none is shipped.
6. Arrow/Parquet data-plane handoff works for large local datasets.
7. Packs are signed, hashed and verified before activation.
8. Pack update and rollback are proven.
9. Pack removal does not corrupt Projects/Artifacts.
10. Pack crashes do not crash Electron or canonical state.
11. Every shipped pack includes SBOM/notices.
12. OSS registry maps every bundled major donor to exact version/commit/license.
13. Known-answer/conformance tests validate material financial calculations.
14. User-facing workflows reveal LiOS capabilities, not donor implementation names.
15. Pack resource/storage behavior is acceptable on clean supported machines.
16. Offline installed deterministic packs work with local data where designed.
17. Secrets never enter pack manifests, logs or exported Project packages.
18. Existing P0-P10 runtime/Project/Data/Artifact contracts remain authoritative.
19. No approved candidate remains in an undefined "adapt later" state.
20. A new approved donor can be added by implementing/registering an adapter/pack without rewriting core Project/Conversation/Artifact persistence.

## 33. P11 flagship proof journeys

### Portfolio
```text
Project data
 -> portfolio.optimize.black_litterman
 -> capability router
 -> Portfolio Pack
 -> selected primary engine
 -> optional validator
 -> Portfolio Artifact
 -> Show Work / receipt
```

### Institutional risk
```text
Project positions + governed curves
 -> risk.scenario / risk.xva
 -> Pricing & Risk Pack
 -> ORE/selected engine sidecar
 -> normalized RiskResult
 -> Risk Artifact
```

### Research
```text
SEC filing
 -> Research Pack
 -> EdgarTools/Arelle/Docling pipeline as required
 -> evidence-linked structured facts
 -> Research Artifact
```

### Quant forecast
```text
canonical time series
 -> forecast capability
 -> Quant Pack
 -> StatsForecast/Qlib/selected engine
 -> model receipt + Forecast Artifact
```

## 34. Future relationship to public plugins

P11 is **internal trusted engine packaging**.

The later Plugin/SDK phase is for third-party/external extension contracts.

Do not conflate them:
- P11 packs are first-party curated/signed internal runtime units;
- future plugins may be third-party and need stronger publisher/trust/revocation boundaries;
- both may reuse Runtime Registry contracts, but trust and distribution policies differ.

## 35. Final P11 principle

> **LiOS should own the intelligence operating system, not reimplement every mathematical library beneath it.**

The durable product is:

```text
User
 -> LiOS Projects / Conversation / Workspace
 -> capability + policy + context
 -> LiOS Engine Fabric
 -> hidden signed pack
 -> deterministic/model engine
 -> canonical result
 -> Artifact / Ledger / decision support
```

This lets LiOS exploit 20, 100 or 500 upstream projects over time while keeping the user experience simple and the core architecture stable.

## 36. Current implementation status and release truth

P11's **V1 source-controlled Engine Fabric/product-depth disposition is recorded complete**; the foundation and full productized pack-family/release scope remain distinct. This records source route disposition, not signed/provisioned donor packs, full launch-family completion or Shipping Point acceptance.

Delivery evidence follows **contract locked → code integrated → tests passed → packaged/provisioned → user accessible → vertical flagship passed → shipping point accepted → release proven**. The catalog's 24 available / 6 deferred / 1 policy-blocked / 0 planned counts describe source routes only, not installed donor-pack counts or accepted milestones.

Recorded source implementation/test evidence (not newly exercised by this document):

- manifest v1 and capability-contract validation;
- Ed25519-signed `.lios-pack` ZIP artifacts whose sorted file-checksum index is bound to the signed manifest;
- bounded archive parsing, traversal/collision/symlink rejection, verify-before-extract, private staging, atomic version install, health checks, side-by-side activation, rollback and valid-install recovery;
- actual Parquet decoding/row-count validation through DuckDB; Arrow IPC remains deliberately deferred until it is reintroduced through an isolated runtime pack after the required cross-process benchmark;
- LEP identity/schema handshake checks, capability allow-listing, signal/manual cancellation, timeout cancellation grace and forced termination of an unresponsive sidecar;
- runtime registration that omits `planned` and deliberately `deferred` capabilities while retaining explicit policy denial for broker order writes;
- P11 lifecycle/format/runtime behavior tests and a runtime-based acceptance check rather than source-string evidence.

`.lios-pack` v1 currently accepts single-disk, non-ZIP64 archives with UTF-8/ASCII-safe paths, no ZIP comments or local extra fields, no encrypted entries, and only stored/DEFLATE compression. Defaults cap compressed archive size at 256 MiB, expanded size at 512 MiB and entry count at 4,096. These bounds and path restrictions are part of the implementation contract, not general ZIP compatibility guarantees.

Runtime availability is explicit in `src/server/p11PackCatalog.ts` through `executionStatus`:

- `available`: **24** registered, executable capability routes in the V1 source surface;
- `deferred`: **6** intentionally excluded V1 capabilities with no truthful current execution authority;
- `policy_blocked`: **1** broker order-write capability, rejected by current product policy;
- `planned`: **0** catalog entries.

The executable adapters call existing LiOS/managed authorities for advanced valuation, portfolio optimization, derivatives/fixed-income/risk, forecasting/econometrics, point-in-time backtesting and strategy robustness validation. Research/Documents exposes Project search, governed research runtime and local Docling parsing. Data Lab exposes governed Parquet materialization plus DuckDB scans. Market Data exposes reference/local catalog discovery and governed historical observations with provenance. Reporting/Modeling exposes Project-scoped Artifact inspection. Local AI exposes provider inspection and **local-only** invocation through the existing BYOAI transport; model weights are never silently downloaded or made authoritative Project state.

The six deferred capabilities are Arrow IPC execution, live market streaming, broker inspection, and server-side XLSX/DOCX/PPTX export. These are omitted from runtime descriptors/routes rather than represented by metadata placeholders. The candidate inventory currently has zero bundled P11 donor projects; a donor decision or repository pin is not an imported/runnable engine.

Remaining **platform/release evidence**, separate from V1 source disposition:

1. Build and qualify real signed first-party pack artifacts for any launch family that will ship as an independently installed pack; verify exact upstream pins, code licenses, notices and separate API/data/model/trademark rights.
2. Exercise production Python/native/JVM pack environments and worker protocol on packaged macOS/Windows builds; where stronger isolation is required, prove an OS-enforced filesystem/network/process/resource sandbox rather than treating the subprocess boundary as one.
3. Measure packaged install size, startup, data throughput, resource ceilings, permissions and offline behavior with actual release packs.
4. Complete clean-machine packaged desktop acceptance on supported macOS and Windows architectures, including app signing/notarization where release requires it.
5. Revisit deferred capabilities through the bounded owners and evidence triggers below, without treating deferral as completed integration.

| Deferred surface | Canonical owner / SI contribution | Blocker and revisit evidence |
| --- | --- | --- |
| Arrow IPC execution | P11 / CA-06; SI-04.07, SI-05 engine data plane | Isolated cross-process benchmark and real typed handoff/cleanup/integrity proof; DuckDB+Parquet is the current baseline, not Arrow execution proof. |
| Live market streaming | P5 Data Fabric / P11 adapter; SI-05.01 | Verified provider rights/entitlements and canonical stream authority; revisit with real reconnect, backpressure, freshness and failure evidence. |
| Broker inspection | P5 connector / P11 adapter; SI-05 portfolio inputs | Real read-only connector, credentials/rights and governed inspection authority; revisit on an authorized read-only journey, never order-write approval. |
| Server XLSX/DOCX/PPTX export | P11 / CA-02 behind P4; SI-04.11–13 | Selected reviewed donor/runtime and actual server execution; revisit with cited Artifact → real format → reopen/round-trip and packaged evidence. Existing client exports are separate evidence, not proof of these server routes. |

Exact research `observedCommit` values in the candidate inventory are not interchangeable with selected release/import pins in the upstream lock. Reconcile the chosen source/version/path and rights before import; preserve both research provenance and exact approved pins.

Current local verification commands:

```bash
cd src
npm run test:p11
npm run acceptance:p11
npm run acceptance:p11:platform
```

The platform lifecycle command uses signed test fixtures. CI runs it on GitHub-hosted macOS and Windows runners, but that is not a substitute for production pack binaries, signing credentials or packaged Electron qualification. Keep P11 open until the remaining family integrations and release gates above are evidenced.
