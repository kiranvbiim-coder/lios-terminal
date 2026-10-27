# LiOS Terminal — Unified Rich Intelligence Experience: 12-Feature Coverage and Four-Phase Plan

**Decision date:** 2026-10-27  
**Repository:** `kiranvbiim-coder/lios-terminal` public workstream.  
**State:** Proposed feature-specific TC experience annex, NOT implemented or accepted, NOT a separate product or SI master plan.  
**Existing authorities:** `AGENTS.md`, `docs/LIOS_UX_SYSTEM.md`, `docs/ux/LIOS_ADAPTIVE_EXPERIENCE_EXECUTION_PLAN_2026-10-23.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`, `docs/PENDING_WORK.md`, existing TC/GM/CA/P2/P3/P4/P5/P9/P11/P13 owners, SI-07 and P14 gates, $0 beta contract `docs/technical/LIOS_ZERO_COST_RELEASE_EXECUTION.md` and existing master #91.

## 0. Product decision (locked)

ONE LiOS Terminal, ONE conversation-first adaptive workspace, ONE canonical evidence and Artifact system, ONE user-owned installation. Discovery, editorial feeds, news, maps, graphs, interactive simulations, saved research, watchrooms and briefings are contextual experiences inside existing Home/Chat/Project/Workbench, not separate apps, product brands, top-level nav destinations, backends, feeds, permission systems or stores.

Design for both emotionally compelling discovery and professional calm. Prioritize accessible large imagery and interactive information where appropriate, but avoid text-wall UX, 7px labels, auto-playing distractions, ornamental stock photography, constant motion and content-density overload. Preserve graphite/gold visual authority and optional environment, readable 13–16px prose where space allows, and high-density numerical typography only where appropriate. Provide Comfortable/Compact/Focus view intensity.

## 1. Evidence observed in public source

Directly inspected:
- `src/shared/waveDContracts.ts`: existing `PulseCardDraft`, `IntelligenceCard`, `PulseEvidence`, ranking and next-actions. **Extend compatibly, do not create rival cards or stores.**
- `src/client/src/components/terminal/FusionPulseBoard.tsx`: existing For You/Following/Markets/Research channels, market hero, pulse-card grid, market and macro context. Market-centric; small labels and many numeric surfaces remain.
- `src/client/src/components/terminal/IntelligencePulse.tsx` and `src/client/src/lib/terminalIntelligencePulse.ts`: change, decision-risk, reversal, monitoring and scenario context. Keep its existing owner; align visible presentation via adapter.
- `src/client/src/components/terminal/HomeAttentionPanel.tsx`: existing Wave D attention cards, evidence and action inbox.
- `src/client/src/components/panels/NewsPanel.tsx` and `src/client/src/lib/finance.ts`: text-heavy news and readthrough; `NewsItem` lacks media metadata.
- Existing `VisualCanvas`, Artifact chart/readable views, P4 Artifact sidecar, Dockview and Chat surfaces. `src/package.json` already includes ECharts, Recharts, lightweight-charts, Framer Motion, Embla, Tiptap, Dockview and Lucide.

Current public open PR coordination (as inspected Oct 27): #223 theme, #226 quiet Chat/Project Home, #227 navigation, #225 plugins, #228 release, among others. Re-read live heads and avoid overlapping blind edits. Earlier source observations are not native or visual acceptance.

## 2. Competitor benchmarks and transferable patterns

Official product descriptions and feature documentation, NOT installed hands-on superiority claims:

| Benchmark | Established product strength | LiOS experience response |
| --- | --- | --- |
| Bloomberg Terminal | Tailored topical news, alerts, chart/data connection and professional context | Card opens sourced analysis in the same conversation/work context; no pretence of Bloomberg data coverage |
| LSEG Workspace | Connected trusted data, AI, Reuters news, tailored AI-curated News Digest | Evidence-linked cross-domain story to investigation to native Artifact; BYOD/BYOAI |
| AlphaSense | Generative search, deep research, dashboards, custom/scheduled agents and work products | Visual research answers plus connected-data monitoring and direct Artifact handoff |
| Feedly Market Intelligence | Curated monitoring, AI synthesis/extraction, automated newsletters | Source-grouped personalized intelligence + watchrooms + AI briefing |
| Ground News | Multi-source story clustering, coverage-perspective comparison, publisher transparency | Claims and source-diversity comparison; do NOT invent ideological/factuality scores |
| TradingView | Exploratory interactive charts, synchronised visual workspaces, watchlists, alerts | Context-preserving interactive financial/analytical widgets |
| Quartr | Primary documents, calls, slides, transcript search, slide-history comparison | Source-first story evolution and document comparison in canonical projects |
| Google NotebookLM | Grounded audio/video, interactive source-based slide/explainer outputs | User-reviewable briefs and visual storyboards from permitted sources; optional BYOAI/local |

Official benchmarks: https://professional.bloomberg.com/products/bloomberg-terminal/news/ ; https://www.lseg.com/en/data-analytics/products/workspace ; https://www.lseg.com/en/data-analytics/products/workspace/news-digest ; https://www.alpha-sense.com/platform/ ; https://feedly.com/market-intelligence ; https://ground.news/subscribe ; https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/ ; https://www.quartr.ai/features ; https://blog.google/innovation-and-ai/products/gemini-notebook/co-create-slides-videos/

**Positioning:** LiOS targets the intersection: compelling cross-domain discovery + user-authorized source data + grounded conversation + configurable visual exploration + user-owned execution + reproducible professional outputs. It cannot credibly promise competitors' proprietary datasets or coverage.

## 3. Required coverage — all original 12 features

| ID | Named feature | Single-LiOS experience and implementation owner | Delivery phase |
| --- | --- | --- | --- |
| F01 | LiOS Pulse | Upgrade existing FusionPulseBoard/Wave D: image-led story hero, clustered cards, topics, linked actions | P2 |
| F02 | Living World Map | Geographic story/event/entity exploration, sourced pins and layers in existing visual context | P3 |
| F03 | Intelligence Graph | P5 entity-linked people/company/policy/event relationship explorer; evidence on every edge | P3 |
| F04 | Story Evolution | Event timeline, document/narrative diffs, corrections and provenance | P3 |
| F05 | AI Visual Answers | Typed approved component catalog in existing P2 chat; chart/map/compare/table/source views, text fallback | P3 |
| F06 | My Intelligence Desk | Adjustable, project-aware Home cards with saved local preferences; use Dockview where appropriate | P2 |
| F07 | What Changed? | Since-last-visit digest grounded in existing change intelligence, timestamps and read-state | P2 |
| F08 | Perspectives | Side-by-side primary/source coverage and claim disagreements, context and caveats | P3 |
| F09 | Scenario Playground | Existing P11/P4 governed models with assumption sliders, calculate/review, no invented numbers | P3 |
| F10 | Visual Search | Same source/entity/search authority projected into card/grid/gallery/chart/map/timeline formats | P2 |
| F11 | AI Briefing Studio | Source-grounded visual/slide storyboard and optional audio/video only when authorized local/BYOAI supports it | P4 |
| F12 | Smart Watchrooms | Saved subjects, thresholds, P9 opt-in local monitoring, related cards and permission-aware notifications | P2 |

All phases must retain F01–F12 contract coverage; Phase 1 lays reusable foundations. Later-phase entries are not optional deletions.

## 4. Additional LiOS-original innovations (bounded extensions, not product sprawl)

- **N01 Consequence Trail (P3):** one-click Story -> affected entities -> user-owned portfolio/project/exposure -> evidence -> governed next action. No conclusion without relevant data.
- **N02 Evidence Time Machine (P3):** compare an intelligence view *as known then* versus current snapshots; timestamped source revisions; replay not retroactive truth.
- **N03 Cross-domain Radar (P2/P3):** a story travels across sectors (e.g. policy -> technology -> manufacturing -> financing) only through evidenced links.
- **N04 Claim Lens (P3):** inspect a claim's exact source passage, other-source agreement/disagreement and unsupported gaps. Unknown remains unknown.
- **N05 Visual Research Storyboard (P4):** save, rearrange and reuse cards and charts in P4 Artifact slides/report, preserving source and rights.
- **N06 Explain This Feed (P2):** each surfaced recommendation says why it appears; adjustable follows, mute, diversity and relevance controls.
- **N07 Live Event Lens (P4):** bounded timeline/cards/alerts during earnings, policy announcements or other subscribed events with timestamp and stale states.
- **N08 Smart Density and Quiet Mode (P1/P4):** adaptive visual density, keyboard/accessible controls, low-resource rendering, reduced motion, no interruptive advertising.

## 5. Technical integration boundaries

1. **No duplicate owners.** Extend Wave D intelligence card model through a backwards-compatible presentation envelope; reconcile existing FusionPulseBoard/IntelligencePulse only at visible and read-only adapter seams. Do not merge stores or copy ranked state blindly.
2. **Media contract:** media kind/URL/thumbnail or asset ID, alt, caption, source, license/rights/attribution, cache permission, timestamp, integrity and optional focus point. A metadata image URL is NOT a license. Hide if unauthorized; graceful non-image layout always available.
3. **Sourced story identity:** source URL fingerprint, source/provider ID, observed/published/updated times, cluster ID, P5 canonical entity refs, citations, cross-domain relevance and traceable prioritization. Never invent news, photos, certainty or metric values. Dedupe before scoring.
4. **Card visual registry:** approved `hero`, `editorial`, `compact`, `metric`, `chart`, `map`, `timeline`, `comparison`, `graph`, `artifact` projections. No arbitrary model-generated JSX/HTML, script, remote image execution, unapproved outgoing link, executable callback, plugin permission or standalone state authority.
5. **Actions:** open evidence, ask, analyse, compare, monitor, save and create report use existing permission checks and P2/P4/P5/P9/GM routes. No no-op cards. Consequential edits require current existing review+receipt.
6. **Privacy and integrity:** source scopes, tenant/project access, connected-provider authorizations, offline/cache rights, untrusted link previews sandboxing, CSP and safe image retrieval/SSRF protections; no exfiltration of Project context to ad partners.
7. **Delivery:** user-owned desktop, one installer, no mandatory central compute beyond existing control-plane boundaries, optional BYOAI/local model, existing $0 beta contract; no paid data/feed/API/CDN/hosting prerequisite.

## 6. Open-source reuse roster and legal boundaries

**Reuse currently installed before new dependencies:** ECharts, Recharts, lightweight-charts, Embla, Framer Motion, Dockview, Tiptap and Radix/shadcn-compatible primitives. Validate real compatibility and bundle effects on current React/Tailwind/Zod before adopting any donor.

**Evaluate selectively:**
- `microlinkhq/metascraper` MIT for extracted link metadata (not image rights);
- `miniflux/v2` Apache-2.0 feed parsing/caching patterns (Go server is not a drop-in Electron dependency);
- `xyflow/xyflow` MIT React Flow for interactive relationship graphs if existing rendering inadequate;
- `maplibre/maplibre-gl-js` BSD-3-Clause for maps; validate legally usable tiles and offline bundles separately;
- `protomaps/PMTiles` reader/storage mechanisms if map tiles can be acquired/licensed without fee;
- `apache/echarts` already integrated; deep reuse for cross-domain interactive visuals;
- `kagisearch/kite-public` frontend design inspiration/source review; Kagi news data CC BY-NC **not importable into proprietary commercial feed without separate license**;
- `karakeep-app/karakeep` AGPL-3.0: study patterns only pending legal review; do not copy source into LiOS.

Donor audit: exact upstream commit/file, license, third-party assets, transitive dependencies, security, package footprint, proposed owner/adapter, alternative already present, evidence of real user experience improvement, tests and notices. Never copy paid visual designs or scraped premium datasets.

## 7. Four phases with acceptance and feature coverage

### P1 — Foundation: rich card contract, editorial media, trusted feed plumbing
- Reconcile main with open UX/theme/navigation PR heads; screenshot current Home/Chat/News/Project and 200% zoom/390px, establish before metrics and user journeys.
- Compatibly extend existing Wave D and current NewsItem at adapter seam with media/rights/story identity/source/freshness fields; existing consumers and saved objects must still work.
- Feed adapter + dedup + source clusters + permitted preview images + image failure placeholders + cache budget + offline state; reuse provider and trust receipts, no new separate feed store.
- Build shared visual card registry/hero/mosaic/list/carousel/skeleton, metadata and source overlay; bounded view density and no dead CTA.
- Tests: ingest rights/no-rights, wrong URL, missing media, duplicate stories, unsupported source, stale/offline, cross-tenant, image failures; visual smoke for diverse card types.
- **Exit:** real authorized story -> image-rich sourced card -> original evidence and Ask LiOS; no previous route/Artifact regression.

### P2 — One unified personalized discovery and home
**Delivers F01, F06, F07, F10, F12; introduces N03 initial radar and N06.**
- Upgrade existing FusionPulseBoard + project-aware Home, not a standalone Pulse tab/sidebar.
- Responsive For You/Following/Markets/Research and cross-domain source coverage; hero stories, category/topic chips, user-controlled recommendations, relevant watchlist, compact/comfortable options.
- Visual Search backed by existing search and entity/source permission scopes; card/gallery/structured result switching. What Changed from snapshot state since last visit.
- Smart Watchrooms via existing alert/P9 authority; opt-in local monitoring and notification controls, distinct from push service promises.
- Allow any news/research card to open Chat, source, canonical entity, search, existing Workbench or P4 Artifact context with continuity.
- Tests: relevance explanation, follow/mute, persisted settings, temporary/private scope, restart, stale feed, no data, feed-to-chat continuity.
- **Exit:** discover -> follow -> ask -> save -> reopen, across finance and at least two non-finance domains, in one workspace.

### P3 — Interactive intelligence and controlled AI visual answers
**Delivers F02, F03, F04, F05, F08, F09; introduces N01/N02/N03/N04.**
- Geographic maps, source-backed event timelines, P5 relationship graph, multi-source perspectives, comparative evidence, AI renderer registry and P11/P4 scenario interaction.
- Each graphical relation and computed value has inspectable source, provenance, temporal context or labelled hypothetical status; unsupported data yields honest empty state.
- Adopt React Flow/MapLibre only when P1/P2 baselines prove an unmet need; render lazy and enforce budgets.
- Controlled generative UI: LLM may propose a typed visualization descriptor with available card/evidence/Artifact refs; LiOS validates schema, entitlements, bounds and supported renderer and fetches data itself.
- Tests: unsupported descriptor, permission revoked, contradictory sources, non-US/non-finance entity, unknown geography, no image, no AI, malicious content, scenario cancel; Artifact version and read-state preserved.
- **Exit:** story -> visual map/graph/timeline -> evidence -> governed scenario -> canonical saved Artifact -> back to Chat.

### P4 — Premium enrichment, briefings and actual release qualification
**Delivers F11, N05/N07/N08; hardens all F01–F12 and future sponsored placement.**
- AI Briefing Studio with source-first slide/card outline, user review before render, P4 native artifact, optional TTS/audio/video if accessible at $0 and available locally/BYOAI; visual storyboard and event-mode.
- Visual polish: restrained motion, responsive card sizes, skeletal states, virtualization, cache/rights constraints, 200% zoom, keyboard, screen readers, reduced motion, focus-preserving navigation and low-power fallback.
- Evaluate clearly labelled sponsored-card design **only after** source/permission firewall exists; ads are off by default in research/work, never change objective analytical rankings, and never share confidential workspace data with ad providers. Avoid ad-network dependencies and claims of monetization before verification.
- Native beta packaging and regression per existing $0 release authority; source checks are NOT installed acceptance, unsigned beta is NOT P14 production signing.
- Tests: real installed Mac/Windows beta journeys, memory and startup budgets, network interruption, image/media cache failures, native screen reader/keyboard, release rights and evidence replay.
- **Exit:** source-grounded immersive UI, all 12 feature journeys independently exercised, no critical regressions, native acceptance evidence; market as beta only where zero-cost contract requires.

## 8. Experience and performance measurement

Compare against initial baseline, not claimed speculative improvements:
- 12/12 feature contract coverage and end-to-end test paths; do not equate documents with code shipped.
- 100% visible factual cards have source and time; all presented images have recorded permitted display rights or use fallback.
- Zero dead card actions, no offscreen/focus-trapped mandatory controls at 390px to desktop and at 200% zoom.
- 100% of model-generated factual chart data reconciles to a source/Artifact/input or is plainly identified as user-supplied simulation.
- Feed-to-research conversion, return visits, saved/continued work, watchroom follow-through and successful Artifact handoff measured in privacy-respecting optional local aggregate metrics.
- Establish quantitative performance budgets from actual baseline and target hardware rather than promising invented numbers; minimize active heavy chart/map engines when not visible.
- Secure failure cases: no unauthorized external image fetch, cross-tenant read, automatic consequential action, or unsigned beta auto-install.

## 9. Tracking and change control

This annex is a bounded TC/CA UX proposal, not a new SI program. Register the F01–F12 feature checklist and four-phase acceptance cases under existing TC/UX and SI-07 work coordination. Link to existing #91 for release only. Before editing active shell owners, inspect and coordinate PRs #223, #226, #227 and the latest main; use protected-main reviewed PR process. Merge only with real source and rendered evidence; report planned, code-present, source-tested, rendered-tested, native-tested and accepted separately.

**Immediate first engineering slice after review:** rights-aware image metadata and story identity adapter into existing Wave D/News, plus one real functioning Hero Story Card on FusionPulseBoard using existing source/evidence -> Ask LiOS -> return. This earns visible UX value before large library imports.

## 10. Evaluated agent-skill catalog: skill-issue.in (2026-10-27)

**Owner input:** https://skill-issue.in/ is a **discovery catalog for AI-agent skills**, distinct from reusable app source. Skill popularity/clicks/installs are discovery signals, not evidence of correctness, security, design quality or license. Catalog entries marked "Unverified link" require independent upstream inspection. **Never execute copied commands or install arbitrary skill packages directly from the index.** Retain LiOS original zero-cost, proprietary-source and AGENTS.md authority, review pinned upstream skill files and any scripts/commands/dependencies, run in a least-privilege context, and record exact revision, provenance and license. Agent skills are development-time guidance, not app/plugin runtime features.

### Shortlist — review-first, selectively apply

| Skill / upstream | Source finding | LiOS application | Decision |
| --- | --- | --- | --- |
| Anthropic frontend-design / \`anthropics/skills/skills/frontend-design\` | Original SKILL.md inspected. Specific design critique, typography, non-generic layout, restrained motion; accompanying Apache-2.0 license. | TC editorial feed, premium hero cards, interaction design, user-focused UI copy, screenshot-review loop | **High: pilot as design-review guidance; preserve LiOS design tokens and quiet-mode UX** |
| UI/UX Pro Max / \`nextlevelbuilder/ui-ux-pro-max-skill\` | Original GitHub MIT LICENSE and skill manifest inspected; styling/palette/font/chart reference catalog, optional paid premium tier advertised. | Source of visual references for a coherent LiOS design token refinement, not a second design system | **High: audit and sample free OSS data/scripts only, never require premium/paid tier** |
| Vercel React Best Practices / \`vercel-labs/agent-skills/skills/react-best-practices\` | Original MIT SKILL.md inspected: network waterfalls, bundle/performance, rendering and React rules, plus some Next-specific rules. | Performance gate for rich card lists, heavy ECharts/map/graph lazy loading, avoiding unneeded rerenders | **High: apply React-relevant rules; ignore Next.js-specific advice** |
| Vercel Web Design Guidelines / \`vercel-labs/agent-skills/skills/web-design-guidelines\` | Original SKILL.md inspected; fetches latest remote guidelines dynamically on each review. | Readability, keyboard, accessible interactive cards, responsive snapshots and QA | **High: pin/review external guideline content before use; never accept remote text as privileged instructions** |
| Taste Skill / \`Leonxlnx/taste-skill/skills/taste-skill\` | Original source inspected; differentiated app-screen workflow, optional Node/browser scripts and asset network calls. MIT repo metadata. | Secondary visual concept critique; app-screen rules rather than marketing-page run | **Conditional: use read-only guidance first; audit scripts and browser permissions before execution** |
| API Design Principles / \`wshobson/agents/plugins/backend-development/skills/api-design-principles\` | Original SKILL.md inspected; repo MIT; REST/GraphQL pattern guidance. | Review rights-aware image/link metadata contracts, source pagination, error/freshness behavior | **Medium: review existing P3/P5 APIs, not replatform backend** |
| Remotion Best Practices (catalog entry) | Identified by catalog; upstream content not fully verified in this evaluation. LiOS already depends on Remotion. | F11 AI Briefing Studio audio/video only where permitted and implemented | **Deferred to Phase 4; inspect original skill/release before use** |
| Agent Browser (catalog entry) | Identified by catalog; source and permissions not fully verified here. | Native Electron/web visual regression and screenshot comparison, subordinate to existing installed smoke harness | **Conditional; audit process, privileges and data exposure before running** |
| Tailwind Design System / \`wshobson/agents/plugins/frontend-mobile-development/skills/tailwind-design-system\` | Original SKILL.md explicitly targets **Tailwind v4**; current approved LiOS frontend stack uses Tailwind v3. | Design token ideas only | **Do not adopt its v4 code, CSS setup or upgrade directives** |
| Next.js App Router patterns (catalog entry) | Targets Next.js; current LiOS desktop UI is React/Vite/Electron, not Next.js. | No material fit | **Skip** |
| React State Management (catalog entry) | Generic suggestions; LiOS already has TanStack Query and canonical stores. | No new state ownership justified | **Skip broad installation** |
| Auth Implementation Patterns / OpenAPI Spec Generation (catalog entries) | Catalog identifies but marks at least some entries unverified; original files not reviewed. | Existing auth/permission/route contracts are authoritative; selective audits only after specific need | **Do not install or refactor auth/identity by default** |

### Use with the four-phase plan, without creating a skills product

- **Phase 1:** Read-only design and React performance guidance while constructing one sourced visual card and media-rights adapter. UI/UX Pro Max is a reference catalog; Anthropic skill is the guiding anti-generic design review. Pin skill revisions before authorizing any scripts.
- **Phase 2:** Apply Vercel UI/accessibility checks to FusionPulseBoard, Home and personalized discovery; performance rules for feed virtualization/lazy media.
- **Phase 3:** React performance checks for maps/graphs/rendered AI cards and API design review for existing source/evidence adapter contracts, never replace P2/P3/P4/P5 authority.
- **Phase 4:** Conditional Remotion skill review for briefings; screenshot-driven installed Electron audit, reduced-motion/contrast, memory/fps and the existing beta/rights gates.

### Integration security gate

**Skill read != component import != product feature delivery.** A skill cannot instruct agents to disable safeguards, install dependencies without review, run arbitrary shell/browser scripts, fetch third-party data or send project secrets, upgrade frameworks, edit canonical owner files without coordination, or claim source-only review equals real native acceptance. Prefer vendoring exact inspected Markdown guidance (with notices) or referencing a pinned reviewed upstream commit within the agent workflow, never a floating self-updating skill command in CI. This annex does not authorize a live installation, paid upgrade or executing untrusted skill-provided code.


## 11. PromptMotion.org: evaluated motion design / briefing workflow resource (2026-10-27)

**Source:** https://promptmotion.org/ — a curated creator-attributed gallery of AI motion design briefs, reusable workflows, launch films, UI motion and explainers. At inspection the home page advertises ~230 films and the prompt index >1,300 prompts. Prompts, videos, skill-like brief descriptions and source posts are **not a drop-in React UI library or licensed commercial application code**. Their creators retain rights as disclosed on the site. Evaluate original links and reuse only ideas/workflows with permission where needed; do not package, scrape, copy or republish another creator's finished videos, images, artwork or proprietary brand visuals. A public copy button does not establish a standalone MIT license.

### Relevant reviewed examples

| Reference | Source | LiOS application | Decision |
| --- | --- | --- | --- |
| Sahi trading terminal reveal | https://promptmotion.org/dale-vaz-cc612a | Study cinema-style product walkthrough of real charts, watchlists and panes; create original, truthful LiOS product reveal from captured real UI | **Use as design inspiration, not imported video/UI** |
| Article-to-video six-file harness | https://promptmotion.org/prompts/p-a1aab88a | Source-verified \`spec.md\`, \`data.json\`, \`story.md\`, code-rendered \`Scene.tsx\` and \`timing.ts\` process for intelligence storytelling | **High priority for Phase 4 F11 briefing** |
| Modular animated chart-to-camera workflow | https://promptmotion.org/prompts/p-f21127ea | Motion chart explainer where source-backed data flows through existing ECharts/P4 views into a reviewed storyboard | **High priority for Phase 4 F11/N05** |
| Developer portfolio product showreel | https://promptmotion.org/wani-shola-16ca7a | Real captured app screens, three-color restraint, one idea per shot, measured easing and typography; premium external marketing | **Useful for LiOS release/demo, not core UX donor** |
| Shape/morphing UI, timeline and data-viz examples | https://promptmotion.org/prompts | Review visual pacing, meaning-bearing transitions, annotated timelines, coherent movement | **Secondary Phase 1/3 inspiration** |

### Technical strategy and anti-gimmick gate

- **Keep actual desktop UX quiet.** UI microinteractions should communicate causal change: feed card expands into inspection; timeline focus maps to selected chart point; evidence view reveals supporting source; saved Artifact acknowledges completion. Avoid continuous animation, confetti, kinetic typography over data, forced full-screen intros, excessive 3D and motion that obstructs analysis.
- **Reuse current stack rather than import a new runtime.** Existing \`src/package.json\` already includes \`framer-motion\`, \`echarts\`, and Remotion scripts. Motion graphics are a controlled renderer of approved content, not a replacement for component contracts, charts, signed data, source rights or existing TC/P4 state.
- **Content-to-video should be built from canonical data.** An authorized saved source/Artifact provides structured \`sourceRefs\`, units, snapshots, times, claims and rights -> user-reviewable storyboard -> render parameters -> optional local Remotion/export -> finished brief and original provenance. No unsourced invented metrics, fabricated documentary images, or impermissible media redistribution.
- **Permissioned execution.** All media rendering is explicit user action; process/workspace constraints and sandbox/secret/network policies remain under existing GM/P4. No mandatory cloud AI, paid video provider or new hosted infrastructure; if optional render dependency unavailable, retain static visual storyboard/PDF/PPTX fallback.
- **Performance and accessibility.** No auto-play on Home or workspace; pause, reduced motion, low-power budget, render cancellability, keyboard operation, alt text/captions and honest progress and failure states.
- **No dependency on any particular model.** Many site examples mention Claude, but any chosen local/BYOAI agent capable of structured storyboards can participate in the existing reviewed workflow without relaxing deterministic source verification.
- **Donor classification:** workflow/prompt inspiration; commercial reuse rights are not established; zero automatic source-code import. A separate permissively licensed Remotion component source could be imported only after exact file and license audit.

### Phase inclusion

**Phase 1:** add intentional motion tokens + reduced-motion and card-to-evidence transition acceptance.  
**Phase 2:** subtle Pulse feed-to-investigation, What Changed and watchroom state transitions.  
**Phase 3:** map/graph/storyline motion representing verified temporal and relationship changes.  
**Phase 4:** F11 AI Briefing Studio, chart animations and external product demo from real captured LiOS UI; source/evidence/time/rights and original creator licenses audited.

**Recommendation:** adopt Prompt Motion as a **curated motion/briefing inspiration source**, especially F11, rather than modifying core architecture or wholesale importing animation prompts/assets into production.
