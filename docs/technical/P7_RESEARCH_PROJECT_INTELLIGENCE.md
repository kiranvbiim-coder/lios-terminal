# P7 — Research, Project Intelligence and Thesis State

P7 turns existing Project state into evidence-backed research intelligence without creating another workspace, memory system, dashboard hierarchy, or AI-owned source of truth.

The [SI execution plan](../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md) governs strategic execution. P7 remains the research/index subsystem owner supporting SI-03 and P4 professional work in SI-04; S0–S10 are validation coverage, not implementation phases.

## Authority and state ownership

- **Authoritative state:** P1 Projects/chats/resources, P3 Ledger, P4 Artifacts/versions, P5 governed providers and source policies.
- **P7 Project Intelligence index:** derived and rebuildable. It may accelerate retrieval but cannot become authoritative state.
- **Thesis state:** a first-class P4 `ThesisArtifact`, so every refresh/postmortem is versioned and ledger-compatible.
- **AI:** optional. Deterministic search, graph, delta, filing diff, Insight Lens and Thesis state transitions do not require BYOAI.
- **External tools:** browser and MCP calls stay behind the existing P5 Project policies and explicit approval contracts.

## Canonical implementation

| ID | Implementation |
| --- | --- |
| LIOS-P7-01 | `p7ProjectIntelligence.ts::buildReactiveContextGraph` creates a typed graph across Project sources and the canonical finance dimensions: entity, metric, period, date, event, portfolio, benchmark, scenario, geography and currency, plus explicit evidence relations. |
| LIOS-P7-02 | `compileDeterministicInsights` produces change/contradiction/staleness/open-question/risk/catalyst/decision signals and explicit deterministic anomaly/trend/percentile/revision/correlation/curve/regime signals; Project Home renders the Insight Lens. Contradictions are emitted only from exact `relations[{ type: "contradicts", targetRef }]` edges, canonicalized as source pairs with both evidence refs; prose containing the word “contradict” is not a contradiction signal. These signals require deterministic source metadata and are never AI-inferred then relabelled deterministic. |
| LIOS-P7-03 | `createProjectSnapshot` + `diffProjectSnapshots` implement immutable Project snapshots and What Changed. `project_intelligence_document_versions` retains content-addressed document bodies, while `getProjectIntelligenceHistoricalState` and `projectIntelligenceAsKnownOn` reconstruct exact retained Project state at a real snapshot on/before a requested time. |
| LIOS-P7-04 | `buildResearchGraph` projects research/evidence/filing/report/thesis plus the canonical finance context dimensions from the same Context Graph. |
| LIOS-P7-05 | `p7ProjectIntelligenceStore.ts` rebuilds a tenant-scoped index from permitted chats/messages, non-excluded resources, Artifact heads/assumptions/decisions/timeline events and Project Ledger events. Credential-shaped metadata/refs are removed before indexing. Explicit derived evidence/documents may be cached with `preserveOnRebuild`; canonical state remains elsewhere. |
| LIOS-P7-06 | Built-in bounded hybrid search uses the single P7 document projection: BM25-style lexical ranking, optional caller-supplied local embedding similarity, exact entity-ref ranking and structured context-ref ranking (metric/period/event/portfolio/benchmark/scenario/geography/currency, etc.) are filtered by source policy first and fused deterministically with weighted reciprocal-rank fusion. No LLM/query-expansion step is required. Docling 2.129.0 is an optional `research-docs` managed runtime, local desktop only. `sqlite-vec` stays a non-authoritative optional accelerator/stub for V1 rather than creating a second database beside PGlite/Postgres. |
| LIOS-P7-07 | `thesisArtifactContentSchema` models claims, catalysts, risks, evidence/counter-evidence, invalidation conditions, open questions, refresh state and postmortems; `lios.thesis.native` is the built-in Artifact adapter. |
| LIOS-P7-08 | `p7ThesisEngine.ts` refreshes only from explicit evidence signals, records contradictions/changes and appends explicit postmortems as new Artifact versions. |
| LIOS-P7-09 | `buildUnifiedTimeline` merges dated Project evidence/events into one provenance-preserving timeline; TimelineArtifact events are indexed individually rather than flattened into the parent Artifact. |
| LIOS-P7-10 | `p7FilingDiff.ts` performs section-aware primary-source filing comparison, emits section evidence refs and persists each user-run comparison as derived Project research evidence so it participates in search and later snapshot deltas. |
| LIOS-P7-11 | `p7ResearchTools.ts` exposes LiOS-owned Project research tools and a non-bundled donor-adaptation manifest for TradingAgents, Dexter, LangAlpha, Fin-Agent and LSE. Their approved patterns map into LiOS Agent Runtime, Project/Artifact/Ledger, Data Fabric, permission and BYOAI contracts rather than importing competing persistence/provider runtimes. |
| LIOS-P7-12 | ResearchArtifact is the canonical research pipeline: question → structured plan → permitted-source policy → indexed extraction/evidence → claim/evidence/contradiction graph → analysis document → versioned Artifact. SI-03.07 adds `lios.web.evidence_artifact`, an exact-source deterministic consumer that turns already-captured governed-browser pages into source-separated citation blocks without creating another research store or network authority. SI-03.09 projects each cited ResearchArtifact evidence item into the existing tamper-evident P3 Artifact ledger event with source/time/excerpt-hash-or-locator/transformation/downstream-use lineage. SI-03.10 adds explicit claim provenance and claim-level lineage so source support is distinguishable from analytical inference, user assertion and legacy/unknown provenance. |
| LIOS-P7-13 | ThesisArtifact adds explicit expected outcomes alongside claims/catalysts/risks/invalidation/open questions. Expected-outcome state changes only from explicit evidence signals and is included in refresh history and evidence collection. |
| LIOS-P7-14 | Timeline is both a first-class P4 TimelineArtifact and a derived Project Intelligence view. TimelineArtifact events retain their own source/artifact/decision refs and are indexed individually. |
| LIOS-P7-15 | Intelligence Timeline events retain source/entity/artifact/model/decision refs. The timeline API supports deterministic event/source/entity/model/artifact/decision/time filters, and Project Home exposes compact event/reference filtering. |
| LIOS-P7-16 | `lios.project.what_changed` is a first-class deterministic Conversation Runtime workflow backed by immutable Project snapshots/deltas and covered by runtime + engine tests. |

### Explicit local embedding retrieval

Project Intelligence defaults to **Lexical · no model**. Select **Local embeddings · Ollama / LM Studio** and enter the exact installed, rights-approved embedding model to opt into the existing P7 fusion ranker with generated vectors. `POST /api/projects/:projectId/intelligence/search/local` uses the same current owner/Project/source filters before generation and before results are presented. Ordinary search now refreshes stale projections using the canonical Project edit/activity clock; excluded, archived or removed resource children cannot remain searchable merely because their old index rows exist.

The existing BYOAI transport owns the local embedding request. Only configured loopback endpoints are permitted; redirects, remote fallback, downloads and automatic model selection are forbidden. Organization AI policy is enforced. Query and at most 64 permitted source passages (4096 characters each) are embedded in one batch. Provider-bound research is withheld from model input rather than treating a retained entitlement record as a current model-use grant. Explicit source AI restrictions are honored; the UI reports withheld, omitted and truncated counts.

Vectors are **request-only derived values**: finite, nonzero, consistent-dimensional and normalized. The response must name its served model. Query/source vectors share one response space; no vector from another model or source revision is reused or written into immutable source history. Results expose space id, model, dimensions, exact source revisions and limits. Request-only recomputation trades inference cost for bounded, straightforward custody; it does not create a second vector store.

Missing/unavailable local endpoints fail explicitly. Lexical retrieval remains selectable without a model. Synthetic HTTP protocol/vector fixtures verify transport, authorization, malformed-space rejection and ranking integration, not installed model quality. Real installed-model semantic quality/rights and native shipping qualification remain separate prerequisites.


## ResearchArtifact workflow state

P7 extends the existing P4 `ResearchArtifact` rather than creating a competing research object. It now carries:

- a research question and structured plan with step status and allowed source kinds;
- evidence records with source ref, optional URL, snippet, source type and observation time;
- an explicit source policy: connected sources, or **Use only these sources** with an allow-list; deterministic Project search and agent tool invocation read the active ResearchArtifact policy and filter Project retrieval to the allow-list, failing loudly when `only_refs` has no sources. Agent invocation reloads this policy before each tool call rather than retaining a stale plan-time list;
- structured contradictions linked to claims/evidence; the deterministic Project evidence digest projects an explicit contradiction only when both opposing source refs are in the selected/permitted evidence set, so an excluded relation target cannot leak through metadata;
- a compact execution trail with timestamp, action, source refs and optional execution receipt;
- the existing editable research document blocks and claims.

Evidence and open contradictions are projected into Project Intelligence during rebuild, while the ResearchArtifact remains the versioned canonical research work product.

Governed `agent.browser.navigate` is the canonical SI-03.07 web-research acquisition path: an approved public search/result URL can be browsed with bounded link extraction, selected pages can be collected in the same governed multi-page tool, and Auto-scope text extraction is captured through the existing P7 document/version index. Link/JSON extraction remains discovery output and is not silently indexed as textual evidence.

For every collected page, the connector preserves both the requested URL and the browser's resolved URL after redirects. The resolved URL is re-authorized through the same Project browser policy before extraction is accepted, becomes the canonical P7 source/citation identity, and retains the requested URL as a dependency. Adapter identity, retrieval time, extraction selector, acquisition reference/hash and untrusted claim posture remain attached; publication/effective dates stay unknown rather than being inferred from retrieval. Active ResearchArtifact source selections restrict requested browser URLs before launch. Web-only scope returns browser output without adding Project knowledge.

`lios.project.evidence_artifact` preserves acquired source URLs, underlying source dependencies and selected acquisition provenance in quote-block attributes, including the indexed document revision hash and requested→resolved URL provenance when a web page redirected. This is extractive evidence, not verification of webpage assertions. Capture completeness is explicitly `bounded_not_verified`; requested→resolved redirect identity is preserved, while precise page/paragraph anchors and full-source completeness still require deeper acquisition work. Source browser-to-index-to-Artifact/reopen smoke is not packaged SP-03 acceptance.

### SI-03.05 cross-Project retrieval

`lios.project.cross_search` is the bounded cross-Project retrieval surface. It does **not** add a Project-sharing system or an all-Projects search authority. The exact target Project IDs are part of a `user_confirm` governed operation. Before any target search or lazy index rebuild starts, LiOS validates the current Project and every requested target through the canonical owner/organization `getProject` access check. A mixed authorized/unauthorized target set therefore fails closed rather than returning partial data.

The operation searches only the deduplicated IDs in the approved request, labels every hit with its Project ID, globally ranks the bounded P7 results, and propagates the active ResearchArtifact `allowedSourceRefs` to every target. The existing `lios.project.search` remains the safe-auto current-Project path; cross-Project access is never inferred from model intent, Project names, session visibility, or a downloaded Project roster.

**Donor disposition:** pinned `openclaw/openclaw@c074824a27c96d3983043f9eeb33823cd1772d8c` (MIT) `docs/concepts/session-search.md` contributes the visibility-before-result-limit and bounded-result mechanism, while `docs/gateway/operator-scopes.md` contributes current-authority recheck discipline. **ADAPT PATTERN** only: OpenClaw's broad default cross-agent visibility is intentionally not imported; LiOS keeps explicit one-shot Project selection and canonical owner/org access as the stricter authority.


### SI-03.07 exact governed web evidence

`lios.web.evidence_artifact` completes the durable collect/compare/cite step without becoming a crawler or search provider. Its model-visible input is only a question/title plus 1–10 exact HTTPS source URLs already returned by the governed browser. Each requested URL must resolve to a canonical P7 `research_evidence` capture with browser acquisition provenance. Requested redirect aliases are accepted only when they belong to that same captured document; the resulting Artifact cites the final resolved URL and retains the requested URL in dependency/provenance lineage.

The operation fails closed if any requested source is missing, outside the active ResearchArtifact source selection, not a governed-browser capture, or aliases a source already selected. Every source remains a separate evidence/quote/citation block with content hash and explicit truth posture. Multiple sources are placed in a deterministic comparison boundary, but LiOS does not infer agreement, verification, or contradiction from wording alone. Durable creation requires Auto scope; Web-only browsing intentionally remains non-persistent.

**Donor disposition:** the already-registered OpenClaw browser/search separation remains a **REFERENCE/ADAPT PATTERN** validator, while the registered LSE web-tool posture contributes bounded reads, redirect/host safety and fail-loudly network behavior as an **ADAPT PATTERN**. LiOS reuses GM-14/P5 and P7/P4 authorities and imports no donor crawler, search-provider registry, runtime, or persistence authority.

## SI-03.09 evidence ledger

The evidence ledger is a **projection into the existing P3 Project Ledger**, not a new research database. P4 already emits tamper-evident `artifact.created`, `artifact.versioned` and `artifact.forked` events. For ResearchArtifacts, those same events now add one evidence node per cited evidence record and retain the existing Artifact/source nodes.

Each evidence-ledger entry records:
- the exact source ref and ResearchArtifact evidence ID;
- the quote-block locator when one exists;
- SHA-256 of the displayed excerpt/snippet rather than raw source text;
- indexed source content hash when P7/P4 supplied it;
- observed/retrieved/published/effective clocks plus the explicit as-of basis when available;
- bounded extraction/acquisition posture such as evidence kind, selector/extraction metadata, completeness, acquisition ref and acquisition output hash;
- the exact downstream Artifact version ref that used the evidence.

Lineage edges show `source → evidence` as produced evidence and `evidence → artifact@version` as downstream usage, while the existing direct source→Artifact `used` edge remains for compatibility. Non-research Artifacts keep their existing ledger behavior. Ledger sanitization, owner/organization scope and hash-chain integrity remain P3-owned.

This design intentionally avoids storing full excerpts in the ledger and avoids a second provenance store. P5 `DataLineageReceipt` and optional P10 OpenLineage export remain authoritative for provider/data-pipeline lineage; SI-03.09 covers **research evidence usage in durable work products**. Existing OpenLineage support is reused as an interoperability reference rather than imported as another state authority.

## SI-03.10 claim provenance

ResearchArtifact claims carry an explicit provenance class: `source_backed`, `explicit_inference`, `user_asserted`, or `unknown`. Legacy claims default to `unknown`, while `source_backed` claims fail validation unless they cite at least one source ref. Claim source refs reuse the existing credential-bearing-reference guard before any Artifact write, fork, or proposal application.

The existing P3 Artifact ledger projects each claim as a first-class `claim` lineage node containing the claim ID, a SHA-256 statement hash, declared provenance and source refs; raw claim text is not copied into ledger lineage. When a cited source maps to a ResearchArtifact evidence record, lineage begins at that evidence node. Otherwise it begins at the cited source ref. Only explicitly `source_backed` claims receive `supports`; source-linked inference/unknown/user-asserted claims use `derived_from`, so citation presence is never silently upgraded into verification. Claims without source refs receive no fabricated source edge. Every claim then links to the exact downstream `artifact@version` that contains it.

This remains a projection into the canonical P3/P4 Ledger/Artifact authorities: no second provenance table, graph store, claim database, verification model, or AI classifier is introduced.

## SI-03.22 explicit Research Artifact refresh

`lios.research.refresh` evolves an active ResearchArtifact only through the existing P4 immutable-version authority. The operation is once-only `user_confirm`, requires authenticated Project agent context plus an exact expected Artifact head version, and performs no provider/network fetch.

The Artifact source policy and the active run's server-owned source refs are intersected before P7 retrieval. Deny-all or disjoint source selections fail closed, as do Web/Files scope, disabled resource transmission and provider allow/deny restrictions that the current P7 retrieval path cannot enforce exactly. A refresh never widens its own source permissions.

P7 search returns the exact indexed document content hash. Before persistence, refresh re-reads the matching Project document and requires that hash to remain unchanged, preventing a search→save race from binding an excerpt to a different source version. New or changed source versions append separate evidence/quote blocks containing the source content hash, excerpt hash, explicit truth/provenance metadata and a link to the previous quoted evidence version when one exists.

Existing blocks, claims and prior Artifact versions remain unchanged. Refresh does not reverify or rewrite claims, and a no-change result writes no Artifact version. Repeated use of the same source ref is bound in the P3 evidence ledger by exact evidence ID (with conservative legacy fallbacks), so separate acquisitions retain their own content hashes rather than inheriting the first quote for that source.

No second research store, version store, ledger, retrieval engine or source-policy authority is introduced.

## SI-03.14 entity intelligence

Research-facing entity resolution reuses the canonical P5 Global Entity & Instrument Master through `lios.entity.resolve`. The tool is deterministic, read-only, bound to an authenticated owned Project in Auto/My Data scope, and local to persisted LiOS identity state: it does **not** invoke an external provider, infer a ticker, or auto-persist an unverified identity.

The model-visible request must specify exactly one primary lookup — legal/name identity, ticker, provider-neutral identifier, or provider-scoped identifier — with optional MIC/exchange qualifiers for ticker queries and optional historical/as-of semantics. The result exposes the same durable P5 hierarchy and truth boundaries:

- stable `lios:entity:*`, `lios:security:*` and `lios:listing:*` identities where those records actually exist; `instrumentId` remains null unless a genuinely distinct canonical instrument layer exists;
- provider-neutral identifiers with explicit namespaces, including registry + jurisdiction for registry-scoped IDs;
- legal-entity kind/status/identity confidence, so a persisted private/no-ticker entity or persisted `individual` can resolve without inventing a listing;
- listing venue/MIC/currency/share class and lifecycle/as-of state;
- predecessor/successor entity refs and ADR/GDR/related-listing refs already owned by P5;
- explicit `ambiguous` with bounded ranked candidates/reasons when P5 cannot choose uniquely;
- explicit `not_found` when no persisted canonical identity matches.

External/provider fallback remains a separate governed P5 data operation. It is deliberately excluded from this `safe_auto` research tool so a deterministic local lookup cannot silently become a network request or persist an external guess.

**Donor disposition:** the LiOS Global Instrument Master and its existing OpenFIGI fallback integration are **DIRECT REUSE**; no second identity authority is introduced. Microsoft GraphRAG D+033 (observed `769542fbf1d8e5b4c6a8677fefc34621c87894c5`, MIT/reference posture) is a **REFERENCE VALIDATOR** for entity/relationship-aware research context only. Splink remains catalog `DISCOVERY`; probabilistic linkage is not imported into canonical deterministic identity resolution.

### SI-03.19 thesis / counter-thesis posture

The canonical ThesisArtifact and `p7ThesisEngine` remain the sole thesis authority. SI-03.19 adds a deterministic **review projection** over the existing claim/evidence state; it does not introduce a second thesis store or a new numeric conviction model.

`buildThesisCounterThesisReview` separates:
- **base case** — claims carrying explicit supporting evidence refs;
- **counter-thesis** — claims carrying explicit counter-evidence refs or explicit invalidation;
- **unresolved** — open claims with neither supporting nor counter evidence;
- **invalidation refs** — evidence attached to explicitly triggered invalidation conditions.

The derived posture is intentionally coarse and non-numeric: `unrated`, `strengthening`, `mixed`, `weakening`, or `invalidated`. Explicit invalidation dominates. A claim with both supporting and counter evidence appears on both sides and yields a mixed posture rather than silently collapsing the evidence into a synthetic confidence score. General prose does not change posture; only the existing explicit ThesisArtifact evidence fields and `metadata.thesisSignals` can move state.

On refresh, P7 compares the posture before and after applying explicit evidence signals. A posture transition is appended to the existing refresh-change log with base/counter/unresolved counts. Repeating the same refresh is stable: no new posture-change entry appears when the derived state does not change.

**Donor disposition:** LiOS P4 ThesisArtifact + P7 thesis engine are **DIRECT_REUSE/EXTEND**. GPT Researcher `assafelovic/gpt-researcher@0957c301ed06c2a5857b834358c7227c739041d4` (Apache-2.0), especially `deep_agents/report_benchmark.py` and `gpt_researcher/skills/deep_research.py`, is a **REFERENCE VALIDATOR** for keeping report claims grounded in traceable supporting citations rather than unsupported prose. Microsoft GraphRAG `microsoft/graphrag@769542fbf1d8e5b4c6a8677fefc34621c87894c5` (MIT/reference posture), especially `packages/graphrag/graphrag/data_model/relationship.py`, is a **REFERENCE VALIDATOR** for preserving explicit source/target evidence relationships. LiOS deliberately does **not** import GraphRAG relationship-strength scores or invent a numeric thesis-conviction score.

### SI-03.15 no-ticker/private entity research

`lios.entity.private_research` composes canonical P5 identity with the current Project's permitted P7 evidence instead of forcing a public-market identity onto a private entity.

The model-visible lookup accepts only legal/name identity, provider-neutral identifier or persisted provider ID plus an optional research question/as-of date. It deliberately does **not** accept a ticker. LiOS first resolves the entity locally through the P5 Global Entity & Instrument Master with provider fallback disabled. Only a uniquely resolved entity with no canonical symbol/listing/security/instrument proceeds through the private-entity path; a listed entity is returned as `listed_entity` and must use the ordinary listed-security research path.

Evidence selection is Project- and source-policy-first. When an active ResearchArtifact allow-list is present, P7 documents are filtered before entity matching. Exact canonical `entityId` / entity-context refs are the strongest binding. Exact normalized legal-name phrase matches are a bounded fallback for legacy/private evidence that has not yet been tagged with the canonical entity ref. Unrelated partial-name matches are excluded. Returned evidence remains source-separated and carries the existing content hash, observation time, freshness/access/certainty posture and source-quality truth fields.

For a genuine private/no-ticker entity the output explicitly reports:
- ticker: unavailable;
- listing/security identity: unavailable;
- public-market quote: unavailable;
- provider fallback: not used.

This is an availability statement, not an attempt to infer a synthetic quote from private evidence. If identity is ambiguous or missing, no Project evidence is disclosed. If no permitted evidence matches a valid private entity, LiOS reports an empty evidence set rather than fabricating facts.

**Reuse/donor disposition:** P5 Global Entity & Instrument Master + P7 Project Intelligence are **DIRECT_REUSE**. Microsoft GraphRAG D+033 entity-context local-search patterns are a **REFERENCE VALIDATOR** only. GPT Researcher D+019 source/citation traceability is a **REFERENCE VALIDATOR** only. No commercial/private-market provider, external search runtime, alternate identity graph or second research store is assumed or imported.

### SI-03.16 document intelligence

Project document intelligence now stays on the canonical Project attachment → P7 path instead of creating a separate document repository. The attachment service accepts PDF, DOCX, PPTX, XLSX, UTF-8 text/Markdown/CSV/TSV/JSON and supported images under the existing tenant scope, integrity hash, per-file/project quota and context-mode controls.

PDF retains the existing bounded behavior: strict SI-01.12 isolation uses the canonical GM-11c sandboxed Docling route; legacy-local mode keeps the bounded in-process `pdf-parse` fallback with explicit page/character truncation. DOCX, PPTX and XLSX reuse the existing P7 Docling adapter. In strict isolation they are copied into the sandbox as declared workspace inputs, parsed with network denied, and only the declared result file returns. In legacy-local desktop mode they require the optional managed `research-docs` runtime; if it is unavailable, LiOS reports that fact and does not fabricate document text.

Successful extraction is still bounded by the Project attachment character limit and its truncation is surfaced to conversation context and to the rebuildable P7 attachment projection. P7 indexes only text actually returned by the canonical parser. Excluded Project resources are filtered before their blob is read, images remain metadata-only for Project Intelligence unless an explicit governed vision workflow consumes them, and parser failures degrade the derived P7 projection to an explicit metadata-only/unavailable state without inventing OCR or document content.

This closes the bounded SI-03.16 implementation surface for common reports, contracts, presentations, spreadsheets, PDFs and text documents through the existing user attachment workflow. It does not claim OCR completeness, arbitrary binary-format support, packaged SP-03 acceptance or a second document-processing authority.

**Reuse/donor disposition:** LiOS P1/P12 Project attachment storage/integrity/quota/context controls are **DIRECT_REUSE**. LiOS P7 Docling `2.129.0` at pinned upstream commit `14789f2c2c542f8d127a0aac85eb779d5bba554e` is **DIRECT_REUSE/EXTEND**. No donor parser runtime, document store, vector database or alternate research state authority is imported.

### SI-03.17 structured extraction

Structured extraction is a **derived P7 projection over canonical attachment parsing**, not a second parser runtime or document database. For Docling-backed PDF/DOCX/PPTX/XLSX parsing, the existing governed conversion now returns Markdown plus Docling's structured `export_to_dict()` payload in the same operation. LiOS immediately projects that donor-native object into bounded LiOS-owned structure; the raw donor schema is not canonical product state. For plain text/Markdown and parser paths without structured output, LiOS uses a deterministic text fallback.

The bounded projection preserves:
- title/section-header structure and page/bounding-box anchors when Docling provides them;
- table cells with row/column spans and row/column-header flags, plus table page/bounding-box anchors;
- explicit parent/child document references such as group containment and table/text parent refs;
- source-explicit unit hints such as whitelisted currency codes, percent/basis-point markers, disclosed scale words, per-share markers and selected physical units;
- raw financial rows only when table structure explicitly supplies metric/value fields or a metric-by-period layout;
- a conservative financial-table classification (`income_statement`, `balance_sheet`, `cash_flow`, or `unknown`) derived only from observable labels, with `unknown` when evidence is insufficient.

P7 rebuild emits searchable `document` children for sections/tables, linked by `derived_from` to the parent Project resource and carrying the original attachment source ref. Existing source allow-lists therefore admit or exclude the parent and its structured children together. Table child documents expose only source-explicit metric/period/currency refs to the existing hybrid retrieval layer.

LiOS does **not** NLP-infer prose relationships, fabricate P5 entity IDs, infer missing units/currencies/periods, normalize raw values into a finance engine, or promote observed tabular relationships into the canonical entity graph. Attachment truncation and structured-limit truncation remain explicit. Excluded resources are filtered before blob reads and therefore cannot produce structured children.

**Reuse/donor disposition:** SI-03.16 Project attachment extraction is **DIRECT_REUSE**. Pinned Docling `2.129.0` / upstream `14789f2c2c542f8d127a0aac85eb779d5bba554e` structured export is **DIRECT MECHANISM REUSE + LiOS-owned bounded projection**. Existing P7 filing section identity/provenance is **ADAPT/EXTEND** for child-document identity. No donor graph, parser runtime, document store, numerical engine or source-policy authority is imported.

### SI-03.23 universal provider & entitlement fabric

P5 remains the single provider/data authority. SI-03.23 does **not** add another provider registry, credential store, research fetcher or entitlement database. Instead, the canonical P5 response now carries a normalized `ProviderAccessPosture` for every provider actually considered by `executeCanonicalDataRequest`.

The posture keeps the following dimensions explicit and independent:
- provider capability and point-in-time compatibility;
- secret-free authentication mode plus three-state credential requirement (`required | not_required | unknown`);
- locality (`lios_local | user_owned | remote_provider | mixed | unknown`);
- provider entitlement decision, policy id, permitted uses and reasons;
- AI-transmission, internal-use and redistribution rights (`permitted | restricted | unknown`);
- availability (`available | unavailable | degraded | unknown`) with a bounded reason such as returned, empty, unsupported point-in-time, entitlement denied, quota/rate limit, mapping required, policy denied or provider failure.

Unknown policy stays unknown. Missing metadata never means permission. The posture deliberately cannot contain a raw credential, token, API key or SecretRef identifier; it exposes only the authentication *mode/requirement*. Existing P5 entitlement callbacks/result decisions remain authoritative for request-time entitlement and are preserved verbatim in the normalized posture.

`lios.provider.access` exposes the same access contract to P7 research as a deterministic read-only inspection tool. It reads registry metadata only: it does not invoke provider `fetch`, `entitlement`, `health` or `quota` hooks and therefore cannot silently turn a research planning step into a network call. Request-time entitlement remains `unknown` until an actual governed P5 data request evaluates it. Provider allow/deny filters are applied before metadata is returned.

For canonical data execution, provider-policy exclusion of all otherwise capable providers now returns the existing structured gap with `reason=policy_denied` rather than misreporting the capability as unsupported. Existing observations, attempts and gap remedies remain backward-compatible; `accessPostures` is additive.

ResearchArtifact refresh now consumes the same provider-policy meaning on already-indexed P7 evidence. P7 search accepts server-owned `providerAllow/providerDeny` filters and resolves provider identity only from explicit indexed metadata: `researchSource.identity.providerId` first, otherwise explicit non-attachment `metadata.provider`. It never infers a provider from prose, a URL/domain, title or source label. Provider filtering happens before lexical/semantic/entity/structured ranking and before excerpt construction; a non-empty allow-list therefore excludes untagged evidence, and deny always overrides allow. This is an indexed-evidence filter only: it performs no provider fetch, entitlement callback or access-registry mutation.

**Donor disposition:** current LiOS P5 `ProviderSdkRegistry` / SecretRef/source-connection authority is **DIRECT REUSE/EXTEND**. OpenClaw `openclaw/openclaw@6693bb9665ced2a4fea3e286f62acfd0116e2c72` (MIT), especially `src/plugins/provider-auth-availability-core.ts`, `src/agents/model-auth-policy.ts` and `src/gateway/server-methods/models-auth-status.types.ts`, is **ADAPT PATTERN** for secret-free capability/auth availability and fail-closed compatibility. OpenBB D+008 is a **REFERENCE VALIDATOR** only while its exact importable package rights remain under REVIEW. Portkey D+025 and LiteLLM D+024 are **REFERENCE VALIDATORS** for provider-normalization/routing concepts only; neither becomes a second P5 authority.

### SI-03.25 broker / expert / internal research composition

P7 remains the single Project research/index authority and SI-03.23/P5 remains the provider/entitlement authority. SI-03.25 adds a **composition policy**, not a new research store, provider registry, rights database or retrieval engine.

A source may carry an explicit `metadata.researchSource` object with:
- source class: `public_external | broker_research | expert_content | internal_research | user_file`;
- exact source identity: source id, provider, organization, author, analyst/expert ids and URL where applicable;
- the existing three-state provider entitlement decision;
- independent use rights for AI transmission, internal use and redistribution.

Broker, expert and internal identity are never inferred from prose. Explicit metadata wins. Existing technical markers provide only two conservative fallbacks:
- Project resources/structured children derived from `chat_attachment` are classified as `user_file`;
- governed browser evidence with an acquisition ref plus canonical resolved/source URL is classified as `public_external`.

Those fallbacks **do not invent downstream rights**. A user-owned Project attachment is locally available to its Project owner and may be used for local internal research, but that fact does not imply AI-transmission or redistribution permission. Governed browser capture proves acquisition/source identity, not downstream entitlement, internal-use rights or AI-transmission rights.

`composeResearchSources` evaluates a declared use separately:
- entitlement `denied` or `unknown` never becomes permitted;
- internal use must be explicitly permitted for composition;
- AI assistance additionally requires `aiTransmission=permitted`;
- redistribution additionally requires `redistribution=permitted`.

The server-side composition result retains exact identity even for blocked sources so downstream governed workflows can explain policy decisions without flattening source provenance. The AI-facing `lios.research.compose_sources` surface is stricter: it searches only permitted Project evidence, applies the active server-resolved ResearchArtifact source allow-list, and emits excerpts plus source identity **only** for sources explicitly permitted for AI transmission. Blocked sources are reduced to aggregate `sourceClass + reason + count` rows, so restricted titles, source refs, analyst/expert ids, organizations and content do not leak to the model.

This preserves the important distinction between:
- **Project/local availability** — LiOS can read the source within the user's Project;
- **entitlement/internal use** — the source may be used for the requested research purpose;
- **AI transmission** — the source may be sent to the selected model/provider;
- **redistribution** — the source may appear in downstream distributed/exported output.

No one dimension implies another.

**Donor disposition:** LiOS P7 Project Intelligence + SI-03.23 provider/entitlement posture are **DIRECT REUSE/EXTEND**. OpenClaw `openclaw/openclaw@05838d86819f5e2462efc0db60fe694bf5825c7d` (MIT), especially `docs/start/why-openclaw/provenance.md`, is **ADAPT PATTERN** for keeping origin/trust metadata outside prose so content cannot self-promote its provenance or permission. GPT Researcher D+019 `assafelovic/gpt-researcher@0957c301ed06c2a5857b834358c7227c739041d4` (Apache-2.0), including `gpt_researcher/skills/deep_research.py`, is a **REFERENCE VALIDATOR** for source-separated research/citation composition. Haystack D+018 `deepset-ai/haystack@e03f7c66fcfa683be6c2b31858f54e60c792b656` (Apache-2.0) is a **REFERENCE VALIDATOR** for metadata-filtered retrieval patterns only; P7 remains the search/store authority.

### SI-03.27 living investment thesis

The canonical P4 ThesisArtifact remains the only thesis state authority. A living investment thesis is represented by its **durable P4 version history**, not by a second research memory or hidden model state.

`buildLivingThesisReview` compares one exact ThesisArtifact version to its immediate durable predecessor. The current state includes thesis status/summary, SI-03.19 thesis-vs-counter-thesis posture, explicit claim confidence values, supporting/counter evidence refs, expected outcomes, catalysts, risks, invalidation conditions, open questions and the version's canonical `assumptionRefs`. Confidence is never synthesized: the review only reports confidence already persisted on each claim.

Changed-since-last-review is field-level and deterministic:
- thesis status and SI-03.19 posture changes;
- claim text/status/confidence/support/counter-evidence changes;
- assumptions added/removed from canonical P4 version metadata;
- expected-outcome text/status/due-date/evidence changes;
- catalyst text/status/due-date/evidence changes;
- risk text/status/evidence changes;
- invalidation text/trigger/evidence changes;
- open-question text/status/evidence changes.

Version 1 is an explicit baseline: it reports the complete current state but **does not invent a prior review or synthetic changes**. Historical inspection of version N compares only against N−1. Exact Artifact version refs and immutable content hashes are returned for both sides.

`lios.thesis.living_review` is deterministic, read-only, Project-scoped and side-effect free. It reads P4 Artifact/version state only; it does not fetch providers, invoke AI, refresh the thesis, synthesize confidence, or mutate canonical state. Thesis refresh remains the separately governed `lios.thesis.refresh` action.

**Donor disposition:** P4 ThesisArtifact/version authority + P7 thesis engine are **DIRECT REUSE/EXTEND**. GPT Researcher `assafelovic/gpt-researcher@0957c301ed06c2a5857b834358c7227c739041d4` (Apache-2.0) is a **REFERENCE VALIDATOR** for iterative evidence-grounded research/report revision. Microsoft GraphRAG `microsoft/graphrag@769542fbf1d8e5b4c6a8677fefc34621c87894c5` (MIT/reference posture) is a **REFERENCE VALIDATOR** for explicit evidence relationships only; LiOS does not import graph relationship-strength scores as thesis confidence. OpenClaw memory/reflection runtime is intentionally not imported because P4 Artifact versions are the canonical durable thesis memory.

### SI-03.30 alternative & private-market evidence adapters

LiOS already owns point-in-time alternative snapshots in `alternativeDatasetStore`; SI-03.30 turns those snapshots into research evidence without introducing a second provider, entitlement, entity or snapshot authority.

The adapter preserves the exact snapshot identity and clocks:
- `snapshot:<id>` and parent revision ref;
- content hash plus a hash of stored lineage;
- effective, published, retrieved and model-available times;
- provider/source identity;
- stored entitlement-policy ID;
- quality record count / missing-field posture;
- bounded deterministic payload preview with explicit total/shown/truncated counts.

The snapshot's **exact entitlement policy record** is loaded by the ID captured on that snapshot. A later policy revision cannot silently rewrite historical evidence rights. Unreviewed or missing policy is `unknown`, never permission. Reviewed policies map explicit `internal_research` to internal-use permission and explicit `model_input` to AI-transmission permission. Redistribution is permitted only when the policy is redistributable and explicitly allowed/attribution-required; otherwise it is restricted or unknown.

Canonical P5 entity binding is local-only. `private_series` and commodity-style entity keys use name resolution; estimate/options symbols use ticker resolution; portfolio holdings have no single entity binding. Only a unique local P5 match gets entity/security/listing IDs. Ambiguous or absent identity remains explicit and no ticker, quote or valuation is invented.

`lios.research.alternative_evidence` is a deterministic read-only Project tool. Its default classes are `private_series`, `options_chain`, `commodity_curve` and `portfolio_holdings`; `estimates` may be requested only as generic snapshot evidence while SI-03.29 remains the sole analyst/rating/consensus semantics owner. The tool performs no provider/network fetch.

For model-visible output, both internal use and AI transmission must be explicitly permitted. Evidence with denied/unknown entitlement or restricted/unknown AI rights is not returned with source/provider/entity identity or payload; it contributes only aggregate blocked counts/reasons. Active server-owned `allowedSourceRefs` are applied to exact snapshot refs before inclusion.

**Donor disposition:** LiOS `alternativeDatasetStore`, entitlement policy store and P5 entity master are **DIRECT_REUSE/EXTEND**. OpenClaw `openclaw/openclaw@6693bb9665ced2a4fea3e286f62acfd0116e2c72` (MIT) is a **REFERENCE VALIDATOR** for fail-closed resource/provider transmission; no domain-specific private-market adapter is imported. OpenBB D+008 is a **REFERENCE VALIDATOR** only while catalog rights remain REVIEW. The only new code is the normalization bridge over LiOS-owned authorities.

### SI-03.21 known / qualified / unknown research state

SI-03.21 extends the existing `ProjectEvidenceTruthPosture`; it does not add another truth database, evidence store, provider entitlement registry or confidence model.

Each evidence item now carries a derived `knowledge` projection:
- **known** — certainty is explicitly `verified`, freshness is explicitly `fresh`, availability is explicitly `available`, entitlement is explicitly `entitled`, and the existing truth posture has no unknown dimensions;
- **qualified** — matching evidence exists, but at least one explicit blocker or unknown truth dimension remains. Qualifiers preserve disputed/uncertain certainty, stale/unknown freshness, unavailable/inaccessible/unknown availability, unentitled/unknown entitlement, and missing temporal/source-quality fields independently;
- **unknown** is intentionally **not** an evidence-item class. It is the aggregate result when no permitted matching Project evidence exists. Absence is never relabeled as inaccessible, unentitled or uncertain.

Source quality remains orthogonal to certainty. A first-party/authority source does not become `verified` merely because of its source tier, and unsupported/unknown source-quality metadata keeps the evidence qualified. SI-03.23 provider entitlement/access posture is consumed only when those states have already been projected into canonical evidence metadata; SI-03.21 does not invent or fetch provider rights.

`lios.project.knowledge_state` is deterministic, read-only and current-Project scoped. The server-owned ResearchArtifact/source allow-list is applied **before** retrieval, so excluded evidence cannot affect ranking, counts, qualifiers or excerpts. Returned rows preserve exact source ref, content hash, observed time, bounded excerpt and the full existing truth posture. The tool performs no network/provider fallback, no writes and no semantic inference from prose.

**Reuse disposition:** current LiOS `projectEvidenceTruth.ts`, P7 Project Intelligence search/index and the governed conversation runtime are **DIRECT_REUSE/EXTEND**. P5/SI-03.23 entitlement/provider policy is a **CONSUMER BOUNDARY** only. No external donor runtime or new truth authority is imported for this slice.

### SI-03.29 estimates / recommendation evidence

LiOS already has canonical point-in-time consensus snapshots, benchmarks and the `estimateVintageLedger`. SI-03.29 exposes those existing authorities to research; it does not introduce another analyst-estimates database, recommendation store or consensus engine.

The reusable `getEstimateRecommendationEvidence` projection is now shared by the existing `/api/consensus/intelligence` endpoint and the governed research tool. Its central distinction is explicit:

- a **contributor vintage** exists only when source metadata supplies a concrete contributor/analyst observation with value, provider, source reference and publication/retrieval/vintage clocks;
- a provider aggregate without those explicit rows remains **aggregate-only**. Provider name, source name or contributor count must never be promoted to analyst identity;
- incompatible metric/period/unit/currency definitions remain separate through the existing vintage-ledger grouping;
- per-contributor revisions, breadth, dispersion, actual surprise, internal-model divergence and contributor accuracy remain deterministic outputs of the existing ledger;
- price targets and numeric recommendation scores use the same evidence model as other estimates;
- human recommendation/rating labels and actions are returned only from explicit source metadata (`recommendationLabel`, `ratingLabel`, `recommendationAction`, `ratingAction`). Numeric recommendation scores are never mapped to invented labels.

Point-in-time truth uses the existing canonical clocks. Snapshot eligibility is gated by `availableAt <= asOf`; explicit contributor rows preserve `publishedAt`, `retrievedAt` and `vintageAt` separately. Benchmarks use their canonical effective clock. Later evidence is not backfilled into an earlier as-of view.

Human/internal consensus routes retain their existing role-gated visibility. The AI-facing `lios.research.estimate_evidence` adds the SI-03.25 rights boundary: source metadata must explicitly provide a valid `researchSource` with entitlement allowed, internal use permitted and AI transmission permitted. Unknown, denied or restricted rights fail closed. Blocked rows contribute only aggregate block counts/reasons; blocked contributor/source identity, URLs and values are not emitted to the model.

The governed tool is deterministic, read-only, requires an active Project, uses the authenticated tenant organization rather than a model-supplied organization ID, performs no provider/network fetch and preserves the existing internal consensus-reader role boundary.

**Reuse/donor disposition:** LiOS consensus snapshots/benchmarks plus `estimateVintageLedger` are **DIRECT REUSE/EXTEND**. OpenBB D+008 remains a **REFERENCE VALIDATOR** only because the watchlist still marks exact import rights as REVIEW. GPT Researcher D+019 is a **REFERENCE VALIDATOR** for source-separated evidence/citation posture only. No donor estimate store, recommendation ontology or provider runtime is imported.

## Historical state / Time Machine

The current Project Intelligence table is a rebuildable projection. It is **not** used as the historical store. Before a direct index update or full Project rebuild mutates the current projection, LiOS writes each unique `(project, source type, source ref, content hash)` document into `project_intelligence_document_versions`. Snapshots retain the manifest of source refs + hashes.

`getProjectIntelligenceHistoricalState` resolves every snapshot manifest entry back to the exact retained body and fails loudly if any historical evidence is missing. `projectIntelligenceAsKnownOn` chooses the latest actual snapshot at or before the requested timestamp. LiOS does not regenerate current data and call it historical state.

## Runtime and OSS posture

### Docling
- Upstream: `docling-project/docling`
- Pinned commit: `14789f2c2c542f8d127a0aac85eb779d5bba554e`
- Verified package version at that commit: `docling==2.129.0`
- License: MIT
- LiOS posture: optional managed `research-docs` pack, not Core/CI superset.
- Adapter accepts only an absolute local regular file, caps input at 100 MB, output at 16 MB and execution at 120 seconds, uses no shell, and refuses hosted-control-plane execution.
- Readiness is bounded: a selected `research-docs` pack and Python interpreter path can produce the current `installed` status; this does not prove successful Docling import, healthy parser/model assets or an exercised document conversion.
- Returned Markdown is additionally sliced to 2,000,000 characters. Explicit disclosure of that slice truncation remains a runtime gap; stderr warnings alone are not proof of disclosure, and P12 bounded-parser receipts do not automatically cover Docling.
- Local invocation/no shell is not proof of OS filesystem/network/process isolation or absence of model downloads. Pack/model provisioning, parser health and extraction/citation quality require target evidence.

### sqlite-vec
- Upstream pin: `04d28bd21773981e2d266bbf6aa4efbd011eb4f6`
- License: MIT OR Apache-2.0
- V1 posture: evaluated/stub, not bundled and not authoritative. P7 already supports optional embedding vectors and bounded cosine scoring. Activate a vector accelerator only when scale proves it necessary and without moving Project truth out of PGlite/Postgres.

### SI-03.06 hybrid-retrieval donor disposition
- **Haystack D+018:** observed `deepset-ai/haystack@a9ed2f9370961ccb1b10aa31fa19035f9a94a708`, Apache-2.0. Its retriever guidance explicitly separates sparse keyword and dense embedding strengths and its `DocumentJoiner` documents reciprocal-rank fusion for combining independently ranked result lists. **Disposition: ADAPT PATTERN.** LiOS implements deterministic rank fusion inside canonical P7 instead of importing Haystack pipelines/document stores.
- **Microsoft GraphRAG D+033:** observed `microsoft/graphrag@769542fbf1d8e5b4c6a8677fefc34621c87894c5`, MIT/reference posture. Local Search combines entity/relationship/structured context with raw text candidates. **Disposition: REFERENCE_VALIDATOR only.** P7 already owns entity/context refs and does not import GraphRAG's graph runtime/vector store.

### SI-03.12 contradiction donor disposition
- **OpenClaw / Goldmine:** pinned `openclaw/openclaw@c074824a27c96d3983043f9eeb33823cd1772d8c`, MIT; inspected `extensions/memory-wiki/src/lint.ts` and its claim-conflict/contradiction reporting seam. Useful mechanism: contradictions remain explicit quality issues with source/provenance context rather than silently becoming verified truth. **Disposition: ADAPT PATTERN**, with P7/P4 retaining canonical LiOS evidence state.
- **Microsoft GraphRAG:** Secondary watchlist entry `D+033`, MIT/reference posture; inspected its generic source/target `Relationship` model and relationship-retrieval pattern (repository search observed commit `769542fbf1d8e5b4c6a8677fefc34621c87894c5`). **Disposition: REFERENCE_VALIDATOR only.** LiOS already has typed P7 relation edges, so no GraphRAG runtime/state is imported for this bounded pair-detection gap.

### LSE research/tool donor
- Upstream pin: `62c48a5ce6de37a1c115d6270dfd0eee75166d8b`
- Useful patterns from `lse_terminal/engine/webtools.py`: local execution, redirect/host safety, bounded reads, explicit errors and optional browser fallback.
- LiOS does **not** import an LSE assistant runtime. Existing P5 browser/MCP policies are authoritative and stricter for Project-scoped execution.

## Security and privacy boundaries

1. Project index rows are owner+organization scoped and protected by RLS.
2. Resources marked `excluded` never enter the Project index.
3. Credential-shaped structured fields are omitted from searchable projections.
   Credential-bearing source refs are rejected/removed before current or historical Project Intelligence persistence.
4. Docling sends no document to a LiOS-hosted parsing service; P7 invokes the local managed runtime only.
5. Browser/MCP research tools cannot bypass Project allowlists/approval policy.
6. Thesis transitions are deterministic only when explicit source metadata carries the corresponding thesis signal. General P7 contradiction insights likewise require an exact explicit `contradicts` relation. P7 does not infer a contradiction/invalidation from prose and then present it as deterministic.
7. Snapshot hashes and source refs preserve reproducibility; the current index can always be rebuilt.
8. Historical document versions are owner+organization scoped and RLS protected; Time Machine never falls back to current-state reconstruction.
9. Deterministic insight-family labels (anomaly/trend/percentile/revision/correlation/curve/regime) are emitted only from explicit deterministic metadata/evidence.

## User experience

Project Intelligence is embedded in **Project Home**, alongside Artifacts and Ledger. It is deliberately not a permanent top-level terminal module. The user gets:
- Refresh index
- Project-wide search
- Insight Lens
- Time Machine snapshot list plus interactive **As Known On** reconstruction of retained historical state
- Research/Context Graph through the Project intelligence API
- Evidence-linked Intelligence Timeline with event/source/entity/model/Artifact/decision filtering
- ThesisArtifact in the existing Artifact pane with expected outcomes, deterministic **Refresh from Project evidence**, contradiction/invalidation state and immutable **Postmortem** actions
- ResearchArtifact in the same Artifact pane with plan/evidence/source-policy/contradiction/execution-trail state
- Project chat can invoke deterministic `lios.project.search`, `lios.project.what_changed` and `lios.project.insight_lens` workflows without a BYOAI call

## Acceptance

P7 is complete only when the canonical P7-01…P7-16 roadmap is unique and fully represented, and:
- `npm run test:p7` passes;
- `npm run acceptance:p7` passes;
- migration `0070_lios_p7_project_intelligence` is journaled immediately after `0069` so the runtime Drizzle migrator actually applies it;
- P1–P6 remain green;
- the full LIOS Quality Gate passes on the exact P7 head before merge.

SP-03/SP-04 acceptance additionally requires the [Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md): real cited research/professional-work MSJs with reopen/restore or round-trip as applicable, target execution, explicit unavailable/truncated states, regression protection and exact evidence. Index metadata, optional embeddings and an interpreter selection do not prove full-document retrieval, measured hybrid-search quality or accepted Shipping Point status.
