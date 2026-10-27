# LiOS Premium UI — Final Four-Phase Execution Plan
**27 October 2026 · Owner decision synthesis · Implementation not started**

**One product:** the existing local-first LiOS Terminal, conversation first, professional by default. This is the **single execution checklist for the UI/visual assimilation stream** and supersedes earlier conflicting UI-component shortlists in draft PR #229. Prior source audits remain supporting evidence: [Whole-product architecture](LIOS_WHOLE_PRODUCT_EXPERIENCE_ARCHITECTURE_2026-10-27.md), [20-site donor audit](LIOS_20_SITE_PREMIUM_DONOR_AUDIT_2026-10-27.md), [rich-intelligence feature plan](LIOS_RICH_INTELLIGENCE_EXPERIENCE_2026-10-27.md). **Not** another SI/TC/GM/CA master roadmap or separate datastore/runtime. Actual execution remains aligned to active SI-06/SI-07, `AGENTS.md`, `docs/PENDING_WORK.md`, P14 and strict $0 additional release spend.

## Product we will actually make

**Three compatible states in one workspace, not three apps/sidebar products:**
1. **Discover:** beautiful, source-linked editorial Pulse, Home, What Changed, relevant changes, visual search and Watchrooms. Strong hero and supporting story hierarchy; optional user-controlled compact mode.
2. **Investigate:** source inspector + charts/maps/graph/timeline/Perspectives/Scenario Playground, synchronized selection of subject, as-of date, evidence, Project, work context and user permission.
3. **Work:** calm Chat/Projects/Workbench, approved AI and tools, editable P4 Artifacts, agent plans/reviewed actions, connectors, automation receipts, devices. Everything accessible from the current conversation with right-side workspace panels only when relevant.

**Default shell:** New Chat, Home, Search, Projects, Chats, Library, Automations, Plugins/Connections, Settings/account. Existing Project/Chat/Artifact sidecar/advanced Workbench; no new permanent nav for Pulse/Graph/Maps/Briefings or donor kits. Plugins/Connectors use existing contextual Chat setup as well as existing nav entry where present. Sidecar is hidden until useful. On compact windows, contextual inspector stacks/replaces focus rather than squashing Chat.

**Visual character:** premium warm graphite/near-black and restrained gold/neutral accents; light mode properly supported; legible type and tabular number typography; two or three thoughtful editorial card sizes; imagery when rights-approved; calm, fast transitions; professional tables/dense financial canvases; original assets; screenshot-verified ergonomics. No universal 7–9px labels in reading/working mode, decorative misleading fake metrics, constant motion, garish gradients, empty cards or default dashboard clutter. Existing `TerminalUxSettings` density/comfort/focus settings are the controls, not yet another settings system.

## Source truth: actual LiOS code we will improve

| LiOS existing owner/file (main snapshot) | Already working | UX improvement / integration |
| --- | --- | --- |
| `src/client/src/components/terminal/FusionPulseBoard.tsx` | 4 channels (for_you/following/markets/research), market/metric Pulse cards, ask/open actions | Create sourced editorial Hero/Story/Compact layouts, varied density, meaningful images; replace narrow local PulseCard projection to retain canonical Wave D evidence/actions; no new feed store |
| `src/shared/waveDContracts.ts`, `src/server/waveDRoutes.ts`, `waveDIntegrations.ts` | Ranked sourced Pulse, What Changed, monitored actions, bounded optional BYOAI | Source IDs, time, entity links, story group IDs, authorized media metadata and status in compatible projections; keep server source authority |
| `src/client/src/components/panels/NewsPanel.tsx` + `src/client/src/lib/finance.ts` | Text-first articles, time, filter, article view | Same story-family presentation, richer source metadata, previews and diverse editorial stories |
| `src/client/src/components/terminal/ChatSourcesControl.tsx`, `ChatTerminalSurface.tsx`, `WorkSearchDialog.tsx`, `CommandBar.tsx` | In-composer sources, finance tool entry, work search/shortcuts | One universal composer, cross-domain contextual tools, models/files/skills/apps, source and permission readiness; **reuse existing search/router** |
| `src/client/src/components/terminal/GraphExplorer.tsx` | Actual domain graph data/actions, rudimentary fixed-position SVG, small text | React Flow/force graph high-quality renderer, zoom/pan/filter, linked evidence; reuse graph computation/entity ownership |
| `ImpactMap.tsx`, `CoverageMapPanel.tsx` | Scenario impact and geographic provider *coverage* matrix | Keep both; add real geospatial World Map over P5/P3-linked location data, MapLibre + licensed map tiles |
| `EvidencePrism.tsx` and `ProjectContinuityPanel.tsx` | Trust/claims and retained change snapshots | Reusable Source Passport, Claim Lens, Evidence Time Machine and Story Evolution UI |
| `ConversationArtifactSidecar.tsx`, `ProjectHome.tsx`, `src/shared/artifactAdapterRegistry.ts` | Canonical P4 editor, sidecar, project chats and artifacts, multiple renderers | Cohesive preview→editable Artifact→versioned changes→Workbench, intelligent progressive Project Home; no second P4 store |
| `ProjectAutomationPanel.tsx`, `src/shared/schemaAutomation.ts` | P9 workflows/runs/notifications, confirmed review paths | Beautiful What Changed/Watchroom cards, inline propose→review→save/run/receipt and offline truth |
| `connectorPluginService.ts`, `ConnectorRegistryPanel.tsx`, `p13ExtensionContracts.ts`, `pluginSdk.ts` | Plugin manifests/discovery, precise connector readiness, trust previews and consent | In-chat capability cards and one provider flow; no second plugin backend |
| `DevicesSettings.tsx`, `aiMemory.ts`, `agentLoop.ts` | Pairing/homes, durable memory, governed bounded agent planning | Elegant task trace, System Doctor, meaningful continuity/repair; retain GM memory/execution/trust |
| `src/remotion/DemoVideo.tsx` | Demo composition with *hardcoded fictional/example* market data | F11 source-backed storyboard only, valid Remotion license or permissible renderer alternative; never treat demo as live intelligence |

**Do not label source findings as packaged feature acceptance.** Reconcile live PRs #219–#228, particularly #223 theme, #225 plugins, #226 quiet Home and #227 navigation, before touching shared UX owners; no collision or premature merge.

## Primary donor policy: use as much *good* reusable code as actually helps

Import an entire family, multi-file component, full dashboard layout or backend mechanism when it measurably improves a specific LiOS flow; don't cap reuse by number of components. Compare against existing LiOS and selectively port from inspected upstream. All dependencies/media/font licenses, transitive imports, accessibility, local desktop performance and user permission must be audited. Full React/Tailwind/Motion migration is eligible if independently tested to deliver a larger sustained upgrade, not prohibited or presumed necessary.

### Where each source website will be used

| Source user supplied | Reuse nature | Specific LiOS destinations | Phases |
| --- | --- | --- | --- |
| **ui.watermelon.sh** — `WatermelonCorp/watermelon-platform`, `watermellon-registry` (MIT) | **Direct TSX/multi-file source import**: `expandable-event-card`, `activities-card`, `morphing-discovery-bar`, `contextual-ai-bar`, `quick-switcher`, `preview-link-card`, `filter-disclosure`, `inline-table-control`, `continuous-tabs`, `carousel-navigator`, `journal-navigation`, `integration-card`, `onboarding-setup`; entire premium dashboard composition after comparison | Pulse/News, Home, Chat context actions, Project, search, source inspection, plugins, timelines, scenario sliders and decks | 1–4 |
| **beui.dev** — `starc007/ui-components` (MIT) | **Direct TSX source family**: `components/agents/{citations,streaming-response,tool-approval,prompt-input,agent-activity}`, `components/charts/{sankey-chart,treemap,funnel-chart,candlestick-chart,price-target-fan,liquidity-heatmap}`, `components/motion/{timeline,animated-toast-stack,animated-sidebar}` where superior | Chat, citations, agent status/approvals, analytics, Graph/causal flows, Story Evolution and status feedback | 1–4 |
| **skill-issue.in** | Catalog, **not app runtime**. Review upstream Anthropic frontend-design, Vercel React performance, Watermelon make-interfaces-feel-better, UI/UX Pro Max, Taste Skill, agent-browser and backend architecture skill source | Agent coding/review rules across **every** LiOS screen and source adapter; pinned, read-only skills first; visual QA | All |
| **promptmotion.org** | Creator-owned motion prompt/workflow *reference*; source code copied only with a specific valid license | F11 source-grounded storyboard/briefing animations, data storytelling, product demos and measured interface motion | 1,3,4 |
| **modulify.ai + /templates** | Free browsing/prototypes, **code export paid** | Whole layout/hero/dashboard inspiration and public website/landing A/B concepts; no compulsory generator in production | 1,4 |
| **landdding.com** | Landing-page gallery | Public website's above-the-fold story, value/feature narrative and download/get started pages, not core desktop runtime | 4 |
| **motionin.design** | Motion/interactivity gallery/prompts; paid unlocks | Higher-end details for contextual panel transitions, visual cards, product demo scenes; source only if properly licensed | 1,3,4 |
| **iconly.design** | Icon research, icons shown belong to creators | LiOS product icon identity, module icon semantics; create original SVG or use permissively licensed icon sets | 1,4 |
| **fontinlogo.com** | Brand wordmark/type research | Typographic direction for Limuria/LiOS name, app display/body/number scale; install only redistributable fonts | 1,4 |
| **on.design** | Curated design community | External design exploration, high-end mood boards, critique and creative benchmark | 1,4 |
| **godly.website** | Redirects to Recent | Combined with Recent, no separate integration | 1,4 |
| **60fps.design** | Motion inspiration and some platform-specific snippets (SwiftUI; paid MCP) | Quality bar for native-feeling spring/interruption, focus, gesture, panel state and user controls; implement with existing Motion/CSS | 1–4 |
| **footer.design** | Public website footer gallery | Public LiOS/Limuria marketing footer, legal/licensing, docs, GitHub/Releases/download pathways | 4 |
| **recent.design** | Premium contemporary visual gallery | Editorial cards, motion, brand system, image hierarchy and creative benchmark across Home/marketing | 1,2,4 |
| **backgrounds.supply** | Assets; free samples often personal-use only, commercial rights separate | Inspiration for original lightweight CSS/locally owned visual environments; include purchased/cleared media only | 1,4 |
| **posts.design** | Real branded posts inspiration | Launch graphics, social announcements, briefing layouts and original thumbnail/post treatments | 4 |
| **wonderlist.design** | Paid Figma layouts | Screen-composition research for polished marketing/optional prototypes, not unlincensed bundled app source | 1,4 |
| **mobbin.com** | Real product flows/screens reference | Compare onboarding, first-run, search, plugin/setup, Projects, user actions, error/recovery and app consistency | 1–4 |
| **sent.dm** | Paid messaging service/API | Optional explicit-cost BYOD communications connector and P9 notification channel, not required for install | 4 or later, if needed |
| **closeit.fast** | Electronic-signature service | Optional user-initiated P4 proposal/contract send/track and external signing; not core editing/runtime | 4 or later, if needed |
| **paperanimation.ai** | Watermarked/free vs separately commercial output | Original launch reels, optional permitted storyboarding/visual brief animations | 4 |
| **HorizonX.so** | High-end paid components/Figma/design systems | Premium art-direction benchmark for desktop panels, layout hierarchy, imagery, layered motion; licensed source only when approved | 1,3,4 |

### Additional best-in-class permissive OSS needed for the full product

- **Kibo UI (MIT):** source/diff comparisons, drag-drop data import, Gantt/temporal/project displays → Perspectives, Artifact and Project/Workflow.
- **React Flow (MIT)** or qualified force graph: professional zoom/pan nodes/edges → current GraphExplorer, *no new ontology*.
- **MapLibre (BSD-3-Clause) + rights-cleared tiles** and optional deck.gl (MIT): actual location-based events/world research layers → F02.
- **Existing ECharts/Recharts/lightweight-charts** and selected beUI charts: rich, deterministic professional data views, **avoid duplicate engines**.
- **TanStack Virtual (MIT):** large source/story/chat-related lists, performance on modest hardware.
- **Metascraper (MIT) + Mozilla Readability (Apache-2.0):** safe source metadata/article parsing where site terms and rights permit; preview URL != rehost rights.
- **assistant-ui (MIT)** only if its rich Chat composition materially improves current P2; adapt UI, do not create competing conversation store/cloud dependencies.
- **Magic UI/Motion Primitives (MIT repos):** selected striking elements where they strengthen an actual high-impact journey; not indiscriminate glitter.

## Phase 1 — The premium foundation and universal Chat

**Scope:** current shell, Chat/Project/Home coherence, rich responses and evidence, premium design grammar. **Keep the existing single router and stores.**

1. Freeze/reconcile affected active PRs (#223, #225, #226, #227) and capture actual screenshots/user tasks on main. Existing source tests and docs are not proof of visual readiness.
2. Build cohesive professional **LiOS visual tokens**: type scale, neutral/gold themes, contrast, hero/editorial image hierarchy, layout grid, spacing/radius, motion durations and allowed density. Use current `TerminalUxSettings` instead of adding a competing system.
3. **Import beUI** Chat source/citation, streaming response, agent activity, tool approval, status feedback and optionally prompt composer *presentation only*. Connect to canonical P2/GM actual events/permissions, not demo local state.
4. **Import Watermelon** Hero/Expandable Story Card, Contextual AI Bar, Activity Card and selected disclosure/navigation composables to reshape actual `FusionPulseBoard` + `NewsPanel`.
5. Make Wave D evidence-preserving projection: story ID, sources, timestamps, media rights/attribution, subject/entity links, selected actions and project scope. Real provider data only; fallback uses original local graphics, never fake stock numbers/media.
6. Responsive shell/sidecar behavior with keyboard, window resize, 200% zoom, reduced motion, offline states, meaningful typography. Progressive disclosure: normal users see a clean screen; expert tools on demand.
7. Compare React18/Tailwind3 source-port vs isolated React19/Tailwind4/Motion12 modernization using actual P2, P4, plugin and desktop build tests. Upgrade only if superior and reversible.

**Visible end state:** Product opens into polished Chat/Home. Real sourced featured story → visual expansion → inspect evidence → ask/compare → create or save a canonical Artifact without losing scope or input.

**Acceptance:** accurate source/citation/permission, useful unavailable states, no demo data, keyboard/390px/768px/desktop/200% zoom, verified rendered screenshot and installed macOS smoke proof. Source unit/test gate alone is insufficient.

## Phase 2 — Discovery, Home, Projects and connected intelligence

**Scope:** make information and ongoing work compelling, personalized, cross-domain and discoverable without extra top-level pages.

1. Adapt **larger cohesive Watermelon Home/dashboard/page components** when they outperform current `ProjectHome` and `FusionPulseBoard`; full screens/families permitted. Preserve project identity and any existing #226 quiet-UI changes.
2. Deliver F01 Pulse, F06 My Intelligence Desk, F07 What Changed, F10 Visual Search, F12 Smart Watchrooms; N03 Cross-Domain Radar, N06 Explain This Feed. Stories should group and deduplicate real source articles, show why relevant, and allow follow/mute/compare.
3. Add beUI/Watermelon motion carousels, chronological activity, linked Source Passport previews, readable card density and saved views. Lazy media, virtualize large lists, preserve network/privacy rights.
4. Chat-first inline Plugin/Connector access using current P13/GM manifest/permissions, and P5 provider verification. One setup journey from requested capability → inspect rights → authorize/configure → verify live → use in same Chat. Show catalog-only/ready/connected/degraded separately.
5. Simplify Projects into a **continuity desk**: recent chats, saved Artifacts, source changes, decisions, workflows and meaningful next steps; one-tap reopen with right context and history.
6. Automations/Watchrooms: source-backed topic changes, monitor suggestion → editable P9 draft → explicit save/review → run/history/notification; honest status while app/local service offline.
7. Apply Mobbin's journey-level benchmarking and Recent/60fps visual quality reviews, but never copy third-party screenshots as customer UI assets.

**Visible end state:** One sophisticated personal intelligence Home, cross-domain Discover in context, relevant stories/insights, interactive search, inline source/plugin setup, saved watchlists, and Project resume. **User does not have to learn a new product to use any feature.**

**Acceptance:** first-time user + returning professional can Connect/Skip → Discover → Ask → Follow → Monitor → Open Project → Resume after restart in finance and at least two non-finance subject areas; correct no-source/offline data and correct permissions.

## Phase 3 — Advanced visual research, professional analysis and agent action

**Scope:** professional investigation comes alive through actual interactive visualization without inventing new analysis backends.

1. **Graph**: port React Flow (or benchmarked force-graph alternative) as a renderer for current `GraphExplorer`. Rich object nodes, zoom/pan, clustered connections, evidence drilldown and object actions; preserve existing P5 entity keys and domain logic.
2. **Geospatial World Map**: MapLibre sourced place/event entities, layered reports, time range slider, uncertainty/unknown locations, comparison panels. Licensed/offline map tiles; disable location effects where source data missing.
3. **Timeline/Story Evolution**: beUI motion timeline or Watermelon journal navigation, source snapshots and Project Continuity. Show as-known-then vs now and source revision diffs without changing historical facts.
4. **Perspectives + Claim Lens**: Kibo comparison and beUI citation/source UI; show opposing sourced statements, date, coverage and knowledge gaps. No invented bias scores.
5. **AI Visual Answers**: P2 Chat selects from approved renderer schemas (charts/maps/graph/tables/timeline/scenario); model supplies a typed intent, server resolves grounded data and permissions; cannot execute arbitrary JSX/JS or fabricate source values.
6. **Scenario Playground**: Watermelon sliders and professional beUI analytics with actual deterministic P11 models or other validated engines; review baseline, assumption, time and units; save P4 Artifact versions.
7. **Consequence Trail**: source change → entities/suppliers/geographies → user-authorized Project exposures → verified impact scenario → proposed reviewed action. Combine connected data and explain missing links.
8. **Agent action UX**: beUI tool approval/progress + existing governed GM loop and receipts; plan, wait/confirm, inspect, revise, cancel/resume, with real status. Persist reviewed outputs into current Project/Artifact/workflow records.

**Visible end state:** From any sourced development, one connected professional investigation with linked map/graph/timeline/chart/assumption/evidence, deterministic analysis, saved deliverables and reviewed actions.

**Acceptance:** story → geography/graph → claim comparison → scenario → approved action → editable P4 Artifact → Chat, with all source/time/entity/Project context retained and restorable; test offline, denied, low-memory and contradictory-data cases.

## Phase 4 — Briefings, native polish and long-life quality

**Scope:** finish everything as one premium product and eliminate the 'demo assembled from templates' feeling.

1. **AI Briefing Studio (F11):** user-reviewable source-backed visual storyboard, slide deck, chart/infographic and optionally original audio/video; P4 Artifact owns versions. Draw interaction language from PromptMotion/Paper Animation/60fps/MotionIn. Remotion only if license and business/redistribution rights permit; a clean editable report/slide option remains mandatory.
2. **Native finishing:** motion easing, optical alignment, coherent iconography, high-grade type, rich source-safe images, consistent professional dark/light themes, responsive layout/zoom, reduced-motion, keyboard and screen reader. UI/UX Pro Max, Anthropic, Watermelon design skill, Vercel, Taste, Recent, Mobbin as development QA guidance.
3. **System Doctor and device settings:** readable runtime/provider/data/AI/tool/automation status, actionable recovery and truthful paired-device continuity, no magical unavailable cloud sync.
4. **Public product site/marketing:** adapt *original or licensed* ideas from Modulify, Landdding, HorizonX, Footer Design, Recent, Posts, Wonderlist, Iconly, FontInLogo, Backgrounds Supply; show actual LiOS screenshots/verified demos and clear installation trust/cost wording. No website/gallery media bundled without rights.
5. **Optional business connectors:** Sent and CloseIt only if explicit user value and verified source/payments/permissions, outside $0 baseline; cannot gate core use or release.
6. **Technical permanence:** upstream source pin/license ledger, maintainable code ownership, automated regression screenshots, real installed app journeys, cross-platform load/memory/build/offline/corrupted source/recovery tests. No hidden production signing claim: maintain strict **$0 additional release spend** for unsigned Windows and ad-hoc macOS beta only.
7. **All 12 original features + eight approved extensions** verified in coherent end-to-end tasks, not simply files present in repo. Flag anything incomplete honestly.

**Visible end state:** a cohesive premium desktop LiOS with high-end discovery, serious analytical Workbench, connected Chat/Plugins/Automations/Artifacts, optional briefings, verifiable sources and an honest zero-cost beta delivery.

**Acceptance:** tested native Mac/Windows installed journeys; source, privacy, security and asset rights review; no blocked standard task due to a paid provider; acceptable typing and UI responsiveness; user can restart/reopen without losing Project/Artifact identity; clearly log remaining P14 production requirements.

## Cross-phase guardrails that prevent overlap, overuse and underuse

1. **One owner per data/action:** Chat P2, evidence P3/P5, Artifact P4, automation P9, finance engine P11, plugins/skills/permissions GM/P13, visible UI TC. Donor copies renderer and behavior, *not separate authority*.
2. **One coherent visual vocabulary:** shared tokens and source/status semantics, different visual densities for discover/investigate/work, no 'vendor showroom' UI.
3. **Reuse maximum that passes tests:** import an entire high-value subapp layout if better, including necessary helpers; maintain a complete path-level license/provenance registry.
4. **No false intelligence:** every editorial card/interactive chart/source quote has real provenance; use authorized media only, clear unknown/stale/simulation labels, stable source actions.
5. **No forced payment or backend:** BYOD/BYOAI/local-first and $0 release rule; subscriptions and external providers remain opt-in and truly optional.
6. **Performance/a11y/native:** native Electron installed experience is the bar; reference desktop Mac M2 and Windows; active Chat must remain responsive as rich canvases lazy-load.
7. **Coordination:** reconcile #223–#228 before writing affected files, adapt upstream commits and current LiOS equivalents; protected main unchanged until reviewed merges.

## Phase start order — implementation, not more planning

The first engineering PR starts **Phase 1** and must deliver real code, tests and screenshots:

- Real source and evidence from Wave D into richer Pulse story projection.
- Port/adapt Watermelon `ExpandableEventCard` and beUI citations/streaming/approval *where actually valuable*; use a **single shared premium token system**.
- Verified end-to-end journey **story → evidence → ask → save/reopen** while preserving existing Chat.
- Upstream notices, dependency and licensing audit; real offline/empty/denied and native surface proof.

Then move directly into Phase 2, then Phase 3, then Phase 4. **Do not repeat site research or create more competing roadmaps unless new source/reality shows a substantial blocker.**
