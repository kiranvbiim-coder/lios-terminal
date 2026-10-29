# LiOS Connector & Data Intelligence Specification

## Current SI execution and Shipping Point authority — 2026-10-03

Read `AGENTS.md` → [SI execution plan](LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md) → [mandatory Shipping Point contract](technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md) → Master Plan → Architecture → OpenClaw Assimilation Blueprint → Capability Assimilation Workstream → UX System → this specification → detailed/historical roadmap → donor registry/current implementation → master issue #91 and the active canonical issue/PR.

`SI-01`–`SI-07` are strategic execution phases, not rigid dependency walls. `S0`–`S10` remain validation coverage; `CP1`–`CP7` remain historical evidence references. Multiple bounded owners may proceed behind stable contracts, with one canonical owner per shared core and existing GM/TC/CA/P IDs preserved. No SI data router, connector registry, identity store, permission layer or customer runtime is introduced.

`SP-01`–`SP-07` require a real Minimum Shippable Journey, applicable packaged/target execution, no fake success, regression protection and exact commit/build/environment/topology/check/result/limitation evidence. Use **contract locked → code integrated → tests passed → packaged/provisioned → user accessible → vertical flagship passed → shipping point accepted → release proven**. Connector contracts, source presence, registry entries, unit checks and historical COMPLETE labels do not imply accepted Shipping Points or released capabilities. P14 remains final release authority; privileged interactive `exec.*` remains blocked pending GM-11 exact-operation authority, sandbox and trust receipts.

Desktop Local/LiOS Home is the default customer runtime and owns identity, state and secrets. User NAS/server/VPS/cloud, databases, storage, models and approved providers are allowed; no LiOS-operated customer intelligence/data server or relay is assumed. Home identity/licensing is independent of connecting a source or cloud model.


**2026-10-28 channel convergence:** Under [the existing OpenClaw isolated supporting-service contract](technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md#01-owner-decision--full-openclaw-capability-convergence-through-an-isolated-supporting-service--2026-10-28), Telegram, WhatsApp and other approved user-connected channels are capability adapters behind the **existing** LiOS Gateway/Home, connector, P13 and privacy/permissions authorities. Evaluate the full useful donor/platform-supported feature surface, not only basic send/receive. Channel Add/Install is distinct from user account Connect/Authorize; each provider's actual readiness, rights/API constraints, receipts, disconnected/revoked states and per-conversation scopes must be accurately exposed. Work and Artifacts remain governed LiOS Chat/P4/P9/Workbench objects. Implement against the [five-package evidence checklist](PENDING_WORK.md#openclaw-isolated-supporting-service--five-package-agent-checklist--2026-10-28) and [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91); documentation is not implementation evidence.

## 0.0 General research and simple connection contract — 2026-10-02

**Owner-approved extension; implementation evidence is capability-specific, not blanket completion.** See [Terminal Convergence §0.0.12](LIOS_EXECUTION_ROADMAP.md#0012-general-ai-research-and-desktop-experience-expansion--owner-decisions-2026-10-02) for decisions, audit findings, candidates and acceptance journeys. Current source presence does not close live-provider, integrated, packaged or Shipping Point evidence gaps.

- General factual questions on any topic use web search by default; writing/editing need not search. Search/retrieval and AI inference are distinct capabilities; a connected model does not imply native search, tools, embeddings or cited responses. Verify capability-specific readiness through existing routers. Ordinary retrieval and deterministic work remain useful with AI off; quick answers are default and deeper research is explicit, bounded and cancellable.
- Auto retrieval for Project/Quick chats may read relevant approved connected sources across Projects. Tenant/client/source ACLs, user exclusions, explicit narrower scopes and stronger installed policies always apply. Web excludes Project/file content; Files includes only explicitly attached Project-file material; My Data cannot silently invoke market retrieval. Storage/index ownership and mutations stay scoped. A global connection does not confer universal access, and sharing one chat/Artifact does not share its Project. Temporary chats use only explicit session sources, never implicit private inheritance, persistent Ledger or durable memory.
- Recorded informed consent may allow relevant private excerpts to approved cloud AI providers without repeated routine prompts. Tenant/firm/source restrictions override convenience; revocation, provider change and local-only policy are enforced at context packaging and provider routing. Consent never creates source/tenant access. Preserve narrower installed settings during migration; no silent broadening or cloud fallback for local-only work.
- Documents require actual passage retrieval with stable document/page/table anchors. Datasets require governed discovery and bounded live queries; filename/profile discovery alone is insufficient. Semantic mappings must establish metric/entity/period/currency/unit and confirm material ambiguity.
- Query execution requires real engine-specific read-only and resource/access boundaries, not a SQL-prefix check. Apply timeout, row/memory caps before full buffering, cancellation, table/function restrictions and filesystem/network controls where applicable before widening database research paths.
- Normalize source identity and content revision separately; retain publication/effective/retrieval times, provenance, permissions, entitlement and extraction/truncation state. Quality defaults are not measured confidence; old-but-relevant historical evidence is not invalid solely due to age.
- Claims/financial assertion checks must use retrieved evidence with metric/entity/sign/value/unit/currency/period semantics. A claims schema, model response or heuristic confidence score is not proof of grounding. Numeric-guard containment and verified database execution boundaries remain prerequisites for widening affected paths.
- Fallback tries suitable permitted alternatives; disclose material substitutions/conflicts/gaps and retain original source/as-of context. Do not replace authoritative financial observations with unverified web prose.
- Connectors are discovered through a simple shared catalog/detail flow. Add/Install is capability acquisition; Connect is account authorization. One connection can support multiple capabilities when policy allows. Show only required OAuth/key/file/database setup fields and plain readiness/recovery states.
- A contextual connection step preserves the pending request, validates readiness and resumes once; settings and chat operate on the same connection record. Never imply catalog-listed or installed means live/entitled/ready.
- Search/extraction/embeddings and background work can cost money or local resources even with BYOAI. Enforce declared budgets, disclose known charges/estimates and support cancellation. No hidden LiOS inference-token billing.
- Do not promise premium competitor content through generic search or a copied connector. Exact software license, API/data rights, cache/redistribution terms and user entitlement are separate acceptance gates.
- Candidate search providers (Brave, Exa, Tavily, Perplexity, verified native grounding, optional user-managed SearxNG) require a measured adapter comparison; no default vendor selected yet.
- Connector acceptance includes cross-Project allowed/denied cases, source revocation/deletion, malicious retrieved instructions, quota/offline/failure/cancel, correct account, retry and retained-work behavior.



### Public/private company sources and no-upload baseline

[Terminal Convergence §0.0.13](LIOS_EXECUTION_ROADMAP.md#0013-public-and-private-company-research--no-ticker-and-no-upload-coverage--2026-10-02) defines ticker-independent entity discovery for listed, private/unlisted, LLP/SME, subsidiaries, historical and catalog-absent companies. Company identity coverage is separate from financial/document coverage, and privately held company is separate from access-controlled source. Resolve by name/domain/country/registration ID, preserve material ambiguity and provisional/parent/subsidiary/temporal distinctions, then retrieve. Do not manufacture a ticker or require an upload to obtain useful cited public identity/business/events/funding/peers/disclosures where evidence exists; missing quotes must not block qualitative research.

Current CA-03 source includes nullable `companies.symbol`, zero-security/listing entities, separate provisional identity/jurisdiction/legal-form/lifecycle facts and registry identifier namespaces in `src/shared/schema.ts` and migration `0077_lios_ca03_no_ticker_entity_identity.sql`. This is a schema/migration baseline, not proof every installation migrated or resolver/conversation/raw-query caller and coverage journey is complete. Country/entity-class/period/field/corpus depth and workflow usefulness still require actual retrieval evidence.

Source candidates include company sites, Companies House Public Data/Document APIs, SEC Form D for covered offerings, GLEIF identity, MCA authorized services/imports, commercial OpenCorporates access, entitled Crunchbase/PitchBook APIs and other qualified registries. Candidate listing is not proof of a shipped adapter, entitled account or universal private-company financial coverage; existing source-specific implementations must be assessed individually through the coverage funnel. OpenFIGI remains security identity enrichment, not private-company fundamentals.

Measure per-country/entity-class/period/field coverage. Distinguish disclosed, claimed, reported, user-provided, calculated, estimated, conflicting, not found, inaccessible and not applicable within existing trust contracts. Financing amount, amount sold, post-money valuation and revenue are different fields. No user-upload journey is required; deeper access remains BYOD with verified API/rights/entitlement. Assess paid-corpus economics separately; no vendor purchase or central data hosting is approved here.

**Status:** CANONICAL CONNECTOR / DATA ROUTING CONTRACT  
**Effective:** 2026-09-21  
**Parent:** `docs/LIOS_MASTER_PLAN.md`

## 1. Objective

LiOS should accept broad user/provider connectivity without turning data breadth into UI complexity.

The user experience is simple:

> Connect once. LiOS knows when and how to use it.

The backend is capability-aware, identity-aware, entitlement-aware and explicit about gaps.

## 1.1 Provider-neutral contract

The core engine contract is:

> **Engines ask for data, never for a provider.**

A valuation, portfolio, risk, research or chart engine requests canonical data requirements. The Data Router resolves those requirements against permitted/connected capabilities.

No analytical engine should permanently hard-code a vendor as its architecture.

## 2. Connection Center

Connection Center is the only primary setup surface for external/user systems.

Primary sections:

- Connected;
- Add source;
- Import;
- Data stack;
- AI providers.

Advanced sections may include:

- provider health;
- conflict/pins;
- credentials;
- runtime packs;
- consent;
- quotas;
- detailed diagnostics.

Normal analytical screens should not require users to understand connector internals.

## 3. Source classes

### User/private

- CSV/XLSX/TSV;
- local files/folders;
- databases;
- custom REST/JSON APIs;
- API-key/bearer/basic-auth endpoints;
- OAuth-connected services;
- cloud drives where implemented;
- private enterprise sources.

Additional supported/target private input classes may include:

- JSON and Parquet;
- PDF/document corpora;
- PostgreSQL / MySQL / SQLite / DuckDB where implemented;
- GraphQL;
- MCP resources/tools;
- broker/bank/portfolio sources under explicit permission.

Read-only access is the default for user/private sources. A non-brokerage workflow write requires its explicit canonical permission contract; brokerage/exchange order/account writes and copy trading are prohibited in current scope and cannot be enabled by connector metadata or confirmation alone.

### Custom/universal connector protocols

The universal connector layer should support, through one governed interface where implemented:

- REST/JSON;
- OpenAPI-described REST discovery/import;
- GraphQL;
- SQL/database sources;
- CSV/XLSX/TSV/JSON/Parquet;
- local folders/files;
- MCP resources/tools where appropriate;
- streaming/WebSocket sources when a workflow/provider requires them.

The product objective is **connect what the user brings** rather than force users into a fixed vendor list. Where technically and legally possible, a user should be able to connect a source through a generic protocol path even when LiOS has no vendor-specific adapter yet.

A generic connector must still declare capability, identity/mapping, freshness, entitlement and failure semantics. “Can make an HTTP request” is not sufficient to call a source production-ready.

## 3.1 BYOD custody rule

BYOD means the user can connect/import data without LiOS requiring a cloud copy of private data.

Approved default behavior (target contract, not a blanket current-source claim):

- read-only connector permissions where practical;
- local credential custody;
- local indexing/cache for private sources where practical;
- Project-owned storage/index/mutation authority, with source/client/tenant ACLs and retention/entitlements enforced independently of UI or models;
- explicit promotion and destination/scope preview when Quick/Temporary session material becomes durable Project data; important Project output must auto-persist through P4 rather than require manual Keep;
- approved cross-Project read federation only, with source attribution/exclusions and no automatic sharing or mutations across ownership boundaries. Migration/import preserves stronger installed settings; connection or memory presence is not a permission grant;
- delete/disconnect semantics that are understandable and testable.

Current conversation-produced Artifact retention still requires **Keep in Project**, including in Project Chat; Quick/Temporary work requires an explicit destination. Automatic meaningful Project-output persistence remains an open TC-13/P4 requirement, not implemented behavior proved by the current Keep path. Permissions, provenance, immutable versions and accessible history remain part of the required retention contract.

### Public/reference

Examples may include:

- SEC EDGAR;
- FRED;
- World Bank;
- IMF;
- Eurostat;
- ONS;
- exchange/regulatory sources;
- other permitted public datasets.

### Keyed/licensed

Examples may include user-owned access to:

- financial market APIs;
- estimates/fundamentals vendors;
- news/research providers;
- institutional sources.

LiOS does not assume the entitlement. The user brings credentials/rights.

### Analytical/aggregation sidecars

Examples:

- QuantLib-backed runtime services;
- focused analytical services justified by a concrete LiOS workflow;
- future approved MCP/tool servers.

OpenBB is not an approved LiOS connector/sidecar and was removed under LIOS-P0-01. Do not present it as a catalog connector, runtime pack or compatibility option.

### AI providers

Cloud or local AI connectors through the BYOAI router.


## 3.2 London Strategic Edge optional provider profile

London Strategic Edge (LSE) is a **keyed optional provider**, not a hard dependency.

The verified `lse-data` client library is MIT, but its README explicitly states that the software license does not grant rights in the underlying hosted data. LiOS therefore separates:

1. software-adapter rights;
2. the user's LSE service entitlement;
3. rights governing data use/redistribution.

### Connection model

```text
Connection Center
  -> London Strategic Edge
  -> user supplies own key
  -> key stored through LiOS local secret custody
  -> capability/health/usage discovery
  -> LSEProviderAdapter
  -> Universal Data Router
```

Rules:

- never persist the key in Project/chat/artifact payloads;
- never transmit the key to AI providers;
- never proxy LSE data through a Limuria multi-user redistribution service;
- cache locally only within allowed provider terms;
- make the connector replaceable by any other provider with equivalent capabilities;
- production distribution/marketing remains behind provider-terms review.

### Capability targets discovered in the audited SDK

Model these as runtime-discovered capabilities/entitlements, not permanent hard-coded promises:

- catalogue/instrument discovery;
- live tick WebSocket;
- historical candles;
- deep/tick history;
- bulk Parquet history/export;
- economic series;
- economic calendar;
- insider trades;
- dividends and splits;
- COT positioning;
- financial statements/reports;
- company profiles;
- fundamentals;
- government bond yields;
- options chains;
- options flow;
- option candles/subscriptions;
- usage/quota status.

### Canonical mapping

LSE-native responses must normalize into LiOS objects such as `Instrument`, `MarketQuote`, `OHLCVSeries`, `FinancialStatement`, `FundamentalMetric`, `CorporateAction`, `EconomicSeries`, `EconomicEvent`, `YieldSeries`, `DerivativeContract`, `OptionChain`, `OptionTrade/Flow`, `DatasetArtifact` and `ProviderUsage`.

Provider symbols are aliases, not canonical identity. LSE catalogue discovery feeds the Global Instrument Master and OpenFIGI/official enrichment pipeline where applicable.

### Streaming and bulk history

LSE streaming must enter the generic LiOS stream hub, with reconnect, subscription state, backpressure, timestamp normalization, replay/live markers, quota awareness and provider health. No LSE-specific UI transport is permitted.

Bulk Parquet history must enter the generic dataset/import path with local storage selection, quota budgeting, Arrow/DuckDB compatibility, provenance and no central redistribution.

### Data-gap behavior

If LSE is unavailable, exhausted, unentitled or disabled, the Data Gap Engine may route to another permitted provider, ask for a source, or explain the gap. No analytical engine may assume LSE exists.

See `docs/technical/LSE_TECHNOLOGY_ASSIMILATION.md` for the full V1 implementation matrix.

## 4. Capability Registry

Each connector advertises what it can do.

Recommended schema dimensions:

- connector ID;
- source class;
- data families;
- asset classes;
- geography/markets;
- field catalog;
- historical depth;
- update frequency;
- batch limits;
- search/universe support;
- stream support;
- credential type;
- entitlement policy;
- quota/cost hints;
- data-sharing/license restrictions;
- freshness semantics.

The UI can remain simple because the router reads this registry.

## 4.1 Coverage / breadth ledger

Data breadth must be measured rather than discussed generically.

For every important data family, market and provider path track:

> **required → available → connected → entitled → retrieved → mapped → used → verified**

Definitions:

- **required** — fields/capabilities needed by LiOS workflows;
- **available** — provider/source claims the capability;
- **connected** — user has configured the source;
- **entitled** — the user's license/account permits it;
- **retrieved** — LiOS can actually fetch it;
- **mapped** — it has usable canonical/extended semantics;
- **used** — a real LiOS workflow consumes it;
- **verified** — tests/live evidence confirm correctness.

This ledger is the primary way to find real data gaps, provider under-utilization and false “broad connectivity” claims.

Provider audits should report this funnel by data family, not just number of endpoints/connectors.

## 5. Canonical data families

At minimum route independently:

- identity/reference;
- quote;
- OHLCV/history;
- corporate actions;
- financial statements;
- fundamentals;
- analyst estimates;
- filings;
- news/research;
- macro;
- FX;
- fixed income;
- derivatives;
- fund/ETF;
- portfolio/private holdings;
- user-defined/custom datasets.

Do not force every family through one lowest-common-denominator shape.

## 6. Resolution policy

The resolver receives a canonical request and evaluates connected sources.

Conceptual order:

1. explicit user/manual authoritative input where applicable;
2. explicit pin;
3. project/family source policy;
4. user-ranked provider stack;
5. eligible public/reference fallback when policy allows;
6. deterministic derivation when semantically valid;
7. unavailable.

The resolver records:

- attempts;
- winner;
- alternatives;
- failure reasons;
- as-of/freshness;
- entitlement/rate-limit state;
- conflicts.

No valid source means no fabricated value.

## 7. Data Gap Engine

The Data Gap Engine converts absence into actionable state.

For each missing request determine:

- is another connected source capable?
- is a compatible connector available but not connected?
- can the user import it?
- can a deterministic engine derive a valid proxy/alternative?
- can the workflow continue without it?

The system explains the gap in user language.

Example:

> Consensus EPS is not available through the current source stack. Connect an estimates provider, import estimates, or continue with user-defined scenarios.

## 7.1 Data-gap and AI-assist behavior

LiOS primarily works with the data the user has connected or that an eligible public/source connector can legitimately retrieve.

When required data is missing:

1. identify the missing field/capability;
2. try eligible connected sources according to policy;
3. offer another connector/import/manual input where appropriate;
4. permit deterministic derivation only when mathematically legitimate and inputs are sufficient;
5. if the user explicitly asks for AI help, allow the connected AI to produce a **clearly labelled AI-derived estimate/analysis** using the permitted context;
6. never write that AI-derived value back as if it were observed provider data or an authoritative deterministic result.

The user should be able to continue working despite a gap, but the system must preserve the distinction between **observed data, deterministic derivation, manual input and AI-derived analysis**.

## 8. Provider depth

Connecting a provider should unlock the provider's useful documented breadth, subject to licensing and implementation.

Do not reduce every provider to the same five fields.

Maintain:

- canonical mapped fields for engines;
- extended provider fields for exploration;
- provider-specific search/universe capability;
- utilization reporting: available → retrieved → mapped → used.

## 8.1 Mapping and semantic safety

Provider-specific code should stop at the connector/normalization boundary.

- canonical fields are versioned;
- unknown but authorized provider fields remain available as namespaced extended fields;
- unit/currency/scale/period semantics are explicit;
- field-mapping suggestions may be deterministic or AI-assisted, but **no AI-suggested mapping becomes executable until confirmed** when semantics are ambiguous/material;
- mappings retain provider/source/schema version;
- schema changes and mapping failures surface explicitly rather than silently changing model inputs.

## 9. Identity resolution

Every finance route should resolve through canonical LiOS identity.

Inputs may include:

- name;
- domain;
- country/jurisdiction;
- namespaced registry/registration ID;
- ticker;
- exchange+ticker;
- FIGI;
- Composite FIGI;
- Share-Class FIGI;
- ISIN/LEI where permitted;
- provider ID;
- aliases/former symbols.

OpenFIGI is an important resolver/mapping source.

LiOS-owned entity/security/listing IDs remain durable internal identity.

### OpenFIGI enrichment rules

OpenFIGI is an identity/enrichment connector, not a price/fundamental provider.

**Credential model:** LiOS should ship the OpenFIGI connector capability, while the user supplies their own OpenFIGI API key/credential through Connection Center. Do not embed a shared production API key in the application.

Use it to improve cross-provider resolution and reduce duplicates:

- user-supplied credentials stay in the user/device credential vault;
- support bounded batch resolution and caching;
- preserve FIGI, Composite FIGI and Share-Class FIGI as distinct identifier types;
- retain source/retrieval metadata;
- use ticker + MIC/exchange and other permitted identifiers to disambiguate;
- do not make application startup depend on OpenFIGI;
- missing credentials, rate limits, ambiguity and no-match leave the existing canonical object usable with an explicit unresolved state;
- never fabricate an identifier.

Identity resolution should also use appropriate official/provider sources such as ISO 10383 MIC data, GLEIF/LEI, SEC CIK/EDGAR, permitted ISIN/SEDOL/CUSIP sources and provider-native IDs.

## 10. Global data breadth

The terminal should scale beyond a static bundled ticker file.

Architecture:

- local common-instrument index;
- provider universe ingestion;
- canonical dedupe/mapping;
- federated lookup on local miss;
- local cache of resolved identities.

The recorded provider-ingestion baseline expanded beyond the legacy ~67k directory to 80k+; this is not a fresh count or current packaged coverage claim. The target remains a measured 100k+ canonical searchable listing universe without pretending LiOS hosts all underlying market data. `realUniverseSize` measures deduplicated real candidates; the 120k `capacityProofSize` stress fixture proves index capacity, not market/entity coverage.

### Breadth acceptance

The 100k+ objective is a quality target, not a marketing counter.

Acceptance should include:

- measured canonical listing row count;
- primary/secondary listing relationships;
- dedupe quality;
- delisted/renamed identity handling;
- region/exchange coverage;
- provider mapping rate;
- federated miss-resolution success;
- search latency p95;
- unresolved/ambiguous identity rate.

Do not fabricate listings or ship an unmaintainable static 100k JSON merely to cross the threshold.

## 11. Conflict handling

When providers disagree:

- user-ranked/pinned source can remain the active winner;
- retain alternatives;
- show concise conflict state;
- expose detailed comparison in Advanced/Data Truth;
- preserve source policy in exports/receipts where relevant.

Normal screens should not show decorative provenance badges on every cell.

## 12. Freshness

Every data result should know its freshness semantics:

- live;
- delayed;
- end-of-day;
- historical;
- cached;
- manual/imported;
- model-derived.

Do not describe cached/manual/reference data as live.

## 12.1 Refresh and cadence policy

Refresh frequency is source/entitlement-aware.

- use live/streaming updates only when the connected provider supports and permits them;
- a **~1-minute refresh** is a useful target for eligible near-real-time desktop views when the provider and quota allow it;
- slower/delayed/end-of-day sources must retain their real cadence;
- background refresh should be adaptive to visibility, project activity, provider quota and battery/network state;
- never simulate a faster refresh by repeating stale values;
- point-in-time and historical analysis must retain the original source/as-of state.

## 13. Quota and cost awareness

The router may consider:

- remaining quota;
- expected request cost;
- breadth vs depth workload;
- rate-limit status;
- user policy.

Example: Pulse breadth may use a lower-cost eligible source while a detailed model uses a preferred high-depth source, if the user's policy permits.

## 14. Credentials

Rules:

- credentials are scoped to the user/org policy;
- secrets are stored in the appropriate vault/secure store;
- never inject credentials into AI prompts;
- sanitize pasted credentials;
- redact diagnostics;
- prevent credential leakage through redirects/logging;
- use explicit test/verify actions.

## 15. Community/non-licensed paths

Network-access libraries or unofficial/community sources must not silently activate in the retail desktop profile.

Use:

- explicit pack/source enablement;
- unified consent where the same capability has multiple entry paths;
- clear source status;
- fail-closed behavior without consent.

The existing pack-scoped managed Python runtime and community consent implementation should be preserved.

## 16. BYOAI

AI providers are connectors too, but are routed separately from financial data.

The BYOAI layer exposes:

- provider;
- model;
- tool support;
- structured-output support;
- context limits;
- local/cloud classification;
- endpoint/credential state.
- provider-reported model availability and supported generation capabilities, with an explicit checked-at state.

Static model catalogs are suggestions, not proof of user entitlement. When the provider supports model discovery, LiOS should use the credential-scoped discovery result to distinguish chat-capable models from other model families. Model discovery is read-only and must not send a prompt or silently change the user's selected model. Paginated catalogs must expose partial-result state; a model missing from a partial page is not evidence that the key lacks access. If discovery is unavailable or incomplete, show curated suggestions as unverified and preserve the explicit gap.

Completion, provider function calling, structured output, vision, embeddings, web search and provider-native grounding need separate readiness evidence. The recorded conversational completion path is not verified function calling: provider text or a capability flag must never execute a LiOS tool directly. Verified calls compile into the canonical plan/tool/permission authority; privileged interactive `exec.*` additionally waits for GM-11 authority, sandbox and trust receipts.

LiOS tools and finance state remain independent from any one AI provider.


## 16.1 LiOS Metric Catalog / Semantic Finance Layer

Canonical fields must evolve into a formal semantic catalog so AI, providers, screeners, models and exports all mean the same thing.

For each material financial metric store, where applicable:

- canonical metric ID;
- human definition;
- aliases/synonyms;
- unit and scale;
- currency behavior;
- instant vs duration semantics;
- fiscal/calendar period semantics;
- asset/company applicability;
- source/provider mappings;
- derivation formula/rules;
- restatement/revision behavior;
- valid transformations;
- validation constraints;
- lineage/source metadata.

Examples such as EBITDA, adjusted EBITDA, EBIT and operating income must never silently collapse into one field merely because a provider uses a convenient label.

The Metric Catalog is versioned. Ambiguous AI-suggested mappings require explicit confirmation before they become executable model semantics.

## 17. Connector SDK target

Adding a connector should eventually require:

1. manifest/capability declaration;
2. credential schema;
3. test/health function;
4. discovery/search functions if supported;
5. typed fetch functions;
6. canonical mapping;
7. extended-field catalog;
8. entitlement/freshness semantics;
9. tests;
10. Connection Center metadata.

Avoid permanent one-off provider shortcuts.


## 17.1 Provider SDK assimilation target

Provider contracts from approved OSS donors may be imported/adapted into a LiOS-owned Provider SDK.

Conceptual provider responsibilities:

- identity and metadata;
- capability declaration;
- markets/asset classes/data families;
- search/universe;
- fetch/batch fetch;
- streaming where supported;
- health/status;
- quota/rate-limit/cost;
- entitlement/license semantics;
- normalization/mapping;
- freshness/as-of semantics;
- deterministic failure reasons.

Analytical engines continue to request canonical data, never vendor brands.

Provider SDK implementation should support both vendor-specific adapters and generic REST/OpenAPI/GraphQL/SQL/file/MCP pathways.

## 17.2 Provider fallback, cache and stream fabric

LiOS may assimilate tested provider-fallback, stale-while-revalidate, background-prefetch and WebSocket/market-data-hub patterns from permissively licensed donor terminals.

Required behavior:

- explicit provider attempt order;
- no silent substitution that violates project/source policy;
- stale data remains labelled stale;
- cache records source/as-of/freshness;
- failover records why the preferred provider failed;
- streaming and snapshot paths converge into common canonical semantics;
- provider-specific fields remain available as extended fields;
- offline/local cache may preserve useful work but never pretend to be live.

## 17.3 Point-in-time and revision-aware data

Historical research/backtesting must avoid look-ahead leakage.

Where applicable, financial observations should retain:

- period end;
- first reported/published timestamp;
- effective/as-known-from timestamp;
- retrieval/source-as-of timestamp;
- revision/restatement version;
- superseded/current status.

Time Machine and backtests use the state available at the requested historical knowledge date rather than today's restated values unless the user explicitly requests restated/current data.

## 17.4 Real Data Quality Engine

LiOS must implement real validation of actual data. Do not import donor demo/stub logic that fabricates quality events.

Checks may include:

- missing observations/gaps;
- duplicate keys/timestamps;
- stale data;
- impossible/invalid values;
- unit/scale/currency mismatches;
- fiscal-period mismatches;
- restatement/revision conflicts;
- outliers and suspicious jumps;
- corporate-action adjustment failures;
- provider disagreement;
- schema drift;
- broken identifiers/mappings;
- non-monotonic or malformed time series;
- incomplete required model inputs.

Quality results attach to the affected dataset/field/source and may block authoritative model execution when material.

## 17.5 Instrument universe and federated discovery

The instrument master should combine:

1. fast local canonical index;
2. known provider/exchange/regulatory universes;
3. OpenFIGI identity enrichment;
4. connected provider search;
5. federated external resolution when a local miss occurs.

The objective is broad discoverability without making raw ticker strings durable identity.

## 17.6 Data lineage

For material model/report outputs, preserve a lineage path conceptually equivalent to:

> connector/source → retrieved record → mapping/normalization → canonical/extended dataset → deterministic transformation/model → artifact/export

OpenLineage-style event schemas may be adopted where useful. The user sees this lineage through the Show Work/receipt UX only on demand.

## 18. Health states

Use simple states:

- Not connected;
- Connected;
- Live verified;
- Degraded;
- Rate limited;
- Entitlement missing;
- Consent required;
- Unavailable.

Only show detailed internal diagnostics when the user asks or recovery requires them.


## 18.1 Runtime-pack connector behavior

Some connectors or analytical capabilities may require optional Runtime Packs.

Examples:

- Research Pack for filing/XBRL/document tooling;
- Quant Pack for advanced quantitative engines;
- Modeling Pack for spreadsheet/model tooling;
- Data Lab Pack for Perspective/Arrow/Polars;
- Local AI Pack for supported local inference/embedding tools.

If a requested capability is architecturally supported but its pack is absent, LiOS should show an explicit install/enable action and continue with valid alternatives when possible.

## 19. Connector acceptance

A production connector is incomplete until:

- credentials can be safely saved/tested;
- supported capabilities are registered;
- canonical identity mapping works;
- failure/rate-limit behavior is explicit;
- freshness is correct;
- no data fabrication occurs;
- source restrictions are respected;
- offline tests exist;
- live/provider-contract tests exist where credentials permit;
- the user can understand recovery.


<!-- LIOS-FINAL-2026-09-21-CONNECTORS -->
## Final 2026-09-21 universal data and interoperability lock

This section extends the connector contract for the final build plan. It preserves all existing connector behavior and strengthens the goal: LiOS should make almost any legitimate user-connected source useful without hardwiring the product to one data vendor.

### Universal Data Fabric

LiOS analytical code asks for canonical capabilities, not provider-specific endpoints.

Representative capability calls include:

- resolveSecurity;
- searchUniverse;
- getQuote;
- getPriceHistory;
- getFinancialStatements;
- getFundamentals;
- getEstimates;
- getCorporateActions;
- getFilings;
- getNews/Research;
- getOptionsChain;
- getYieldCurve;
- getMacroSeries;
- getFX;
- getPortfolio;
- getTransactions;
- getAlternativeAssetData;
- getProviderExtendedFields.

The Data Router determines which permitted connected source can satisfy the request.

### Source classes

The connector layer must support or remain extensible to:

- CSV/TSV;
- XLSX/spreadsheets;
- JSON;
- PDFs/documents;
- local folders;
- databases;
- REST;
- GraphQL where useful;
- WebSockets/streaming feeds;
- OAuth-connected services;
- cloud storage;
- MCP resources/tools;
- OpenFIGI;
- regulatory/exchange/public sources;
- macro/statistical sources;
- CCXT/exchange APIs;
- licensed/premium APIs;
- enterprise/private endpoints;
- user-built provider adapters.

A product feature must not assume that one named provider is always present.

### Canonical identity

Ticker strings are not durable identity.

The canonical model remains:

**Entity → Security → Listing → Provider Identifier**

Identity mappings may include, where permitted/available:

- internal LiOS ID;
- FIGI/Composite FIGI;
- ISIN;
- exchange ticker;
- provider identifiers;
- other licensed identifiers.

OpenFIGI is a built-in mapping capability using user-supplied credentials where required. It strengthens identity resolution but does not replace LiOS-owned canonical IDs.

### Capability-first provider selection

Each connector declares what it can actually provide, including:

- asset/security coverage;
- fields;
- history depth;
- frequency/granularity;
- real-time/delayed/end-of-day status;
- point-in-time/revision support;
- streaming support;
- non-brokerage write capability only where a separate canonical permission contract allows it; no trade/order/account-write readiness in current scope;
- quotas/rate limits;
- credential/entitlement requirements;
- geographic/market coverage.

Routing uses this capability metadata rather than assuming all connectors are equivalent.

### Provider depth and extended fields

Provider neutrality does not mean lowest-common-denominator data.

LiOS should preserve access to provider-specific extended fields where practical. Canonical normalized fields power common workflows; provider extensions remain discoverable and queryable when the user has access.

### Source policy and precedence

Project source policy may define:

- user/private data as authoritative;
- preferred providers;
- forbidden providers;
- pinned source for a metric/family;
- fallback order;
- local-only rules;
- primary-source-only research;
- permitted web/public research.

Explicit user selection wins over generic routing only when valid under tenant/client/source ACLs, entitlements, exclusions and stronger policies. Project-owned storage/mutation does not prohibit approved cross-Project read federation; read permission or cloud-AI consent never grants mutation or tenant access.

### Data-gap intelligence

When a requested field/capability cannot be satisfied, the router returns structured gap information, not fabricated data.

Gap output should identify:

- missing capability/field;
- providers checked;
- reason unavailable where known;
- entitlement/credential issue;
- unsupported frequency/history;
- quota/rate-limit issue;
- source conflict;
- valid alternatives.

The UI/runtime may offer actions such as:

- connect a suitable provider;
- import a file;
- choose another connected source;
- continue with available historical data;
- create an explicit user estimate;
- cancel.

AI cannot silently manufacture the missing observation.

### Conflict handling

If providers disagree, preserve:

- each observation;
- provider;
- timestamp/as-of date;
- revision/publication metadata where available;
- units/currency/frequency;
- transformation history.

Conflict policy may choose a display/working source, but underlying disagreement remains inspectable.

### Point-in-time and revision semantics

Where the source supports it, connectors should distinguish:

- observation period;
- release/publication timestamp;
- retrieval timestamp;
- revision/vintage;
- "as known on" date.

Backtests, historical research and Time Machine workflows must avoid look-ahead by using point-in-time data when required.

A connector that cannot guarantee point-in-time integrity must declare that limitation.

### Streaming and real-time

Streaming connectors expose a common lifecycle for:

- connect;
- subscribe;
- update;
- reconnect;
- stale state;
- unsubscribe;
- close.

Do not hardcode five-second polling when a provider offers proper streaming. When polling is necessary, use connector-specific quota-aware policies.

Streaming data flows through normalization and local caching before UI consumption.

### Local import contract

Imported files/datasets should record:

- source file/hash;
- schema;
- inferred/confirmed data types;
- units/currency;
- entity/security mappings;
- import timestamp;
- Project scope;
- user corrections;
- transformation history.

Imported user data may be explicitly marked authoritative for a Project.

### Analytical local-store boundary

Connectors should be able to materialize normalized data into the local analytical path (DuckDB/Arrow/Parquet/other approved stores) without coupling provider SDKs to renderer state.

Provider adapters fetch/stream; local analytical services query/transform.

### Connector health

Each connector exposes structured health such as:

- connected/disconnected;
- auth required;
- entitlement missing;
- rate limited;
- degraded;
- stale;
- schema changed;
- healthy.

Project Home should surface health only when action is required; detailed diagnostics live in Connection Center/diagnostics.

### Credentials and secrets

Secrets remain in OS-secure/local secret custody and are referenced by opaque IDs.

Never:

- persist API keys in Project/session exports;
- send keys through renderer state;
- write secrets to logs;
- include credentials in MCP prompts/resources;
- duplicate secrets when sessions are forked.

### BYOAI as a connector/provider family

AI providers are connector-like capabilities behind AIProvider.

Ollama is optional rather than primary.

AI configuration may include:

- provider/model;
- endpoint;
- credential reference;
- local/cloud classification;
- tool/function support;
- embedding support;
- context limits/capabilities;
- Project policy restrictions.

Projects/firm/source policy may prohibit cloud providers or restrict transmission. Recorded informed consent may authorize relevant private excerpts to approved models without repeated routine prompts, but revocation/provider changes and local-only restrictions must be checked at both packaging and routing; no cloud fallback may finish local-only work.

### MCP client interoperability

MCP servers are treated as external capability providers.

For each MCP server record:

- identity/version;
- Project scope;
- tools/resources/prompts actually permitted;
- credential reference;
- network/process boundary;
- filesystem access policy;
- user/organization approval;
- health.

MCP never gets implicit access to every Project or credential.

### Future MCP server mode

LiOS may later expose approved governed capabilities as an MCP server.

Expose only:

- explicit tools/resources;
- permission-checked Project scope;
- entitlement-compatible data;
- redacted/approved outputs.

Do not expose secret stores, unrestricted filesystem, arbitrary database access or hidden internal state.

### Controlled browser/web connector

Playwright or equivalent web automation must run in an isolated connector/runtime with:

- allowed domains;
- navigation/download policy;
- bounded tabs/processes;
- timeouts;
- filesystem sandbox;
- user/project permission;
- execution receipt;
- no renderer privilege escalation.

Web research output still passes through evidence/source normalization.

### Exchange/transaction connectors

CCXT or other exchange/broker adapters may provide read-only market/account data when explicitly authorized under the source's rights and LiOS policy.

Brokerage execution, copy trading and exchange/broker order or account writes are prohibited in current scope. Broker & Execution donor/pack labels and connector write metadata do not reopen that scope. Any future write/order tier needs a separate owner-approved controlled design; data connectivity or a user-confirm action class is not trade authorization.

### Generic custom provider path

LiOS should make it straightforward for a user/developer to map a permitted REST/JSON/database source into canonical capabilities.

The minimum custom-provider definition should support:

- auth;
- endpoints/query templates;
- schema/field mapping;
- entity/security mapping;
- pagination;
- rate policy;
- caching;
- freshness;
- error mapping;
- capability declarations.

This path is important for enterprise/private data breadth.

### Research source policy

Research connectors should distinguish:

- first-party filings/company materials;
- regulator/exchange sources;
- licensed/professional research;
- public web;
- user-uploaded documents;
- user notes/estimates.

Project policy may require "only these sources" or "primary sources only."

### Data rights and software license separation

A permissive connector implementation does not grant rights to redistribute or commercially expose the upstream data service.

For every provider integration, separately track:

- code license;
- API/service terms;
- data redistribution/display rights;
- credential ownership;
- branding/attribution requirements;
- caching/retention restrictions.

### Portable Project/session import

Portable Project/session packages may include user-approved local data snapshots but never credentials.

On import:

- provider references are re-bound;
- unavailable providers are marked;
- entitlements are re-evaluated;
- missing datasets become explicit gaps;
- secret references require destination-machine reconfiguration.

### Connector acceptance criteria

A connector/provider adapter is not production-ready until it has:

- typed capability declaration;
- auth/secret handling;
- health state;
- normalized errors;
- cancellation/timeout;
- quota/rate behavior;
- freshness/as-of metadata;
- point-in-time declaration;
- data-gap behavior;
- Project permission enforcement;
- local/packaged desktop test;
- service/data-rights review;
- tests for real and unavailable states.
- applicable SP real-user MSJ and packaged/target evidence with exact identifiers, limitations and truth level; later SI work protects any accepted journey rather than redefining it.

The target behavior is simple: LiOS either returns governed data from an allowed source or clearly explains why the requested data is unavailable and what the user can do next.
