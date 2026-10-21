# LiOS Architecture

## Current execution and reuse contract — 2026-10-03

`AGENTS.md`, the [Super Intelligence execution plan](LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md), current `main` and issue #192 govern `SI-01`–`SI-07` as the final strategic execution program. `S0`–`S10` are validation journeys only; `CP1`–`CP7` are historical maturity/evidence references. Multiple coordinated bounded owners may work behind stable contracts; each shared-core authority has one canonical implementation owner. Existing `GM-*`, `TC-*`, `CA-*` and `LIOS-P*` IDs and valid in-flight work remain intact. SI is not a new router, runtime, store, memory, engine registry or permission layer.

Read in order: `AGENTS.md` → SI execution plan → [mandatory Shipping Point contract](technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md) → Master Plan → this architecture → OpenClaw Assimilation Blueprint → Capability Assimilation Workstream → UX System → Connector Specification → execution roadmap for detailed/historical evidence → donor registry/current implementation → issue #192 and the active canonical issue/PR.

`SP-01`–`SP-07` require a bounded Minimum Shippable Journey, real integrated user outcome, packaged/target execution where applicable, no fake success, regression protection and an exact commit/build/environment/topology/evidence record. No source-complete status below implies Shipping Point acceptance. P14 remains final release authority. `SI-01.11 / GM-11` exact-operation authority, sandbox and trust receipts precede privileged interactive `exec.*` exposure.

Use **contract locked → code integrated → tests passed → packaged/provisioned → user accessible → vertical flagship passed → shipping point accepted → release proven**. A task may reach its declared technical scope without accepting an SP; no accepted status is inferred here.

OpenClaw remains the primary donor at the exact pin below. The 92-entry baseline requires deep analysis, not an installation quota: inspect product, subsystem, mechanism and LiOS transformation before direct reuse/adaptation/repurposing/combination/generalization/innovation or evidence-backed rejection. Capability Assimilation §15 governs rights, security, provenance, suitability and owner-visible new-scope proposals. This execution/reuse contract does not claim shipped capability.


## 0.0A User-owned runtime + OpenClaw assimilation lock — 2026-10-02

**Owner-approved architecture.** Read [OPENCLAW_ASSIMILATION_BLUEPRINT.md](technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md) before structural runtime/mobile/execution/storage work.

### Infrastructure invariant

> **LiOS owns software contracts; the user owns runtime infrastructure.**

Default installation is a complete Desktop Local LiOS Home. Advanced deployments may use user-owned PostgreSQL, storage, NAS/server/VPS/cloud, compute nodes, model providers, secret managers, network and identity. No LiOS-operated customer runtime server is part of the architecture.

### OpenClaw role

Pinned donor: `openclaw/openclaw` `v2026.9.7` / `c074824a27c96d3983043f9eeb33823cd1772d8c` / MIT.

OpenClaw-derived infrastructure may implement Gateway/device transport, technical execution sessions, PTY/process management, native device clients, agent-loop mechanics, browser/computer-use, coding runtimes, worker placement, memory patterns, skills and diagnostics. LiOS remains canonical for Projects, Conversations, Artifacts, data/identity semantics, deterministic finance, permissions, plugins and provenance.

### Target platform shape

```text
Conversation / Projects / Artifacts
              │
       LiOS orchestration
              │
    ┌─────────┼──────────┐
    │         │          │
 Analytics  Agents    Execution
    │         │          │
    └─────────┼──────────┘
              │
        Device Fabric
              │
 Desktop / Mobile / Watch / Browser / Nodes
              │
       USER INFRASTRUCTURE
 DB / Storage / Models / Compute / Secrets / Network
```

### Required replaceable seams

Extend existing runtime/P13/connector contracts rather than creating parallel registries for: database, storage, secrets, compute/execution, network, backup, identity, notification and browser providers.

### Local canonical state

PGlite remains the zero-configuration system database. User PostgreSQL is the advanced canonical DB target. External MySQL/SQLite/DuckDB/etc. remain data-source connectors rather than alternative LiOS schema authorities.

### Mobile canonicality

Mobile caches/outboxes are replicas/queues only; the selected LiOS Home remains authoritative. A desktop-local Home being asleep/offline is a valid state, not a reason to introduce vendor cloud.


## 0.0B Capability Assimilation ownership + one-app contract — 2026-10-02

**Owner-approved.** Technical coordination authority: [CAPABILITY_ASSIMILATION_WORKSTREAM.md](technical/CAPABILITY_ASSIMILATION_WORKSTREAM.md).

Capability Assimilation is a parallel implementation/evidence workstream, not a new platform layer. Every capability remains owned by the existing subsystem:

```text
P4  → Artifact/rendering/editing capability
P5  → Data/entity/connector capability
P11 → Finance/quant/research/output engines
P12 → Voice/multimodal
P13 → Plugin/MCP exposure
GM  → Gateway/execution/agent/device/browser/local-AI infrastructure
```

LiOS exposes stable capability contracts; donor packages are replaceable implementations beneath them. The model/agent must not depend on donor-specific types.

**One-app rule:** ordinary users invoke or enable a LiOS capability; LiOS provisions/validates internal components. Internal modularity remains for security, footprint and rollback, but manual donor installation is not the normal product experience. Large model weights/heavy engines require explicit download-size consent.

Implementation-truth states are separate from design approval. The machine registry `third_party/capability-assimilation.json` is the cross-donor implementation-truth view. Existing candidate/lock files remain license/source inventories, not proof of integration.

## 0.0 General AI, research and memory contract extension — 2026-10-02

**Approved direction; not a shipped-capability claim.** [Terminal Convergence §0.0.12](LIOS_EXECUTION_ROADMAP.md#0012-general-ai-research-and-desktop-experience-expansion--owner-decisions-2026-10-02) contains the full implementation/benchmark register and source references.

Extend the current Conversation Runtime, WorkflowPlan, context/ledger, Universal Data Fabric, BYOAI transport, Artifact store, P7 intelligence, P9 automation and P11/P13 authorities. Never introduce a second router, memory store, connector registry or workflow scheduler.

1. General AI handles any topic and produces general work products. Deterministic finance retains authority for calculations; specialist expansion remains finance-first.
2. Hidden Working Context carries user/tenant, current Project/Chat/Temporary posture, permitted cross-Project source scope and exclusions, source provenance, task/entity/time posture, active Artifact, AI transmission consent and time/cost budgets. It is bounded live state, not an ordinary user-facing inspector or durable memory store. Authorization is enforced independently of model instructions.
3. Project-scoped indexes remain storage boundaries; Auto retrieval for Project/Quick chats may federate relevant approved sources across Projects. Tenant/client/source ACLs, exclusions and stronger installed policies override convenience; migration never silently broadens them. A global connection is not universal access, and sharing a chat/Artifact does not share its Project. Temporary chats use only explicitly supplied session sources under the same policies, with no implicit private-context inheritance, persistent Ledger or durable memory contribution.
4. Model completion, tools, structured output, vision, embeddings, web retrieval and provider-native grounding are separately verified capabilities in the existing registry. Normalize evidence/citations/usage/errors across adapters. A successful completion does not prove web/tool readiness.
5. Evidence records distinguish source identity from content revision hash and preserve passage/page/table/query location, publication/effective/retrieval timestamps, entity, period, units, currency, permissions and extraction state. Revisions and deletion/revocation propagate to retrieval/cache/memory dependents.
6. Documents use the existing parser/pack path with structured anchors and visible truncation. Database research requires allowed schema discovery, confirmed material semantic mappings and real engine-specific read-only execution, table/function/filesystem/network restrictions, timeout, cancellation and row/memory bounds before full buffering. SQL-prefix validation alone is not sufficient.
7. Grounded synthesis must consume actual evidence. Financial assertion checks must establish metric/entity/sign/value/unit/currency/period before widening affected paths; user messages, model output, a claims schema and heuristic quality scores do not prove grounded verification or authoritative facts.
8. Broad automatic durable memory remains GM-owned, separate from TC live Working Context and P7 derived indexes/history. It retains origin and inferred-vs-confirmed status and requires visible inspect/correct/delete and retention controls. Memory never bypasses source access or becomes stale authoritative financial evidence.
9. Save as task captures a versioned recipe, parameters, source requirements and output types; never raw credentials or cached authorization. Recheck policy on rerun. Scheduling remains a separate P9 action.
10. Contextual installation/connection is a resumable runtime step. Add/Install registers capability; Connect authorizes an account. Readiness, failed/cancelled setup and exactly-once continuation must be tested through existing state/permission contracts.
11. Comparison tables use existing typed Artifacts, cell-level evidence and immutable revisions. Evidence opens within the existing side pane. Generative output, deterministic calculation and user assumptions remain distinguishable.
12. Ordinary factual chat can give a quick answer when appropriate; explicit research objectives trigger a bounded, progressive, comprehensive investigation using both permitted structured and web/generative sources where available, without needless network calls when a source is unavailable or unnecessary. Cancellable deepening, fallback suitability, entitlements and AI transmission policy remain enforced; local-only restrictions cannot be overridden to finish a task.
13. Reuse substantial permissively compatible OSS under the existing donor matrix and import protocol. Vane/GPT Researcher are adaptation candidates, Docling is an existing integration to extend; all imports need exact pins/path licenses/dependency rights/tests and desktop footprint proof. See the roadmap for the full candidate register.
14. Fix/contain the reproduced numeric guard weakness and verify database execution boundaries before widening affected user-facing paths. Source-review concerns are not proof of an exploitable incident.
15. Benchmark every task on declared hardware/build/fixture/provider conditions. Preserve local-first delivery and separately measure network latency. Product/code/packaged evidence remain distinct.

Scope separation: broad retrieval grants no cross-Project mutation authority; user/cloud consent grants no tenant access; plugin installation grants no account authorization; a saved task grants no schedule or external side-effect permission.
Recorded informed consent may permit relevant private excerpts to approved cloud models without repeated routine prompts. Revocation, provider changes, tenant/firm/source restrictions and local-only policies must be enforced both at context packaging and provider routing. Consent does not create access rights; local-only work may not fall back to cloud.



### Owner-confirmed convergence invariants — 2026-10-20

The [20-decision TC experience lock](LIOS_UX_SYSTEM.md#owner-approved-universal-intelligence--workbench-convergence--2026-10-20) governs presentation and capability composition without introducing a new architecture. In particular:

- **Visibility is not execution:** Chat is the default shell; the existing Workbench can supply backend engines while not displayed. Optional Artifact sidecar/focus and full Workbench are projections of the same state, not competing stores, windows, products or agents.
- **Shared context / typed handoff:** conversation identity, allowed Project/Chat scope, selected entity/topic, Artifact ID + version/head, provenance, source policy, assumptions, time/units, pending edits and preferred layout must travel to the existing Workbench and back. Verify actual round-trip in source and an installed app; a surface navigation action alone is insufficient.
- **Regular-Chat durability:** canonical P1+P4 identity, ACL, version and reference authorities must support durable work with a Chat owner without forcing an invented Project. Existing Project-backed Artifacts remain valid; Temporary data must not be silently persisted or promoted. Data-model evolution and migration require their own bounded owning tasks.
- **Source routing:** preserve one P5/Connection Center registry and one rights/entitlement policy authority; chat's compact Sources selector is a view/override into it. Research tasks may run permitted structured retrieval and web/AI research concurrently or in a bounded progressive investigation; synthesis cannot promote search results or AI guesses into verified facts.
- **Autonomy:** governed GM/P2 tooling orchestrates existing engines. Reusable informed AI transmission consent is separate from source access and consequential side-effect grants. Local-only and tenancy constraints always prevail. Long-running tasks continue only on an available authorized user-owned runtime with budgets/checkpoints.
- **Comprehensive but calm:** P4 holds all authorized produced work while chat projects a useful subset. Runtime progress details remain behind an intentional inspection action, except cancellation and material errors, approvals, cost/permission implications and evidence/coverage limitations.

The work remains within existing TC/P2/P4/P5/P7/GM/CA/SI-07 owners and existing SP/P14 milestones; it does not authorize live brokerage execution.

### Entity-only company research and coverage

[Terminal Convergence §0.0.13](LIOS_EXECUTION_ROADMAP.md#0013-public-and-private-company-research--no-ticker-and-no-upload-coverage--2026-10-02) requires listed, private/unlisted, LLP/SME, subsidiary, historical and catalog-absent company research without a ticker or mandatory upload. Current source includes the CA-03 schema/migration baseline: `src/shared/schema.ts` permits nullable `companies.symbol`, zero securities/listings and separate jurisdiction/legal-form/lifecycle/provisional identity facts; migration `0077_lios_ca03_no_ticker_entity_identity.sql` adds namespaced registry identifiers and flags placeholder names. This is source presence, not proof of migrated installations or complete resolver/provider coverage.

Resolve name/domain/country/registration identity first, retain material ambiguity, provisional matches and parent/subsidiary/temporal distinctions, then route actual supported research capabilities. Qualitative research must remain useful without quotes. Where public evidence exists, return cited identity/business/events/funding/peers/disclosures with compact coverage and targeted next actions; never manufacture a symbol, quote or undisclosed financials. Normalize field-level coverage and distinguish failed retrieval, missing disclosure, conflicting evidence and not applicable. Incremental registry/web/provider/user enrichment retains the same entity and versioned evidence. Resolver/raw-query caller convergence, real country/entity-class/period/field coverage and no-upload journeys remain evidence obligations; schema support alone does not close them. Private financial calculations require evidenced or explicitly approved inputs and existing deterministic engines.

## 0.1 2026-09-26 identity-gated entry architecture

The desktop now has two intentionally separate surfaces:

```text
PUBLIC / SIGNED OUT
  PublicProductPreview
    ├─ brand / value proposition
    ├─ locked terminal preview
    ├─ capability + workflow examples
    └─ sign-in / create-account actions
             │
             ▼
      AUTHENTICATION BOUNDARY
      identity + session + device
      subscription → effective entitlements
             │
             ▼
AUTHENTICATED LIOS
  Project / Chat / Workspace
             │
  Conversation Runtime
             │
  Capability / Data / Engine / AI fabric
             │
  Evidence + Artifacts + Ledger
```

The public preview is non-executable. It must not call research/data/AI/tool/engine routes and must not create durable product state. The only intentional anonymous server surfaces are explicitly reviewed public website/support functions such as lead capture.

Every executable LiOS request resolves an authenticated principal before capability execution. Identity, subscription, entitlements and ownership are separate concepts:
- **identity** — who is acting;
- **subscription** — the commercial relationship;
- **entitlements** — what capabilities are allowed now;
- **ownership** — which user/organisation owns the Project/data/artifact.

Existing local-first privacy rules remain: authentication does not justify centralising BYOD/BYOAI secrets, private Project content or deterministic compute.

### P1B identity/access fabric

P1B makes those concepts executable through one shared contract:
- `IdentityPrincipal` is the canonical authenticated human identity;
- `OwnershipScope` is exact `ownerUserId + organizationId` and is independent of billing;
- `EffectiveAccessSnapshot` combines license lifecycle, device authorization and feature-key entitlements;
- `AuthSessionState` distinguishes online restoration, signed offline restoration, re-authentication and revocation;
- durable Express sessions (database `sessions` table) hold only non-secret metadata (`passport.user`); no vendor credential is ever stored in a session, because a customer install contacts no LiOS service (GM-07c);
- native desktop federation uses provider-neutral OAuth/OIDC Authorization Code + PKCE S256 transport;
- the licence is a vendor-signed Ed25519 file verified against public keys pinned in `shared/licenseTrust.ts`; it is time-bounded, feature-key scoped and device-bound only when its signed contents say so (GM-07b).

Identity is the Home's own database (one auth stack at `/api/auth/*`); the local user id owns Project data. Commercial entitlement comes from the local trial clock or an imported licence file, never from a LiOS-operated service.

One product build must carry Trial/Starter/Pro/Enterprise effective access; editions do not create separate identity or customer runtime stacks. Subscription expiry must not hide owned local work or erase its ownership. User-owned BYOD/BYOAI access is not denied merely by provider brand; optional premium-action entitlements remain distinct from provider inference charges and consulting.

### P1C authenticated shell convergence

P1C completes the P1 user-facing boundary without introducing another assistant, persistence model or workspace owner.

Canonical authenticated entry:
- a restored authenticated session opens LiOS directly; persona/domain/connector setup is contextual rather than a startup gate;
- if no Project exists, the first question becomes a Quick Chat automatically;
- Project Chat, Quick Chat and Temporary Chat remain distinct scopes; Temporary Chat is renderer-memory only, with explicit session sources and no implicit private inheritance, persistent Ledger or durable memory;
- the universal composer carries a typed `ConversationSourceScope`: `auto | my_data | web | files`;
- Web excludes Project resources and file contents; Files permits only explicitly attached Project file material; My Data treats Project/user-owned evidence as the boundary and cannot silently bypass into connected market-data retrieval;
- `@resource` references, slash commands and selected-object context converge in the same composer;
- Cmd/Ctrl+K opens universal discovery/actions through the canonical command surface; it is not a composer-focus-only shortcut or a second command authority. Enter sends; Shift+Enter inserts a line; Escape cancels an active run;
- loading, restore failure, retry and memory-only fallback states are first-class shell states.

Living Workspace authority remains unchanged: Conversation output may request bounded `SafeWorkspaceAction` operations, but Terminal owns execution, layout-changing proposals require the existing approval surface, and Dockview remains only a renderer behind LiOS canonical workspace state.

Global/New Chat remains minimal. Project Home is a rich adaptive intelligence dashboard: summary/goals/pins, What Changed/Signals, verified metrics, live/recent Artifacts and chats, events, automations, relationships, activity and health when useful. Reorder only unpinned modules; preserve pins and saved choices. No template gate, manual dashboard builder or permanent Decision widget is required. Quiet refresh shows the last verified as-of or explicit unavailable state, never implied freshness. Expand Workspace stays the same Project/Chat/Artifact/Working Context, not a second product.

P1 shell telemetry is local-only counter telemetry. It records interaction counts/source-scope ids, never prompt text, filenames/file contents, Project/client names, symbols, model inputs or provider credentials.

**Recorded P1 status: COMPLETE (P1A + P1B + P1C, 2026-09-26).** This records the dated source-convergence scope, not current SI/SP completion or release certification; newer entry/context/discovery contracts still require their own integrated evidence.


**Status:** CANONICAL TECHNICAL ARCHITECTURE  
**Effective:** 2026-09-21  
**Parent:** `docs/LIOS_MASTER_PLAN.md`

## 1. Architectural objective

LiOS is a local-first Super Intelligence operating system for any-topic conversation, research and professional work, with finance-first specialist deterministic engines, controlled primarily through conversation.

The architecture must make a simple UX possible without sacrificing deterministic finance, provider depth, privacy or professional workflow.

Preserve all eleven specialist finance families: Market Data; Company Fundamentals; Valuation; Portfolio & Risk; Fixed Income; Derivatives; Macro & FX; Alternative Assets; Corporate Actions & Events; Research & Reporting; Personal Finance & Wealth. Any-topic intelligence expands their shared infrastructure rather than shrinking this scope.

```text
USER
  |
  v
PROJECT / CHAT / WORKSPACE
  |
  v
LIOS CONVERSATION RUNTIME
  |
  +--> Intent Engine
  +--> Context Graph
  +--> State Engine
  +--> Workflow Planner
  +--> Policy / Permission Layer
  |
  v
EXECUTION FABRIC
  |
  +--> Universal Data Router
  +--> Deterministic Finance Engines
  +--> Research / Search Tools
  +--> AI Provider Router
  +--> File / Database Tools
  +--> Automation Engine
  |
  v
VERIFICATION + ARTIFACT ENGINE
  |
  +--> typed outputs
  +--> evidence/source references
  +--> calculation results
  +--> data-gap/failure state
  |
  v
CONVERSATION LEDGER + PROJECT GRAPH
```


## 1.1 Open-source assimilation doctrine

LiOS treats high-quality permissively licensed open source as a strategic force multiplier, not merely as inspiration.

The default doctrine is:

> **DISCOVER → IMPORT → VERIFY → ADAPT → INTEGRATE → HARDEN**

and, when deciding whether to build a capability:

> **ASSIMILATE → WRAP → EXTEND → BUILD**

If a mature MIT, BSD or Apache-2.0 implementation already solves a generic subsystem well, LiOS may reuse an entire component, service, engine, adapter family or subsystem rather than recreating it file-by-file. Full-subsystem reuse is allowed when it accelerates the product and the license/distribution requirements are satisfied.

The required discipline is **aggressive reuse + verification**, not conservative rebuilding and not blind copying.

Every imported subsystem is classified during assimilation:

- **Production-ready** — behavior is real, tested and suitable after LiOS integration.
- **Needs adaptation** — sound implementation, but contracts, persistence, security, UX or architecture must be mapped into LiOS.
- **Prototype/stub** — useful reference or scaffold, but not real production behavior.
- **Reject** — incorrect, insecure, duplicative, abandoned or licensing/data-rights unsuitable.

A permissive repository license does not automatically license external data feeds, APIs, datasets, logos, screenshots, fonts, models, trademarks or bundled third-party assets. Code rights and external service/data rights are reviewed separately.

For every vendored/copied subsystem, pin an upstream repository + commit SHA and record copied paths, destination paths, license, changes and required notices. The P0 machine-readable governance files are `third_party/components.json`, `third_party/upstream-lock.json` and `third_party/workspace-layout-benchmark.json`, with the human-readable entry point `THIRD_PARTY_NOTICES.md`. Before public distribution, reconcile these records against the exact packaged dependency graph and preserve dependency/license/security scanning in CI.

Do not rebuild commodity functionality merely to make it "ours." LiOS differentiation belongs in financial semantics, governed state, data routing, identity, deterministic finance, Project intelligence, artifacts, prescriptive workflows and user-controlled AI.

## 1.1.1 P0 replaceable runtime contract freeze

Before donor-specific implementations expand, LiOS owns the stable runtime seams in:

- `src/shared/runtimeContracts.ts` — versioned component, execution, artifact, workspace/session, backtest, finance, permission, job, plugin and runtime-pack schemas;
- `src/shared/runtimeAdapters.ts` — AIProvider, DataProvider, Connector, ArtifactRenderer, Workspace, Job and Plugin adapter interfaces;
- `src/shared/runtimeRegistry.ts` — replacement-safe component discovery/registration;
- `src/server/runtimeFoundation.ts` — secret-free projection of existing AI-provider, connector and managed-runtime registries into the common contract.

Donor libraries may implement these contracts, but donor framework state must not become canonical Project, Session, Artifact, Data or UI state. Removing or replacing a donor must not require a persistence-model rewrite.

## 1.1.2 P1 Project/Conversation/Session convergence

P1 introduces one canonical user-work hierarchy:

`Project -> Chat -> Resource references -> Session -> Living Workspace`

Persistence authority:
- PostgreSQL/Drizzle Project tables own Projects, persistent Project/Quick chats, Project resources and Session Vault records.
- Temporary Chat is intentionally renderer-memory only.
- Session records contain analytical state, linked context, focused object and Dockview layout geometry, but reject credential/token/password/authorization-like fields recursively.
- Legacy filesystem Workbench records are migration inputs only; `legacy_workspace_id` provides idempotent migration identity.

Runtime authority:
- BYOAI remains replaceable and cannot own conversation persistence.
- Project chat never reads the legacy global AI memory store; governed GM durable memory and approved cross-Project retrieval must use canonical scope/permission contracts instead.
- LiOS Resource context policy decides which references may enter an AI turn. Read federation never changes Project-owned storage/mutation authority, and stronger source/client/tenant exclusions remain binding.
- LiOS safe-workspace actions mediate any AI/user request to open/focus/rearrange panels.
- the authenticated composer source scope is part of the Conversation Request/context contract; it cannot be bypassed by Project resource inclusion or known connected market-data paths.
- clean-install first value does not require Project creation: when no Project exists, the first persistent conversation is a Quick Chat.
- Dockview is a replaceable renderer behind LiOS state. Dockview native close semantics are disabled because LiOS owns pane lifecycle and accessible chrome.
- `react-resizable-panels` remains the mobile/maximized fallback during P1.

## 1.1.3 P2 governed Conversation Runtime

P2 adds one execution layer between Project/Chat and providers/tools. It does not create a second assistant or a second persistence model.

Canonical request flow:

`Project/Chat -> five-level context -> structured intent -> workflow plan -> permission decision -> tool/engine/AI -> typed event/work product -> receipt`

The five context levels are **identity, Project, conversation, workspace and active object/selection**. Provider/framework state is not part of canonical context.

Runtime rules:
- deterministic-first is the default execution mode;
- AI-assisted may interpret/configure work but deterministic engines remain calculator-of-record where they exist;
- AI-direct is permitted only through an explicit USER_CONFIRM grant and every result is labelled AI-derived;
- deterministic execution remains available when Master AI is off;
- Project AI transmission policy is enforced at both context packaging and BYOAI candidate routing;
- local-only policy filters provider candidates using LiOS provider metadata and cannot silently fall back to cloud;
- every runtime execution has a request UUID, bounded workflow plan, cancellation path and normalized events;
- material actions resolve through SAFE_AUTO / USER_CONFIRM / ADMIN_CONFIRM / DENIED rather than free-form model commands;
- approved Project-level grants are explicit inputs to authorization; no model can self-grant permissions;
- Agent Runtime roles are LiOS-owned and framework-neutral; external agent frameworks are replaceable adapters only;
- runtime receipts record execution facts and AI/deterministic attribution without storing hidden chain-of-thought.

Governed tool admission is one server-owned `GovernedToolRegistry` and one permission-decision function. A descriptor declares its typed input/output schemas, permission class, side-effect class and replay-safety; model-originated calls are unavailable unless both schemas exist, and outputs are schema-checked and byte-bounded before they return to the model. Trusted Project/user/source context is added by the server, never accepted from model arguments. Approval authority is resolved directly from canonical GM-11a server grant state; there is no second tool-token mint. Once grants bind to user + request + tool and are consumed before invocation; Project grants bind to user + Project + tool in the existing conversation_action_grants table. Client JSON, planner output and copied approval-shaped objects are not authority. Retries and external effects use the descriptor's classification and a separate run-bound idempotency record; a model cannot self-approve or reclassify a tool.
P2's first executable proof uses the existing Global Instrument Master and governed market-data layer to resolve a security, retrieve quote/OHLCV, calculate RSI/MACD/support-resistance deterministically, and emit a typed technical-analysis work-product draft. Persistent Artifact semantics remain P4 and the durable Conversation Ledger remains P3.


## 1.1.3A Active P2 AI-native capability orchestration

The historical P2 Conversation Runtime remains the execution and permission foundation. Active P2 adds a LiOS-owned capability-resolution/orchestration layer above it; it does **not** create another assistant or let an AI provider own the plan.

Canonical flow:

```text
ConversationRequest
  → source scope + authenticated context
  → resolveConversationCapabilities()
       → capability id
       → readiness / required & missing inputs
       → source compatibility
       → permission class
  → WorkflowPlan.capabilities + dependency steps
  → approval preflight
  → LiOS conversation tools / deterministic engines
  → RuntimeExecutionReceipts + Artifact drafts
  → optional BYOAI synthesis
```

Authority and safety:
- the capability resolver is LiOS code and its output is schema-validated;
- capability resolution may select multiple compatible capabilities for one natural-language request;
- multi-capability market work shares instrument resolution and governed data retrieval before deterministic branches execute;
- a governed branch such as Backtest is approved before the bundle begins tool execution;
- missing inputs and source-scope conflicts are structured gaps, not prompts for the model to guess;
- the provider-facing completion transport currently exposes text/multimodal completion, not a verified provider function-call channel; therefore provider text cannot directly execute LiOS tools;
- verified provider tool calling must compile into canonical LiOS capability/action contracts and pass the same permission boundary; SI agent breadth does not convert completion text or a declared tool-support flag into execution authority, and privileged `exec.*` remains blocked pending GM-11;
- AI Assisted is interpretive: deterministic receipts/artifacts remain authoritative and synthesis failure returns the deterministic work unchanged;
- an explicit Master AI-off preference disables optional synthesis and preserves deterministic execution;
- the Project `allowToolCalling` policy governs provider tool execution semantics and does not suppress ordinary interpretation/synthesis;
- Project/Chat/Artifact/Workspace state remains LiOS-owned; no external agent/provider framework becomes persistence authority.

The Conversation Runtime trace renders capability resolution, readiness, source incompatibility, dependency progress, approval/mutation surfaces, data-gap recovery and cancellation as product UX rather than provider/framework diagnostics. Active-P2 telemetry is local aggregate-only and does not retain user prompt/entity/file/Project content or credentials.

**Recorded Active P2 status: COMPLETE (2026-09-26).** This is source-convergence scope, not verified provider function calling, GM-11 privileged execution, SP-02 acceptance or release proof.

## 1.1.3B Active P3 Universal Data, Evidence & Trust Fabric

Active P3 reuses the existing LiOS Universal Data Fabric, Provider SDK, connector registry, data-stack pins, execution receipts and reproducibility ledger. It does **not** introduce a parallel provider layer or a model-owned provenance system.

Canonical flow:

```text
ConversationRequest / WorkflowPlan capability
  → canonicalDataRequestSchema + P1 source scope
  → user-scoped connector/runtime snapshot
  → provider plan
       → allow/deny policy
       → stack order + data pins
       → executable-path compatibility
       → coverage / connection / source-scope state
  → governed data router / provider adapter
       → observation source refs + clocks
       → freshness and fallback state
       → served entitlement/access state
       → quote/history/Project/file lineage
  → deterministic engine / RuntimeExecutionReceipt
  → TrustManifest
       → evidence observations
       → claims / formulas / assumptions
       → quality / confidence / coverage
       → conflicts or explicit not-evaluated state
       → missing evidence + recovery
  → Show Work
  → evidence.assessed event + lineage graph
```

Authority and truth rules:
- `shared/universalDataFabric.ts` remains the provider-neutral data contract. P3's trust request extends the canonical request with conversation source scope, partial-coverage posture and maximum-age posture rather than creating another data API;
- the provider planner is grounded in the authenticated user's connector runtime state, not server-operator credentials;
- provider stack ordering and data-stack pins remain user-controlled, but only among sources that are compatible with the requested capability, source scope and the actual executable LiOS path;
- registry capability is not sufficient proof of execution. For the conversational price path, P3 only advertises providers that the active LiOS market-data router can actually invoke;
- freshness answers when/how current an observation is; entitlement/access answers what tier was actually served and whether a better tier requires another connector. They remain separate fields in evidence;
- current quote and historical OHLCV are independent evidence observations. A quote provider is never copied onto history provenance unless that history path actually returned the observations;
- newly persisted OHLCV stores upstream source lineage. Legacy local history without recorded lineage remains explicitly `legacy-unattributed` rather than receiving inferred provenance;
- trust quality/confidence is deterministic product metadata based on source freshness, runtime verification, fallback state, evidence coverage, missing fields and conflicts. BYOAI does not rate its own evidence;
- provider conflict state distinguishes `none` (comparable observations were evaluated) from `not_evaluated_single_source`. Disagreement is preserved, not silently resolved;
- all material successful Conversation Runtime results emit a typed `trust` event. Generic trust is built from the same tool-result/receipt events already emitted by LiOS so identity, Project, file/manual and engine evidence are not lost;
- a governed failure emits its partial evidence/trust manifest before the structured data gap when work already observed authoritative evidence;
- Show Work is a product view over the TrustManifest: Sources, Methodology, Claims & calculations, Assumptions, and Exceptions & recovery. It does not expose hidden model reasoning;
- contextual connector recovery opens the existing Connection Center and preserves the original request for continuation after the missing source is connected/imported;
- trust manifests are written to the LiOS ledger as `evidence.assessed` lineage. `supports` and `conflicts_with` are explicit graph relations;
- trust telemetry remains local aggregate-only; no prompt, source ref, provider name, symbol, Project/file content, assumption value or credential is retained by the telemetry counter store;
- AI-assisted synthesis is downstream of evidence/deterministic work and remains non-authoritative. The observed evidence and deterministic receipts are the record of fact/calculation.

P3 deliberately leaves durable Artifact/workspace evolution to active P4. P3 supplies the evidence contract that P4 Artifacts must carry forward rather than rebuilding provenance inside each renderer.

**Recorded Active P3 status: COMPLETE (2026-09-26).** This records the trust/data convergence scope, not universal source coverage, fully grounded claims, SP-03 acceptance or packaged release evidence.

## 1.1.3C Active P4 Artifact & Professional Workspace OS

Active P4 converges the historical immutable/versioned Artifact OS with the P1 conversational shell, P2 governed orchestration and P3 trust fabric. Artifact state remains LiOS-owned and database-backed; AI providers receive bounded context and can propose work, but do not own Artifact persistence, version history or workspace state.

Current source lifecycle (explicit Keep); required automatic meaningful Project output persistence remains a pending TC-13/P4 integration:

```text
ConversationArtifactDraft
  + P2 WorkflowPlan capabilities
  + P3 TrustManifest
  + source / receipt / assumption refs
  → explicit Keep / Quick/Temporary Project destination preview
  → project_artifacts identity
  → project_artifact_versions vN
       ├─ content + contentHash
       ├─ sourceRefs / executionReceiptIds / assumptionRefs
       ├─ trustManifest
       ├─ dependencyRefs
       └─ refreshSpec
  → Artifact workspace
       ├─ Focus
       ├─ Show Work
       ├─ selection-aware Ask LiOS
       ├─ proposals / compare / fork / undo
       ├─ export / package
       └─ governed Rerun
            → restore source scope + execution mode
            → Conversation Runtime
            → refreshed work product
            → compatible vN+1
```

Durability and authority:
- `project_artifacts` remains object identity; `project_artifact_versions` remains immutable version authority;
- migration 0073 adds optional `trust_manifest`, non-null `dependency_refs` and optional `refresh_spec` to versions. Existing rows remain valid;
- P3 trust is a version snapshot. Later provider state does not rewrite the historical evidence record of an older Artifact version;
- dependency refs represent source/Artifact/capability dependencies used to reproduce or understand the version. Credential-bearing references are rejected;
- refresh specs are bounded to conversation/engine/manual origin, canonical source scope and the P2 execution-mode enum. They describe how to restore the governed request; they do not grant permission;
- active-Artifact refresh uses the existing Conversation Runtime. P4 does not add an autonomous second executor;
- explicitly kept refreshed work advances an active Artifact to vN+1 only if its canonical kind matches. Required automatic persistence must preserve this same rule when integrated. Type-changing work must become a separate Artifact; material AI changes still require proposal/review, never silent overwrite;
- optimistic head-version checks remain the concurrency authority for version creation.
- current source requires explicit Keep for Project outputs; automatic persistence of important Project output is required future behavior and remains a TC-13/P4 integration gap, not implemented persistence or passing SP evidence. Quick/Temporary Keep requires an explicit Project destination and preview of changed scope/resources/memory/permissions. Failed save retains its destination and reuses a newly created Project rather than losing work or creating duplicates;

Trust and security:
- TrustManifest values are schema-validated and scanned for credential-shaped nested fields before persistence;
- evidence/claim/conflict/methodology source refs inside TrustManifest are checked against the Artifact credential-ref boundary;
- portable Artifact packages retain trust, dependency and replay metadata and revalidate provider dependencies for entitlement requirements;
- package import verifies content hashes and credential safety before recreating versions;
- interaction/ledger payloads store non-sensitive trust IDs, dependency counts and refresh kind rather than duplicating the full prompt/trust body.

Professional workspace:
- the historical `ArtifactPane` remains the renderer/editor authority for chart, table, screen, valuation, portfolio, research, report, spreadsheet, data, backtest, strategy, decision, timeline and thesis Artifacts;
- Show Work prefers the persisted version TrustManifest, with legacy source/receipt fallback for older versions;
- Focus is a real full-width Artifact work surface. Exiting Focus restores the same Project conversation;
- Artifact selection-aware AI uses the existing local composer selection contract; nothing is sent until the user submits;
- Rerun restores the saved source scope and execution mode and stages the saved governed request. It does not silently broaden data access or trigger hidden autonomous execution;
- Ask LiOS continues to use proposal/review semantics for Artifact mutations;
- version comparison reports content differences separately from changes to trust, dependencies, replay, receipts, assumptions and sources.

Portability and renderer posture:
- the 2026-09-26 active-P4 completion scope added no heavy renderer packages; it is not the current integration ceiling. CA-01/P4 has since integrated the Univer OSS editor behind P4 revision authority;
- built-in adapters/fallbacks remain available. Univer evidence is bounded separately below; Perspective/ECharts/Tiptap bridge or renderer enums alone do not prove installed, provisioned or usable packages;
- Artifact package export/import now carries the active P4 version metadata without changing the credential-free package contract.

**Recorded Active P4 status: COMPLETE (2026-09-26).** This is dated Artifact-convergence evidence, not proof of all SI-04 donor integrations, professional round trips, SP-04 acceptance or release.

## 1.1.3D Active P5 Professional Intelligence Workflows & Finance Depth

Active P5 connects the P1 conversational shell, P2 capability orchestration, P3 trust/data fabric and P4 Artifact workspace to the existing deterministic finance engines. P5 is a workflow-convergence layer, not a replacement finance runtime.

Canonical professional flow:

```text
ConversationRequest
  → P5 professional intent/capability resolution
       ├─ company research / fundamentals
       ├─ valuation & financial modeling
       ├─ portfolio / risk
       ├─ fixed income
       ├─ derivatives
       ├─ macro / FX
       ├─ research / reporting
       └─ personal finance
  → readiness + source-scope checks
  → canonical identity / governed provider data / active Artifact inputs
  → deterministic calculator of record
       ├─ native LiOS finance engines
       ├─ Advanced Quant
       └─ personal-finance core
  → RuntimeExecutionReceipt
       ├─ inputHash / outputHash
       ├─ source refs
       ├─ engine id/version
       └─ validation/warnings
  → P5 reconciliation metadata
  → ConversationArtifactDraft
  → P4 canonical Artifact version
       ├─ P3 TrustManifest
       ├─ dependencies / receipts / assumptions
       ├─ governed replay spec
       └─ canonical export plan
```

Professional authority rules:
- Conversation Runtime remains the sole conversational orchestration authority. P5 does not create a parallel agent/finance executor;
- deterministic LiOS engines and Advanced Quant are the calculator of record. AI synthesis is optional downstream interpretation and cannot overwrite deterministic values or receipts;
- natural company requests share canonical identity and compatible research/data capabilities; market retrieval and technical analysis apply only when a real resolved security/listing and source scope allow them. No-ticker or quote-unavailable research must continue with cited qualitative evidence and explicit coverage gaps, without a module selector;
- financial statements use the existing multi-provider capability broker, preserving material provider conflicts in evidence and professional Research Artifacts;
- institutional model execution requires explicit structured inputs or inputs recovered from a compatible active Artifact. Missing assumptions remain governed gaps;
- Advanced Quant professional outputs retain model id/version, validation level, data-classification posture and deterministic input/output snapshot hashes;
- P5 reconciliation metadata binds each professional work product to its calculator of record and deterministic hashes;
- company Research/Fundamentals and Personal Finance use their actual Conversation Runtime receipt input/output hashes for reconciliation;
- professional reporting from an existing Artifact identifies the exact source Artifact version and records `analyticalRecalculation: false`; report assembly does not recalculate or reinterpret the authoritative model result;
- Personal Finance reuses `lios.personal-finance.core-v1` and only user-owned supplied data/explicit assumptions. No account, transaction, liability, goal or retirement assumption is inferred;
- P5 reuses P4 durable versioning, trust, dependency and replay semantics. A refreshed professional work product is governed through the same Artifact lifecycle rather than stored in separate workflow state.

Export and reconciliation:
- the Artifact kind determines export capability through the shared `ARTIFACT_EXPORT_FORMATS` / `artifactExportFormatsForKind` policy in the canonical Artifact contract;
- the server Artifact export-plan endpoint consumes that same policy; P5 maintains no duplicate export matrix;
- valuation Artifacts expose JSON/XLSX/PDF/PPTX; portfolio Artifacts expose JSON/CSV/XLSX/PDF/PPTX; research/report Artifacts expose JSON/Markdown/PDF/PPTX; decision/personal-finance Artifacts expose JSON/Markdown/PDF/PPTX;
- professional Artifact metadata records export authority as `p4_artifact_export_plan`, keeping presentation/export concerns downstream of deterministic calculation;
- report generation and Artifact export do not change the deterministic hashes. If analytical assumptions change, the model must rerun and create a new governed Artifact version.

Flagship journeys:
- **Research company:** natural company name/domain/registration ID → canonical/provisional entity with ambiguity handling → permitted research evidence and statements where available → cited Research/Report Artifacts; quoted-security work may add governed market/technical analysis, but missing quotes never gate entity-only research;
- **Valuation/modeling:** explicit model inputs or compatible Artifact → Advanced Quant → deterministic receipt → Valuation Artifact;
- **Portfolio/risk:** explicit holdings/model parameters or compatible Artifact → deterministic risk/optimization model → Portfolio Artifact;
- **Fixed income / derivatives / macro:** explicit compatible parameters → registered Advanced Quant path → Report/Portfolio Artifact with deterministic reconciliation;
- **Research/reporting:** active canonical Artifact → report assembly without hidden recalculation;
- **Personal Finance:** supplied user-owned financial profile → deterministic snapshot → Decision Artifact with receipt reconciliation and P4 export/replay continuity.

P5 keeps historical Universal Data Fabric P5 as an underlying baseline; the 2026-09 seven-phase convergence program used P5 for Professional Intelligence Workflows & Finance Depth. That historical numbering does not replace SI-05 or the existing canonical identity/engine owners.

**Recorded Active P5 status: COMPLETE (2026-09-26).** This records the professional workflow convergence scope, not all eleven families' depth, no-ticker resolver/corpus coverage, SP-05 acceptance or release.

## 1.1.3E Active P6 Project Graph, Decision Memory & Continuous Intelligence

Active P6 is a deterministic continuation/read-model layer over existing LiOS authorities. It does not introduce a second Project store, graph database, decision database or scheduler.

```text
Project / Chat / Resource / Session state
  + P4 Artifact versions and dependency refs
  + P7 Project Intelligence graph / snapshots / Insight Lens
  + versioned Decision Artifacts
  + P9 workflows / runs / notifications / event bus
        |
        v
P6 Project Continuity composer
        |
        +--> continuity graph
        +--> Decision Memory
        +--> What Changed
        +--> deterministic Continue Work queue
        +--> active workflow/failure state
        |
        v
authenticated Project workspace
```

Authority boundaries:
- P7 Project Intelligence owns indexed Project documents, historical source versions, immutable snapshots, graph construction, deterministic Insight Lens and Time Machine.
- P4 Artifact OS owns Decision Artifacts and their versions, source/dependency/assumption refs and replay/refresh metadata.
- P9 Continuous Intelligence owns saved workflow definitions, scheduler/event execution, run receipts, relevance/cooldown policy and notifications.
- P6 owns only the typed composition contract and deterministic continuation projection.
- Project Continuity refresh may rebuild Project Intelligence, but it never silently runs a saved workflow.
- Continuation queue items are derived only from explicit typed state: retained source deltas, unresolved/monitorable Decision Artifacts, failed enabled workflows and deterministic Project Intelligence signals.
- The P6 fingerprint excludes request time so identical composed professional state is reproducible across reads.

Canonical files:
- `shared/p6ContinuityContracts.ts`
- `server/p6ProjectContinuity.ts`
- `server/p6ContinuityRoutes.ts`
- `client/src/lib/useP6Continuity.ts`
- `client/src/components/terminal/ProjectContinuityPanel.tsx`
- `docs/technical/P6_PROJECT_DECISION_CONTINUOUS_INTELLIGENCE.md`

**Recorded Active P6 status: COMPLETE (2026-09-27).** This records the deterministic composition/read-model scope, not a second memory/scheduler authority, all rich-Home behavior, SP-06 acceptance or release.

## 1.1.3F Active P7 World-Class Desktop Hardening & Enterprise Release

Active P7 is the final convergence/certification layer. It reuses the existing enterprise, security, desktop, updater, recovery and historical P10/P14 release authorities.

```text
P1 identity / device / session / offline entitlement
  + Enterprise policy / OIDC / SAML / deployment verification
  + Security Acceptance
  + Desktop Acceptance
  + P10 hardening / audits / packaged capability
  + P14 typed release evidence
        |
        v
P7 Release Readiness
        |
        +--> engineeringComplete
        +--> releaseCertified
        +--> engineering-owned blockers
        +--> release-owner evidence blockers
        +--> tenant deployment gates
        |
        v
Operational Readiness + final release certification
```

Authority rules:
- P7 creates no new identity stack, updater, backup/recovery path, release pipeline, evidence format or enterprise policy store.
- Engineering-owned source controls must be complete before P7 can report `engineering_ready`.
- Real signing/notarization, Authenticode, native secret custody, packaged sidecar, clean installs, update/rollback, assistive technology, production privacy/security review and exact release-rights evidence remain external until observed.
- Tenant IdP/private deployment verification is deployment-bound and does not masquerade as generic package certification.
- Final `acceptance:p7:release` consumes the same typed P14 evidence bundle for one exact release tag/version, so P7 and P14 cannot disagree about what was actually certified.
- The existing Quality Gate runs `acceptance:p7`; the final P14 certification workflow additionally runs `acceptance:p7:release`.

Canonical active-P7 files:
- `shared/p7ReleaseContracts.ts`
- `server/p7ReleaseReadiness.ts`
- `server/operationalReadinessRoutes.ts`
- `client/src/components/panels/P7ReleaseReadinessPanel.tsx`
- `script/validate_p7_active_release_acceptance.ts`
- `docs/technical/P7_DESKTOP_ENTERPRISE_RELEASE.md`

**Recorded Active P7 engineering status: COMPLETE (2026-09-27).** This records the repository-side seven-phase convergence scope at that date, not completion of SI-01–SI-07 or acceptance of SP-01–SP-07. `release_certified` remains intentionally unavailable until one exact release candidate carries the required typed external evidence; P14 retains final release authority.





## 1.2 Runtime/platform decisions

**Keep/current architecture**

- Electron desktop host and electron-builder packaging/update path;
- React 18 + Vite + TypeScript;
- Express service layer plus the existing Python/FastAPI deterministic sidecar;
- PGlite/PostgreSQL + Drizzle persistence;
- DuckDB for local analytical querying;
- Lightweight Charts for financial price/OHLC views;
- existing Recharts visualizations where stable;
- Radix/cmdk/resizable-panel primitives;
- current provider-neutral BYOAI router;
- current Electron secret-custody/update/backup/recovery contracts.

Open-source subsystem assimilation must fit into these contracts unless a measured architectural decision explicitly replaces a layer. Do not restart the application around a donor repository.

**Historical exploration, not an active migration:** Tauri/Rust. Do not start a Tauri rewrite without a future explicit benchmarked migration decision.

## 1.3 Primary OSS donor and engine matrix

The following projects are approved research/assimilation candidates as of 2026-09-21. Agents must re-check the exact version/commit license before import.

| Project | License / posture | LiOS role |
| --- | --- | --- |
| Hitheshkaranth/OpenTerminalUI | MIT | **Major terminal donor.** Frontend workspaces, command/search, saved views, linked panels, chart workstation, finance screens, backend provider contracts, plugins, tool registry, streams, background services, risk/backtest/derivatives modules and tests may be imported/adapted in substantial units after verification. |
| ErTasselli/OpenTerminal | MIT | **Major local-first/provider donor.** Provider isolation/fallback, stale-while-revalidate cache patterns, SQLite/WAL/local runtime, command palette, widget workspace, screeners/heatmaps/options/macro/portfolio patterns. Underlying public endpoint terms are reviewed separately. |
| LondonStrategicEdge/lse-terminal + lse-data + brue | MIT code; external LSE data rights separate | **High-priority V1 donor/provider family.** Reuse provider/engine/backtest/indicator/ML/workspace code selectively; implement LSE Data only behind LiOS Provider SDK with user-owned credentials and a separate data-rights release gate; Brue is a strategy-runtime candidate. |
| assistant-ui/assistant-ui | MIT | Primary conversational UI/runtime primitives: threads, composer, attachments, streaming, edit/regenerate, branch UI, custom runtime adapters and tool rendering. LiOS owns persistence/runtime/state; Assistant Cloud is not a product dependency. |
| assistant-ui/tool-ui | MIT | Copy/adapt interactive tool-result components for approvals, progress, forms, tables, charts and finance-specific execution cards. |
| dream-num/univer | Apache-2.0 OSS core | Spreadsheet/document runtime candidate for live modeling artifacts and AI/user co-editing. LiOS keeps its own import/export/charting when capabilities are not in the OSS core. |
| perspective-dev/perspective | Apache-2.0 | High-volume/streaming DataArtifact, virtualized analytical grids, pivots and DuckDB/Arrow-backed exploration. Build a real packaged-desktop POC and adopt if it meets performance/footprint gates. |
| apache/echarts | Apache-2.0 | Advanced analytical visualization: correlation/heatmap/treemap/waterfall/scenario/risk/flow/curve views; lazy-load behind LiOS chart contracts. |
| TanStack/table + TanStack/virtual | MIT | Headless large-table and virtualization foundation where existing tables are insufficient. |
| ueberdosis/tiptap OSS core | MIT | Live editable ReportArtifact/ResearchArtifact surface. Paid/proprietary extensions are not assumed. |
| xyflow/xyflow / React Flow | MIT | Advanced Research Graph / connector / automation graph surfaces only when useful; never default navigation. |
| skfolio/skfolio | BSD-3-Clause | Portfolio optimization, risk, model evaluation and factor workflows behind LiOS deterministic contracts. |
| QuantConnect/Lean | Apache-2.0 | Optional Quant Runtime Pack for deep backtesting/execution/multi-asset algorithm workflows; not the default LiOS runtime. |
| dgunning/edgartools | MIT | Primary US SEC filing/XBRL research helper where suitable: typed filing objects, statements, ownership/filing workflows. |
| Arelle/Arelle | Apache-2.0 | XBRL/iXBRL validation/parsing and taxonomy-aware filing semantics where required. |
| docling-project/docling | MIT | Local document/PDF/table parsing and unified document representation where current parsing is insufficient. |
| asg017/sqlite-vec | MIT/Apache-2.0 | Local semantic vector search candidate for private Project corpora. |
| pola-rs/polars | MIT | High-volume DataFrame transforms when DuckDB/pandas paths show a measured need. |
| Apache Arrow | Apache-2.0 | Columnar interchange between DuckDB/Perspective/Python/JS and data artifacts. |
| OpenTelemetry | Apache-2.0 | Standard internal traces/metrics/logs for conversation/tool/data/artifact/runtime execution, with local-first/redacted defaults. |
| OpenLineage | Apache-2.0 | Candidate event/schema model for data lineage from connector → normalization → model → artifact/export when it improves reproducibility. |
| Open Policy Agent | Apache-2.0 | Optional policy-engine candidate only if LiOS permission/entitlement rules outgrow the existing policy layer. |

Major OSS imports should be vendored or wrapped deliberately; never create architecture that can only run when an upstream SaaS/cloud service is available.

## 1.4 OpenTerminalUI assimilation scope

Hitheshkaranth/OpenTerminalUI is approved as a major code donor, not only a visual reference. LiOS may copy and adapt substantial MIT-licensed subsystems.

High-value frontend imports/adaptations include:

- command palette and keyboard-command infrastructure;
- Launchpad/workspace layout behaviors;
- saved views and restore semantics;
- multi-panel chart workstations;
- linked symbol/context groups;
- watchlists, heatmaps, screeners and security-hub interaction patterns;
- portfolio/risk/backtest/F&O analytical surfaces where they close real gaps;
- intelligence timeline;
- alerts;
- artifact rendering patterns;
- settings/plugin-management surfaces;
- component and end-to-end tests.

High-value backend imports/adaptations include:

- provider interfaces/contracts and registries;
- unified/fallback fetch patterns;
- WebSocket/market-data hub patterns;
- candle aggregation and streaming lifecycle;
- cache/prefetch/background-service patterns;
- instrument loaders;
- alert scheduling;
- tool registries;
- plugin manifests/loaders/permission concepts;
- saved-view persistence;
- portfolio/risk/backtesting/derivatives utilities that pass numerical validation;
- health/metrics/service lifecycle patterns;
- auth/security patterns where compatible with LiOS desktop/local-first boundaries.

**Verification warning:** upstream feature names are not evidence that an implementation is production-real. During research, the current OpenTerminalUI data-quality service was observed to synthesize deterministic pseudo-anomalies from the dataset identifier rather than validate actual data. That specific implementation must **not** be imported as a real data-quality engine. Similar modules must be inspected and classified before assimilation.

Do not import OpenTerminalUI branding, screenshots, logos or data-provider rights. Adapt code into LiOS-owned contracts and visual tokens.

## 1.5 ErTasselli/OpenTerminal assimilation scope

ErTasselli/OpenTerminal is an additional MIT donor with architecture close to LiOS's local desktop/web stack.

Approved concepts/subsystems to assimilate where stronger than current code:

- isolated provider modules;
- provider fallback chains;
- stale-while-revalidate/local cache behavior;
- local SQLite/WAL persistence patterns where useful;
- command/search/workspace behavior;
- watchlist/screener/heatmap/options/macro/portfolio UI;
- calendar/news aggregation interaction patterns;
- local-first network/security defaults.

Its underlying market-data endpoints are **not** automatically approved for commercial LiOS use. Every provider endpoint still goes through LiOS entitlement/licensing review and the canonical Universal Data Router.


## 1.5A London Strategic Edge assimilation scope

London Strategic Edge is integrated as an **acceleration donor family**, not as a replacement product architecture.

Pinned upstream sources are tracked in `third_party/upstream-lock.json`; the detailed mapping is `docs/technical/LSE_TECHNOLOGY_ASSIMILATION.md`.

Authoritative boundaries:

- LiOS owns Project/Conversation/Session/Artifact persistence and permissions.
- LiOS owns the Provider SDK, Universal Data Router, canonical identity and semantic finance layer.
- LSE data-provider code is an adapter under those contracts.
- LSE engine/backtest/indicator/ML code may be imported in substantial MIT-covered units after verification and parity/known-answer testing.
- Brue may implement a Strategy/Formula runtime adapter, but may not own credentials, provider routing, Project state or the only strategy language.
- LSE UI source may contribute reusable widgets/interactions, but LiOS navigation, Projects/Chats model, terminology, accessibility contract and visual system remain authoritative.
- Existing P1-P4 implementation is not reopened to imitate LSE.

Canonical optional provider path:

```text
Project / Conversation / Artifact
        |
Universal Data Router
        |
Capability + entitlement + identity policy
        |
LSEProviderAdapter
        |
local secret handle -> lse-data/client protocol
        |
REST | WebSocket | bulk Parquet | usage/health
        |
normalization + provenance + local cache
```

No renderer/frontend module may call LSE directly. API keys may not enter normal Project state, chat context, logs or model prompts.

The LSE-hosted data license/terms remain independent of the MIT code grant. LiOS does not provide central redistribution of LSE data. Production enablement of an LSE-specific connector is feature-gated by provider-terms review.

The upstream LSE Terminal README references a standalone Brue Connect repository, but that source was not retrievable during the 2026-09-22 audit. Do not assimilate or claim rights to Brue Connect implementation until a verifiable source/license is available.

## 1.6 Conversational and tool UI stack

**assistant-ui** becomes the preferred commodity conversation-UI foundation when integration tests pass.

LiOS maps it to its own Project/Chat persistence, Conversation Ledger, Conversation Runtime, branch ancestry, attachments/BYOD layer, cancellation/streaming contracts, custom tools and BYOAI router.

Do not make Assistant Cloud authoritative. If a package includes optional cloud-related dependencies, verify that packaged LiOS does not require or silently transmit data to an external assistant-ui service.

**tool-ui** components may be copied directly into LiOS and re-themed. Build finance-specific tools on top:

- DataFetchProgress;
- ProviderChoice;
- DataGapResolution;
- AssumptionEditor;
- ValuationApproval;
- ScenarioSelector;
- PortfolioRebalanceApproval;
- SourceConflictCard;
- ModelExecutionReceipt;
- ExportOptions.

## 1.7 Artifact and analytical workspace stack

LiOS Artifact Engine supports progressively richer surfaces without changing the default mental model.

### SpreadsheetArtifact — Univer-backed candidate

Univer OSS is now integrated for spreadsheet Artifact editing behind P4 revision authority, rather than merely a modeling-canvas candidate. `third_party/capability-assimilation.json` records partial integration with real-server edit/save/reload/formula evidence. OpenClaw Assimilation Blueprint §48.8 additionally records source-built and unsigned packaged macOS-arm64 shell/CSP editor evidence from 2026-10-03; it does not prove Windows, signed/notarized distribution or complete SP-04 round-trip acceptance. The current recorded package pin and remaining stable re-pin/qualification gaps remain authoritative. Broader DCF/FCFF/FCFE/APV, comps, portfolio, capital structure/allocation, scenario and personal-finance modeling must still prove its actual journey, not inherit completion from editor presence.

Conversation and direct edits target the same workbook/cell/range state. Material AI edits should support **AI Draft → diff → review → accept/reject**, not silent overwrite.

LiOS must not depend on proprietary Univer capabilities. If import/export, charts, pivots, collaboration or another capability is outside the OSS core, use existing LiOS infrastructure or another approved OSS implementation instead of assuming a paid feature.

### DataArtifact — Perspective/TanStack/DuckDB candidate

For large/streaming datasets:

> BYOD/provider → canonical/extended data → DuckDB/Arrow → Perspective or TanStack/Virtual → LiOS DataArtifact

Primary targets include 100k+ universe/screener, portfolio holdings, fundamentals matrices, risk/factor tables, tick/streaming views, imported user datasets and SQL/query outputs.

### ReportArtifact / ResearchArtifact

Use Tiptap OSS core when a live editable document surface is required. Reports remain linked to underlying artifacts/engines so refresh does not create numerical drift.

### Visualization

Keep Lightweight Charts for financial time series. Keep stable Recharts. Use ECharts for advanced analytical visualizations rather than rebuilding those chart types.

### Advanced graph surfaces

React Flow may power a Research Graph, connector graph or automation/workflow graph. These are advanced surfaces only; they do not become the default application shell.

## 1.8 Deterministic finance engine assimilation

### Current/core

- NumPy, pandas, SciPy;
- statsmodels / linearmodels;
- QuantLib;
- arch;
- scikit-learn;
- ruptures;
- NetworkX / pymoo / SALib;
- asteval;
- DuckDB;
- existing LiOS deterministic finance engines.

### Approved expansion

- **skfolio** for modern portfolio optimization/risk/model evaluation where it is stronger than current implementations;
- **CVXPY + OSQP** for constrained optimization;
- **Arelle** for XBRL validation/parsing;
- **EdgarTools** for SEC filing workflows;
- **LEAN** as an optional Quant Pack, not mandatory core;
- validated OpenTerminalUI finance modules where known-answer/golden-output tests prove correctness;
- Polars/Arrow when high-volume workloads justify them.

Open-source quantitative code is not trusted because it is popular. Every material financial calculation imported from any donor gets known-answer tests, unit/scale tests, edge cases and reconciliation against the existing LiOS engine or an independent oracle before it becomes authoritative.

Robust backtesting should include where relevant point-in-time inputs, walk-forward testing, parameter sensitivity, Monte Carlo/robustness, transaction costs/slippage, liquidity/execution assumptions, partial fills/market impact, drawdown and rolling-risk diagnostics.

## 1.9 Research, document and Project Intelligence stack

LiOS Project Intelligence indexes permitted Project-owned material:

- chats;
- artifacts;
- notes;
- reports;
- uploaded files;
- filings;
- assumptions;
- decisions;
- source/evidence references;
- previous conclusions.

Preferred local-first building blocks include Docling for complex document/PDF/table extraction, Tantivy or existing lexical search where appropriate, sqlite-vec for local semantic vector retrieval where useful, EdgarTools + Arelle for SEC/XBRL, current web/provider research connectors, and Project-scoped indexes with explicit deletion/isolation.

This powers questions such as "Why did I originally buy this company?", "Which assumptions changed?", "What did I previously conclude about margins?" and "Show evidence that contradicts the thesis."

Federated cross-Project retrieval follows the approved 2026-10-02 source scope, attribution and consent contracts. Keep source indexes/ownership scoped and enforce tenant/client restrictions, exclusions, revocation and temporary-chat rules.

## 1.10 Plugin, Provider SDK and Runtime Pack architecture

### LiOS Extension Runtime

Assimilate proven plugin-loader/manifest patterns and strengthen them behind LiOS permissions.

An extension may declare name/version/publisher, required permissions, tools, connectors, artifact types, commands, UI surfaces and runtime-pack requirements.

Example permission families:

- data.market.read;
- project.read;
- project.write;
- artifact.create;
- connector.use;
- notification.send;
- file.read;
- ai.invoke.

Extensions never receive unrestricted credentials or filesystem access.

### LiOS Provider SDK

All provider integrations converge on a LiOS-owned contract covering identity/metadata, capability declaration, search/universe, fetch, stream, health, quota/cost, entitlement/license semantics and normalize/map behavior.

Provider contracts imported from donor terminals may seed this implementation, but LiOS canonical semantics and policy remain authoritative.

### Runtime Packs

Optional packs allow LiOS to be extremely powerful without forcing every user to install every heavy runtime:

- **Core Pack** — normal desktop/finance/conversation capabilities;
- **Research Pack** — EdgarTools, Arelle, Docling, local research/search helpers;
- **Quant Pack** — advanced optimization/portfolio/backtesting/LEAN where enabled;
- **Modeling Pack** — Univer/modeling helpers;
- **Data Lab Pack** — Perspective/Arrow/Polars and heavy data tooling;
- **Local AI Pack** — local inference/embedding helpers where supported.

A capability may be architecturally supported even when its pack is not installed; the UI then offers an explicit install/enable action rather than failing mysteriously.

## 1.11 Production observability, lineage, dependency and policy reuse

LiOS should assimilate mature OSS operational tooling rather than invent bespoke infrastructure.

- **OpenTelemetry** is the preferred standard for internal traces/metrics/logs across conversation → tool → connector → deterministic engine → artifact. Desktop telemetry is local/redacted by default; no private client data is exported without explicit policy.
- **OpenLineage** may inform or carry data-lineage events where useful so an artifact can trace back through retrieval, normalization and calculation stages.
- Use **OSV-Scanner or an equivalent approved vulnerability scanner** in CI/release checks for dependency risk and license inventory where practical.
- Existing permission/policy contracts remain authoritative. OPA is an optional future policy engine only if policy complexity justifies the extra runtime.

Observability must capture execution facts, not hidden chain-of-thought.

## 1.12 Explicit avoid / compatibility boundaries

- **OpenBB:** no current non-duplicative LiOS use case justifies it. LIOS-P0-01 removed the sidecar/connector/runtime-pack integration after dependency/use inspection; focused direct providers/libraries remain behind LiOS contracts. Keep the regression guard and do not restore OpenBB.
- **Fincept Terminal / competition-restricted or ambiguous-license code:** do not import source into commercial LiOS unless a current legal/license review explicitly clears the exact code/version.
- **Open WebUI/LobeHub current code:** use interaction inspiration only unless the exact current licensing terms are explicitly cleared for the intended commercial redistribution/rebranding.
- **Reverse-engineered/personal-use-only data feeds:** code may be technically informative, but do not make those feeds authoritative production dependencies.
- **Giant all-in-one agent/RAG frameworks:** import only when they remove more complexity than they create.
- **Stub/demo/fake implementations:** never present them as real LiOS capabilities merely because they exist in an upstream donor.


## 1.13 Preserved specialist reuse decisions

The stronger assimilation doctrine does not remove previously approved focused libraries/helpers. Preserve these decisions unless a later benchmarked change explicitly replaces them.

### Statistics / quant / specialist candidates

Useful reference or future specialist candidates include:

- PyPortfolioOpt / Riskfolio-Lib for benchmark/reference where helpful;
- FinanceToolkit as a ratio/valuation reference, test oracle or fallback research aid;
- PyMC / ArviZ for Bayesian/statistical workflows when a real use case requires them;
- CausalPy / pgmpy for causal/probabilistic workflows when justified;
- sktime / Darts / StatsForecast for specialist forecasting only when the canonical workflow requires them;
- Optuna / LightGBM and similar specialist ML/optimization libraries only when a concrete LiOS task benefits.

Do not stack overlapping libraries merely for breadth. Prefer one coherent engine path per authoritative workflow.

### AI / agent implementation helpers

The LiOS Conversation Runtime and BYOAI router remain authoritative. Implementation helpers may be assimilated when they reduce code:

- Pydantic AI for typed Python tool/agent helpers;
- Vercel AI SDK for streaming/tool helpers where useful;
- LiteLLM as an optional enterprise/local provider gateway only if it simplifies provider coverage without replacing LiOS policy/state;
- FastMCP for governed Python MCP server exposure;
- ToolHive / ContextForge or similar MCP gateway projects only if a centralized gateway becomes necessary.

MCP tools must remain project/tenant/permission-aware and must not expose credentials or unrestricted filesystem access.

### Workflow automation boundary

n8n/self-hosted automation remains allowed for peripheral orchestration such as monitoring glue, file movement, operational workflows and scheduled integrations.

n8n must not become the authoritative financial calculation engine, Project state store, permission system or Conversation Runtime.

### Export stack

Preserve existing export paths where stable.

Approved additions when needed:

- current XLSX/SheetJS-compatible layer for spreadsheet import/export;
- ExcelJS for richer workbook authoring if the current XLSX layer reaches a real limitation;
- jsPDF/current PDF path where stable;
- react-pdf or WeasyPrint for structured report rendering where appropriate;
- PptxGenJS for native PowerPoint/deck generation.

All exports reconcile with the live source artifact/model state.

### Additional engineering references

Continue to use useful permissive/reference implementations such as:

- virattt/dexter for research/financial-agent/tool patterns;
- anthropics/financial-services for workflow patterns;
- finance-skill repositories/case catalogs as methodology references;
- QuantConnect LEAN for quant/backtest architecture;
- PolicyEngine for future public-policy/economic simulation research only, outside the current finance-first launch scope.

No reference repository overrides LiOS canonical contracts.

## 2. Core layers

### 2.1 Experience layer

Responsibilities:

- Projects;
- chats;
- composer;
- navigation;
- adaptive artifact workspace;
- command palette;
- keyboard controls;
- branch/version controls;
- Connection Center;
- artifact viewing/editing.

It must not contain authoritative finance calculations.

### 2.2 Conversation Runtime

The Conversation Runtime is the primary orchestration layer.

It receives:

- user message;
- project ID;
- conversation/branch ID;
- active object;
- active artifact;
- selected rows/series;
- date/period;
- scenario;
- permissions;
- connected data/AI capabilities.

It produces an execution plan using explicit tools and state mutations.

#### Intent Engine

Classifies and decomposes requests into actions such as:

- resolve entity/security;
- retrieve data;
- compare;
- calculate;
- model;
- screen;
- research;
- explain;
- edit artifact;
- save;
- monitor;
- export.

Avoid a fragile keyword-only implementation. Deterministic hints can fast-route obvious finance intents, but the target is structured intent/tool planning.

#### Context Graph

Holds the currently relevant graph of:

- project;
- conversation branch;
- entities;
- securities/listings;
- portfolios;
- datasets;
- artifacts;
- assumptions;
- source preferences;
- current UI selections.

Context must be explicit and typed so “it”, “only cloud”, “five years”, “add Amazon” and similar follow-ups resolve correctly.

#### State Engine

Applies controlled state mutations to the Conversation Ledger and project objects.

Examples:

- change WACC;
- pin provider;
- remove peer;
- save scenario;
- rename branch;
- attach artifact;
- create monitor.

Mutations must be explicit, reversible where practical and auditable.

#### Workflow Planner

Creates bounded execution graphs.

Example:

```text
"Value NVIDIA and compare with AMD"
    -> resolve NVDA/AMD
    -> inspect available sources
    -> fetch canonical financials
    -> fetch market data
    -> run DCF/comps engines
    -> create comparison artifacts
    -> verify data/calculation status
    -> respond
```

The user should see a concise execution status when helpful, not hidden chain-of-thought.

### 2.3 Universal Data Router

All new data-provider work passes through a common capability and routing layer.

Inputs include:

- data family/field;
- canonical instrument/entity ID;
- time period;
- frequency;
- connected provider capabilities;
- user ranking/pins;
- entitlement;
- freshness requirements;
- cost/quota policy.

Outputs include:

- winner;
- value/series;
- source reference;
- as-of/freshness;
- alternatives/conflicts;
- attempt/failure reasons.

### 2.4 Global Entity & Instrument Master

Durable finance identity uses LiOS-owned canonical IDs.

Hierarchy:

> Entity → Security → Listing / Instrument → External identifiers → Provider mappings

External identifiers may include FIGI, Composite FIGI, Share-Class FIGI, ISIN/LEI where legitimately available, exchange/MIC and provider-specific IDs.

OpenFIGI is an identity-resolution input, not LiOS's primary database key.

Raw ticker strings must not become durable identity for new core work.

### 2.5 Deterministic Finance Engines

Authoritative numerical computation lives outside UI/LLM prompts by default.

A user may explicitly authorize the connected AI to perform a direct calculation/estimate/exploratory analysis. That path is a separate execution mode: the result must be labelled AI-derived, carry the inputs/context used, and must not overwrite or masquerade as a deterministic engine result.

Engine families include:

- valuation;
- portfolio/risk;
- fixed income;
- derivatives;
- statistics/econometrics;
- simulations;
- financial statement transformations;
- scenario/stress;
- macro/FX calculations where deterministic.

Every engine should expose:

- typed inputs;
- units;
- assumptions;
- validation;
- typed outputs;
- known-answer tests;
- error/non-convergence states.

### 2.6 AI Provider Router

The AI router is provider-neutral.

Responsibilities:

- provider/model selection;
- BYOAI credential handling;
- tool-call contract;
- context packaging;
- token/context limits;
- failover where policy allows;
- AI OFF behavior.

Supported/target provider classes include OpenAI-compatible APIs, Anthropic/Claude, Google Gemini, OpenRouter-compatible routing, local Ollama/Llama-family models, LM Studio/local OpenAI-compatible endpoints and future approved providers.

Provider examples are adapters, not architecture. Project policy may restrict cloud vs local models and whether private material may be sent externally.

AI OFF must preserve deterministic functionality.

The AI execution policy therefore supports at least:
- **deterministic-first** — use LiOS engines when available;
- **AI-assisted** — AI configures/invokes engines and interprets outputs;
- **AI-direct, user-authorized** — AI performs a clearly labelled calculation/estimate when the user explicitly permits it.

Material state changes, assumptions and external actions remain permission-governed in all modes.

### 2.7 Artifact Engine

Artifacts are typed persistent objects.

Minimum common metadata:

- artifact ID;
- project ID;
- branch/version;
- type;
- title;
- entity/object references;
- source dataset references;
- calculation/model references;
- assumptions;
- created/updated time;
- provenance/evidence pointers;
- editable state;
- export capability.

Artifacts should support conversational edits without losing their underlying structure.

### 2.8 Conversation Ledger

The Ledger stores explicit financial/workflow state rather than relying on transcript reconstruction.

Recommended logical objects:

- `ProjectState`
- `ConversationBranch`
- `EntityRef`
- `SourcePolicy`
- `AssumptionSet`
- `ArtifactRef`
- `DecisionEvent`
- `AutomationRef`
- `ExecutionReceipt`

A transcript can be retained separately; it is not the source of truth for model state.

### 2.9 Automation Engine

A successful query/workflow can become a monitor.

Automation inputs:

- workflow reference;
- trigger/schedule;
- object scope;
- source policy;
- comparison baseline;
- notification/delivery policy.

Automations must re-run deterministic tools against fresh/allowed data rather than replaying stale answer text.

## 2.10 Canonical context envelope

Every governed action should receive a typed context envelope. Conceptually:

```text
identity
  userId
  organizationId / tenantId
  roles / permissions / entitlements

scope
  projectId?
  chatId?
  branchId?
  workspaceId?

active
  objectRefs[]
  activeTool / view / action
  selection

analysis
  asOf
  period / frequency
  currency / units
  scenarioId / assumptionVersion
  benchmark / comparisonSet

policy
  permitted data connections
  field/data permissions
  AI enabled/provider/model policy
  external-action permissions
  retention/residency rules

trace
  originating message/control
  actionId
  previous context version
```

Large files, datasets and full transcripts are retrieved by reference/on demand rather than copied into every action.

The Context Engine resolves five levels: user/identity → Project → chat → workspace → exact object/version/selection, within a separate mandatory ownership/tenant/entitlement/retention envelope. Resolution precedence is explicit request/reference → explicit selection → active object → chat reference → Project defaults → user defaults. Material identity/client/Project ambiguity must be clarified, not guessed. Hidden bounded Working Context enforces scoped ownership and approved permitted-source retrieval; it is not a default visible context strip, durable memory or authorization inferred from conversational convenience.

Material context mutations use explicit transition semantics: `preserve`, `extend`, `replace`, `fork`, `clear`, `promote`, `link`.

## 2.11 Assumption dependency graph

Assumptions are versioned addressable objects.

The state layer must know which:

- models;
- scenarios;
- forecasts;
- reports;
- alerts;
- living analyses

depend on an assumption. A conversational change should show affected objects and support branch/undo behavior rather than silently rewriting every result.

## 3. Project Graph

A project should be representable as a graph:

```text
Project
  +-- Conversations
  |     +-- Branches
  +-- Entities / Securities
  +-- Files / Datasets
  +-- Artifacts
  |     +-- Models
  |     +-- Charts
  |     +-- Tables
  |     +-- Reports
  +-- Assumptions
  +-- Source policies
  +-- Decisions
  +-- Automations
```

This allows context to survive navigation and sessions.

## 4. Branching and versioning

Financial analysis frequently needs alternatives.

Branching must support:

- base/bull/bear;
- management case;
- different provider assumptions;
- alternative peer sets;
- pre/post earnings;
- different macro scenarios.

A branch inherits parent state and records deltas.

Comparison should operate on structured state, not only textual chat differences.

## 5. Data-gap engine

A missing field is a first-class state.

For each requested field/workflow, the system may return:

- available from selected provider;
- available from alternate connected provider;
- available from public/reference source;
- available from user import;
- derivable by a deterministic method;
- unavailable.

The UI must never translate “unavailable” into invented data.

The gap engine can recommend a connector or valid alternative workflow.

## 6. Capability registry

Every connector/tool/engine should advertise machine-readable capabilities.

Example dimensions:

- provider ID;
- data families;
- asset classes;
- markets/regions;
- fields;
- historical depth;
- update frequency;
- batch/search capability;
- entitlement requirements;
- credential requirements;
- quota/cost hints;
- streaming support;
- license/share restrictions.

The router uses the registry rather than hard-coded provider branches wherever practical.

## 7. Local-first boundary

Default desktop principle:

- user credentials stay in the user/device vault;
- private files/databases remain local wherever practical;
- local analytical state remains local;
- LiOS operates no customer runtime service; the only vendor-side surfaces are distribution (updates, downloads) and the licence issuing the customer imports as a file;
- remote AI/provider calls send only the data required by the requested operation and user policy.
- Home may move to the user's NAS/server/VPS/cloud and back without changing identity; replicas/outboxes never become competing state authorities or trigger a vendor runtime fallback;

## 8. Runtime/sidecars

Preserve the existing TypeScript/React + server + Python sidecar foundations.

Python/runtime packs remain capability-scoped. Network-access/community data packs require explicit policy/consent where applicable.

Focused sidecars/runtime services may exist behind LiOS contracts when they provide a justified capability. OpenBB is specifically excluded and was removed under LIOS-P0-01; the regression guard must continue to reject its reintroduction.

## 8.1 Desktop/runtime footprint

The desktop should remain practical on ordinary professional laptops.

- managed Python runtime installs **core first**, optional packs on demand;
- do not bundle large local LLM weights;
- do not download giant instrument universes at startup;
- use local caches with explicit size/retention controls;
- native/heavy dependencies must be justified by real engines;
- packaging must support macOS arm64/x64 and Windows x64 according to the runtime/release manifest;
- release builds should use reproducible/pinned/verified artifacts and signed installers;
- native-module ABI reproducibility (for example `better-sqlite3`) is a release gate, not a developer-machine workaround.

## 9. Observability

Failures must be diagnosable without cluttering normal UX.

Track internally:

- connector health;
- provider latency/rate limit;
- data freshness;
- router attempts;
- engine failures/non-convergence;
- AI provider/tool failures;
- artifact generation failures;
- automation failures;
- release/runtime health.

Normal screens show only actionable failure state. Detailed diagnostics live in Connection Center / Advanced / support surfaces.

## 9.1 Intelligence services layered above governed data

Advanced intelligence services should be composed over existing context/data/engine contracts:

- Reactive Context Graph;
- Deterministic Insight Compiler;
- Delta / What Changed engine;
- Time Machine / point-in-time comparison;
- Scenario propagation and branch diff;
- validated formula service;
- Research Graph.

These services consume governed snapshots and deterministic engine outputs. They must emit **no result** when evidence is insufficient rather than filling gaps with inferred observations.

They are not allowed to create a second state store, provider router, model engine or context system.

## 10. Security rules

- credentials never appear in model context or logs;
- connector URLs/redirects require SSRF-safe handling;
- tenant/user authorization remains separate from persona;
- actions with external side effects require explicit authorization semantics;
- provider licenses/entitlements are respected;
- client builds must not expose internal-only capabilities;
- imports and generated outputs must preserve isolation;
- AI cannot bypass deterministic/data permissions.

## 10.1 Performance architecture

The conversational UX is only successful if the terminal remains fast.

Use these defaults:

- visible-first progressive loading;
- route/feature lazy loading for heavy analytical libraries;
- cache canonical data/results with explicit freshness policy;
- prefetch only likely next destinations and respect save-data/slow-network conditions;
- virtualize large tables/lists;
- isolate expensive rerenders by pane/artifact;
- move heavy pure computation to workers/sidecars when appropriate;
- stream long research/execution progress without blocking the main UI;
- cancel stale requests when context changes;
- preserve offline/restored project state even when live providers are unavailable.

Performance budgets must be measured in packaged desktop builds, not assumed from development mode.

## 11. Engineering migration rule

Do not rewrite working systems wholesale.

For new architecture:

1. define typed interface;
2. adapt existing implementation;
3. migrate one vertical slice;
4. prove behavior and tests;
5. expand;
6. remove old path only when no active consumer remains.

The target architecture is reached by convergence, not restart.

<!-- LIOS-FINAL-2026-09-21-ARCH -->
## Final 2026-09-21 architecture expansion lock

This section extends the canonical architecture with the final research findings. Existing stronger LiOS contracts remain authoritative; the additions below are implemented behind those contracts rather than replacing them.

### Architecture invariant

The permanent execution shape is:

**React experience → validated preload/IPC → LiOS Core Runtime → LiOS-owned capability contract → adapter → provider/engine/sidecar**

The renderer must never directly own privileged provider credentials, Python finance engines, brokerage/exchange credentials, arbitrary plugin processes or unrestricted filesystem/network access.

### Canonical capability contracts

The implementation must converge on explicit interfaces/contracts for:

- AIProvider;
- DataProvider;
- Connector;
- Tool;
- Agent;
- Artifact;
- BacktestEngine;
- FinanceEngine;
- Workspace/Session;
- Job/Run;
- Permission/Action policy;
- Plugin/Runtime Pack.

Adapters may change. The contracts and Project state remain stable.

### Expanded OSS donor/runtime matrix

The existing donor matrix is expanded with the following candidates. Exact repository commit, license, bundled assets and transitive obligations must be re-verified at assimilation time.

| Candidate | Posture | Intended LiOS role |
| --- | --- | --- |
| TauricResearch/TradingAgents | Apache-2.0 at current verification | High-priority finance-agent donor/runtime: market/fundamental/news/sentiment analysts, researcher debate, trader/risk/portfolio roles, structured outputs, checkpoint/resume, provider/data-vendor abstractions and point-in-time/backtesting patterns. Wrap behind LiOS Agent Runtime and data contracts. |
| virattt/dexter | README states MIT (2026-09-30) but the repository has **no LICENSE file**, so no copyright notice text exists to preserve | **REFERENCE only.** Iterative finance-research planning and tool-use patterns. Do not import code unless the author publishes a LICENSE file; re-verify at assimilation. |
| ginlix-ai/LangAlpha | Apache-2.0 at current verification | Persistent research workspace, skills, subagents, tool discovery, file/research context and financial research workflow patterns. |
| YUHAI0/fin-agent | MIT at current verification | Natural-language finance workflow patterns, indicators, screening, portfolio/backtest interactions and desktop agent UX references. |
| tripolskypetr/backtest-kit | MIT at current verification | Candidate **Standard Backtest Runtime** for lightweight TypeScript/Electron strategy research. Must implement BacktestEngine rather than leak package types into canonical Project state. |
| QuantConnect/Lean | Apache-2.0 | Candidate **Advanced Quant Runtime Pack** for deep multi-asset backtesting/execution after the BacktestEngine contract is stable. |
| Dockview OSS | MIT, pinned 8.3.1 | Current-main Living Workspace geometry renderer behind LiOS-owned state and permissions. FlexLayout is rejected/not installed. Keep packaged-Electron accessibility, persistence, startup/memory and interaction evidence open until measured; do not treat source acceptance as release proof. |
| microsoft/monaco-editor | MIT | Strategy/Formula/SQL/code editor surface behind controlled execution/validation boundaries. |
| ggml-org/whisper.cpp | MIT | Optional local Voice Runtime Pack candidate; never a base-app requirement. |
| profullstack/hqtui | MIT | CLI/diagnostic/headless terminal surface only; not a browser/React desktop renderer. |
| Pydantic AI | MIT | Typed Python agent/tool implementation helper where it reduces sidecar code. |
| LangGraph | MIT | Optional graph/checkpoint orchestration helper where useful; never authoritative Project state or permission policy. |
| Shubhamsaboo/awesome-llm-apps | Apache-2.0 at commit `4bf51ab7` (2026-09-30 review) | **REFERENCE + selective ADAPT.** Earnings-call analyst card design (quote-anchored insight events with severity, confidence and citations; boilerplate filtering) and the agent-skills evaluation method for the H0 harness. Deep-research and dashboard-canvas agents are interaction-pattern references for H3/H4. Reject its YouTube ingestion (terms-of-service risk), its Google ADK / Agno / CopilotKit runtimes, its investment-simulator buy/sell demo and its LLM-authored-number finance wrappers. |
| vercel/ai-elements | Apache-2.0 (LICENSE verified 2026-09-30) | **ADAPT candidate** for H2/H4 chat and artifact UI primitives (messages, reasoning/plan, sources, tool cards, artifact frame) behind LiOS-owned state; complements assistant-ui/tool-ui. Retheme to the locked LiOS dark tokens. |
| vercel/chatbot | Apache-2.0 (LICENSE verified 2026-09-30) | **REFERENCE** for streaming chat, artifact side-panel and resumable-stream patterns. |
| AI4Finance-Foundation/FinRobot | Apache-2.0 | **REFERENCE** for equity-research report structure and financial chain-of-analysis prompts feeding H6 report templates. |
| virattt/ai-hedge-fund | MIT | **REFERENCE** for investor-lens checklists as *analysis views* only. Its trade signals and any execution are out of scope (no brokerage execution or copy trading). Output must be labelled AI-derived. |
| microsoft/markitdown | MIT | **CANDIDATE library** in an isolated runtime pack for Office/PDF-to-markdown ingestion of uploads; Docling remains the primary document-intelligence engine. |
| dcajasn/Riskfolio-Lib | BSD-3-Clause | **REFERENCE/validator** for portfolio-risk conventions; skfolio remains the primary optimization engine (one primary engine per capability). |
| LibreChat, CopilotKit / AG-UI | MIT | **REFERENCE** for chat UX (branching, presets, artifacts) and agent-to-UI event streaming; LiOS keeps its own Conversation Runtime event contract. |
| Open WebUI, Dify, Onyx `ee/` | Custom / modified-Apache / enterprise terms | **REJECT** for code reuse (branding, multi-tenant or enterprise-license restrictions). |

These additions complement, rather than replace, assistant-ui, tool-ui, OpenTerminalUI/OpenTerminal donors, Univer, Perspective, DuckDB, Arrow, ECharts, Tiptap, skfolio, CVXPY, QuantLib, EdgarTools, Arelle, Docling, sqlite-vec, OpenTelemetry/OpenLineage and other existing approved components.

### Living Workspace architecture

The Experience Layer gains a formal Living Workspace service.

Responsibilities:

- panel/dock layout model;
- open/close/focus actions;
- artifact-to-panel mapping;
- linked symbol/entity/context groups;
- saved views;
- restore after restart;
- session/branch-specific layout state;
- direct manipulation events;
- keyboard/command routing;
- safe AI-requested workspace actions.

Workspace layout state is data, not an implementation side effect. It belongs in Project/session persistence and must survive renderer reload/restart.

The layout manager is replaceable behind a LiOS WorkspaceAdapter. Dockview OSS is the current-main renderer; FlexLayout is not a parallel candidate or dependency. Replace Dockview only through a measured, user-visible defect or a packaged acceptance failure, with LiOS Project/Session state remaining canonical.

### Session model

A Session is a typed, forkable Project state boundary containing references to:

- chat/conversation branch;
- workspace layout;
- active entities/securities;
- source policy;
- artifacts/models;
- assumptions/scenario values;
- selected datasets;
- strategy/backtest configuration;
- execution/run references;
- parent session/branch lineage.

Session forking must use the same controlled copy/reference semantics as artifact/model branching. Secrets and provider credentials are never duplicated into session payloads.

### Artifact schema expansion

Artifact base contracts must support the expanded classes defined in the Master Plan, including BacktestArtifact, StrategyArtifact, TimelineArtifact and DecisionArtifact.

Base metadata should include:

- stable ID;
- artifact type/schema version;
- Project/session/branch references;
- source lineage;
- calculation/engine receipt where applicable;
- assumptions/input references;
- permissions;
- supported actions;
- revision/history references;
- renderer schema/version.

Renderer components consume artifact schema; agent/provider code does not inject arbitrary React.

### Interactive object/action protocol

Direct manipulation should emit typed actions through the same runtime used by conversation.

Examples:

- InspectSource;
- ComparePeers;
- ChangeAssumption;
- RunValuation;
- RunBacktest;
- CreateScenario;
- ForkSession;
- OpenArtifact;
- OpenPanel;
- FocusTimelineEvent;
- SaveWorkflow.

The runtime re-resolves context and permissions before execution.

### Agent Runtime architecture

The canonical Agent Runtime owns:

- role registry;
- task decomposition;
- tool exposure;
- model/provider selection;
- context packaging;
- execution budget/timeouts;
- checkpoint/resume where supported;
- cancellation;
- result normalization;
- artifact/action emission;
- permission escalation;
- execution receipts.

Specialist agent roles may be implemented by LiOS code or adapters around TradingAgents, Dexter, LangAlpha, Fin-Agent or later frameworks.

The user sees one LiOS assistant. Framework-specific identities are not product primitives.

### BYOAI router

Ollama is optional.

AIProvider implementations may include cloud APIs, OpenAI-compatible endpoints, enterprise gateways, local endpoints and local runtimes. Provider selection is Project-policy aware.

Project policy may restrict:

- allowed providers/models;
- whether files may leave the device;
- whether raw data may leave the device;
- local-only execution;
- tool calling;
- retention-compatible providers.

No provider owns or stores canonical LiOS Project state.

### BacktestEngine abstraction

Backtesting must not be hardwired to LEAN or any JS package.

BacktestEngine should expose stable concepts such as:

- strategy specification/reference;
- universe/instruments;
- time range/frequency;
- capital/portfolio state;
- fees/slippage assumptions;
- signals/orders/fills;
- performance series;
- trade list;
- metrics;
- benchmark;
- walk-forward/parameter run metadata;
- reproducibility receipt.

Initial candidate mapping:

- Backtest Kit → Standard Backtest Runtime;
- LEAN → Advanced Quant Runtime Pack.

BacktestArtifact consumes normalized output.

### Strategy/Formula execution boundary

Monaco may provide the editor, but code execution is a separate controlled runtime.

Generated/user strategy code must pass:

- syntax/schema validation;
- supported-language/runtime checks;
- filesystem/network restrictions;
- package/import policy;
- time/memory limits;
- user permission;
- deterministic seed/configuration where applicable.

Formula Studio remains a deterministic expression path and must not silently become arbitrary code execution.

### Local data architecture

For large analytical workloads, the preferred path remains:

**connector/import → canonical normalization → Arrow/Parquet where useful → DuckDB/Polars/Python analytical layer → LiOS Data API → Artifact**

Do not move large tables through React component state when a query/virtualized artifact can operate on a local analytical engine.

### MCP architecture

LiOS MCP support is bidirectional but governed.

**MCP client mode**
- consume approved resources/tools;
- bind each server to Project/tenant/permission policy;
- vault credentials locally;
- restrict filesystem/network/tool capabilities.

**MCP server mode**
- future capability;
- expose only explicitly approved LiOS tools/data;
- preserve Project scope, tenant boundary, data entitlements and audit/receipts;
- never expose raw secret stores or unrestricted local filesystem.

MCP is an interoperability protocol, not a bypass around Connector/Tool/Permission contracts.

### Browser automation runtime

Playwright/web automation runs in a dedicated process/connector boundary with:

- domain allow policy;
- request/download controls;
- timeout/resource ceilings;
- filesystem sandbox;
- Project permission;
- execution receipt.

Never give arbitrary web automation direct Electron renderer privileges.

### Plugin and SDK architecture

Plugin manifests declare:

- id/name/version;
- publisher/signature when supported;
- runtime;
- permissions;
- required capabilities;
- provided tools/connectors/artifacts/agents;
- network/filesystem requirements;
- dependencies.

Plugin code with privilege requirements runs outside the untrusted renderer. The long-term public ecosystem may expose Connector SDK, Tool SDK, Artifact SDK and Agent SDK, but marketplace distribution is gated on signing/trust/revocation/update controls.

### Runtime Pack architecture — P11 Hidden Engine Fabric

Base LiOS remains usable with Core only. P11 extends the existing `runtime_pack`, RuntimeRegistry and `MANAGED_RUNTIME_MANIFEST` foundations into a real internal pack operating system.

Canonical flow:

```text
Project / Conversation / Artifact request
        |
capability + context + permission
        |
LiOS Capability Router
        |
primary / validator / fallback selection
        |
Hidden Engine Pack
        |
LIBRARY | VENDOR | SIDECAR | CONNECTOR
        |
canonical result + receipt
        |
Artifact / Ledger / Show Work
```

Target pack families:

- Core Finance;
- Portfolio;
- Pricing & Risk;
- Quant & Forecast;
- Strategy & Backtest;
- Research & Documents;
- Data Lab;
- Market Data;
- Broker & Execution — candidate naming for governed market/account-data adapters only in current scope; no brokerage writes or copy trading;
- Reporting & Modeling;
- Local AI.

#### Pack ownership

LiOS owns:
- pack manifests and compatibility;
- capability names/routing;
- permissions and secret handles;
- sidecar lifecycle;
- data-plane handles;
- result schemas;
- health/update/rollback;
- OSS governance.

Donors never own Projects, chats, Sessions, Ledger, Artifacts, canonical identity, source policy or commercial entitlement.

#### Integration modes

Every imported project has exactly one current posture per subsystem:

- **LIBRARY** — pinned dependency inside an isolated pack;
- **VENDOR** — copied permissive source behind LiOS interfaces;
- **SIDECAR** — separate supervised local process;
- **CONNECTOR** — Provider/Connector SDK path;
- **REFERENCE** — benchmark only;
- **REJECT** — do not ship.

There is no production "adapt later" state.

#### LiOS Engine Protocol

Default sidecar control plane is versioned NDJSON over owned stdin/stdout. It includes handshake, capabilities, health, execute, progress, result, error, cancel, diagnostics and shutdown.

Large data uses a separate data plane:
- Arrow IPC;
- Parquet;
- DuckDB/local analytical handles where safe.

Do not push multi-million-row finance datasets through JSON.

#### Runtime isolation

Python pack environments are isolated and reproducibly locked; P11 evaluates `uv` as the environment/build manager. Native/JVM/.NET engines remain separate sidecars where appropriate. A pack crash must not crash Electron or mutate canonical Project state.

#### Pack artifact/trust

A first-party `.lios-pack` is a deterministic signed archive carrying:
- manifest;
- adapter/runtime payload;
- schema metadata;
- SBOM;
- notices;
- hashes;
- signature.

Install new versions beside the active version, health-check before activation and retain a known-good rollback target.

#### Capability routing

Each capability declares:
- primary engine;
- optional validator;
- optional fallback.

Validators are used deliberately for release/high-materiality/anomaly checks. LiOS never silently averages disagreeing engines.

#### Pack security

Pack manifests declare network/filesystem/secret/process/GPU/external-side-effect permissions. Default deny unnecessary privilege. Credentials remain in LiOS custody and packs receive narrow secret handles/operations rather than vault dumps.

#### P11 references

- `docs/technical/P11_ENGINE_FABRIC_SPEC.md`
- `docs/technical/P11_OSS_CANDIDATE_MATRIX.md`
- `third_party/p11-candidates.json` — proposal-only machine-readable candidate inventory; not a bundled-component declaration

Voice/multimodal remains P12. Public Plugin/SDK ecosystem work remains P13; P11 packs are first-party curated/signed internal runtime units, not arbitrary third-party plugins.

### Voice architecture

Voice input is an adapter to Conversation Runtime.

Pipeline:

**audio → permitted transcription provider/local pack → transcript → normal context/intent/tool runtime → artifacts/actions → optional speech output**

Voice never bypasses permissions or invents a parallel command system.

**P12 implementation status — 2026-09-25:** The active Connection Center now mounts local Voice Runtime setup from the #59 baseline. The conversation implementation preserves voice transcript evidence through the editable composer and enforces server-derived review requirements in authenticated Project/Quick and Temporary execution routes before Project persistence or execution. Project chat also provides governed picker/drop upload, private Project Resource storage, runtime-only bounded content extraction, policy-aware AI transmission and saved-message download references. Raw voice audio is not persisted. Source acceptance is not release acceptance: packaged voice walkthrough, real local-runtime benchmark/clean-machine evidence, attachment restart/reopen/error UX and explicitly authorized live-provider vision acceptance remain open. See `docs/technical/P12_VOICE_MULTIMODAL_SPEC.md` and `npm run acceptance:p12`.


### Observability and Show Work

OpenTelemetry-style local spans/events should cover, where practical:

**request → context resolution → plan → tool/connector/provider → data normalization → finance/backtest engine → artifact mutation/export**

Default telemetry is local/redacted. This execution graph supports diagnostics, performance, reproducibility and user-facing Show Work without exposing hidden chain-of-thought.

### Portable Project/Session package

Portable export should contain a versioned manifest and permitted:

- Project/session metadata;
- artifact/model definitions;
- assumptions;
- local data snapshots explicitly included by the user;
- research notes/evidence references;
- workflow definitions.

Never include secrets, API tokens or OS-vault material. Import re-validates connector entitlements, package schema version, permissions and unavailable external dependencies.

### Security action classes

The runtime standardizes action policy into categories equivalent to:

- SAFE_AUTO;
- USER_CONFIRM;
- ADMIN_CONFIRM where organization policy requires it;
- DENIED.

Opening/focusing permitted local Artifacts can be safe. Material writes, external side effects and provider mutations require their exact-operation policy. Brokerage execution, exchange order/account writes and copy trading are prohibited in current scope, regardless of connector/pack names or confirmation availability. A future order/write tier requires a separate owner-approved controlled design; existing action classes do not authorize it.

### CLI boundary

An optional CLI may use HQTUI or ordinary terminal rendering for operations such as:

- status;
- doctor;
- connectors;
- runtime packs;
- logs;
- agent/job status;
- data diagnostics.

The CLI calls the same LiOS Core APIs and must not become a separate authority.

### Architectural definition of done for imported OSS

A donor/runtime is accepted only when:

1. exact upstream repository/commit and paths are recorded;
2. license/notice/assets/service/data rights are reviewed;
3. canonical LiOS contract adapter exists;
4. secrets/permissions are mapped;
5. tests cover real behavior and failure states;
6. packaged Electron/runtime behavior is verified;
7. numerical/data correctness gates apply where relevant;
8. upstream cloud dependencies are optional or removed;
9. footprint/startup/resource cost is measured;
10. removal/replacement does not require rewriting Project/Artifact state.

## P3 canonical architecture — Conversation Ledger and reproducibility

P3 adds a durable evidence plane without changing P1/P2 ownership boundaries.

    Persistent Project / Quick Chat
            |
            v
    P2 Conversation Runtime or P1 Session mutation
            |
            v
    tenant + Project/chat/session scope validation
            |
            v
    credential-safe canonical payload
            |
            v
    Ledger stream sequence reservation (transactional)
            |
            +--> typed event + lineage graph
            +--> reproducibility receipt / change receipt
            |
            v
    SHA-256 previous-hash -> event-hash -> stream head
            |
            +--> Project History / Show Work
            +--> branch/common-ancestor comparison
            +--> inverse mutation + state.reverted
            +--> portability manifest

### P3 invariants

1. **Append-only evidence:** application services do not update or delete Ledger event rows. A correction or Undo creates a new event.
2. **Atomic state + history:** Session create/update/archive/restore/fork and their Ledger event are committed together where the state mutation occurs.
3. **Ordered integrity chain:** each Project/Quick stream reserves a monotonically increasing sequence and binds the new event to the prior head hash. Verification recomputes the full chain. This is integrity evidence, not independent notarization or protection against a privileged rewrite of the entire history.
4. **Tenant isolation:** every persisted event is bound to the authenticated owner/organization and validated against its Project/chat/session before append or read.
5. **Credential exclusion:** Ledger canonicalization recursively redacts credential-shaped fields. Portability manifests contain references and hashes, never secret material.
6. **Evidence, not hidden reasoning:** Show Work contains observable sources, inputs/hashes, assumptions, formulas, engines, timestamps, warnings, lineage and AI attribution. It does not expose private chain-of-thought.
7. **AI attribution is non-ambiguous:** a result cannot be simultaneously deterministic and AI-direct. AI-assisted/direct evidence remains explicitly labelled.
8. **Replaceable execution:** P2 tools/agents/providers remain behind LiOS contracts. The Ledger records normalized evidence and never becomes provider- or donor-framework-owned.
9. **Session graph before Artifact graph:** P3 records Session ancestry and future artifact-version references. P4 remains authoritative for persistent Artifact versions.
10. **Portable manifest before portable package:** P3 defines and hashes the credential-free manifest. P4 may package permitted artifacts/data around that manifest and must revalidate entitlements on import.

The lineage vocabulary is intentionally compatible with useful OpenLineage-style concepts, but LiOS owns the schema, storage, permission boundary and product semantics.

## P4 Artifact Operating System implementation lock — 2026-09-22

The canonical Artifact stack is now:

> **Project → Conversation/Direct UI → Artifact identity → immutable ArtifactVersion → interaction receipt → P3 Ledger/lineage**

### Canonical ownership

LiOS owns Artifact identity, typed content, version numbers, source/receipt/assumption refs, fork ancestry, proposals, references and portability. Renderer/editor/query libraries are replaceable adapters and never own Project state.

The fourteen canonical P4 Artifact kinds are Chart, Table, Screen, Valuation, Portfolio, Research, Report, Spreadsheet, Data, Backtest, Strategy, Decision, Timeline and Thesis. `src/shared/artifactContracts.ts` is the authoritative serialized kind/action schema; the older runtime Artifact envelope imports it. Company/Metric/Risk/Scenario/Workflow and other richer product concepts do not create additional serialized kinds merely by appearing in prose.

### Persistence and mutation

`project_artifacts` stores mutable identity/head/status metadata. `project_artifact_versions` stores immutable content versions with SHA-256 content hashes, adapter id, source refs, execution receipt refs and assumption refs. Head advancement uses an expected-base-version predicate to fail closed on concurrent edits.

Conversation output currently enters this durable stack through explicit Keep in `ProjectExperienceShell.tsx` (`keepArtifact`, wired as `onKeepArtifact`). Required automatic persistence of meaningful Project output remains pending TC-13/P4 integration; Quick/Temporary work must still explicitly select a Project destination. Database/version authority does not establish automatic saving or passing SP evidence.

Material AI/conversation edits do not mutate content directly. They create `project_artifact_proposals`; acceptance atomically claims the proposal, advances the Artifact head, inserts the immutable version, records an interaction receipt and appends P3 Ledger evidence. Reject leaves canonical state unchanged. Undo is compensating version creation, never history deletion.

### Adapter boundary

The desktop preserves existing native paths where strong and adopts real CA renderers behind the same authority:
- Spreadsheet: integrated Univer OSS editor via the P4 revision API, with LiOS SpreadsheetGrid/formula/XLSX paths retained as fallback/import/export infrastructure;
- Data: DuckDB/Parquet columnar store + bounded native paging;
- Charts: Lightweight Charts/Recharts;
- Documents: LiOS block editor.

Univer is partially integrated, not bridge-only: its recorded real-server and unsigned packaged macOS-arm64 editor/CSP evidence is bounded in §1.7. Perspective, ECharts, Tiptap and TanStack Virtual projections/bridges or pins are not evidence of their full donor runtime adoption. SI-04 requires real package/import/provisioned user behavior and citation-preserving edit/export/reopen/round-trip journeys under P4. Lazy loading and built-in fallback preserve usability but cannot stand in for missing donor integration or professional-output acceptance.

### Portability and security

Artifact packages are versioned, hashed and credential-free by contract. Content and provenance refs are rejected when credential-shaped material is detected. Import verifies package/content hashes, revalidates source entitlements, remaps Session ids, Artifact ids and fork ancestry, and deliberately does not reuse deployment-local chat/resource ids.

### Reproducibility

Artifact versions retain source refs, execution receipts and assumption refs. Session references persist exact `artifact:<id>@vN` provenance into the P3 Session state/change graph. The P3 Ledger remains the historical evidence authority; P4 does not introduce a competing lineage store.

## P5 Universal Data Fabric & Semantic Finance implementation lock — 2026-09-22

The canonical data path is:

> **Project/Data Request → Provider Registry/SDK → entitlement + quota + point-in-time policy → provider observation or structured gap → normalization/mapping → quality/semantic layer → lineage → engine/artifact/export**

### Provider and identity ownership

LiOS owns the Provider SDK contracts, provider ordering, cache/prefetch state, mappings, semantic metrics, lineage and gap semantics. A provider library or donor terminal never becomes authoritative Project state.

Instrument identity remains **Entity → Security → Listing → identifiers/provider mappings**. OpenFIGI is a governed v3 identity-enrichment adapter using the user's key from credential custody. OpenFIGI/SEC federated hits remain provisional until linked to canonical LiOS identity.

### Coverage and scalability

Coverage and scalability are intentionally separate measurements. `realUniverseSize` measures unique real local candidates after deduplication; `capacityProofSize` records the canonical index stress proof. P5 validates 120k-candidate index capacity with a p95 target while refusing to market that capacity as bundled coverage.

### Point-in-time and no-fabrication policy

Every canonical request declares point-in-time mode. Adapters that cannot satisfy `as_known_on` or exact revision are skipped rather than silently substituting latest data. Backtests reject latest-only semantics and historical research requires publication/availability evidence when using as-known-on mode.

If no allowed provider can satisfy the request, the output is a typed Data Gap, never a fabricated value.

### Connector convergence

User sources converge behind the same SDK:
- built-in/public/keyed APIs and OAuth-backed sources;
- REST, GraphQL, SOAP and OpenAPI discovery;
- local JSON/NDJSON/CSV/TSV/Parquet files;
- read-only PostgreSQL/MySQL/SQLite/DuckDB;
- cloud/object storage;
- governed external MCP tools/resources.

Confirmed field mappings are versioned. Suggested mappings are advisory until explicitly confirmed.

### High-volume and optional runtimes

Core retains the already-shipped DuckDB/Parquet path and lightweight WebSocket runtime. Playwright, Arrow and Polars are optional measured runtime-pack candidates. The external MCP client uses the LiOS security/endpoint/credential boundary and does not require a mandatory MCP SDK package.

### Persistence and tenant isolation

Coverage snapshots, semantic metric definitions, lineage receipts, confirmed mappings and external-rights assessments are durable P5 state. User-owned PostgreSQL deployments apply user + organization RLS; this is not a LiOS-hosted customer runtime. Credentials remain references to custody, never portable/raw data fields.


## 1.1.13 P13 governed plugin and SDK boundary

P13 extends the existing RuntimeRegistry rather than creating a second extension registry. Public plugin packages declare a versioned LiOS manifest and contribute ConnectorAdapter, ToolAdapter, ArtifactRendererAdapter and AgentAdapter implementations through the P0 runtime contracts.

Executable or privileged plugins require trusted signatures and run outside the renderer. The Node host uses the Node Permission Model for filesystem isolation, preloads a locked core-network guard because Node permissions do not govern sockets, denies direct child-process execution in that host, and brokers permitted HTTP(S) through explicit LiOS host allowlists. Installation is transactional and removal unregisters contributed runtime components without rewriting canonical Project, Conversation, Session or Artifact state.

LiOS MCP server mode exposes only canonical RuntimeRegistry tools that are explicitly listed in the MCP exposure contract, rights-cleared for external use, tenant/project scoped and user-approved. Filesystem, secret and internal-state exposure remain disabled by contract.
