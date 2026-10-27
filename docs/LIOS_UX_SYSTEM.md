# LiOS UX System

## Execution and shipping authority — 2026-10-03

[Super Intelligence execution](LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md) governs SI-01–SI-07 strategic outcomes; [Shipping Point contract](technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md) governs SP-01–SP-07 progressive milestones. S0–S10 are validation journeys and CP phases historical evidence, not scope or sequencing walls. TC owns visible experience, GM runtime/permissions/durable memory, CA capability integration, P4 Artifact state, P5 identity, P11 deterministic finance and P13/GM skills. No second SI authority is introduced. GM-11 exact-operation authority, sandbox and trust receipts must be proven before privileged interactive `exec.*` exposure.

Each applicable SP requires a real Minimum Shippable Journey, target/package execution where applicable, explicit non-success states without fakes, regression protection for accepted behavior, and exact commit/build, topology, journey, outcomes, limitations and truth-level evidence. Source contracts, screenshots, static tests and unsigned smoke do not imply Shipping Point acceptance or P14 release proof. No acceptance is asserted by this reconciliation.

Truth ladder: **contract locked → code integrated → tests passed → packaged/provisioned → user accessible → vertical flagship passed → shipping point accepted → release proven**.


## Owner-approved universal intelligence / Workbench convergence — 2026-10-20

**Authority and scope:** Owner-confirmed decisions 01–20; source-of-truth for the visible experience under TC / SI-07 and existing P2/P4/P5/P7/GM/CA owners. This section clarifies prior 2026-10-01/02 UX language where inconsistent; it is **required future behavior**, not a claim of implemented or shipped functionality. Coordinate implementation under the existing [public issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91) and [canonical active tracker](PENDING_WORK.md). Do not fork the architecture or create a new execution board.

### The definitive Workbench display model — no ambiguity

1. **Chat is the signed-in default and normal full-time surface.** Minimal sidebar/composer, readable streamed answers, only essential quiet status (such as `Researching Apple…`) and a Stop/Cancel action. No always-visible agent list, per-source progress wall, developer console, tool steps, raw JSON, module menus, or dense finance dashboard. Project Home may remain a secondary deliberate destination, never the mandatory first stop.
2. **Background intelligence, not a second background UI:** using the existing user-owned runtime, the chat orchestrator may invoke permitted research, providers, BYOAI, agents, models, calculation engines, reports, connectors and existing Workbench capabilities *without rendering the Workbench*. Actual background continuation depends on an active authorized runtime and its budgets; closing the only runtime does not magically continue jobs.
3. **Artifact preview is contextual and optional.** Surface one or a few relevant, readable clickable Artifact cards in the conversation; clicking opens the *same canonical P4 object* in a resizable right sidecar with Artifact / Evidence / History when relevant. Auto-created additional work is discoverable in the chat/Project/Workbench library, not dumped into the conversation. Small/narrow windows may use a focused view instead of a cramped pane.
4. **The full existing Workbench is an on-demand expansion, not an additional product, hidden OS window, restricted 'pro' mode or rebuilt replacement.** It opens through **Expand Workspace**, a contextually relevant Artifact action or direct user navigation, using current entity/topic, exact Artifact ID/version, permissions/source selection, analytical assumptions, time/units and best saved layout. Load only initially relevant panels, yet expose **the complete existing source catalog and all authorized professional tools** without requiring new implementation copies. Do not show all tools simultaneously. The UI may keep Workbench mounted/lazily loaded for engineering reasons, but it must not be visually exposed by default.
5. **Full round-trip continuity.** Chat and Workbench read/write the same canonical state. Edits in either view produce governed versioned changes, deterministic recalculation where applicable, refreshed rendered outputs and evidence/receipt history. Back to Chat restores the same investigation and selection. Entry/exit/reopen must never silently switch company, Project, source posture or Artifact head; material ambiguity or conflicting edits require review rather than guessing.
6. **Advanced inspection is discoverable, not forced.** Source/Evidence, Show Work, selected tools/diagnostics and layout controls open only on request or when a material error, missing source, contradiction, permission/approval requirement or relevant limitation must be shown. Never conceal approval, stop, errors, cost/permission consequences or source uncertainty for cosmetic simplicity. Do not display hidden model chain-of-thought.

**Navigation fundamentals (TC / SI-07):** The signed-in desktop shell must display **named** destinations by default: Chat, Projects, History, Artifacts, Automations, Plugins, Connections and Settings, with New chat and Search as direct actions. The available Workbench remains behind an explicit workspace action; it is not another competing primary navigation system. A user may deliberately collapse the sidebar to an icon rail, where every icon retains an accessible name and an obvious Expand navigation control. The mobile drawer exposes the same named destinations. The current page is identifiable by text and an accessible active state, including Project Home and saved Chat history. Search opens the actual saved-work search rather than a generic command palette. Navigation must not silently hide the Stop control during an active run or discard local Artifact edits. Screen size or theme should never change which user actions exist, only how they are presented. Actual installed/keyboard/screen-reader acceptance remains required.

**Four-phase enhancement delivery — Phase 1 implementation checkpoint (2026-10-27):** The agreed 50-outcome enhancement set is grouped into four delivery phases within the existing #91/SI/SP/P14 architecture, **not** a new acceptance ledger: (1) Core product and state continuity, (2) premium spatial/visual interaction, (3) entitled live/proactive intelligence, (4) subtle Limuria company discovery and final product qualification. Phase 1 begins by reconciling PR #226's quiet-default presentation and PR #227's named navigation with direct Work access and one shared compact/expanded/mobile account menu. Work opens the **existing full Workbench** through the existing Chat origin/Artifact handoff; it does not become a new router or duplicate view. A running response or unsaved Artifact edit must not disappear on a sidebar, compact-rail or external navigation request; short-window layouts must retain keyboard access to all controls. New source acceptance tests are part of the normal project test discovery, but hosted CI/actual native visual, interruption and installed package acceptance are separate proofs. The next Phase 1 code slices are exact Chat/Artifact round-trip restoration, coherent search/History/Project journeys, and measurable first-use/failure recovery. Phase 2 must not be represented as started by these navigation changes.

**Phase 3 continuation — fresh and reauthorized Chat review (2026-10-27, draft #249):** Opt-in Proactive Review now distinguishes current (up to 5 minutes old), stale, future-dated (>30 seconds clock skew), and unavailable inbox snapshots. These checks apply to the server as-of timestamp, not to an alert's historical createdAt. The UI warns instead of presenting old/future server responses as current; a user-clicked draft action re-evaluates freshness at the click instant. Before it stages an alert in the existing Chat editor, the client issues a separate abortable **read-only GET to the same owner-entitled Wave D endpoint**, validates the returned snapshot and rechecks the exact selected alert identity, card identity, title, reason, status, priority, timestamp, action suggestions and source-evidence references. A changed, missing, revoked, stale, offline or denied response *fails closed*, presents a user-visible reason and does not open Chat, send any prompt or invoke tools. The recheck is canceled on modal tab change/unmount and duplicate clicks are disabled. This is not a substitute for server-enforced provider/source permissions at final AI execution, but closes the client-side stale-selection handoff race. Pure regression tests cover boundary times, status changes, evidence swaps, deletion and misleading stale data. Full actual provider/agent/automation, installed usability and P14/SP acceptance remain unproven.

**Phase 3 entitled/proactive implementation checkpoint (2026-10-27, stacked draft from Phase 2):** The existing Intelligence Pulse adds a user-enabled **Proactive Review** tab that reads the already access-controlled Wave D `GET /api/wave-d/action-inbox` contract; the existing ambient Pulse badge now shares the same validation/foreground polling hook instead of another silent reader. This does not start a second agent/provider, create an Artifact authority, perform an AI call, or auto-run suggested actions. Each alert is derived only from the server's current attributed inbox, with bounded priority ordering, open/snoozed/resolved status, server as-of time, exact source-card ID, and inspectable evidence/source attribution. Only safe HTTPS URLs without embedded credentials become external links; missing evidence is prominently acknowledged. Foreground opt-in, pause while tab hidden, AbortController on unmount/tab change, bounded 60-second polling, manual refresh, and no persistence of records/query/session are source implemented. Unauthorized (401/403), malformed/contradictory, transport-unavailable and genuine empty are separate truth states; never render a false "all clear." The old ambient badge now counts **only open verified items** and treats missing payloads as unavailable, preserving its existing off-by-default preference. Pure contract/URL/error tests and UI source assertions added. Proactive Review also offers a **direct, user-clicked Draft review in Chat** action. It prepares a bounded source-attributed alert summary (IDs/priority/as-of/source labels, at most six evidence references) and sends it to the existing Workbench-to-Chat draft handler; no AI/provider request is submitted until the user reviews and sends it in the existing Chat. Unsaved Workbench changes block the navigation. Untrusted source descriptions are explicitly labeled as such in the proposed draft, and no source entitlement is transferred. Intelligence Pulse now uses the app's existing accessible Dialog with keyboard focus management, Escape/outside-close and safe return focus. The existing ambient badge and detailed review have one validation/polling policy, instead of two pollers. This is a **review and human-approved Chat handoff slice, not autonomous AI/entitled model invocation or SP-06/P14 acceptance**; real BYOAI provider readiness, provider/permission/paid-fallback receipts, P9 durable scheduled execution, notification review, installed clean Mac/Windows journeys and Project/Quick/Temporary context isolation still require independent evidence. Phase 1 #227 and Phase 2 #231 remain unmerged dependencies; resolve their exact-head CI before promotion.

**Phase 2 premium-spatial implementation checkpoint (2026-10-27, PR #231; stacked on draft #227):** The existing Analytical Studio's Spatial Research Canvas has been upgraded with readable Map, pin-chronology Timeline and keyboard-friendly List modes; nodes are real locally pinned Research Tray objects, and graph edges express only explicit shared user-entered groups (never inferred evidence, finance causality or permission). One user-opened, movable Insight companion inspects the selected pinned object and opens the same existing terminal Workbench action. A bounded 36-object graph, optional board expansion, pointer/keyboard pin movement with final-position persistence, position reset, focus-visible controls and responsive low-motion/low-GPU layouts are source-implemented. The single existing VisualCanvas adds user-selected Adaptive/Immersive/Contextual/Focus atmosphere intensity within the saved UX preference and preexisting enabled/low-resource/motion safeguards; Workbench and Presentation/Focus always suppress scenery, and a user-specified Immersive level cannot override contextual reading surfaces. No extra global router, Artifact database, runtime capability or licensed source is introduced. **Evidence gate:** source unit/contract tests are necessary but not full acceptance; actual installed desktop+browser, 200% zoom, keyboard/touch/VoiceOver, light/dark contrast, scene/preload/GPU budgets, interrupted-run continuity and complete SP/P14 still require measured replay. Remaining agreed premium interactions (more extensive scene/graph visualization, work-preserving context animation and device-specific polish) are Phase 2 scope under the existing #91 ledger, not claimed complete by this candidate. Phase 1 #227 remains draft/unmerged.

**Phase 2 continuation — real responsive spatial-reading policy (2026-10-27, PR #231):** Analytical Studio now observes the *actual Spatial Research Canvas container width* with ResizeObserver and a legacy resize fallback. A tiny, pure `spatialPresentationPolicy` shares the existing 760px CSS container breakpoint, defaulting to safe stacked reading until the pane is measurable. Map/Timeline/List each declare whether user moves are possible: at 760px or narrower, all appear as stacked, scrollable reading views with no live pin/companion drag controls and no hidden SVG line DOM. Wide Map retains pin/companion moves; wide Timeline retains companion moves but never price-history inference; explicit List remains reading-only at any width. Moving to a narrow pane or zooming while a pointer drag is active discards uncommitted pin previews and restores the original companion position. The single Insight Companion is now a focusable, visibly outlined region instead of targeting an unusable disabled drag button on narrow screens. Accessibility status copy correctly describes the active reading mode. No change to saved pin data, Workbench routing, storage or platform architecture. Pure tests and source contracts cover 320/560/760px, null and non-finite widths, 1920px layouts, zero decorative edges in stacked mode and canceled gestures. The ResizeObserver result is bucketed into the two sides of the same 760px threshold, so continuous pane resizing no longer forces a full 36-pin React redraw per pixel; the UI updates only when presentation capabilities change. Installed browser zoom (100%, 200%, 400%), touchscreen, screen-reader and real native performance acceptance remain necessary.

**Phase 2 continuation — local Spotlight research find (2026-10-27, PR #231):** Analytical Studio's sole existing Spatial Research Canvas includes an explicit, keyboard-friendly Find in research field with Clear, Enter-to-inspect-first-match and Escape-to-clear. Query execution is strictly local over already-saved Research Tray item title, symbol, group, kind, description, user note and tags, using case-insensitive all-terms matching; neither AI, network tools nor Artifact creation run. Results filter the user's existing kind selection **before** the 36-node map cap, so a previously hidden pin can be located without expanding render load. Up to five direct exact-pin inspection targets are shown; no speculative results are generated. The search string is not part of the persisted research pin, Studio return snapshot or storage and is discarded when this canvas unmounts. Existing saved order remains stable, and selection/connection/trails are validated against the current visible subset. Empty states distinguish no pin from no match. Unit and source interaction contracts test matching, filtering order, bounded results and no mutation; browser/installed keyboard, zoom and screen-reader verification remain open.

**Phase 2 continuation — accessible Studio modal and explicit spatial motion budget (2026-10-27, PR #231):** The existing Analytical Studio presentation moves from a pointer-dismissed custom fixed overlay to the app's pre-existing accessible Radix Dialog abstraction with title/description, trapped keyboard focus, Escape/outside dismissal and focus restoration only to a still-connected opener. The original Workbench/open action and in-memory Studio return remain unchanged. This avoids a second dialog stack, source or router, but requires installed keyboard/screen-reader testing. The existing Spatial Research Canvas now derives a two-level visual motion policy from its current UX settings (environment opt-in + motion opt-in), reduced-motion, low-resource, and native software-rendered mode; unopted/default, quiet, and software rendering suppress decorative 3D depth/transitions and simplify backgrounds. CSS also honors OS reduced-motion independently. The dedicated pure motion-policy test and source contracts cover suppression and dialog structure. Underlying research data, calculations, provenance, identity, permissions and routing are untouched. Hosted CI and installed native/macOS/Windows validation remain open until independently confirmed.

**Phase 2 continuation — session-only Studio/Workbench return (2026-10-27, PR #231):** Analytical Studio now keeps its last selected tab and the Spatial Research Canvas presentation (layout Map/Timeline/List, kind filter, user-selected grouped trail, expanded board, inspected pin and inspected connection) in memory owned by the existing authenticated TerminalUxOverlays component. Clicking Open on a saved research pin uses the unchanged Workbench onOpen(view, mode, symbol) callback and closes Studio so the original analysis is visible. Reopening Studio in the same mounted terminal returns to the prior view; it does **not** create a new conversation, Artifact authority, persistent storage key, background task, or new route. Every restored pin and connection is checked against currently visible, bounded pins and named groups; changed, removed or filtered-out references clear instead of silently opening another owner or stale record. Unit and source integration contracts cover return focus/identity preservation and stale selection. This implementation is source-level until native/browser keyboard, resize, 200% zoom and cross-platform runtime qualification is performed.

**Phase 2 continuation — inspectable connection provenance (2026-10-27, PR #231):** The Spatial Research Canvas now provides a keyboard-accessible disclosure listing all connections between the currently visible, bounded Research Tray pins, where each line means **consecutive saved pins in exactly the same explicitly user-assigned named group**. A user-selected connection revalidates both exact endpoints and current group membership against the current visible graph before inspection; stale, filtered-out, duplicated-ID and mismatched links are rejected. The inspector names both originating pins and provides explicit Inspect-first/second actions through the existing single movable companion, without guessing a correlation, analytical proof, causality or permission to use the underlying data. Optional endpoint and SVG-line highlights do not replace text or screen-reader access; small panes, low-resource and reduced-motion fallback CSS is included. Dedicated pure verification and source interaction tests were added. Real installed touch/keyboard/screen reader, zoom, browser and GPU qualification is still required; no SP/P14 signoff is implied.

**Phase 2 continuation — user-directed evidence trails (2026-10-27, PR #231):** The existing spatial canvas now supports optional step-through exploration of user-created named research groups. The trail draws exclusively from the first 36 currently visible saved Research Tray objects, ordered by saved pin creation timestamp with a deterministic ID tie-break; groups with fewer than two visible members are not offered. Starting, previous and next actions deliberately open the exact existing pinned object in the movable companion without calling AI, auto-executing tools, claiming causality or contacting a service. Group membership/current-position affordances preserve other pin visibility and announce progression accessibly. Canceled pointer/touch drags do not persist positions; pointer release commits once. Pure chronology/group/bounds tests and source interaction contracts were added. Hosted cross-platform and installed/native usability evidence remain distinct requirements; no live provider, network, SP or P14 acceptance is implied.

**Phase 1 continuation — safe Workbench return (2026-10-27, PR #227):** Both the generic Chat-origin Workbench and an exact saved Artifact Workbench can return to their original Chat without a new conversation or parallel state store. A return to a **different** Chat, Project or persistence mode (including Temporary versus new Quick, even with null IDs) passes the same existing unsent-draft review used for ordinary Chat switching. A declined review leaves the original draft, attachments and voice staging in the current Chat; approval checks a changed-draft fence before clearing staged inputs and changing selection. A same-identity return keeps the live draft untouched. Artifact returns use their recorded P4 identity and returned revision; staged Workbench questions are appended idempotently for user review, never automatically sent. Source regression tests cover origin identity, scope crossover, version handoff, modal guard and preserved mounted Chat state. **Pending:** hosted CI, a real cross-context return with staged attachments/voice, installed-app restart and signed release qualification; do not claim the end-to-end journey is accepted based on source tests alone.

**Phase 1 saved-work navigation integration (2026-10-27, PR #227):** Signed-in Chat, Projects, History and Artifacts continue to use one existing shell and one authenticated saved-work search. A source-audited defect in cross-Quick-Chat Artifact search was corrected: the selected Artifact and its exact server-confirmed revision are now bookmarked under the **destination Chat's owner/project/chat key**, never written into the currently mounted Chat before the navigation commits. Source/ownership verification and the existing modal review for unsent text, staged files, voice and personal-finance inputs remain in place. The Artifacts directory now provides an explicit **Search saved work** path for regular Chat Artifacts instead of incorrectly suggesting a Project is mandatory; clearing a Project filter restores Quick Chat mode rather than an invalid Project mode without a Project. The normal History list continues to include both regular and Project Chats. A destination-bookmark unit test and six focused source-integration contracts were added to normal project test discovery; these are source-level proofs, **not** observed installed-app UI, backend/network acceptance, or P14 release qualification. Browser, multi-account, Windows/macOS native and actual provider/data-backed journeys remain required.

**Phase 1 continuation — canonical History and unobstructed navigation (2026-10-27, PR #227):** History uses the existing `canonicalRecentChats` selector (all saved Project and Quick Chats, no duplicates, no trashed/archived entries, stable descending activity order) and paginates only after normalization. The secondary Trash & archive and legacy import routes must not hide Stop, an in-flight message or unsaved Artifact edits; section-level Back to Chat clears any Project Home request and restores the composer. Sidebar History action menus remain visually quiet on pointer-fine hover-capable devices but visibly available on touch/coarse-pointer devices and through keyboard focus. The existing authoritative data/search/persistence APIs remain unchanged. Executable policy tests and focused source regressions were added to normal client test discovery; they are not substitutes for an installed-app browser/desktop/assistive-technology journey.

**Phase 1 navigation test coverage — rendered component and executable History policy (2026-10-27, PR #227):** The canonical History listing (including the full History directory, not only the short recents sidebar) reuses `canonicalRecentChats`, which deduplicates Quick and Project query overlap, removes archived/trashed results, retains stable ordering and applies pagination after normalization. Back to Chat clears Project Home intent. Trash/archive and legacy migration entry points respect an active response and unsaved Artifact edits, while chat action menus remain visible for keyboard-focus and coarse-pointer/touch users. New `AuthenticatedNavigation.render.test.tsx` uses React server rendering to inspect the actual named navigation markup and accessible current-page/account controls, supplementing source-only tests; this does not exercise click handlers or installed-app focus behavior. Canceled cross-Chat Workbench returns now direct users to History or saved-work Search rather than promising an automatically restorable Workbench origin. Hosted source CI remains distinct from packaged native and P14 acceptance.

**Professional default and copy discipline (TC / SI-07):** Keep one clear primary action per surface; use short task-based headings rather than marketing copy, repeated guidance, unexplained technical labels, all-caps metadata or decorative status cards. Chat opens with a concise prompt and focused starters. Project Home presents the conversation entry first; optional settings, saved resources/sessions and specialist panels remain behind native keyboard-accessible disclosures. During a run, show a quiet state and Stop, with progress, source receipts and diagnostics in Show work. On pointer devices, secondary message actions may appear on hover/focus; on touch and for keyboard users they remain accessible. Never collapse, suppress or delay a material error, revoked/missing source, permission or cost consequence, approval request, data-quality limitation, user-facing task result, or citation needed to judge an answer. Minimal UI is not a license to overstate verification.

**Reference scenario:** Open LiOS → sign in → type “Research Apple” → compact working state → progressive grounded findings and relevant Artifact cards → open one in a sidecar → expand into the existing Apple Workbench with selected financial models/sources/assumptions → edit the model and record a new authorized version → return to chat with context unchanged → restart and reopen exactly that work. No required Project creation or manual handoff; an advanced user can enter the Workbench directly.

### Twenty locked product decisions

| # | Owner decision | Required behavior / restriction |
|---|---|---|
| 01 | Structured + web/AI research together | For research objectives, pursue both permitted source classes where available; no fabricated coverage, forced web calls for ordinary chat, or hidden search cost. |
| 02 | Intelligent optional Projects | Reuse an appropriate authorized Project, otherwise keep working in the regular Chat and offer linking unobtrusively; never silently select an unrelated Project. |
| 03 | Adaptive Artifact presentation | Compact previews in Chat, substantial Artifact in side pane/focus, full context-aware Workbench on expand. |
| 04 | Context-aware full Workbench | Reuse the complete installed Workbench and its provider/tool catalog, selecting relevant panels and saved layout first. |
| 05 | Bidirectional versioned work | Chat and Workbench share active object, sources, assumptions, calculation, revisions, evidence and history. |
| 06 | Progressive comprehensive research | Research requests begin a bounded comprehensive investigation, yield useful verified results progressively and may deepen in governed stages. |
| 07 | Persistent/resumable research | Checkpoint authorized work and resume through the user-owned runtime; no fictitious compute after shutdown. |
| 08 | Optional monitoring | Suggest recurring updates after a relevant task; never start indefinite monitoring without explicit user choice. |
| 09 | Shared Source catalog | Source Auto selection by default; a compact Sources control opens/searches/filters the **same** canonical Workbench connection/catalog registry and rights, not a duplicated registry. |
| 10 | Evidence reconciliation | Verify entity, period, currency, units, timestamps, entitlements and conflicts; distinguish deterministic values, assumptions and AI interpretation. |
| 11 | One-time AI-data authorization | After informed approved connection/scope consent, allow routine relevant AI processing without repetitive prompts; revocation, firm/source ACLs and local-only restrictions still apply. |
| 12 | Highly autonomous orchestration | Chat can execute approved multi-step workflows using full existing Workbench capabilities and permitted external integrations, rather than just open tools. |
| 13 | Risk-based autonomy | Routine read/research/compute/Artifact actions execute within scoped grants; payments, external publishing, destructive changes and any future brokerage actions require stronger authorization. Existing prohibition on live brokerage execution remains in force. |
| 14 | Intelligent capability generation | Discover permitted schemas/files, confirm material semantic mappings, assemble reusable analysis and dashboards through existing engines/Workbench; do not create a second capability framework. |
| 15 | Cross-Project permitted intelligence | Find relevant approved Project/Chat/Artifact content while honoring source/client/tenant exclusions and provenance; retrieval grants no cross-Project mutation. |
| 16 | Intelligent data-gap recovery | Search lawful alternative registries/web/providers and continue useful qualitative work; label unsupported financial numbers as unknown, not zero or invented. |
| 17 | **Extremely minimal visible UX (A)** | Default: quiet status + progressive useful output, not visible multi-agent panels. Detail only on demand or for consequential/error states. |
| 18 | Comprehensive, selective Artifacts | Generate appropriate full work-product set within limits, surface only most useful Chat previews; persist accessible remainder with evidence and revisions. |
| 19 | Automatic saving without forced Project | Save regular Chat research, canonical Artifacts, revisions and Workbench context by default; offer optional Project linking. **Temporary Chats stay non-persistent** and must not silently create Projects/Artifacts/memory. |
| 20 | Universal intelligence OS | Same conversation/research/Artifact/Workbench model for any topic and connected data; Finance is a deep specialist, not a topic gate. |

**Source custody and model quality are non-negotiable:** one-time consent never transmits prohibited private data; a model completion does not prove a working web retriever or claim validation; deterministic engines own material finance calculations; actual provider entitlements, mapping and numerical evidence determine what can be claimed. Default Auto must make best effort within rights and budgets rather than claiming invisible successes.

### Implementation priorities and visible acceptance (no duplicate stack)

- **P0 / contract and collision review — TC/SI-07 issue #91:** preserve authoritative SI program, Shipping Points, P14 and canonical owners. Treat [PR #93](https://github.com/kiranvbiim-coder/lios-terminal/pull/93) (quiet chat, typed/rendered/saved Project Artifacts) and [PR #92](https://github.com/kiranvbiim-coder/lios-terminal/pull/92) (source custody) as in-flight; independently review/reconcile, not duplicate or auto-merge. Track truth separately: contract / code / real journey / packaged / SP / release.
- **P1 / chat-to-Workbench state:** use existing `ProjectExperienceShell`, `Terminal`, `DockviewWorkspaceGrid`, canonical Working Context and P4 Artifact state. Current `onOpenWorkbench` surface switch alone is not evidence of an exact Artifact/entity/source/assumption/layout handoff. Specify and test a typed handoff plus return-to-chat and saved layout round-trip, without another shell.
- **P1 / chat-owned durable Artifact:** existing Project-backed keep/auto-save paths do not fulfill regular Quick-Chat persistence. Extend canonical P1 chat and P4 Artifact ownership/reference contracts safely for regular Chats, without a fake/invisible Project, bypassing tenant ACLs, or duplicating P4 storage. Migrate and test existing Project Artifacts; Temporary Chats never auto-save.
- **P1 / shared sources and data gaps:** connect the minimal Sources chooser to existing P5/Workbench source catalog and rights-aware Auto router; enable the permitted parallel structured + web/AI research plan under P7/GM, with source-by-source citations, explicit coverage gaps and cost boundaries.
- **P2 / comprehensive orchestration and Artifacts:** canonical P2/GM agent runtime executes approved workflows through existing Workbench engines; P4 stores all meaningful results but only selective previews surface. Add failure/resume/stop and source-revocation/cost/permission test cases; no always-visible tool dashboard.
- **P2 / deeper professional journeys:** native cross-Project retrieval, confirmed database mappings and repeatable user-owned monitoring on request; benchmark meaningful donor reuse under existing donor policy and CA registry, not a new import campaign.

**Minimum real acceptance:** the flagship Apple request must succeed through actual configured permitted sources and provider, chat-owned saved Artifacts, contextual existing Workbench open, direct/chatted versioned edits, return to Chat and restart. Also verify one non-finance research case and one connected company-database task, as well as no-ticker/private-company research with explicit data gaps. Run keyboard/narrow-layout/privacy/tenant revocation/AI-off/error/cancel tests on a real installed target. Synthetic fixtures may prove isolated mechanisms; they do not establish real-provider/web/AI or SP/P14 acceptance.

## 0.0A Simple desktop and plugin journey extension — 2026-10-02

**Owner-approved direction; visual/runtime acceptance pending.** Full decisions and benchmarks: [Terminal Convergence §0.0.12](LIOS_EXECUTION_ROADMAP.md#0012-general-ai-research-and-desktop-experience-expansion--owner-decisions-2026-10-02).

### User journey and entry

Download → install → open → create account/sign in → clean chat home → connect when needed → ask about anything → inspect/refine/save. Keep public marketing/preview, signed-out app and authenticated home distinct. Authentication is mandatory for execution. Account recovery, verification where required, expired sessions, failed network and browser-to-desktop return are part of this journey.

The new user sees the composer immediately and a contextual **Connect AI** action when needed. No mandatory Project/persona/provider wizard or bundled model download. Preserve a pending prompt across setup and resume exactly once when ready. Returning users restore valid saved work. Account creation and trial details should be clear separate concepts; no pricing changes are implied.

### Plugins, Connections and Settings

- One simple plugin discovery surface: search + Browse / Installed; item = name, optional icon, one-line purpose, one primary action.
- Selection opens a short detail sheet with what it adds, requirements, permissions and Add/Install or Connect.
- Installation and account authorization are distinct. Use plain readiness states: Ready, Finish setup, Reconnect, Unavailable. Show the relevant connected account in details.
- OAuth: authorize the intended account. API: enter the key. Files: choose files/folder. Database: required fields only. Advanced options open on demand.
- Chat can suggest one relevant connection and guide setup without navigating away from the task. Settings and chat deep-link to the same saved connection authority.
- Installation does not add permanent sidebar entries/dashboards. Avoid default capability matrices, protocol badges, provider-health walls, raw endpoint fields and debug chrome.
- Ordinary UI label: **AI**. Explain BYOAI ownership/billing in context. Each setting has one authoritative location; advanced controls remain available.
- Removal/reconnection clearly explains effects on access and retained work; failed setup preserves the user's request.

### Conversation, memory and work products

Any-topic conversation and web research share the existing minimal composer. Ordinary factual questions may receive a quick answer without retrieval when appropriate; explicit research objectives trigger bounded progressive investigation with permitted structured and web/generative sources where useful and available. General documents/reports/tables/charts use the same professional work paths as finance tools. Relevant permitted sources may span Projects, with attribution and exclusions; firm/client/tenant policies still apply.

Broad automatic memory has inspect/edit/delete controls. Temporary chats do not contribute durable memory or inherit private context by default. Prefer simple controls and source explanations over exposing hidden Working Context.

Comparison requests produce cited tables when appropriate. Citation clicks open supporting passages/pages/query results in the existing evidence pane, preserving the chat and active work; the original source remains accessible. Save as task stores reusable work; monitoring is a separate optional action. Material source substitutions and missing/conflicting evidence remain visible.

### Premium quality and audit method

Preserve the dark theme; use readable text, consistent spacing, restrained icons, clear hierarchy, coherent primary actions and responsive panes. No overlapping workspace/workbench surfaces or tiny typography used to conceal clutter.

Audit eight complete journeys: installation; account/sign-in; first launch; ordinary chat/search; connections; settings; Projects/outputs; desktop recovery. Capture actual screens and keyboard/focus behavior, plus loading/empty/error/retry/offline/restore states. Repository observations such as 7–9px labels, trial-specific sign-up copy and “Master AI” naming are review targets, not a completed visual audit.

Each task has a reference behavior, baseline, measurable target, implementation owner and evidence. Proposed ≤100ms local interaction acknowledgement must be measured on declared hardware. Competitor documentation is a research reference, not firsthand visual inspection or proof of superior usability.



### Company research without tickers or uploads

[Terminal Convergence §0.0.13](LIOS_EXECUTION_ROADMAP.md#0013-public-and-private-company-research--no-ticker-and-no-upload-coverage--2026-10-02) adds mandatory private/public-company acceptance. Users ask by name, website, country or registration identifier; no ticker selector, quote/chart prerequisite or mandatory upload. Clarify genuinely ambiguous matches using short identity choices.

Return a useful cited company brief/peer table from available public evidence, with a compact coverage note and relevant next actions. Expose precise supporting evidence and missing-field detail in the existing side pane. Offer targeted financial inputs or an entitled source only when needed for deeper analysis. Later uploads enrich the same work. Missing revenue is not zero; no-data fetch failures are not proof the company has no information. Preserve simple chat and avoid permanent coverage dashboards.

## 0.0 Terminal Convergence UX lock — 2026-10-01

For authenticated terminal UX, follow \`docs/LIOS_EXECUTION_ROADMAP.md §0.0 Terminal Convergence\`.

The locked UX hierarchy is:

\`\`\`text
GLOBAL / NEW CHAT
  → minimal Ask LiOS surface

PROJECT HOME
  → rich adaptive intelligence dashboard
  → What Changed / Signals / verified metrics / Artifacts / Chats / events / automations / activity
  → quiet refresh, truthful as-of state

PROJECT CHAT
  → conversation-first professional work
  → compact runtime narrative
  → finance-native structured answers
  → contextual governed Next Actions

ACTIVE ARTIFACT
  → right-side professional work surface
  → ARTIFACT / EVIDENCE / HISTORY
  → direct selection/manipulation + conversational control
  → immutable revisions

EXPAND WORKSPACE
  → same Project + Chat + Artifact + context
  → more professional canvas, not another product
\`\`\`

Additional locks:
- hidden Working Context stays invisible in normal UX;
- no mandatory active entity/security selector;
- automatic routing is the default;
- advanced source/execution/provider controls use progressive disclosure;
- default composer is minimal;
- one visible LiOS identity;
- meaningful successful Project and regular Quick-Chat outputs auto-retain through the existing P4 keeper and canonical Project/Chat ownership; Temporary Chats remain nonpersistent. Explicit Project promotion still requires a destination/scope preview. Candidate source and bounded packaged evidence are recorded in docs/PENDING_WORK.md, not full TC-13/SP/P14 acceptance.
- high proactivity is allowed within permission/budget/governance limits;
- passive status strip shows only real connected/provider/market/runtime state;
- no dedicated permanent Decision area is required on Project Home;
- graphite/gold LiOS visual identity remains canonical.

These locks are encoded in `src/shared/terminalConvergenceContracts.ts` and enforced by `src/client/src/lib/terminalConvergenceContract.test.ts` (in `npm run test:ux`). Composer controls beyond Tools / Ask / Voice / Send are tracked there as TC-06 debt that may only shrink.

## Supplied Figma Make reference — 2026-10-01

The user's supplied `App.tsx`, `DesktopApp.tsx` and `index.css` are the visual reference for the actual product's public entry → sign-in → authenticated workspace. Apply their graphite surfaces (#09090b / #07070a / #0d0d10 / #111115), warm foreground (#ede9e0), gold accent (#d4a017), Barlow Condensed display headings, Inter conversational text and JetBrains Mono data labels. Bundle fonts locally. New and unconfigured workspaces use the reference matte background; visual environments remain optional and an explicit saved choice is retained. This supersedes previous cinematic entry and orange shell styling where they conflict with this explicit reference.

The public entry follows the reference's compact product header, four-line Financial Intelligence Operating System hero, animated terminal demo, DCF sensitivity grid, seven-step workflow and capability cards. The signed-in shell uses a compact icon rail, Project/Chat sidebar, readable conversation and contextual Artifact/Evidence/History inspector. Preserve the canonical Projects → Chats → Artifacts hierarchy and existing governed actions; no duplicate persistence or router is introduced. Sign in and Open App invoke the real authentication boundary. Illustrative preview content is visibly labeled, non-executable and never presented as observed market data. Actual provider gaps remain explicit.

The supplied landing code is ported directly, including timed analysis lines and a blinking cursor, a 30-second sample ticker, DCF grid, workflow/feature/capability sections, connection example, plan cards and footer. Sample figures, connection states and reference prices are visibly illustrative; all account/access CTAs use real authentication. View Demo restarts the local animation. Reduced-motion users receive the complete sample without animation. The workspace uses the source 36px title bar, 44px rail, 216px collapsible sidebar and 348px artifact sidecar where space permits.

## 0.1 2026-09-26 entry experience lock

The permanent first-impression model is:

> **Show LiOS before sign-in; unlock LiOS only after sign-in.**

### Signed-out public preview

The launch screen may show:
- LiOS brand/value proposition;
- a realistic but locked representation of the conversational terminal;
- example prompts;
- source scopes such as Auto / My Data / Web / Files;
- Projects/Research/Artifacts/Models/Connectors navigation previews;
- professional capability cards and plan/feature teasers.

It must not provide an executable composer, guest research, anonymous AI, anonymous Projects/Chats/Artifacts, connector execution or deterministic-engine execution. Any product interaction converges on authentication.

### Authentication

Authentication should be visually calm and short. It is a gate, not a setup wizard. Do not require connector setup, persona selection, domain selection, AI-provider setup or tutorials before the user reaches the workspace.

### Authenticated first surface

After successful session + entitlement resolution, open the real LiOS conversational workspace. The universal composer remains primary. Source scopes are product controls, not onboarding steps. Professional terminal depth appears progressively from the user's question.

Returning authenticated users should normally bypass the public preview and authentication UI through secure session restoration.

### UX quality bar

- calm matte-dark LiOS visual system;
- one obvious primary action at each state;
- keyboard and screen-reader complete;
- no dead-end paywalls;
- plan expiry never hides owned local work;
- system status visible for offline/re-auth/restricted states;
- no fake terminal interactions on the public preview.

**Status:** CANONICAL UX / INTERACTION CONTRACT  
**Effective:** 2026-09-21  
**Parent:** `docs/LIOS_MASTER_PLAN.md`

## 1. UX objective

LiOS should feel immediately understandable to a user familiar with modern AI products while remaining powerful enough for professional financial work.

The visible experience combines:

- ChatGPT-style Projects and chats;
- Claude-style side-by-side artifacts;
- Perplexity-style source/evidence access;
- terminal-grade charts, models and analytical objects;
- LiOS's own dark professional visual identity.

Do not reproduce another product's branding, proprietary visuals or trade dress. Reuse interaction principles.

### 1.1 LIOS-P0-13 competitor-derived interaction principles

Competitor/market research is converted into **product requirements**, never copied design assets or a clone mandate. The reusable interaction principles are:

- Projects/chats should be as easy to understand as modern conversational AI workspaces.
- Live artifacts should open beside conversation when useful and disappear when not needed.
- Evidence, source state and assumptions should be inspectable without burying the primary answer.
- Professional users should have keyboard-first command/search/navigation and density on demand.
- Charts/models/tables should support direct manipulation, linked context and saved workspaces rather than static dashboard screenshots.
- Spreadsheet-like manipulation is appropriate where finance users genuinely need cell/formula/model behavior.
- Advanced terminal density is progressive disclosure: the default state stays calm and conversation-first.
- Provider, AI, workspace and artifact implementations remain replaceable behind LiOS-owned contracts and state.
- LiOS may reproduce generally understood interaction patterns, but must not copy another product's logos, names, proprietary icons, screenshots, exact branded layouts, protected artwork, proprietary datasets or trade dress.
- Imported permissive OSS UI is separately governed by the OSS registry and is always re-themed into the canonical LiOS dark system.

These principles are the canonical record for competitor-derived UX requirements. Future research updates this section instead of creating a competitor-specific clone plan.

### 1.1.1 Identity-gated conversational entry

LiOS shows the product before account setup, but executable intelligence begins only after authentication.

- After the short branded startup state, a signed-out user sees the supplied Figma graphite/gold matte public preview, representative workspace visuals, example prompts, source scopes, capabilities and plan families. Optional saved environments do not replace this default.
- The preview is deliberately non-executable. It does not run research, AI, data retrieval, tools, engines, connectors, Projects, Chats or Artifacts and it does not create product state.
- Preview interactions converge on explicit **Sign in** or **Create account** actions. Registration and authentication are part of the same identity boundary; neither grants capabilities until the resulting session/entitlements are resolved.
- Returning authenticated users restore directly into the Project/Conversation experience.
- Connection Center, Persona preferences and domain/workspace selection are not startup gates. They remain available from contextual recovery/actions or Settings after sign-in.
- Setup state may inform capability availability, but it must not block the authenticated shell from opening.
- The product depth model is **Conversation → Artifact → Workspace**. A user can remain in conversation, expand a result into an Artifact, and open a professional workspace only when the task benefits from it.
- Any future anonymous execution path requires an explicit architecture/security decision and new acceptance coverage; it must not reappear as a convenience shortcut.

This identity-gated entry contract supersedes the retired guest-first execution model and older mandatory onboarding behavior.

### 1.1.2 First-use continuation contract

After authentication, LiOS must feel immediately usable rather than like a setup wizard.

Canonical first-use order:

1. **Ask first.** The authenticated conversation surface is the default destination and provides example work without requiring provider setup.
2. **Connect optionally.** Connections is a secondary action available from the empty state, Settings and contextual missing-source recovery.
3. **Verify only what the user chooses.** A selected provider must pass its normal credential/model/source verification before LiOS represents it as usable.
4. **Return to the work.** If a request needs a missing source, LiOS opens Connections without discarding the original question; closing/continuing returns to the same task.

Rules:

- identity is the only startup gate;
- no connector, AI provider, runtime pack, Persona or domain selection is required to enter the shell;
- zero connections is a valid state, not an error state;
- Connection Center uses **Continue to LiOS**, not onboarding-completion language;
- the conversation entry visibly states that connections are optional;
- capability gaps remain explicit: LiOS may say data/provider access is needed, but it must not fabricate values to make first use look complete;
- a provider that the user elects to configure must still pass the normal verification/policy boundary before use.

Opening and leaving the workspace must preserve the same continuity:

- A transient session-service failure is a recoverable opening state, not evidence that the user signed out. Session restoration is bounded and offers Retry; only an explicit unauthenticated response opens the public preview.
- Contextual Connection Center and domain selection preserve the mounted conversation and staged inputs, then return to the same work. Hidden workspace shortcuts must not intercept setup input.
- Sign-out clears local session/workspace state only after server acknowledgement or an already-expired session. A rejected or unreachable sign-out keeps the session visible and offers Retry.
- A conversation stream needs a valid terminal event. An interrupted connection preserves received evidence and reports an incomplete run; it must not silently imply completion.

Artifact presentation and saving follow the same calm workflow:

- One Focus artifact action accompanies a side pane sized to the available conversation width. Narrow surfaces can enter Focus and return to the chat explicitly.
- Streaming follows the latest response only while the reader is near the bottom; scrolling back keeps the reading position and exposes Jump to latest.
- Move into Project and Keep in Project from Quick/Temporary work require an explicit existing or new destination. A failed save retains the choice and reuses any newly created Project on retry.
- Artifacts use readable text and semantic tables/fields for recorded data. Raw editing and internal adapter/hash details belong under Advanced or Show Work.
- Export lists the formats returned by the canonical export plan, identifies the recorded revision, and awaits export failures. Preview-row and active-sheet limitations stay visible.

P14-11 source acceptance protects this path. The packaged clean-profile walkthrough remains separate release evidence.

### 1.2 P1 Projects and Living Workspace interaction rules

The default LiOS entry is now conversation-first, but not chat-only:

- Authenticated left rail stays deliberately small: **New chat, Search, Projects and More** are the default controls, with recent chats beneath them. More contains Temporary chat, All chats, Library, Automations, Plugins, Workspace and Connections. Settings and lifecycle/import controls live in the account menu. New chat creates a Quick Chat; Project Home creates Project-scoped chats.
- Center: the active conversation or Project Home.
- Project context: instructions, AI transmission policy, resources and Session Vault open on demand. On narrower screens context temporarily occupies the content region; closing it returns to the same conversation.
- Library and Automations reuse existing Project-scoped artifact and workflow surfaces. Select a Project explicitly; failures remain visible with retry. Plugins states the SDK boundary honestly until marketplace/install controls exist.
- Project, source-scope, execution-mode and artifact-kind single selects retain native platform popups; their trigger styling follows the locked theme.
- Narrow screens expose the same navigation and account actions through the shared accessible drawer. On the Projects/chat surface, **Search means saved work**: Project names/instructions, chat titles and message text, Artifact titles, and file/resource labels. Analytical capability/entity command discovery remains a separate Workbench/power-user surface. Do not duplicate global Search with permanent Project filters or title-only chat search boxes.
- Workbench: opens only when analytical depth is useful; it is not forced on the first screen.
- The Workbench rail is an **advanced workspace navigator**, not a second product sidebar. It may expose Back to Projects, Workbench capability groups, Data/Connections and Settings. Pulse / Explore / Signals remain supporting capabilities reachable through search, conversation, deep links or explicit advanced actions; they do not reappear as competing top-level navigation.
- On restart, persisted supporting surfaces such as Pulse / Explore / Signals / legacy Library canonicalize back to Projects. An explicitly entered Workbench may be restored because it represents deliberate analytical depth.
- `@` references are explicit context controls, not cosmetic mentions.
- `/` commands invoke LiOS-owned safe actions or deterministic tools.
- AI-generated machine directives are removed from visible prose before rendering.
- Opening/focusing an analytical panel is safe-auto only after validating the requested view against the LiOS feature registry.
- Multi-panel layout changes are proposals with an explicit Apply/Dismiss control.
- Changing conversation or Project while a response is running is blocked. An unsent draft or staged input requires an explicit discard choice before changing context; cancelling keeps the draft.
- New Project uses the shared dialog, preserves its name on failure and selects the created Project after success on both desktop and narrow screens.
- Rename, Trash and destructive lifecycle actions use the shared accessible dialog contract; confirmations state the affected object and consequence. Destructive controls do not occupy permanent chat-header space.
- Temporary Chat visibly states that it is **not saved** and cannot silently become persistent.
- Session Vault exposes restore/fork/compare without copying credentials.
- Docking, tab grouping and floating panels are advanced affordances; the default Project/chat view stays calm and uncluttered.
- Mobile/maximized analytical panes continue to use the simpler fallback rather than forcing desktop docking behavior.

### 1.3 P2 conversational execution interaction rules

- Keep one Ask LiOS surface; do not expose specialist-agent personalities as separate product tabs.
- Show a compact execution card only while a request is doing real work or needs approval.
- Tool steps use plain finance language and visible states: queued, running, complete, cancelled or failed.
- A deterministic result must be visibly distinguishable from an observed-source value and from an AI-derived estimate.
- AI-direct mode is never implicit: it remains available under the composer's Advanced controls and execution pauses for explicit approval. It does not occupy permanent composer chrome.
- Approval affordances are **Allow once**, **Allow for Project**, and **Deny**. High-impact actions later add Review/Apply/Cancel before mutation.
- Cancellation is available while a workflow is running and must stop provider/tool work rather than merely hiding the UI.
- Typed work-product drafts appear as compact artifact cards and stay subordinate to the conversation until P4 persistent Artifact UX is active.
- The active security/panel is passed as selection context so “analyze this” works without restating symbols; Project policy can disable selection transmission.
- Project AI transmission controls live with Project Context: configured, local-only, or any-configured provider posture; provider allow/deny lists; plus Project-instruction, resource-reference, active-selection and tool-calling boundaries.
- Advanced execution detail is progressive disclosure. Default users see what is running and why, not internal framework names or hidden reasoning.

### 1.4 P3 Project History, Show Work and change-intelligence rules

- Keep the default Project Home calm. P3 appears as one **Project History & Ledger** surface rather than adding permanent navigation clutter.
- History rows use understandable event names plus compact sequence/hash/actor metadata; raw internal payloads are not the default UI.
- **Show Work** is on demand. It exposes sources, as-of time, formula/method, engine/version, input/output evidence hashes, warnings and explicit deterministic/AI attribution.
- “Hash chain verified” means the stored LiOS Ledger sequence/content links recompute successfully; do not imply an external notarization or guarantee against a privileged database administrator rewriting all history.
- **Undo** is offered only for events carrying a valid inverse mutation. Undo never removes the original event; the UI reflects the appended revert and refreshes Session state.
- Session comparison explains concrete changed categories and common ancestry. It must not invent motives for why a user changed a value.
- “Why did this change?” is deterministic when based on stored Session/provenance differences. AI may later summarize evidence, but it cannot replace the stored comparison facts.
- Portability UI clearly states that credentials are excluded. Secrets/API tokens remain in the appropriate credential store and must be reconnected after import.
- Temporary Chat has no persistent Ledger. Quick Chat has its own persistent stream; Project work uses the Project stream while retaining chat/session references.
- Persistent P4 artifacts will reuse this evidence model. P3 work-product drafts must not be presented as already-versioned persistent artifacts.

## 2. Governing principle

> **Maximum intelligence, minimum interface.**

A feature is incomplete if the user must learn internal architecture to use it.

## 3. Default shell

The normal desktop shell should have three conceptual zones:

```text
+----------------+----------------------------------+----------------------+
| PROJECTS/CHATS | CONVERSATION / ACTIVE WORK      | ARTIFACT (optional)  |
|                |                                  |                      |
| + New Project  | Ask LiOS...                      | Chart / Model /      |
| project list   | conversation                     | Table / Report       |
| recent chats   | tool progress                    |                      |
|                |                                  |                      |
+----------------+----------------------------------+----------------------+
```

The artifact pane appears when useful. It should not permanently reduce the canvas if there is no artifact.

Existing Pulse / Explore / Workbench / Signals / Library functionality is retained, but these are supporting product surfaces, not cognitive prerequisites for a new user.

## 4. Projects and chats

### Project behavior

A project groups related:

- chats;
- files;
- entities;
- models;
- artifacts;
- reports;
- automations.

Opening a project restores relevant context.

### Chat behavior

Chats are separate working threads inside a project. A user can create multiple analyses without losing the project's shared resources.

Chat history should be easy to rename, search, pin, branch and reopen.

## 4.1 Quick Chats and Temporary Chats

In addition to Project chats:

- **Quick Chats** support exploratory questions outside a Project.
- A Quick Chat can be moved into a Project only with an explicit scope preview.
- **Temporary/private chats** do not automatically enter durable project memory or long-lived analytical context.
- Project and Quick chats may retrieve relevant permitted sources under the approved 2026-10-02 scope with attribution. Temporary chats do not implicitly inherit private context; explicit session-scoped selection remains governed.

## 4.2 Project Home

Project Home is a rich adaptive intelligence dashboard, distinct from minimal Global/New Chat and conversation-first Project Chat.

Show useful Project summary/goals/pins, What Changed/Signals, verified metrics, live/recent Artifacts and chats, events, automations, relationships, activity and health. Quiet refresh retains last verified as-of state or explicit unavailable status; it never implies freshness.

Adapt and reorder only unpinned modules; preserve user pins. No template gate, manual dashboard-builder or permanent Decision widget is required. Detailed instructions/resources/policy remain on-demand Project Context.

## 4.3 Keep in Project

Important regular Chat and Project outputs must auto-persist under canonical P4 identity and immutable content versions. Current candidate source retains supported successful Project and Quick Chat output through conversationRunService and P4 persistConversationDraft, with explicit owning Chat instead of an invented Project. Temporary Chats remain nonpersistent. Saved assistant messages retain exact Artifact/version references; reopening does not rerun tools. Candidate source and bounded packaged journeys are recorded in docs/PENDING_WORK.md; complete TC-13/Shipping Point/P14 qualification remains open. Chat and direct controls share the same object and revision state. Material AI edits require review; rejection leaves the version unchanged and undo creates a compensating version.

Regular Quick Chats retain their authorized work without a Project destination; moving/linking into a Project is an optional explicit scope-aware action, preserving the Chat and P4 object identity. Temporary Chats remain non-persistent, including no automatic durable Artifact or memory creation; any explicit promotion requires a clear user action and governed destination. Failed explicit move/link must preserve the user's choice and retry state. Output concepts include charts, tables, models, screens, reports, research, sources, scenarios and recipes; the canonical schema controls serialized Artifact kinds, not this prose list.

## 5. Composer

The composer is the dominant action surface.

Its **default visible state is intentionally minimal**: add/attachment (`+`), text input, one microphone icon and send. It grows with the message rather than presenting a permanent control panel.

It supports:

- natural-language prompt;
- file attachment/import through `+`, drag/drop and paste where supported;
- `@` references;
- optional `/` commands for power users;
- selected artifact/object context;
- source scope under `+ → Sources`;
- deterministic/AI-direct modes, session/workflow actions and reply speech under `+ → Advanced`;
- clear stop/cancel controls only while work is running.

Voice setup must not occupy permanent composer space. The microphone remains a single icon; if voice is not configured, activating that icon opens the appropriate setup/recovery flow.

The empty state should suggest useful actions without becoming a wall of feature cards.

## 6. Conversational references

LiOS must handle short follow-ups correctly.

Example:

1. “Show Microsoft.”
2. “Compare it with Google.”
3. “Only cloud.”
4. “Five years.”
5. “Normalize margins.”
6. “Add Amazon.”
7. “Why did 2024 move?”
8. “Use filings only.”
9. “Make a bear case.”
10. “Save this.”

These messages should mutate one coherent analytical context.

## 7. Adaptive workspace

The interface changes based on the work.

- research request → research/source artifact;
- valuation request → live model artifact;
- comparison → table/chart artifact;
- screen → filter/result artifact;
- portfolio stress → risk/scenario artifact;
- memo request → document artifact.

The user should not first choose the module that can perform the task.

## 8. Artifact interaction

Artifacts are interactive.

From chat the user can say:

- “remove Infosys”;
- “use FY27 EBITDA”;
- “change WACC to 9%”;
- “only show five years”;
- “undo that”;
- “make this a bar chart”;
- “add this to the memo”.

Artifact controls and conversation must update the same underlying object.

## 9. Branching

Users can branch a conversation/model state.

Examples:

- Base;
- Bull;
- Bear;
- Management guidance;
- Pre-earnings;
- Post-earnings.

Branching must preserve the parent state.

A compare command can explain structured differences in assumptions, sources and outputs.

## 10. Power controls

Natural language remains primary, while professionals get shortcuts.

Examples:

```text
/research
/compare
/model
/screen
/chart
/monitor
/report

@NVDA
@portfolio
@DCF-v4
@my-estimates.xlsx
@OpenFIGI
```

`⌘K` provides universal command/discovery access.

Keyboard use should never require a separate “pro mode”.

## 11. Chat-to-terminal continuity

Chat and terminal are two views of the same state.

Example:

- user asks for Apple revenue;
- LiOS creates chart/table;
- user opens full company workspace;
- the same entity, period and selection remain active;
- user changes assumptions;
- chat understands the updated state.

Navigation should not reset context unnecessarily.

## 12. Evidence and execution visibility

Do not expose hidden chain-of-thought.

For complex workflows, keep the default UI at quiet Working/Stop with progressive verified answers. Only when the user requests **Show Work** (or material error/approval needs attention), show a concise inspectable execution trail such as:

- resolving entities;
- checking 4 sources;
- running DCF;
- comparing 8 peers;
- generating 2 artifacts.

Evidence/source detail is expandable.

Normal analytical screens prioritize the answer. Failure/conflict states expose the relevant source detail automatically.

## 13. Data-gap UX

Missing data should feel helpful, not broken.

Example:

> Consensus EPS is unavailable from your currently connected sources.

Offer valid next actions:

- connect a compatible provider;
- use an alternate connected source;
- import estimates;
- build a user-defined scenario;
- continue without that field.

Never silently invent the missing number.

## 14. Visual system

Preserve the supplied Figma graphite/gold identity as the current visual authority. Older login/orange/cinematic references remain dated history where they conflict; optional environments and explicit saved preferences remain supported.

Key characteristics:

- matte near-black surfaces;
- strong contrast;
- thin separators;
- restrained gold active emphasis;
- semantic market/financial colors;
- dense information when the task requires it;
- calm empty states;
- minimal decorative chrome.

Do not create a second visual language for “AI mode”.

Chat, Workbench, charts, models and Connection Center must feel like one product.

### Base LiOS palette

The supplied reference governs shell/background/foreground/brand values below. Older regression tests against orange tokens are implementation evidence, not authority for the new visual contract or proof of visual acceptance. Semantic analytical colors remain distinct from branding.

```text
App background        #09090b
Shell                 #07070a
Panel                 #0d0d10
Panel secondary       #111115
Text primary          #ede9e0
LiOS brand gold       #d4a017
Market up             #2D9CDB
Market down           #D4511A
Success               #1FCB84
Analytical            #8B5CF6
```

Structural surfaces stay matte graphite. Avoid glossy gradients and decorative glow as default shell treatments.

### 14.0.0 Signature Entry & Typography

The first 30 seconds of LiOS must feel like one premium intelligence product rather than a conventional SaaS dashboard or a retro terminal skin.

Canonical entry follows the supplied Figma Financial Intelligence Operating System hero and compact product header. The older “Turn information into advantage” cinematic entry direction is superseded where conflicting.

New/unconfigured surfaces use matte backgrounds. Environments are optional; preserve an explicit saved selection and never rotate active work merely because time passes. Only explicitly enabled pre-work rotation may use a slow cadence, bounded current/likely-next preload and visibility pause; reduced-motion users receive static imagery. Immersive → Contextual → Focus continuity applies when an environment is enabled.

Bundle typography locally:

- **Barlow Condensed** — display headings;
- **Inter** — conversational prose, navigation, actions and explanatory UI;
- **JetBrains Mono** — financial values, tickers, status, source IDs and data labels.

Rule:

> **Sans communicates thought. Mono communicates data.**

Authentication remains visually calm. Do not reintroduce CRT scan lines, Matrix/code-rain effects, excessive glow, pulsing terminal ornaments or other decorative “hacker” motifs.

### 14.0.1 Contextual Visual Intelligence Canvas

LiOS may use generated background imagery and restrained motion to make the product feel richer, more spatial and more premium, but imagery must support analytical work rather than compete with it.

The visual model has three intensity states:

1. **Immersive** — used for launch, sign-in, empty states, Project entry and other orientation moments. Rich LiOS-generated imagery may occupy a large portion of the canvas while the composer and essential controls remain highly legible.
2. **Contextual** — used once a conversation or research workflow begins. The selected visual remains as a subdued edge/header/background layer while conversation and live Artifacts use mostly opaque matte surfaces.
3. **Focus** — used for dense analytical work such as valuation models, spreadsheets, risk views, charts, multi-pane workspaces and long reports. Structural surfaces become near-black and the contextual image is reduced to a faint header, vignette, accent or removed entirely.

The transition should feel continuous:

> Immersive entry → conversation begins → contextual visual recedes → Artifact opens → analytical focus increases → professional workspace becomes predominantly matte → close/de-focus returns visual richness.

#### Canonical background environments

Preserve the ten canonical LiOS-owned optional environment families and their master → 1920×1080 production SVG → 1600×900 low-resource chain, rather than arbitrary stock photography or random wallpapers:

- Global Intelligence / Macro — earth horizon, illuminated networks, economic geography and global flow;
- Company Research — abstract corporate architecture, structured data geometry and business intelligence motifs;
- Markets — flowing market/data terrain, price/volume rhythm and financial motion;
- Valuation / Modeling — geometric layers, curves, grids, scenario pathways and restrained analytical forms;
- Portfolio / Risk — topographic risk surfaces, connected asset structures and scenario contours;
- Quant / Strategy — signal topology, computational model geometry and restrained structured waves;
- Research / Knowledge — documents, information constellations, evidence networks and subtle knowledge architecture;
- Personal Finance / Wealth — calmer horizon, planning, progress and long-term wealth imagery;
- Economic Intelligence — time/geography, macro data contours and structural economic flows;
- Neutral / General — premium dark LiOS environment for uncategorized chats and Projects.

These environments are contextual aids, not module branding. They must not create a second navigation taxonomy.

#### Rotation and persistence

Do not rotate backgrounds continuously while the user is working.

- explicitly enabled pre-work rotation may occur on a new app session, new Project or empty-state revisit; matte/disabled defaults and saved selections take precedence;
- once active analytical work begins, freeze the selected environment for continuity;
- optionally allow a Project to pin one visual environment;
- preserve the user's visual choice with Project/Saved View state when practical;
- never change the background in response to every small chat turn.

#### Context-aware selection

LiOS may choose an environment using current Project/object context, for example Macro, Company Research, Portfolio, Risk or Valuation. The selection must remain subtle and reversible. The user should still experience one LiOS product rather than separate themed applications.

#### Color enrichment

The matte graphite token system remains authoritative. Optional background art may introduce controlled secondary color while gold remains the primary brand accent.

Approved contextual color families include:

- restrained amber / burnt orange / warm gold;
- deep indigo / violet for analytical depth;
- occasional electric blue / cyan for information and network structure;
- semantic green/red/blue only where financial meaning requires them.

Avoid rainbow UI, uncontrolled neon, glossy gradients across structural panels or high-saturation imagery beneath dense data.

#### Material and glass usage

Translucency is allowed selectively where it improves hierarchy:

- composer;
- command palette;
- compact menus;
- lightweight suggestion cards;
- temporary overlays.

Large research/model/table/report surfaces should become substantially opaque. Glass/material is a framing treatment, not the default surface for dense financial information.

#### Motion

Motion may make the environment feel alive, but it must remain restrained:

- very slow parallax;
- subtle network/data pulses;
- soft lighting drift;
- short transition when an Artifact opens or focus mode changes.

Do not use persistent attention-grabbing animation behind charts, models or long-form reading. Support reduced-motion mode and static fallbacks.

#### Readability and accessibility

Every contextual visual treatment must preserve:

- sufficient text contrast;
- clear focus states;
- readable charts/tables;
- predictable semantic colors;
- reduced-motion support;
- a solid-background fallback;
- user preference to reduce or disable decorative imagery.

If visual richness reduces comprehension, the image must recede.

#### Performance and packaging

Background richness must not compromise the desktop-terminal experience.

- optimize and compress canonical assets;
- preload only the current/likely-next environment;
- avoid large unbounded video backgrounds;
- lazy-load nonessential environments;
- cache locally;
- test startup, memory, GPU and battery impact;
- provide low-resource and reduced-data fallbacks;
- prefer efficient still imagery plus lightweight effects over heavy continuous video.

#### Interaction rule

Richness comes from **depth + context + transitions + analytical objects**, not more permanent cards.

Background imagery must never become a substitute for the Projects → Chats → Artifacts interaction model, and it must never obscure the transition from simple conversation to professional analytical workspace.

## 14.1 Capability growth without capability clutter

LiOS may continue adding substantial finance capability. **Capability count is not the UX.**

Rules:

- new capabilities should become discoverable through conversation, search, `⌘K`, contextual actions, artifacts and Project state before they become permanent navigation;
- the main shell must not grow one menu item per engine/provider/analysis;
- advanced functionality may appear only when the current task/context makes it relevant;
- users should be able to work directly on generated artifacts with both normal controls and conversational edits;
- professional users may reach deeper tools quickly without forcing beginners to understand the internal taxonomy.

The product can become much more capable while the visible mental model remains **Projects → Chats → Artifacts**.

## 15. Progressive disclosure

### First-time user

Sees:

- projects/chats;
- composer;
- obvious suggested actions;
- clean results.

### Professional user

Also uses:

- multi-pane workspace;
- tabs;
- keyboard shortcuts;
- saved layouts;
- branch comparison;
- direct commands.

### Expert/diagnostic use

May expose:

- provider conflicts;
- source pins;
- runtime packs;
- data health;
- detailed provenance;
- advanced modeling controls.

Expert chrome should not dominate first use.

## 16. Information hierarchy

For finance artifacts:

1. key number/result;
2. chart/table/model;
3. comparison/scenario;
4. controls/actions;
5. concise explanation;
6. evidence/details.

Avoid large paragraphs above the actual analysis.

## 17. Simple names

Prefer task/object language:

- Project;
- Chat;
- Company;
- Portfolio;
- Model;
- Research;
- Screen;
- Report;
- Data.

Avoid exposing internal code names, panel names or architecture terms unless in developer/admin diagnostics.

## 18. First-use target

A healthy install should allow a user to:

1. open LiOS and immediately understand the product through the non-executable public preview;
2. sign in or create an account to cross the execution boundary;
3. restore or enter the authenticated conversation workspace without a mandatory connector/persona/domain wizard;
4. ask a useful question immediately, with capability availability resolved from the authenticated session and entitlements;
5. obtain a useful output and inspect or refine it;
6. expand into an Artifact/Workspace only when deeper professional work is useful;

without documentation or mandatory advanced connector setup.

## 18.1 Context controls and semantic zoom

The user should not need a permanent “Intelligence Fabric” dashboard.

Advanced linked intelligence should appear contextually:

- entity;
- metric;
- period;
- point-in-time;
- event;
- portfolio;
- benchmark;
- scenario;
- geography;
- currency.

Use **semantic zoom**: a small pane shows only essential state; larger space reveals deeper labels, statistics, evidence and controls.

## 18.2 What Changed / Time Machine / Scenario UX

- **What Changed** compares governed states and highlights meaningful deltas.
- **Time Machine / As Known On** only renders historical state when a real snapshot/source supports it.
- **Scenario Lens** makes Base/Bull/Bear/custom branch differences visible without mutating the parent.
- **Formula Studio** is advanced/on-demand and never replaces normal natural-language interaction.
- **Research Graph** is a supporting exploration artifact, not a mandatory navigation model.


## 18.3 Final enrichment interaction contract

This section freezes the interaction model for the next major LiOS implementation stage. New power should enrich this model rather than create another competing shell.

### 18.3.1 Context and source controls

Working Context is bounded live state and remains hidden in normal UX; it is not GM durable memory. No default Context Strip, hidden-context inspector or mandatory entity/security selector is required. Automatic routing is the default.

The historical heading is retained for link compatibility; its former default-visible strip requirement is superseded by hidden Working Context.

Explicit object/selection actions may reveal relevant entity, period, scenario or source constraints on demand, using the canonical precedence and permission envelope. Evidence/History/Show Work remain inspectable without permanent context-chip clutter. Cmd/Ctrl+K is the single global discovery/action surface, not merely composer focus.

### 18.3.2 Selection-aware AI

LiOS must understand the user's current selection as an executable object.

Examples:

- chart region → Explain movement / Compare / Find catalysts / Create alert / Ask LiOS;
- table rows → Compare / Chart / Research / Add to Watchlist / Run screen;
- model cell/range → Explain / Change / Stress / Show source / Trace dependents;
- report text → Verify / Find source / Rewrite / Add evidence;
- portfolio positions → Explain risk / Stress selected / Rebalance selected;
- timeline event → Explain impact / Open evidence / Add to thesis.

Selection actions should be contextual and compact rather than permanent toolbar clutter.

### 18.3.3 Ask this

Every typed artifact can become the active conversation object.

The user can ask:

- "Why did this collapse here?" while a chart region is selected;
- "What is causing most downside risk?" while a portfolio artifact is active;
- "Why did margins change?" while statements are active;
- "Make this quarterly" while a table/report is active;
- "Use only filings" without restating the company.

The active object, exact object version and selection are passed through the canonical context envelope.

### 18.3.4 Search and command discovery

`Cmd/Ctrl+K` has one meaning within a given surface and must never compete with a composer-focus shortcut.

- On **Projects/chat**, it opens saved-work Search across Projects, conversation text, Artifacts and files/resources.
- In the **Workbench**, it may open analytical command/action discovery across securities/entities, data, tools, models, providers and workspace actions.
- The composer never claims `Cmd/Ctrl+K` merely to focus itself.

Natural-language conversation remains the primary way to invoke analytical work. Command discovery is a power-user acceleration layer, not the default Search mental model.

Power-user syntax such as slash commands and @ references remains optional. Nothing essential requires memorizing commands.

### 18.3.5 Saved Views, presets and linked panels

Saved Views are first-class professional state, not merely browser routes.

A Saved View may preserve:

- Project/object;
- entity/security;
- period/frequency;
- scenario;
- source policy;
- visible artifacts;
- panes/tabs;
- chart/table filters;
- peer set;
- workspace geometry where applicable.

Users may optionally set a Saved View as Project Home.

Advanced workspaces support **linked context groups**. When linked, a security/context change propagates to intended panes such as Chart + Financials + News. Unlinking freezes a pane/artifact.

Ship optional starter presets such as Research, Valuation, Portfolio Manager, Risk, Quant and Macro. These presets are not separate products and are never mandatory navigation.

### 18.3.6 Progressive professional workstation

Default:

> Conversation + active artifact

Advanced user action:

> Open in Workspace

The artifact may expand to a two/four/six-pane layout, full screen, comparison view or multi-chart workstation.

This professional depth is progressive. The default Project/Chat interface remains calm.

### 18.3.7 Spreadsheet/model artifact UX

A SpreadsheetArtifact may be powered by Univer OSS or another approved engine behind the LiOS artifact contract.

Normal users initially see a concise financial artifact with key assumptions and outputs.

Professional action:

> Open Full Model

Then the user can inspect/edit cells, ranges, formulas, periods, scenarios and assumptions.

Conversation and direct edits always address the same model state.

Material AI model edits use:

> AI Draft → show changed cells/formulas/assumptions → Review → Accept/Reject

Support undo/version/fork. Never silently overwrite a professional model.

### 18.3.8 DataArtifact UX

Very large datasets may open as a high-performance DataArtifact backed by DuckDB/Arrow with Perspective or TanStack/Virtual as appropriate.

The user can:

- sort/filter/group/pivot;
- select rows/columns;
- chart selection;
- ask questions about selection;
- save screen/view;
- create a derived dataset;
- export;
- keep in Project.

The user should not need to know which rendering/query engine powers the artifact.

### 18.3.9 Live ReportArtifact / ResearchArtifact

Reports and memos are living editable artifacts, not disposable generated files.

The user may ask:

- "Shorten the risks section."
- "Insert the valuation chart here."
- "Update this after earnings."
- "Turn this into an IC memo."
- "Verify this paragraph against filings."

Report state stays linked to source artifacts/models where practical so refresh does not create numerical drift.

### 18.3.10 ThesisArtifact

A thesis can contain:

- claims;
- catalysts;
- risks;
- assumptions;
- evidence;
- contradictions;
- valuation references;
- invalidation conditions;
- open questions;
- important events;
- refresh/postmortem history.

LiOS may refresh the thesis after new evidence and explain what changed. Do not reduce this to an arbitrary AI conviction score.

### 18.3.11 Intelligence Timeline

A unified Project/entity timeline may combine:

- filings;
- earnings;
- guidance;
- corporate actions;
- news/research;
- insider activity;
- alerts;
- model runs;
- assumption changes;
- scenario changes;
- user decisions;
- automation events;
- provider/data-health events when material.

Timeline items are actionable and source-linked.

### 18.3.12 Tool progress and approvals

Use assistant-ui/tool-ui-style interactive states rather than verbose chat narration.

Example:

Valuation Analysis
- Security resolved
- Sources checked
- Statements normalized
- Peer set built
- DCF running
- Scenario artifact pending

Permission-sensitive actions use compact approval UI such as:

- Allow once;
- Allow for Project;
- Deny;
- Review changes;
- Apply;
- Cancel.

Examples include sending Project content to an external AI provider, using a private file, running a material write action or changing many model assumptions.

### 18.3.13 Data-gap action UX

A missing field is never a dead-end error when alternatives exist.

Example:

Consensus EPS unavailable
- connected provider A: not entitled;
- provider B: field unavailable;
- Project files: no estimate found.

Actions:
- Connect provider;
- Use alternative source;
- Import estimates;
- Enter manually;
- Create AI-derived scenario with permission;
- Continue without field.

Observed, deterministic-derived, manual and AI-derived values remain visually distinguishable on inspection.

### 18.3.14 Show Work / reproducibility drawer

Every material result can reveal an on-demand receipt containing:

- sources;
- retrieval/as-of timestamps;
- exact data inputs;
- units/currency/period;
- assumptions;
- formulas/method;
- deterministic engine + version;
- transformations/derivations;
- conflicts/gaps/warnings;
- AI-derived values clearly labelled;
- branch/model/artifact version;
- rerun/fork/compare actions.

This is execution evidence, not hidden chain-of-thought.

### 18.3.15 Conversation → Workflow

Any useful completed sequence can offer **Save as task**: a versioned recipe with parameters, source requirements and output types, never credentials or cached grants. Saving does not schedule execution. Reruns recheck permissions, inputs and freshness through canonical P9 workflow/scheduler authority.

Separate optional execution modes:

- Run now;
- Run manually from Project;
- Run on schedule;
- Run after an event such as earnings/new filing/provider update;
- Run as a monitor/alert.

The user should not have to construct a workflow graph for ordinary automation.

### 18.3.16 Project Intelligence UX

Project Intelligence lets the user query permitted Project-owned history such as chats, models, reports, files, assumptions, evidence and prior decisions.

Example questions:

- "Why did I originally buy this?"
- "Which assumptions changed?"
- "What did I say about margins last quarter?"
- "Show evidence contradicting the current thesis."

Relevant cross-Project retrieval follows the approved user/source scope, with source attribution and exclusions; tenant/client restrictions and temporary-chat rules still apply.

### 18.3.17 Action history

Expose a compact deterministic action/change history when useful:

- WACC changed 8.5% → 9.0%;
- source policy changed to filings only;
- MSFT added to peer set;
- Bear branch created;
- report refreshed;
- workflow scheduled.

This is not model chain-of-thought.

### 18.3.18 Open-source UI assimilation

LiOS may directly copy/adapt permissively licensed UI/workspace code from approved donors, including substantial components, when it is faster and better than rebuilding.

Primary near-term sources:

- assistant-ui for conversation/thread/composer primitives;
- assistant-ui/tool-ui for tool-result/approval UI;
- Hitheshkaranth/OpenTerminalUI for command palette, workspaces, linked panels, saved views, workstations, timeline and terminal interactions;
- ErTasselli/OpenTerminal for local terminal/workspace/provider UX patterns;
- Univer OSS for spreadsheet/model interaction;
- Perspective/TanStack for large-data interaction;
- Tiptap OSS for reports;
- ECharts for advanced analytical views.

All imported UI is re-themed to LiOS and must preserve the exact dark visual system. Do not copy donor branding/assets.

## 18.4 Simplicity rule for maximum power

"Simple UX" does **not** mean a weak product or limited feature set.

The product may contain extremely deep capability. The rule is:

> **Maximum capability, minimum unnecessary interface.**

Advanced capability should appear through context, artifact actions, command discovery, selection actions, saved workflows and progressive workspaces rather than permanent module clutter.

## 19. UX acceptance gates

For every core journey validate:

- loading;
- empty;
- unavailable;
- stale;
- conflict;
- failure/recovery;
- keyboard;
- resize;
- reduced motion;
- reload/session restoration;
- branch restoration;
- artifact persistence.

### Performance behavior

The user should perceive LiOS as immediate even when workflows are deep.

Use:

- visible-first rendering;
- progressive data hydration;
- bounded predictive prefetch;
- cache with freshness truth;
- virtualization for large result sets;
- worker/sidecar execution for heavy computation;
- isolated pane/artifact rerenders;
- streaming progress for long research;
- cancellation of stale work after context changes.

Do not prefetch aggressively on slow/save-data connections. Measure packaged-desktop behavior.


Measure, do not assume:

- startup latency;
- composer-to-first-result latency;
- entity search latency;
- artifact interaction latency;
- bundle impact.

## 20. Existing UX work to preserve

Do not throw away current implemented work, including:

- dark theme;
- calm shell convergence;
- omnibox;
- Ask LiOS split-pane behavior;
- Workbench saved layouts/scenes;
- object workspace work;
- tab continuity/reordering;
- existing charting and analytical panels.

The next UX stage should wrap and converge these capabilities into the Projects/Chats/Artifacts mental model.


<!-- LIOS-FINAL-2026-09-21-UX -->
## Final 2026-09-21 Living Workspace UX lock

This dated lock preserves Living Workspace interaction and continuity. Current Project Home and supplied Figma requirements above supersede its older default-dashboard and visual restrictions; it does not create a second shell or state authority.

### Experience target

LiOS should feel simple enough for a first-time conversational-AI user and powerful enough for a professional finance workflow.

The interaction synthesis is:

- ChatGPT/Claude-style conversational simplicity and Project organization;
- Bloomberg-style keyboard efficiency and information density on demand;
- AlphaSense/LSEG/Capital IQ-style source-aware financial research;
- TradingView-style interactive market/strategy exploration;
- Excel-like model manipulation where the user needs spreadsheets;
- proactive advisor/workflow behavior inspired by modern wealth assistants;
- event-driven research/monitoring patterns demonstrated by modern primary-source finance platforms.

The result must still look and behave like one coherent LiOS product.

### Default state: calm, not cockpit clutter

Global/New Chat remains minimal and Project Chat conversation-first:

- Project/Chat navigation at left;
- one dominant composer;
- conversation as the primary chat center surface;
- Project context and connected-source detail revealed when relevant.

Project Home instead uses the rich adaptive intelligence dashboard in §4.2, preserving pins without a template gate or manual dashboard builder.

The Living Workspace expands only when the user opens an artifact, chooses a professional layout or the current task clearly benefits from more space.

### Living Workspace

LiOS supports dockable/resizable/tabbed panels while preserving a simple default.

Common compositions include:

**Conversation + Artifact**
- chat at left/center;
- valuation/chart/report/backtest at right.

**Research**
- conversation;
- source viewer;
- research note/thesis;
- timeline.

**Modeling**
- conversation;
- spreadsheet/model;
- assumptions/scenario controls;
- chart/sensitivity.

**Quant**
- strategy editor;
- chart;
- backtest metrics;
- trades/equity curve.

**Portfolio**
- conversation;
- holdings/risk;
- scenario;
- chart.

Panels may be:

- opened/closed;
- resized;
- moved;
- tabbed;
- focused;
- linked by entity/security/context group;
- saved into a view;
- restored with the session.

Dockview OSS is the current-main workspace geometry renderer behind the LiOS WorkspaceAdapter. Keep one docking system; replace it only after a measured packaged-acceptance failure. Packaged accessibility, persistence and performance evidence remain explicit release gates.

### Layout persistence

Workspace layout is saved with session/project state, including:

- active panels;
- sizes/dock locations;
- tabs;
- focused object;
- linked context/symbol groups;
- saved view name where applicable.

Restarting LiOS or reopening a session should reconstruct the intended workspace without requiring the user to manually rebuild it.

### AI workspace behavior

The assistant may request workspace actions such as:

- open a chart;
- open a source;
- open a model;
- create a comparison;
- focus an existing artifact;
- propose a professional multi-pane layout.

The assistant should not constantly rearrange the interface. Prefer the minimum layout change needed to complete the user's objective.

Significant rearrangements should be reversible and, when disruptive, previewed or confirmed.

### Session Vault UX

Projects contain chats and artifacts; Sessions preserve a forkable analytical state.

Expose Sessions simply, for example:

- Base;
- Bull;
- Bear;
- Pre-Earnings;
- Post-Earnings;
- Custom user-named session.

Core actions:

- Save current session;
- Fork session;
- Rename;
- Compare;
- Return to parent;
- Archive/delete with clear impact preview.

Users should understand that forking creates an alternative analysis, not a duplicate credential/data connection.

### Artifact interaction standard

Every supported artifact should expose context-appropriate direct actions.

Examples:

**Financial value**
- Explain;
- Show source;
- Show history;
- Compare;
- Use as assumption.

**Chart**
- Inspect point/range;
- Show events;
- Open source;
- Add comparison;
- Create alert/monitor;
- Use selected period in analysis.

**Valuation**
- Edit assumption;
- Show source;
- Run sensitivity;
- Create scenario;
- Compare branch;
- Explain change.

**Portfolio**
- Inspect holding;
- Risk contribution;
- Correlation;
- Thesis;
- Rebalance scenario;
- Stress.

**Backtest**
- Inspect trade;
- Inspect signal;
- View rule;
- Change parameter;
- Rerun;
- Compare strategy/session.

Conversation and direct manipulation must update the same underlying object.

### Artifact chrome

Artifact surfaces should have a consistent small set of affordances:

- title/status;
- source/engine receipt indicator;
- save/reference;
- version/history;
- compare/fork where supported;
- export;
- more actions.

Do not bury the screen in toolbars. Progressive disclosure remains mandatory.

### Source/evidence UX

Material claims and calculations should support a compact **Show Work / Sources** affordance.

On demand expose:

- provider/source;
- document/filing;
- observation date/as-of date;
- engine/calculation;
- assumptions;
- conflicts or missing fields;
- execution receipt.

Do not expose hidden chain-of-thought. Expose evidence, inputs, tools and reproducible execution facts.

### Data-gap UX

When requested data is unavailable, the product should state what is missing and present actionable choices such as:

- Connect provider;
- Import file;
- Use another available source;
- Continue with historical-only data;
- Create a user estimate;
- Cancel.

Never fill a professional-looking chart/table with fabricated observations to avoid an empty state.

### Strategy Studio

Strategy Studio is a Living Workspace composition, not a permanent top-level navigation requirement.

Recommended layout:

- Monaco-based strategy/formula editor;
- chart;
- parameter controls;
- metrics;
- trades;
- equity/drawdown view;
- validation/output panel.

AI may:

- explain code/formulas;
- draft a strategy;
- debug;
- refactor;
- compare variants.

Execution remains behind validation and permission boundaries.

### Backtest Cockpit

BacktestArtifact should support a professional but comprehensible cockpit including:

- market/candlestick view;
- entries/exits/signals;
- equity curve;
- drawdown;
- benchmark;
- trade list;
- exposure;
- position sizing;
- fees/slippage;
- key performance metrics;
- parameter controls;
- walk-forward/Monte Carlo/parameter-run results when available.

Parameter changes should clearly distinguish:

- edited but not run;
- running;
- completed;
- failed;
- stale result.

The user must never confuse a hypothetical/backtest result with live performance.

### Spreadsheet / Model UX

SpreadsheetArtifact should support model co-editing without silent AI mutation.

AI-proposed edits use:

**Draft changes → Diff/Preview → Accept/Reject → Undo**

The user may select a cell/range/model object and ask LiOS to:

- explain;
- trace source;
- create formula;
- run sensitivity;
- compare versions;
- create scenario;
- chart selected data.

### Research UX

Research should support both fast answers and deep investigation.

Deep research may show:

- plan/status;
- permitted source set;
- evidence list;
- contradictions;
- open questions;
- draft conclusions;
- ThesisArtifact;
- TimelineArtifact.

The visual design should keep research readable. Avoid exposing the internal swarm of agents as chat personas.

### Thesis UX

ThesisArtifact should make claims and invalidation conditions inspectable.

Suggested sections:

- Thesis summary;
- Claims;
- Evidence;
- Catalysts;
- Risks;
- Assumptions;
- Valuation links;
- Invalidation;
- Open questions;
- What Changed;
- History/Postmortem.

### Intelligence Timeline UX

Timeline should unify meaningful Project events without becoming an activity-log dump.

Examples:

- filing;
- earnings;
- macro event;
- alert;
- model version;
- assumption change;
- thesis refresh;
- user decision;
- material price/portfolio event.

Filters may narrow by entity, artifact, event type, source or session.

### Prescriptive UX

Decision support should be presented in an understandable order:

1. What changed?
2. Why does it matter?
3. What scenarios were tested?
4. What options exist?
5. What are the trade-offs/risks?
6. What can the user do next?
7. What should be monitored?

Then provide actions such as:

- Open model;
- Stress scenario;
- Compare peers;
- Inspect source;
- Backtest thesis;
- Create memo;
- Save monitor.

Do not hide the deterministic inputs behind a confident narrative.

### DecisionArtifact UX

DecisionArtifact may present:

- objective;
- constraints;
- alternatives;
- expected outcomes;
- risks/trade-offs;
- assumptions;
- user-selected option;
- implementation steps;
- monitoring triggers.

LiOS may structure options, but political/financial/user decisions remain the user's choice. For finance decisions, make uncertainty and assumptions visible.

### Voice UX

Voice is another composer input. The default composer exposes voice as one microphone icon; readiness/setup UI appears only after the user activates it or when a voice operation needs recovery.

Voice interactions should use the same:

- Project;
- active object;
- permission;
- tool;
- artifact;
- history.

Examples:

- “Open Reliance.”
- “Show the downside case.”
- “Set WACC to ten percent.”
- “Compare it with Tata Motors.”
- “Run the backtest.”

Show the transcript and allow correction before high-impact execution.

### Agent action UX

Agent actions use consistent approval states.

Suggested visual categories:

- Running / informational;
- Safe automatic action;
- Confirmation required;
- Blocked by policy;
- Failed/retry.

For confirmation, state plainly:

- what will happen;
- which object/source is affected;
- whether external data/system is written;
- whether the action is reversible.

### Continuous intelligence UX

Any successful workflow may offer:

**Save as task**

Store the versioned recipe without credentials/cached grants; saving alone does not schedule. Separately choose:

- run manually;
- schedule;
- trigger on event/data update where supported.

Monitors should live in Project context and only interrupt the user when configured conditions are met.

### Personal Finance & Wealth UX

Personal finance should remain understandable to non-professionals.

Prioritize:

- cash flow;
- net worth;
- goals;
- debt/loan plans;
- asset allocation;
- retirement/long-horizon scenarios;
- portfolio monitoring;
- clear decision trade-offs.

Professional details remain available on demand. Do not force institutional terminology into a household workflow.

### Command and keyboard layer

Professionals should be able to work rapidly through:

- command palette;
- slash commands;
- @ references;
- keyboard navigation;
- saved views;
- context-sensitive shortcuts.

These actions operate on the same Project/Workspace/Object context as natural language.

### Optional CLI UX

A real terminal/CLI may expose status, doctor, connectors, runtime packs, logs, jobs/agents and data diagnostics. HQTUI is an approved candidate for this surface only.

The CLI is not a replacement for the main desktop UX.

### Visual discipline

Preserve the approved LiOS matte near-black visual system and established typography/color semantics.

The Living Workspace must not introduce:

- random card-dashboard styling;
- competing theme systems;
- uncontrolled neon colors;
- excessive borders;
- gratuitous 3D visuals;
- persistent animation;
- dense controls before they are needed.

Richness comes from capability, interaction and information design — not decoration.

### UX acceptance journey

The flagship experience to validate is:

**Create Company Research Project → ask a question → retrieve governed data → inspect filings/sources → run deterministic valuation/comparison → open interactive model/chart → change an assumption → see linked artifact update → save → fork downside session → compare → close/reopen LiOS → continue exactly where the user left off.**

If this journey is not effortless, adding more features does not count as progress.

## P4 Artifact UX implementation lock — 2026-09-22

The Project mental model remains **Projects → Chats → Artifacts**. P4 adds depth without adding a new permanent navigation taxonomy.

- Rich adaptive Project Home includes **Project Artifacts** without becoming a separate object authority. Supported successful Project and regular Quick-Chat outputs auto-retain through existing P4 paths in the current candidate; Quick work owns its canonical Artifact without a forced Project. Temporary Chats remain nonpersistent. Explicit Project promotion requires a destination and scope preview. Users can create/open persistent work or export/import an authorized Project package. Public issue #91 coordinates integration qualification; the canonical 206-item checklist and SP/P14 remain authoritative.
- Every Artifact opens in one consistent `ArtifactPane` with readable title/status/version, source and execution-receipt context, Ask LiOS, review, fork, undo, export, archive, compare and Session reference actions. Raw adapter/hash/internal metadata belongs under Advanced or Show Work, not default chrome.
- Conversation and direct controls operate on the same persistent Artifact identity. **Ask LiOS** passes the Artifact as active context. Supported mutation instructions create a review proposal; the user accepts or rejects it in the Artifact surface.
- SpreadsheetArtifact exposes a real editable formula grid. Professional AI changes are explicit diffs and cannot silently overwrite the model.
- Research/Report artifacts expose a calm live document editor; StrategyArtifact exposes Strategy Studio; BacktestArtifact makes status visible; DecisionArtifact preserves objective/constraints/options/risks/trade-offs; TimelineArtifact renders dated intelligence events.
- DataArtifact hides engine details by default but uses real DuckDB paging when a columnar Artifact is linked. Compact table/chart/spreadsheet rendering is deliberately bounded so large work products do not freeze the Project UI.
- SI-04 requires real renderer adoption behind P4, not renderer-name or enum presence. Univer/Tiptap/ECharts/Perspective/TanStack must render the same LiOS Artifact object with shared auto-persistence/Keep/Ask/Review/History/Compare/Fork/Export semantics; exact integration, provisioning, round-trip and user evidence determine truth level.
- Portable package import/export is Project-scoped and clearly reports imported Artifact/Session counts. Credentials are never a portable-object feature.

## P5 Data Fabric UX implementation lock — 2026-09-22

P5 should make broader data access feel simpler, not expose provider plumbing by default.

- **Connection Center remains the user-facing entry point.** Connected APIs, databases, files, cloud sources and MCP servers become Provider SDK capabilities without creating a second connector product.
- Search is local-first. When LiOS cannot resolve an instrument locally it may transparently check configured OpenFIGI/other federated sources, while showing the source and keeping provisional identities distinguishable from canonical LiOS entities.
- A failed data request must show an actionable **Data Gap**: what LiOS checked, why the value is unavailable, and useful next actions such as connect/review entitlement, confirm mapping, adjust as-known-on date, retry after quota reset, use another source or import data.
- Provider health, quota, coverage and depth are inspectable surfaces, not clutter in normal analytical views.
- Schema discovery may suggest mappings automatically, including AI suggestions, but the UI must require confirmation before the mapping can affect calculations.
- Historical research/backtests expose the selected as-known-on/revision policy so users can understand when the data was actually knowable.
- Data quality is presented as measured dimensions/issues from real data. Do not surface pseudo/demo quality as if it were evidence.
- Large data remains paged/columnar and Project-responsive. Optional Playwright/Arrow/Polars runtimes do not create a different mental model; they execute behind the same Data Fabric contracts when installed.
- MCP/browser actions remain visibly permissioned and Project-scoped. Browser downloads require approved roots/limits; MCP tools that require approval must never execute silently.
- Software/API/data/trademark rights are administrative/release metadata rather than distracting ordinary research, but an entitlement/redistribution restriction must surface when it blocks the requested use.
