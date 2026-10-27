# LiOS — Whole-Product Intelligence Experience Architecture
**Date:** 27 October 2026
**Decision type:** owner-requested long-horizon product design and code-first integration proposal.
**Status:** proposed, not implemented. Standalone design reference *inside* existing SI-06/SI-07, TC/GM/CA/P2/P3/P4/P5/P9/P11/P13 work; not another canonical roadmap or new product.
**Parent plan:** [Rich Intelligence Experience](LIOS_RICH_INTELLIGENCE_EXPERIENCE_2026-10-27.md); [20-site donor audit](LIOS_20_SITE_PREMIUM_DONOR_AUDIT_2026-10-27.md).
**Authority:** `AGENTS.md`, `docs/PENDING_WORK.md`, `docs/LIOS_UX_SYSTEM.md`, existing SI-07 and P14 gates, hard $0 beta release constraint.

## 1. North star: one durable intelligence environment

LiOS is not a dashboard, professional finance terminal, chat wrapper, Figma demo, research-only product, news feed or set of separate vertical apps. It is a **local-first, user-owned, multi-domain intelligence operating environment** that turns **question → authorized sources → verified synthesis → interactive exploration → models/decisions → reviewed actions → durable professional outputs → monitoring/relearning** into one uninterrupted journey. It covers finance, healthcare/life sciences, energy/climate, infrastructure/mobility, technology/AI, consumer/tourism and cross-domain policy research. Capabilities may vary by legally connected sources and local hardware; no automatic proprietary-data parity claim.

**Design rule:** a single **LiOS Workspace** with adaptive presentations, not new permanent navigation or new product modes. Users recognize the same **Project, Chat, source/evidence, entity, Artifact, workflow, agent run and permission scope** no matter what renderer or donor code displays them.

There are three contextual presentations:
- **Discover:** editorial media/story/timeline/What Changed/watchlist, meaningful negative space and strong previews, anchored to the existing Home/Chat/Project.
- **Investigate:** interactive split focus of source/explanation + map/graph/chart/timeline/comparison, context-preserving P4 sidecar and evidence panel; not another data product.
- **Work:** professional calm chat/composer, models, data tables, editable documents, automation review and governance; advanced Workbench only when deliberately entered.

These are **presentation modes, not durable routes or sidebar items**. Context follows intention. Default to clean readable screen, not a giant dashboard or a permanently busy feed. User can control Comfortable/Compact/Focus and full keyboard access.

## 2. Evidence from actual LiOS source, and specific seams

Direct inspection of current public code (not exclusively docs):
1. `src/shared/waveDContracts.ts`: typed card kinds, `PulseEvidence`, `PulseCardDraft`, scorer and What Changed; `src/server/waveDRoutes.ts` + `waveDIntegrations.ts`: source-aware route and constrained optional BYOAI. **Gap:** story identity, human-readable scope, rights-aware media, provenance in visual templates.
2. `src/client/src/components/terminal/FusionPulseBoard.tsx`: working four channels and market context; its **locally defined `PulseCard` is narrower than canonical Wave D**, omitting source/evidence/action fields. **Gap:** source-loss at view-projection seam and heavily market-centric visual affordances. Do not duplicate backend.
3. `src/client/src/components/panels/NewsPanel.tsx` + `src/client/src/lib/finance.ts`: text-led news, filtering, article; `src/server/geminiNewsService.ts` uses existing RSS parsing; `src/server/gdeltData.ts` throttles/caches media data. **Gap:** trustworthy, rights-aware image handling and cross-domain clustering; not a reason to install a new cloud RSS platform.
4. `src/client/src/components/terminal/GraphExplorer.tsx`: cross-domain entity/object relation renderer uses **trigonometric fixed positions**, 120-object cap, plain SVG edges; has tiny `text-[7px]`–`text-[10px]` UI. **Gap:** performant pan/zoom/focus/accessible labels/inspectable weighted and temporal edges; preserve existing relation/evidence authority.
5. `src/client/src/components/terminal/ImpactMap.tsx` is scenario-impact UI, `CoverageMapPanel.tsx` is source coverage; neither is a geographic event atlas. **Gap:** true sourced location renderer, map tile/rights.
6. `ChatSourcesControl.tsx` already consults canonical source registry; `WorkSearchDialog.tsx`/`CommandBar.tsx` already own search/commands; `ChatTerminalSurface.tsx` exposes a fixed **“Finance terminal”** label. **Gap:** discover multi-domain tools and source setup inline without second search or returning users to a finance-only product mental model.
7. `EvidencePrism.tsx` already inspects P3 claims/assumptions/source rights; `ProjectContinuityPanel.tsx` already has retained change snapshots. **Gap:** convert them into natural Claim Lens/Evidence Time Machine UI with present-and-past sources.
8. `ConversationArtifactSidecar.tsx` delegates editing to P4; `src/shared/artifactAdapterRegistry.ts` already has multiple chart/document/table projections. **Gap:** dynamic but approved typed visual cards, and repeated presentation across Chat → Workbench → export.
9. `ProjectAutomationPanel.tsx` uses existing P9 definitions/runs/history and explicit manual run/attempt review. `src/shared/schemaAutomation.ts` models durable workflows. **Gap:** translate monitor intent into *reviewable drafts* in context, never second scheduler.
10. `connectorPluginService.ts` has local plugin discovery; `src/shared/pluginSdk.ts`, `p13ExtensionContracts.ts` have manifest and trusted-extension preview/consent. `ConnectorRegistryPanel.tsx` differentiates catalog-only/adapter-ready/configured/live-verified/degraded. **Gap:** concise contextual plugin/install/verify UX and functionality truth, not more connector forms.
11. `src/server/agentLoop.ts` is already bounded and permissioned with validated model plans/checkpoints; `src/server/aiMemory.ts` has canonical durable memory; devices settings include pairing, homes and reviews. **Gap:** expose understandable plans, trust and completion receipts and restore state across available devices.
12. `TerminalUxSettings.tsx` already contains experience/density/comfort/focus options. **Gap:** simplify default surface and preference disclosure; don't create infinite new theme toggles.
13. `src/remotion/DemoVideo.tsx` has hard-coded sample market values/headlines: **illustrative only**, not factual F11 source-based briefing. Current Remotion licensing must be specifically validated for business/redistribution before production dependency.

**Trust classification:** these are source findings, not evidence of installed UX or complete production performance. PR #223 theme, #226 quiet Home, #227 navigation, #225 plugin discovery, #228 zero-cost beta, and #229 experience plan are contemporaneously open. Recheck at edit time, do not blindly overwrite.

## 3. Competitor benchmarks and honest product positioning

All competitor facts are descriptions from public product materials; **not hands-on numerical UX scores**.

| Product | User-proven interaction strength | What LiOS should imitate technically | Where LiOS might differentiate if executed |
| --- | --- | --- | --- |
| Bloomberg Terminal + ASKB | integrated sourced news, data, analytics, alerts and conversational market work (https://professional.bloomberg.com/products/bloomberg-terminal/ai) | story→chart→document/valuation action, keyboard efficiency | legal BYOD cross-domain breadth, data ownership, explainable work; **not Bloomberg proprietary coverage** |
| LSEG Workspace AI Search | trusted natural language across market data, research/news and citations (https://www.lseg.com/en/data-analytics/products/workspace/updates/act-with-the-same-confidence-at-a-new-speed-introducing-lseg-workspace-ai-search) | cross-source entity-aware results with transparency | open provider assembly and local-first execution |
| AlphaSense Generative Search/Workspaces | agentic multi-source research, document organization, outputs and monitoring (https://www.alpha-sense.com/platform/; https://help.alpha-sense.com/hc/en-us/articles/51087728136979-Getting-Started-with-Workspaces) | persistent research investigation with cited work products | shared P4 Artifacts + P9 monitoring + user-controlled provider/model |
| Palantir AIP/Ontology | data/logic/action linked in decision workflows with approvals (https://www.palantir.com/docs/foundry/platform-overview/overview) | source→entity→scenario→reviewed workflow→receipt | local-first modular, user-owned rather than centrally managed enterprise data |
| TradingView Supercharts | deeply interactive charting, linked layouts, replay, alerts (https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/) | user-adjustable chart/graph/map comparisons and synchronized context | beyond finance, cross-domain evidence and decision continuity |
| Ground News | source clustering, comparative coverage and transparency (https://ground.news/subscribe) | Perspectives, claim disagreement, story groups and coverage diversity | link to actual personal Project exposure and source receipts; no invented publisher bias scores |
| Google Gemini Notebook | reviewable source-backed slide/video outline and creative steering, Oct 19 2026 (https://blog.google/innovation-and-ai/products/gemini-notebook/co-create-slides-videos/) | user review before generating professional briefs | same P4 Artifact, source and scenario revisions |
| Notion AI | connected enterprise search, Project memory, editable database/docs, agents (https://www.notion.com/product/ai) | content and repeatable agentic work in one place | professional calculations, provenance and local execution |
| ChatGPT connected apps/plugins | authorized in-conversation cards, app connectors, actions and automations (https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt) | elegant capabilities within conversation, not secondary forms | local-first plugin rights and permission receipts |
| Linear Agent | global command-led work, skills and repeatable workflows (https://linear.app/docs/linear-agent) | one universal Cmd/Ctrl+K and scoped agent actions | evidence-backed cross-domain decisions rather than issue tracking |
| Airtable Omni | natural-language creation/updates and permission-aware data workflows (https://support.airtable.com/articles/1744327578-Using-Omni-AI-in-Airtable) | connected database→reviewable custom analysis | canonical data/entity schema mapping, deterministic scenarios, no duplicate low-code engine |

**No competitor superiority claims without actual UX task benchmark.** LiOS proposed win condition: *the same entity/source/assumption/project and permission scope persists across research, interactive investigation, calculation, generated deliverable and monitored outcome*, with $0 mandatory cloud compute and user-owned runtime.

## 4. Whole-product information architecture: the Intelligence Continuity Spine

```text
User enters existing Home / Project / Chat
         │   asks | searches | follows | imports | schedules
         ▼
Universal Intent & Context Interpretation [TC/P2 existing router]
         │   who/user | which Project | permissions | subjects | period
         ▼
Canonical P5 Entity + source scope + P3 evidence/trust
         │   rights | reliability | time | observed vs derived
         ▼
GM governed agents/skills/BYOAI/local models + tools
         │   typed outputs | bounded plans | checkpoints | receipts
         ▼
LiOS Visual Projection Registry [TC/CA presentation only]
  article • infographic • table • chart • map • graph • timeline
  scenario • report • workflow review • quote • evidence prism
         │   same evidence refs, entity refs, Artifact refs
         ▼
P4 Saved Artifact + P11 deterministic model + P9 monitor/action
         │   reversible review, version, scope, receipts
         ▼
Continuity / What Changed / refresh and replay
```

No **new database, ontology, artifact store, memory, permission engine, plugin runtime, model router or execution runner**. The spine is an *integration contract and user experience*, realized through adapters to existing canonical owners.

**Bounded typed Visual Descriptor** (conceptual, design only):
```ts
type VisualProjection = {
  kind: "story"|"source_comparison"|"table"|"chart"|"timeline"|"map"|"graph"|"scenario"|"artifact"|"workflow_review";
  projectId: string | null;
  contextId: string;
  entityRefs: string[];
  sourceRefs: string[];
  artifactRef?: string;
  temporal: { observedAt?: string; asOf?: string; changedAt?: string };
  provenance: "observed"|"calculated"|"user_supplied"|"model_inference"|"simulation"|"unavailable";
  rightsPolicyRef?: string;
  state: "loading"|"ready"|"stale"|"offline"|"denied"|"error";
  actions: string[];  // only existing authorized action ids
};
```
This is a proposed presentation view schema, **not source data authority and not a copy/paste production type yet**. AI suggests a descriptor, but the server validates permitted renderer/data/rights and resolves current data; no arbitrary model JSX, browser JS or unsafe URLs.

## 5. Signature innovations: what makes LiOS a category-level product

### Intelligence & trust
- **I01 — Contextual Intelligence Front Door.** Launch into one quietly tailored briefing, open Projects and contextual Ask. Not a finance-only start screen or second Pulse home.
- **I02 — Source Passport.** Every substantive result can reveal: provenance class, permitted sources, date/time, terms, freshness, assumptions, confidence limits and scope, via existing P3 evidence surfaces.
- **I03 — Evidence Time Machine.** View what was actually available *at a past recorded time*, compare it to later corrected observations and inspect changes; never pretend retroactive truth.
- **I04 — Contradiction Lens.** Source claims aligned side by side, unsupported claims and dissent explicitly shown, not forced into one summary or fabricated media-bias rating.
- **I05 — Consequence Trail.** Explore reported event → P5 entity network → domain links → Project exposure → supporting evidence → safe next action; cannot infer user exposure without permitted data.
- **I06 — Cross-Domain Radar.** Compare effects across healthcare, finance, technology, climate, infrastructure and consumers from real link evidence, not ticker-only assumptions.

### Professional work and applied AI
- **I07 — Adaptive Investigation Studio.** One conversation can temporarily display chart, geography, graph, evidence, comparison or table beside content, selected by user and grounded AI intent; one underlying Project/Artifact state.
- **I08 — Scenario Twins.** Create reviewable alternative futures anchored to actual baseline and explicit user-controlled assumptions, calculated by P11 and other governed engines when available; label speculative cases.
- **I09 — Living Work Products.** Reports/spreadsheets/slides retain source and assumption lineage; refreshing creates versioned diffs and review proposals, not silent overwrites.
- **I10 — Research-to-Workflow Compiler.** Connecting a permitted source/database lets existing semantic mapper suggest a reusable analysis, monitor or P4 template, with mappings reviewed and confirmed, not autonomous schema guesses.
- **I11 — Capability-in-Context.** Need a source or skill? The same Chat shows verified plugin/connection choices, installation rights, trust state, preview and confirmation. Use existing P13/GM; no secondary catalog app.
- **I12 — Agent Mission Trace.** User sees task plan, milestone, source/tool budget, permitted actions, checkpoints, failure/recovery and result receipts, with bounded GM agent loop and review.

### Continuity, trust and experience
- **I13 — Personal Intelligence Memory With Boundaries.** Durable P6/GM memory remembers authorized preferences and decisions by scope and time; explicit view/correct/revoke; do not silently conflate user preferences with facts.
- **I14 — Watchrooms That Explain Themselves.** Monitor requested topics/thresholds and deliver 'what changed / why this matters / source / proposed action' via existing P9; distinguish offline app, local running service and unavailable background monitoring.
- **I15 — Decision Loop and Outcome Ledger.** Save hypothesis, scenario, decision, action/review, later outcome and lessons, rather than endless generation of disconnected reports.
- **I16 — Device Continuity With Truthful Availability.** Resume authorized work across paired devices when network/local Home is available; cached and stale states clearly shown; no invented universal cloud sync.
- **I17 — System Doctor / Readiness Companion.** Real capability status, provider verification, local runtime/memory, unavailable actions, performance and upgrade integrity in readable user language, without installing opaque additional system agents.
- **I18 — Source-Grounded Briefing Studio.** User-reviewable slides, visual storyboard and optional audio/video derived only from P4/allowed source refs, with rights and zero-cost license checks.
- **I19 — Adaptive Calm / Pro Mode.** Editorial hierarchy while browsing, dense numerical precision in models, clean Chat/composer and reduced motion where needed; maintain one theme/token authority.
- **I20 — Explain My Intelligence.** Ranking provenance, why a story is relevant, missing data and alternatives; user can mute, follow, narrow sources, or request a comparison without manipulation.

**Hierarchy:** I01–I20 are **composed experiences over the already-approved original F01–F12 plus N01–N08**, not 20 standalone workstreams or 20 additional permanent sidebar buttons.

## 6. Source-code assimilation: maximum reuse, strict integration seam

### Preferred donor families (not artificial count limits)

| Existing LiOS ownership seam | Candidate inspected repository and code | Adoption posture |
| --- | --- | --- |
| Rich editorial cards, activity, contextual controls | Watermelon `WatermelonCorp/watermelon-platform`, `watermellon-registry`: expandable cards, contextual AI bar, source previews, disclosure, dashboard compositions, carousels, user interaction | Import substantial coherent families, remove demo data and CSS mismatch; preserve single design language and rights |
| Chat citations, streaming, tool approval, agent status, Sankey/treemap/timeline | beUI `starc007/ui-components`: real `components/agents/*`, `components/charts/*`, `components/motion/*` | Higher priority than generic decoration; attach to P2/GM/P3 authority, no new message store |
| Comparison, Gantt, dropzone, data controls | Kibo `shadcnblocks/kibo` | Reuse where current P4/Chat affordance inadequate; full dependency closure |
| Graph explorer | `xyflow/xyflow`; alternative `vasturiano/react-force-graph` | Render existing P5 relationship results better; benchmark interaction/speed, keep one actual graph runtime |
| Maps and layers | MapLibre, optional deck.gl, PMTiles | Use approved geocoded data and independently licensed tile datasets; lazy-load heavy GPU dependencies |
| Professional charts | Existing ECharts6, Recharts2, lightweight-charts; selected beUI/Tremor compositions | Improve projections and comparative dashboards; **do not multiply unrelated chart engines without user benefit** |
| Search/news ingestion | Existing `fast-xml-parser` and GDELT; selectively `metascraper`, Mozilla Readability, RSS parser | Source URL validation, publisher rights, safe caching, entity resolution and dedup; no mandatory cloud feed server |
| Long feeds | `TanStack/virtual` and existing Embla | Virtualized sources, stories, references and search results; performance measured |
| Chat framework inspiration | `assistant-ui/assistant-ui` | May reuse P2 compatible renderer facade/controls but must **not** fork GM/P2 conversation state |
| Skills / visual QA | Anthropic frontend design, Watermelon design skill, Vercel React best-practices, Taste Skill, UI/UX Pro Max, agent-browser (reviewed) | Development-time guidance and real screenshots; no arbitrary remote skill execution in customer runtime |
| Briefings/motion | PromptMotion reference; Remotion only if organizational license and redistribution terms permit; legal open-source alternatives | Structured reviewable source storyboard first, video optional |
| UI/brand references | Mobbin, Recent, 60fps, Modulify, MotionIn, HorizonX, Wonderlist, other galleries | Benchmark interactions/visual art direction, **do not redistribute gallery screenshots or paid designs as code** |
| Optional communication/contracts | Sent, CloseIt | Only cost-transparent, opt-in provider integrations through P13 if useful; never release dependency |

**Framework upgrade policy:** no dogma. Compare stable React18/Tailwind3 port with isolated React19/Tailwind4/Motion12 upgrade only when a *large, proven* donor integration justifies it. Test all P2/P4 editor flows, Electron, plugin/agent, performance and rollback. A source-code licensed component may still have paid fonts/assets and noncompliant fetched media. No GPL/AGPL direct-copy to proprietary code absent explicit counsel approval.

## 7. Complete product UX blueprint

### A. Landing/Home, inside existing Chat/Project entry
Default first screen:
- One **top change** or Project continuity insight anchored to actual connected sources.
- Large primary Ask field, three relevant next steps rather than dozens of AI suggestions.
- Recent Project/reopen in progress (real resumable state).
- Quiet Watchroom/Automation indicator and source/agent readiness only when relevant.
- Optional personalized editorial/markets digest on expansion, not a mandatory wall of tiles.

### B. Chat as the universal command surface
- Primary composer supports regular question, named sources, file, AI model, plugins/connector discovery, automation idea.
- Result is readable prose + **one or a few relevant rich interactive projections**, not all available widgets at once.
- Ask → compare evidence → show how chart was computed → work in canonical Artifact → return to same answer.
- Tool/skill actions show approved/denied/pending and executed receipts, never premature success or hidden tool chains.
- User can enter advanced Workbench deliberately without losing selected entity/time/Project/source scope.

### C. Investigation
- On card click, contextual inspector offers Evidence, Timeline, Entity, Impact and Action only when there is real data.
- Synchronized focus: selecting one sourced period in chart can highlight timeline/map/graph; all renderers read same immutable selected context, not create duplicate cross-domain state authorities.
- Every visual has legend/source/time/unit/unknown handling, accessible table fallback and offline state.
- If source/rights/connector unavailable, explain why; do not hallucinate an attractive empty map.

### D. Project and work
- Existing Project Home and Chat/Artifact sidecar display decision thread: question, documents, model assumptions, analysis, approvals, output, workflow and later refresh.
- Reusable templates/skills are selected in context and reviewed. Existing P4 identity and versions never silently change.
- Default Project view stays quiet; advanced details behind progressive disclosure rather than 8 ever-present panels.

### E. Plugins, devices and operations
- Chat/contextual install = discover, rights preview, verify, save, use; honest `catalog_only` vs `live_verified`.
- P9 watchrooms support scheduled/trigger-based work only when the user's actual local runtime/service can execute it; expose paused/offline and last-run receipts.
- System Doctor is an approachable readiness/repair surface, not another entire troubleshooting product.

## 8. Execution under existing SI-07: four delivery phases

### Phase 1 — Identity, design quality and unified context foundation
**Work:** screenshot actual app; reconcile open theme/quiet-nav/plugin PRs; lock design tokens/typography/density and source rights; build approved visual projection descriptor. Source-port coherent Watermelon and beUI card/citation/approval families. Remove the narrow `FusionPulseBoard.PulseCard` evidence projection without breaking API. Introduce source-verified editorial hero and the complete Card → Evidence → Chat → Project return path. Inspect streaming/recovery and implement screenshot/nightly local QA harness. Audit local-first and permissions.
**Deliverable:** a premium, reliable, source-backed first journey with code provenance. This is foundation for all F01–F12, not a new UI route.
**Stop/go:** native screenshot + keyboard/200% zoom, source/rights, no fake data, no regression, current PR conflicts resolved.

### Phase 2 — Discover + Universal Intelligence Entry
**Work:** scalable personalized discovery/What Changed/Watchrooms/Visual Search; user-controlled relevance; inline source/plugin setup; generic entity and domain navigation rather than finance-ticker primacy; project continuity and capability readiness. Source-port full cohesive donor layouts where visually proven; preserve existing source and P9 logic. Add semantic map of connected source→reviewable research/workflow suggestion.
**Delivers:** F01, F06, F07, F10, F12, I01/I06/I10/I11/I14/I20. Cross-domain fixture tests.
**Stop/go:** first-time user and expert both complete Connect/Skip → Discover → Ask → Follow → Review monitor → Reopen after restart with scope and failures correct.

### Phase 3 — Deep Investigation + Decision Execution
**Work:** real geography, P5 entity graphs, dated event timelines, comparative claim/source views, P11 governed scenario twins, typed generative UI in Chat and evidence time replay. Hook agent mission trace and status, governed actions and editable P4 refresh into the same Project continuity ledger. Source-port React Flow/MapLibre/Kibo/beUI Sankey/treemap where superior to current renderers.
**Delivers:** F02–F05, F08–F09; I02–I09, I12, I15. No arbitrary scripts from AI or hidden write actions.
**Stop/go:** source story → graph/map/time comparison → contradiction → scenario → review action → P4 Artifact/ledger → later monitored outcome; offline, denied and contradictory evidence cases tested.

### Phase 4 — Professional Finish, Briefings, Native Beta and Long-Life Maintenance
**Work:** source-grounded reviewed briefing studio F11, reusable original promotional outputs, polished adaptive calm/pro, screenreader/keyboard and performance, native hardware GPU limits, offline/cached source rights, large-bundle optimization, local diagnostic/rollback/update integrity and secure low-cost packaging. Prove real installed Mac and Windows beta journeys; document unresolved signing gate honestly. Record donor upstream pins/notices, integration tests and modernization/rollback policy so LiOS is upgradeable for years.
**Delivers:** F11 and end-to-end acceptance of F01–F12/N01–N08/I01–I20 where covered by functional sources; prevent feature-presence inflation.
**Stop/go:** product reaches honest available beta target with tested real journeys and an explicit list of remaining unaccepted capabilities; P14 production signing remains unfulfilled under hard $0 lock.

## 9. Risk-control and longevity choices

- Never hard-code third-party data access or falsely promise licensed Bloomberg/AlphaSense-equivalent feeds.
- Repository is proprietary *public source*; explicit donor notices, image rights, font rights and source dataset terms.
- No central mandatory user compute; BYOD/BYOAI. Never hide an optional cost as a "free" feature. Do not import unsupported service integrations under $0 release policy.
- All AI claims are classified as observed, calculated, user-supplied, model inference, simulated or unavailable. Source and as-of time visible on request. Unsupported estimates cannot appear as facts.
- All imported heavy interactions can be suspended/offscreen virtualized; avoid maps/3D/video burning CPU and memory behind Chat.
- Visible app belongs to TC; source/evidence P3/P5; canonical Artifact P4; deterministic finance P11; agent/runtime/security GM; plugins GM/P13; automations P9. Adapt UI without splitting ownership.
- User interaction quality must survive connection loss, stream interruption, expired credentials, denied permission, restart and restored Project state.
- Maintenance: pin donor commits, isolate adaptations to narrow paths, collect upstream update diffs, regression screenshots and reproducible license manifest. Do not treat an unreviewed automatic vendor component update as safe.
- Benchmark by real task completion and cost: latency from query to inspectable evidence, number of clicks to save/reopen, accurate provenance, real renderer coverage, keyboard/zoom, source freshness, paused/offline truth, native startup and memory. Set performance budgets only after measurements.
- Skills/prompts do **not** become self-executing capabilities; secure by review and explicit local grants.

## 10. Product benchmark tasks (run on LiOS and comparator demos ethically)

1. **Brief-to-decision:** 1 policy story → show company/sector relation → cite 2 sources → scenario assumptions → save editable source-backed brief.
2. **Cross-domain research:** non-ticker subject, e.g. rural healthcare or solar supply chain, from source connection → entity comparison → report.
3. **Change intelligence:** Project last opened yesterday → What's New with dated diffs → user follows and sets permitted watch.
4. **Agent transparency:** user requests long task with tool permission → inspect plan/approvals → interrupt/restart → honest receipt/outcome.
5. **Data authority:** connect SQLite/CSV/approved DB → semantic mapping reviewed → generated visualization → report/monitor without code.
6. **Work product round-trip:** modify numerical assumption in Artifact → deterministic recalculation → Chat summarizes source changes → export → reopen correct version.
7. **Degraded runtime:** no BYOAI, offline/no image rights, slow device or revoked connector → useful graceful fallback and exact status.
8. **Professional UX:** 390px/768px/1440px and 200% zoom, keyboard/VoiceOver, modest hardware and long session; no unreadable 7px operational text.

**Record on each scenario:** user goal, initial and final screenshots, source linked, time, wrong/blocked actions, pause/restart truth, artifact ID/version, runtime measurements, pass/fail severity. Do not assign marketing-style "9/10" scores without this evidence.

**First implementation slice once authorized:** reconcile shell PRs, turn the actual Wave D card/evidence projection into one Watermelon/beUI-inspired credible editorial card; preserve typed refs; make Card → Evidence → Ask → Artifact/save/reopen work, then validate installed Electron. This is a whole-product vertical slice, not a decorative component demo.
