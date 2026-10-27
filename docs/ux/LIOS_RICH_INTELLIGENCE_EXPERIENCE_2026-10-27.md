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


## 12. Watermelon UI — direct permissive component donor, selective source-port approval (2026-10-27)

**Sources:** https://ui.watermelon.sh/ ; https://github.com/WatermelonCorp/watermellon-registry ; https://github.com/WatermelonCorp/watermelon-platform ; https://ui.watermelon.sh/framework-support  
**Status:** SOURCE-INSPECTED ADAPTATION SHORTLIST, not yet imported, tested, accepted or shipped.

### Observed source/licensing/compatibility facts

- Registry repository \`WatermelonCorp/watermellon-registry\` has a root MIT license (copyright Watermelon Contributors) and supplies component implementations as shadcn-style registry JSON under \`public/r/*.json\`. Each JSON contains dependency lists and one or more actual TSX file bodies; copying permitted original code requires preserving copyright/license notices and auditing any bundled media, fonts, icons, trademarks and transitive libraries **independently**.
- Website advertises 600+ components/100+ animations; registry and current platform are separate upstream repositories. Counts are upstream claims, **not** a measure of quality/completeness of locally inspected examples.
- Current registry package uses React 19.2.7, Tailwind 4.3.1, \`motion\` 12, \`framer-motion\` 12, Radix/shadcn and Vite; site compatibility notes say component React 18 or 19 **but Tailwind v4 is required as published**. LiOS current \`src/package.json\` uses React ^18.3.1, Tailwind ^3.4.17, \`framer-motion\` ^11.13.1, \`embla-carousel-react\` ^8.6.0, ECharts and existing Radix UI. **Do not bulk-install upstream registry or upgrade React/Tailwind/Zod/Motion.** Source-port single vetted TSX at a time, replacing Tailwind4-only syntax and imports while keeping canonical LiOS tokens, icons, owner boundaries, reduced-motion and installed Electron viability.
- Registry samples include toy-looking styles, hard-coded sample amounts and URLs. \`expandable-event-card\` defaults to \`https://assets.watermelon.sh/event.avif\` and a festival headline; \`revealing-cards\` embeds fictional credit-card amounts; \`command-search\` embeds default menu items; \`portfolio-dashboard\` is mostly example layout/data and pulls many shadcn registry dependencies. None may be shown as real LiOS observations or fetched remotely by default.
- Some samples use clickable \`div\` instead of keyboard-operable button/anchor (e.g. expandable-event-card). Fix keyboard operation, focus/escape, dialog labeling, reduced motion, alt text and source scope before shipping. Recheck all code line-by-line before importing.

### Ranked component-level donor matrix

| Upstream registry file / component | Intended LiOS owner + experience | Decision | Evidence/gates |
| --- | --- | --- | --- |
| \`public/r/expandable-event-card.json\` | Existing Wave D/FusionPulseBoard and News card: rich story opens evidence in-place | **P1 top pilot** | Reuse layout/shared-transition idea, replace fake title/image with rights-aware source data; repair clickable-div keyboard semantics, modal/focus and user-action routing |
| \`public/r/motion-carousel.json\`, \`minimal-carousel.json\`, \`carousel-navigator.json\` | F01 Pulse highlights, F11 briefing slides, N05 storyboards | **P1/P2 adapt narrowly** | Embla already installed; prefer one existing carousel ownership, avoid redundant Motion 12 dependency; no autoplay, carousel keyboard controls and reduced-motion |
| \`public/r/activities-card.json\` | F07 What Changed, F12 Watchrooms, Project activity | **P2 selective port** | Remove decorative pastel/icon tiles; bind actual P3/P9 event receipts, timestamps and ordered entries |
| \`public/r/morphing-discovery-bar.json\` | F10 Visual Search/F01 topic navigation within Chat/Home | **P2 design prototype only** | Keep existing Cmd/Ctrl+K and canonical search owner; inspect actual triggers/focus/escape and do not create parallel command/search routes |
| \`public/r/preview-link-card.json\`, \`hover-card.json\` | F08 Perspectives/F05 visual evidence preview | **P2/P3 guarded port** | Source/media URL safety, rights, popup focus, no background remote image fetches; adapt Tailwind4 origin utilities and \`radix-ui\` meta-package to LiOS existing primitives |
| \`public/r/continuous-tabs.json\` | F01 existing For You/Following/Markets/Research switching | **P2 optional only** | Existing tabs may already be better; preserve aria tablist, keyboard operation and context continuity |
| \`public/r/range-selection-slider.json\` | F09 Scenario Playground numeric range interactions | **P3 adapt controlled input** | No business logic or fabricated calculations in UI; validation/units/canonical P11/P4 recalculation, accessible slider handles |
| \`public/r/collection-grid-disclosure.json\` | F06 My Intelligence Desk, F10 visual result galleries | **P2/P3 conditional** | Avoid heavy icon sets / duplicate disclosure; keyboard+scroll focus, lazy imagery, readable metadata |
| \`public/r/portfolio-dashboard.json\` and other whole dashboards | Inspiration for professional grids and information hierarchy only | **Do NOT bulk copy shell** | Demo content, alternative navigation/state/copy and large dependencies conflict with canonical LiOS; borrow specific audited layout sections only |
| \`public/r/revealing-cards.json\`, assorted flashy buttons/flip-card | Only if deliberate UX proves practical | **Mostly reject for everyday terminal** | Fictional amounts, drag gimmicks and bright decorations risk childish presentation; avoid arbitrary motion |

These registry names and several full TSX bodies were verified in upstream source on 2026-10-27. No component code was imported in this planning step.

### Concrete import method — copy the right parts, never build an isolated UI kit

1. Choose a specific LiOS use case and capture baseline of existing real screen, user navigation and density controls.
2. Inventory current LiOS equivalent (Radix, Motion, Embla, Wave D, P4 Artifact, ECharts). Determine whether reuse of **existing** code is already sufficient.
3. Fetch upstream **exact pinned commit, registry JSON and embedded TSX**, audit MIT+third-party licenses and any sample images; record source path/hash and notice.
4. Port only the needed component into the existing TC UI owner; adapt React18/Tailwind3/Motion11 imports, graphite/gold tokens, typography and mobile/focus/reduced-motion rules. Remove demo state/content and all hard-coded external media.
5. Bind every card/chart/action to current user-scoped, source-backed Wave D/P3/P5/P4/P9 data, keep canonical request and permission pipeline; no parallel stores, search, navigators or data clients.
6. Test TypeScript, license/OSS gate, unit behavior, source/rights, 390px/desktop/200% zoom, keyboard, screen reader, stale/offline, reduced-motion, actual Electron rendering and regression screenshot against a genuine UX baseline.
7. Import only if it measurably improves the intended journey and avoids compatibility/security regressions. Reject with evidence when the incumbent LiOS primitive does better.

### Four-phase integration

- **Phase 1:** port one professional, sourced \`ExpandableStoryCard\` adaptation from \`expandable-event-card\` into existing Wave D/FusionPulseBoard as a controlled trial; establish shared tokens and component provenance.
- **Phase 2:** enrich feed carousel/activity/discovery controls with selective Motion/Embla adapters, preserving the current Home/Search/Watchrooms authority.
- **Phase 3:** use vetted evidence previews and scenario slider affordances when native LiOS primitives fall short; charts/maps/graphs still require separate specialist donor evaluations.
- **Phase 4:** refine transitions and briefing carousels; mature accessibility, source rights, performance, memory, native installed Mac/Windows regression and the existing $0 beta release contract.

**Recommendation:** Watermelon is a **priority permissive source-code donor** for small, polished interactive UI parts, but **not** a blanket replacement for LiOS's visual design system, desktop application shell, analytics, evidence model or backend. Its own marketing claim "production ready" is not LiOS native acceptance.


## 13. Expanded code-first donor assimilation — owner direction 2026-10-27

**This is the latest controlling donor-selection interpretation within this UX annex and supersedes narrower earlier shortlists/rejection language in this file wherever they conflict.** **No arbitrary cap on volume, whole screen/subsystem reuse or framework upgrades** if the improvement is material and verified. Reuse the maximum safe, licensed, maintainable donor code. The distinction is **not** 'small component allowed / big component forbidden'; it is 'improved LiOS experience with functioning original owners / competing or fragile stack'. Research/UX references can inspire design, but only inspected permissibly licensed source code can be directly imported without additional permissions.

**Truth limitations:** this was GitHub source inspection and targeted code review, not full source line-by-line audit of every candidate, browser screenshots, source integration, native Electron acceptance, full dependency closure, or a successfully executed upstream app. Planned != source-present != source-tested != rendered-tested != native-tested != shipped.

### 13.1 Code-derived baseline, not previous summaries

Selected actual LiOS files directly read (public main as inspected):
- \`src/shared/waveDContracts.ts\` — 386-line Wave D card/evidence/scoring/action/What Changed contract; \`src/server/waveDRoutes.ts\`, \`waveDIntegrations.ts\` — real Pulse routes with sources and optional evidence-bounded BYOAI. **Reuse and extend.**
- \`src/client/src/components/terminal/FusionPulseBoard.tsx\` (~299 lines) — functional four channels/market metrics/card rows but information-dense/small type; \`IntelligencePulse.tsx\` — risk/matrix overlay; \`HomeAttentionPanel.tsx\` — Action Inbox/evidence. **Converge visual presentation only.**
- \`src/client/src/components/panels/NewsPanel.tsx\` (~232 lines) + \`src/client/src/lib/finance.ts\` — text-first article lists, filtering, source and timestamps but no media presentation contract. **Media rights/actual source story identity is the main P1 gap.**
- \`GraphExplorer.tsx\` (~96 lines) — existing cross-domain graph is rendered from fixed trigonometric \`nodePosition\` coordinates, bounded to 120 intelligence objects, object actions and filters. **Enhance canvas/zoom/layout/edge interactions using React Flow or alternative, retain cross-domain graph function and permissioned actions.**
- \`ImpactMap.tsx\` — existing *scenario assumption impact* presentation, not geolocation; \`CoverageMapPanel.tsx\` is a provider-region coverage matrix, not event map; \`VisualCanvas.tsx\` provides visual environment/backdrop, not geospatial investigation. **F02 needs real geographic renderer/locations, not an invented claim of existing map coverage.**
- \`WorkSearchDialog.tsx\` (~201 lines), \`CommandBar.tsx\` (~513 lines) — real search/keyboard command ownership exists. **Enhance UX, do not fork another search route.**
- \`geminiNewsService.ts\` — existing Google News RSS XML reading via fast-xml-parser, BYOAI summarization, first 5 items with link/title/published/source; \`gdeltData.ts\` — GDELT API throttled/cached media data. **No new standalone RSS/cloud backend required for first version.** Source eligibility, provider terms, broader cross-domain queries, dedup/media fetching/caching rights need targeted work.
- \`src/remotion/DemoVideo.tsx\` and \`Root.tsx\` — real 1,800-frame Remotion demo scaffold but hard-coded sample quotes and headlines; **not a production grounding path**. Do not reuse fabricated ticker values or pretend demo clips are observed research.
- Existing source imports \`src/client/src/components/terminal/SourceCatalogueSearch.tsx\` already adapt permissive OpenSourceUI donor code with provenance. Reuse this path-level pattern.

### 13.2 Watermelon deeper actual source read — two MIT repos, large reuse allowed

**Pin for repeatable source inspection (2026-10-27):**
- Platform \`WatermelonCorp/watermelon-platform@7b93bcfe8d8b44a462dc676d842bb54056faab0f\` root MIT; current components in \`src/data/contents/animated-components/<slug>/{base,original}.tsx\`; new \`skills/make-interfaces-feel-better\` and \`skills/watermelon-ui\`.
- Registry \`WatermelonCorp/watermellon-registry@86052b8fd12bc19bf3bac07625a7f93736c42b17\` root MIT; composable TSX bundled within \`public/r/<slug>.json\`. Platform's \`scripts/generate-shadcn-registry.ts\` fetches older registry for blocks/dashboards, builds animated component registry from maintained platform source; **check newest platform canonical TSX before importing old registry versions**.
- Published stack uses React 19, Tailwind 4, Motion 12; LiOS current \`src/package.json\` uses React18, Tailwind3, \`framer-motion\`11, Embla8, ECharts6, Recharts2. Watermelon publicly states React18/19 compatible *but* Tailwind4 required for as-is installation; assess both port and controlled UI modernize path.
- Audited actual source of \`contextual-ai-bar\`, \`inline-table-control\`, \`layered-progressive-disclosure\`, \`macos-sidebar\`, \`journal-navigation\`, \`quick-switcher\`, \`extended-toolbar\`, \`onboarding-setup\`, \`feature-tour\`, \`inline-action\`, \`quick-feedback\`, \`list-stack\`, \`expandable-event-card\`, \`command-search\`, \`morphing-discovery-bar\`, \`inline-toast\`, \`carousel-navigator\`, \`continuous-tabs\`, \`minimal-carousel\`, \`filter-disclosure\`, and registry variants of cards/carousels/preview link/slider/dashboard. **Sample code presence does not imply quality or user-tested completion**.
- Several real examples have fixed demo amounts/titles/external media, redundant icon packages, local-only state, or pointer-only clickable containers. Examples do not automatically meet WCAG, data rights or professional density. Plan to improve entire interaction, not merely reskin small cards.

**Expanded direct-source import catalog** (no arbitrary count limit; order is priority, not blanket approval):

| Priority | Upstream component or complete subsystem | LiOS live integration target | Selection notes from inspected source |
| --- | --- | --- | --- |
| P0 | \`expandable-event-card/base.tsx\` + image-led card sections and full story treatment | \`FusionPulseBoard\`, \`NewsPanel\`, Wave D card registry | Import TSX composition and motion where advantageous; replace unlicensed hardcoded \`assets.watermelon.sh\` event image + festival placeholder, use keyboard-safe trigger, grounded story & evidence |
| P0 | \`activities-card/base.tsx\` + \`list-stack\` | What Changed/Action Inbox/Watchrooms/Project continuity | Feed of real event/monitor records, semantic list/action rows, no fake counters |
| P0 | \`morphing-discovery-bar/base.tsx\` + \`command-search\` | Topic discovery/Visual Search UI within existing command and work search | Reuse interactions, not sample Calendar/User commands or second routing/state store |
| P0 | \`contextual-ai-bar/base.tsx\` + \`quick-switcher\` | Contextual Ask/Analyze/Compare actions attached to story/visual/Artifact | Compose with existing P2 Chat and no duplicated AI executor |
| P0 | \`layered-progressive-disclosure\`, \`filter-disclosure\`, \`collection-grid-disclosure\` | Progressive article filters, investigation depth, source comparison panels | Audit nested scrolling and pointer-only interactions; remove extraneous dependencies and dark-mode contrast failures |
| P1 | \`continuous-tabs\`, \`fluid-tabs\`, \`discrete-tabs\`, \`carousel-navigator\`, \`motion-carousel\` | Existing For You/Following/Markets/Research channel selection, hero stories, briefing galleries | Select coherent set; keep semantic tab keyboard, Embla architecture where useful; measure smoothness |
| P1 | \`preview-link-card\`, \`hover-card\`, \`expand-details\` | Source/evidence preview; claims, citations and supporting research documents | No involuntary remote fetch; safe user-authorized preview and P3 trust scope |
| P1 | \`journal-navigation\`, \`event-reminders\`, \`feature-tour\` | Story Evolution, event chronology and optional explainable onboarding | Source timeline plus timestamps, reduced motion, optional tour not unavoidable overlays |
| P1 | \`inline-action\`, \`quick-feedback\`, \`inline-toast\` | Save/follow/review/monitor status with rollback/receipt and undo where applicable | Async success must reflect actual server outcome; no optimistic false confirmation |
| P1 | \`inline-table-control\`, \`extended-toolbar\` | Evidence comparison tables, selected data and Artifact inline tools | Preserve canonical P4 versions, editable permission rules, unit/snapshot semantics |
| P2 | \`adaptive-slider\`, \`range-selection-slider\`, \`knob-slider\` | P11 scenario assumptions and constrained policy sensitivity exploration | Separate UI draft from deterministic engine; proper units/range/input review |
| P2 | \`onboarding-setup\`, \`integration-card\`, \`feature-tour\` | Contextual inline connectors/plugins and first-time LiOS guidance | Avoid alternate setup flows, silent provider activation and shallow marketing copy |
| P2 | \`macos-sidebar\`, \`journal-navigation\` | Evaluate professional layout ergonomics and project/history navigation | **Full layout adaptation permitted** if superior to in-progress #226/#227 and existing canonical shell; no second permanent sidebar |
| P2 | Entire Watermelon dashboard and block compositions (\`agndex-dashboard\`, \`business-operations-dashboard\`, \`portfolio-dashboard\`, \`gridline-dashboard\`, etc.) | Replace/reshape one specific LiOS Home/Workbench visual section with complete quality-controlled composition | **Full page or large subsystem reuse permitted**, provided demo data, competing navigation, extra fake permissions, licensing and dependencies are replaced; compare real screenshots/journeys against incumbent |
| P3 | \`card-swipe\`, \`revealing-cards\`, \`minimal-carousel\`, \`radial-carousel\` | Rich content browsing/story decks *only where usability research supports* | Retain bold editorial variety; avoid relying on gesture-only controls, hidden actions or distracting stacked motion |

**Donor reuse can go beyond this list:** review ALL relevant Watermelon component/block/dashboard/template source as needed for each LiOS screen, not just preselected slugs. A safe source-port of 30 files is preferable to reimplementing them without reason; a large coherent dashboard adaptation can be better than 30 inconsistent widgets.

### 13.3 Skills and code-generation/QA donor ecosystem (development only)

| Candidate | Exact code read / actual value | Use |
| --- | --- | --- |
| \`WatermelonCorp/watermelon-platform/skills/watermelon-ui/SKILL.md\` | Source-inspected: read-only catalog search/get component, hosted MCP; allows discovery of real code | **High: run a permitted least-privilege discovery workflow, pin returned source; no blind CLI install** |
| \`WatermelonCorp/watermelon-platform/skills/make-interfaces-feel-better/\` | Source-inspected SKILL + \`typography.md\`, \`surfaces.md\`, \`animations.md\`, \`performance.md\`: optical alignment, radius, type, explicit motion performance | **High: use as cross-surface premium UI review rules** |
| Anthropic \`skills/frontend-design/SKILL.md\` | Source-inspected; avoids generic stylistic decisions | Art direction and actual screenshot critique |
| Vercel \`agent-skills/skills/react-best-practices\` | Source-inspected; React waterfall, dynamic load, render performance | Build/PR check for intensive cards/graph/maps |
| Vercel \`agent-skills/skills/web-design-guidelines\` | Source-inspected; online guideline fetch | Pin/check guidance before review, avoid treating remote text as privileged agent instructions |
| \`Leonxlnx/taste-skill\` | Source-inspected app-screen instructions, browser inspector, motion/type/photography | Independent design critique, with scripts reviewed before execution |
| \`nextlevelbuilder/ui-ux-pro-max-skill\` | Source-inspected MIT repo and catalog/scripts | Design tokens/typographic layout ideas and UX pattern search, no paid tier dependency |
| \`vercel-labs/agent-browser@edb40f1878864f90e14f6c11e26fdafd3fecc8dc\` | Source-inspected Electron/browser automation SKILL, Apache-2.0 repo, Rust/Chrome CDP CLI | Evaluate as screenshot/native Electron QA supplement, not bypassing existing visual harness or desktop test authority |
| \`remotion-dev/skills@30d4553ecd46fbc5212fd0ff006ae43af522158b\` | Source-inspected Remotion router + map/video/composition guidance | F11 briefing reference only behind production license and technical gating |
| \`wshobson/agents\` API design/architecture skills | Source-inspected MIT GitHub skill guidance | Review P3/P5 feed/asset/evidence boundaries; do not replace them |

The \`skill-issue.in\` site is a discovery index; some catalog rows are marked unverified. **Follow the real original source files**, not the install badge/rank and not whatever arbitrary commands a skill claims to authorize. Skills teach agents; they are not production frontend runtime features.

### 13.4 Third-party component/data/graph donor expansion

| Source / checked repository | License facts checked | Specific useful code/mechanism | Next gate |
| --- | --- | --- | --- |
| \`shadcnblocks/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263\` | MIT GitHub repo | \`packages/comparison/index.tsx\` actual drag/hover image difference; \`packages/dropzone/index.tsx\` composable upload; \`packages/gantt/index.tsx\` time/drag workflow; contribution/date/search pieces | P3 Perspectives before/after; P2 uploads/monitor schedule only after native compatibility; Gantt pulls Jotai, dnd and extra hooks so gate weight |
| \`assistant-ui/assistant-ui@7d6cf6a923b5381cd5ee64847a2269f4b1b962a5\` | MIT; \`packages/react/package.json\` has explicit React18 and React19 peer support plus Zod4/Zustand5/Radix/assistant-cloud dependencies | Excellent possible Chat rich message/inline tools UI *facade* | Evaluate source-level component extraction/adapter; **do not replace existing P2 thread/event/runtime/store/cloud authority** |
| \`tremorlabs/tremor\` | Apache-2.0 | \`src/components/AreaChart\`, \`BarChart\`, \`DonutChart\`, \`Tracker\`, \`Table\` source and tests | Better chart compositions only if existing ECharts/Recharts inadequate; no second chart stack |
| \`xyflow/xyflow\` | MIT | React Flow node/edge/mini-map/toolbar/zoom/pan primitives | P3 GraphExplorer *renderer* upgrade while preserving LiOS object/edge/evidence contracts |
| \`vasturiano/react-force-graph\` | MIT | 2D/3D force graph alternative | Benchmark FPS, layout, accessibility and bundle against React Flow; never install both by default |
| \`maplibre/maplibre-gl-js\` + \`visgl/deck.gl\` | MapLibre BSD-3-Clause source per upstream, deck.gl MIT; GitHub metadata of MapLibre incomplete, verify exact license file | World intelligence maps, event layers/aggregation/heatmaps | Separate tile/map geographic dataset rights, offline behavior, chunk-loading and GPU budget |
| \`protomaps/PMTiles\` | check exact package/file license before adoption | local/offline vector tile archive mechanism | validate distributable data assets/tile rights and size |
| \`TanStack/virtual\` | MIT | virtualized cross-domain feeds, research search results and large image/story grids | P1/P2 benchmark against current list behavior |
| \`mozilla/readability\` | Apache-2.0 | article text extraction under actual publisher access conditions | P1/P3 only if terms allow retrieving and caching text; prompt-injection and SSRF boundaries |
| \`microlinkhq/metascraper\` | MIT | OpenGraph/JSON-LD metadata extraction | P1 server-side link/image description adapter; **metadata image URL is not reuse rights** |
| \`rbren/rss-parser\` | MIT | lightweight Node RSS/Atom parsing | Compare directly against existing \`fast-xml-parser\` in \`geminiNewsService.ts\`; import only if actual correctness/format breadth improves |
| \`Miniflux/v2\` | Apache-2.0 | feed polling, dedupe, retention and caching implementation lessons | Can adapt Go service algorithm/architecture or source as separate local service only if justified by packaging tests; no mandatory cloud feed server |
| \`KagiSearch/kite-public\` | MIT frontend, dataset rights independent/noncommercial | topical news/cluster and source perspective UI inspiration | No licensed Kagi feed dataset import without permission |
| \`RSSHub/RSSHub\`, \`RSSNext/Folo\` | AGPL-3.0 repository source | feed/trend/reading patterns useful for conceptual benchmarking | Copyleft gate: no code wholesale into proprietary core absent counsel/licensing decision |
| \`magicuidesign/magicui\`, \`ibelick/motion-primitives\` | MIT repo metadata, inspect exact component license/path prior to copying | Animations, bento and content hero compositions beyond Watermelon | Evaluate direct source donor when a tested LiOS screen needs the effect, not broad extra packages |

**Avoid assuming MIT root covers arbitrary image/video/font/icon/sample data or every transitive package.** A larger donor import needs better license due diligence, not a categorical size ban.

### 13.5 PromptMotion deep audit — inspiration yes, source code only when attached & licensed

- \`promptmotion.org\` provides creator-attributed motion briefs and videos; its prompts are not a published MIT React registry. Source-based visual references inspected: https://promptmotion.org/prompts/p-a1aab88a (evidence + data.json + code + timing, renders/stills/review), https://promptmotion.org/prompts/p-b0c58a8a (reusable parametrized compositions for social/video aspect ratios), https://promptmotion.org/prompts/p-30d95445 (separate controllable transition parameters), https://promptmotion.org/wani-shola-16ca7a (real UI capture/large type/brand-limited product demo).
- **Import patterns aggressively**: story beat logic, frame/timing parameters, reusable shot renderer interfaces, transitions, code-to-video composition strategies and screenshot render/review loops; write original LiOS content and implementation when no permissively licensed source code is provided.
- **Critical hidden license gate found 2026-10-27:** current Remotion repository license is **source-available custom**, not OSI-approved MIT/Apache; official licensing generally grants Free License to individuals and companies/teams up to three people, with Company License normally required for 4+ people and use-case-dependent redistribution/automation conditions. See https://www.remotion.dev/docs/license/pricing and https://www.remotion.dev/docs/license/faq and https://github.com/remotion-dev/remotion/blob/main/packages/core/LICENSE.md . **LiOS already contains \`src/remotion/DemoVideo.tsx\` example/demo-only Remotion code, not permission to include a user-facing bundled video rendering engine indefinitely.** Audit organization size, use scenario, end-user redistribution/usage and specific version *before* making F11 production-critical. No paid subscription or license is allowed under $0 release owner lock: if ineligible, render F11 first as source-grounded editable visual Artifact/storyboard and evaluate MIT/Apache local composition/FFmpeg paths instead. Do not misrepresent Prompts Motion creations as LiOS-owned video rights.

### 13.6 Honest framework decision — import broadly, modernize only with tested proof

**We are not ideologically restricting LiOS to React18/Tailwind3.** Two admissible approaches:
- **A. Maximal tested source-port first:** import substantial coherent React components/block compositions into current React18/Tailwind3 using code transforms, existing theme variables and Framer Motion/Embla; no global dependency upgrade required. Good for rapid first visible improvements and minimal merge conflicts.
- **B. Isolated modern stack spike:** on an independent experimental branch/worktree (never blindly on release main), upgrade React18->19, Tailwind3->4, Motion11->12 and Zod3->4 only if needed for a compelling >component-scale donor integration. Compare whole-application typecheck, offline/native test suite, CSS rendering, dark theme, accessibility, Electron CSP, P4 spreadsheet/document editing, existing Radix/shadcn, project/chat persistence, binary size/startup/memory, current active PRs and rollback. Migration approval is determined by measured UX and platform benefit, not fashion or fear. **Rollback on failures, avoid partial parallel framework runtimes.**

Whole-dashboard imports, cloned interactions, multiple upstream component collections and substantial backend source are explicitly allowed whenever licenses, compatibility, one-owner integration and real native quality pass.

### 13.7 Phase-by-phase executable import ledger

**Phase 1 — Import-ready premium foundation (F01–F12 shared dependency):**
1. Freeze exact public main/UX PR heads; open real Home/Chat/News/Graph/Briefing at 390px, 768px, desktop/200%; capture source/rendered/native baselines and identify where existing code is superior.
2. Track source SHA/paths and notice for imported donor files. Trial Watermelon cohesive \`ExpandableStoryCard\` **and** \`contextual-ai-bar\` + \`activity-card\`, with right sourced story/permission/review actions. First visual experience must not require 4 new package managers.
3. Plug into Wave D/News existing item/envelope with allowed image metadata, alt/attribution/cache rights, source-provenance click path and published/observed timestamps. Use existing Google News RSS/GDELT provider through existing routes where legal/available; compare \`metascraper\` and \`readability\` with actual provider rules. Add safe imagery fallback and story dedup.
4. Build shared editorial hierarchy of hero image + trusted synopsis + source, rich/compact cards + expanded investigation; buttons route to existing Chat, sources, artifacts and monitor.
5. Check types/tests/CSP/SSRF/cross-project/no-source/404/stale/offline/keyboard/reduced-motion and real Electron screenshot; **ship first vertical slice before adding more dependencies**.

**Phase 2 — Import the best complete discovery experience (F01/F06/F07/F10/F12 + N03/N06):**
1. Adapt substantial Watermelon discovery/animation sets, selected dashboard compositions and optional Kibo UI/virtual lists; compose one coherent responsive Home+Pulse; retain user controls to switch editorial/compact/focus.
2. Features: cross-domain topical story collections, ranked & deduped For You/Following/Markets/Research, topic explorer, hover source previews, Explain This Feed, What Changed receipt feed, visual search gallery, Project/recents continuation and Smart Watchrooms/notifications under P9.
3. Native journey: first launch/connect or skip -> discover -> inspect evidence -> ask -> follow -> set monitor -> reopen after restart; finance + healthcare + policy or energy use cases; no fabricated evidence.
4. Benchmark adaptation of full Watermelon \`portfolio-dashboard\`, \`business-operations-dashboard\`, \`gridline-dashboard\` against existing quiet UI and actual user work. If a cohesive full layout wins, import it after replacing dummy data/navigation/permissions.
5. Ensure large feeds are virtualized/lazy and high-quality media doesn't block typing/streaming or local artifact actions.

**Phase 3 — Import mature interactive investigation (F02/F03/F04/F05/F08/F09 + N01/N02/N03/N04):**
1. Wire \`GraphExplorer\` object's existing cross-domain graph function to React Flow or higher-performing qualified alternative; preserve evidence and object action ownership; not a second graph database.
2. Add true geospatial event map with MapLibre/offline permitted tiles and optional deck.gl visual aggregation; geolocate only sourced places/events, leave unknowns unknown.
3. Story timeline/journal, source/claim comparison via Kibo comparison mechanisms, open linked evidence, scenario sliders using existing deterministic P11 engine and P4 review.
4. Typed AI visual cards in current chat: model proposes approved renderer type and current data/Artifact/source refs; LiOS validates and retrieves data independently, denies arbitrary JS/HTML and unreviewed operations; context preserved across Workbench.
5. Complete story -> evidence/graph/map -> scenario -> existing P4 same-ID Artifact -> back-to-chat. Exercise contradiction, stale source, zero records, revoked permissions, pathological nodes and low memory.

**Phase 4 — Adaptive premium finishing + briefings + release (F11/N05/N07/N08 plus regression for all):**
1. Approved Remotion only under documented valid free licensing; otherwise source-backed local editable visual storyboards/P4 slides and reviewed permissive video alternatives. Permit interesting animated diagrams, transcripts and high-quality captured product demos without unsourced financial headlines.
2. Watermelon details skill + Anthropic/Vercel/Taste design critique: typography, optical alignment, layer depth, accessible keyboard/touch, responsive densification, reduced motion, physics/duration, screenshot comparison.
3. Optimize file/binary/resource budget, CSP, current security controls, no outbound ad private data, source rights and cached asset expiry; optional clearly labeled sponsorship isolated from ranking.
4. Native Mac and Windows **installed zero-cost beta** full route journey and error/restart/backup tests; CI green != native release. Preserve existing P14 signed production truth and $0 beta policy.

### 13.8 Stop/go and measurable quality acceptance for donor code

- **No import count restriction:** smallest useful component, coherent 40-file subsystem or full working screen can be correct. Donor acceptance depends on measured improvement + legal/security/owner fit.
- **Experience:** prominent real media when legally allowed, readable editorial text, restrained chrome, meaningful animation, fast consistent shared transitions, no fake financial data, no under-10px functional labels in premium reading mode. Provide cross-domain visual variety, not an endless stack of tiny template cards.
- **Architecture:** existing TC visible shell; P2 Chat; P3/P5 evidence/entity; P4 Artifacts; P9 watchrooms; P11 deterministic scenarios; GM/P13 trust/security; all data stays on user-authorized topology.
- **Reliability:** role/tenant permission tested, safe link/image downloads, image metadata vs. media rights separated, stale/offline fallback, deterministic source timings, no no-op buttons; data remains across restart and permission boundaries.
- **Performance:** measured startup/CPU/RAM/GPU and heavy view lazy-loading on actual reference Mac M2 and Windows, responsive typing while rich content loads, no regression to streaming or Artifact round-trip. Set numeric budgets after baseline.
- **Proof:** \`source-present\`, \`source-tested\`, \`rendered-tested\`, \`native-installed-tested\`, \`accepted\` are separate columns in donor ledger; exact SHA source imports, file modifications, license and notices, screenshot pre/post and negative test proof.
- **Sequence discipline:** PR #229 remains planning annex until owner review; reconcile overlapping #223, #226, #227 and other live PR heads. In Phase 1 ship a real card-to-Chat-and-evidence slice, not a giant untested cherry-pick.

### 13.9 Architectural recommendation

The central source insight: LiOS's weakness is not the absence of many analytical engines, but how evidence and data **appear, connect, flow and feel**. Reuse Watermelon's rich interaction families at scale, specialize with Kibo + React Flow + MapLibre + source-safe article ingestion, enforce skills/screenshot critique across development, and promote verified insights to the existing P4/P9 execution layer. **One premium intelligence product**; immersive when discovering, fast and exact when working, transparent when citing, and never childish.
