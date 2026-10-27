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