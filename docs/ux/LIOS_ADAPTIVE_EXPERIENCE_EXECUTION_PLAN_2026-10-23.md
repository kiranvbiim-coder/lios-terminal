# LiOS Adaptive Experience — Audited UI/UX Implementation Plan

**Prepared:** 2026-10-23  
**Repository:** `kiranvbiim-coder/lios-terminal` — default `main` inspected at `9f7fee80b5189adb533825197fc54c2c4adfbbfc`.  
**Status:** **PROPOSED BOUNDED EXECUTION ORDER / SOURCE AUDIT**, not code implementation, rendered UX certification, installed-app acceptance or a new canonical roadmap.  
**Authority:** `AGENTS.md` → `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` → `docs/LIOS_UX_SYSTEM.md` + Shipping Points/P14 → TC/P2/P3/P4/P5/GM/CA owners → `docs/PENDING_WORK.md` and public issue [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).  
**Discovery annex:** [LIOS UI Innovation Lab](../technical/LIOS_UI_INNOVATION_LAB_2026-10-23.md) (same PR). **Earlier audit baseline:** [2026-10-22 source audit](LIOS_UI_UX_CODE_AUDIT_2026-10-22.md).  
**Scope lock:** The 65 IDs below are *UX-facing breakdowns* of existing work, not 65 new SI workstreams/issues and not permission to invent parallel architecture.

## Executive decision — stop fragmenting product development

**Build one Adaptive Intelligence Workspace**: quiet universal **Chat** → optional **typed Intent Lens** showing the right source-backed interactive comparison/research/model/review → exact same **P4 Artifact** sidecar/focus → full **existing Dockview Workbench** → return to Chat with unchanged owner, entity, source posture, active assumptions, Artifact ID/version and saved layout.

The first differentiating feature is **Evidence-led Comparison Lens**, not AI-generated arbitrary React code. It reads actual authorized entity/source/P4 material, labels unknown/conflicting values, opens evidence on demand, and routes *proposed* scenario edits to canonical P4/P11 review and deterministic calculation. Default ordinary requests remain plain Chat; no source wall, extra agent dashboard, permanent multimodal canvas or duplicate tool menu.

**Reuse method:** Keep React 18 + Vite + Tailwind 3 + shadcn/Radix, existing P4/Tiptap/Univer/ECharts and Dockview. Copy coherent permissible OSS UI compositions where demonstrably better; adapt their interaction mechanics, replacing donor ownership/AI backend/permissions/storage seams with existing LiOS contracts. Do not force React19/Zod4/Tailwind4 merely to install a fashionable generative UI package.

**Implementation starts only after this plan is reviewed.** This PR is planning/documentation only.

## 1. Code-first audit: method, actual coverage and limits

Audited the complete `main` Git tree listing (3,049 entries, untruncated), the existing 120-line source audit, source implementations of major authenticated and public surfaces, UX stylesheet entry/cascade, actual package dependency declarations, static UX/accessibility and visual-smoke harnesses, current draft/ready PR heads and exact hosted Source checks, and the canonical product/donor contracts.

**Structural inventory from repository paths (not all files line-by-line reviewed):**
- 343 files under `src/client/src/components/**.tsx`; 48 shared `components/ui` files; 123 files under `components/terminal`; 11 files under `pages`; 25 CSS files; 212 `src/client/src` test/spec files (some test pure logic, not rendered UI).
- The 2,474-line `ProjectExperienceShell.tsx` orchestrates Quick/Project/Temporary Chat, sources, attachments, streaming and saved Artifact selection; `pages/Terminal.tsx` is 1,110 lines of specialist/Workbench composition; `ArtifactPane.tsx` is 798 dense lines; `DataConnectionCenter.tsx` is 1,831 lines; `PublicProductPreview.tsx` is 1,903 lines. These are **coupling risks**, not automatic defects or mandates to rewrite.
- Actual foundations present: `projectEntry.ts` chooses conversation by default for normal signed-in entry; `SavedArtifactCards.tsx`, `conversationArtifactView.ts`, `ConversationArtifactSidecar.tsx`, `ArtifactPane.tsx`, `DockviewWorkspaceGrid.tsx`, `ChatSourcesControl.tsx`, `ConversationRuntimeTrace.tsx`, `ConversationTrustPanel.tsx`, `visualizationIntent.ts`. Reuse them.
- `main.tsx` imports `terminalStyles.ts`, which imports 11 stylesheet modules. `terminal-shell.css` has 197 source `!important` occurrences; `terminal-theme-lock.css` exists and declares incompatible older palette values but is **not imported by this central entry**. Inspect actual applied CSS before deletion; filename alone is not proof of active overrides.
- Visual-smoke Electron capture harness exists with conversation, conversation-artifact, workspace-focus, workbench and workbench-narrow cases. `validate_ux_flagship_acceptance.ts` and `validate_desktop_accessibility.ts` mainly assert source contracts. No screenshot, native target execution, VoiceOver, Narrator, fresh-account usage or user research was executed in this planning session. We must generate this **new evidence**, not pretend it exists.

### Important corrections to prior audit

The 2026-10-22 audit was written against older `main` `1fa37cc`; treat it as historical baseline, not today's defects:
- **Already source-corrected on current `main`:** Login fields have explicit `htmlFor` and input IDs, autocomplete attributes. `not-found.tsx` is branded dark with a Back to LIOS Chat link. Mark original UX-A04 and UX-A15 as **source-fixed, real interaction unverified**, not unimplemented.
- **Still source-confirmed on `main`:** `AuthenticatedNavigation.tsx` labels the conversation section `PROJECTS`; `ChatSourcesControl.tsx` offers scope radio buttons/connected-source names rather than a searchable full source catalog; `ProjectExperienceShell.tsx` main file attachment path requires a Project, while PR #100 supplies Quick Chat attachments; `DataConnectionCenter.tsx` has custom overlay `div` ModalShell lacking native/dialog semantics and extensive 8–10px controls. The existing `project-conversation-shell.css` hides Chat main below 1200px while context is open—potentially valid but requires return/focus UX.
- **Integration not acceptance:** #98 brings widespread Artifact/Chat integration touching **230 changed files**; #100 19 files; #102 36 files; #115 4 files. These overlap the same `ProjectExperienceShell`, `ArtifactPane`, `ConversationArtifactSidecar`, `ChatSourcesControl` and/or `Terminal`. Their feature code cannot be marked on `main` before reviewed merges and actual journey testing.
- **Static contract tension:** `validate_ux_flagship_acceptance.ts` still asserts the older four-line Financial Intelligence Operating System public hero. Owner-approved universal Chat-first positioning should be reconciled with that Figma-specific contract in a deliberate spec/test change, **not bypassed** or surprised by source CI.
- **Directly usable for the first Lens:** `SavedArtifactCards` reads saved P4 refs; `ArtifactReadableChart` already projects recorded calculation values into a chart; `visualizationIntent` defines context/diagnostic/primary policy; `conversationArtifactView` stores *only UI selection* while P4 authorizes and loads real Artifacts. Hence start with read-only typed projections, not a new generator or store.

## 2. Live PR and integration audit at this checkpoint

All Source checks below refer to each displayed exact PR head **as queried on 2026-10-23**, not full visual/native testing. All are unmerged at checkpoint; no review/signoff inferred.

| Group | PRs and observed state | Integration decision |
|---|---|---|
| First use / navigation | #99, #101, #106, #110 and guidance #118: **ready for review**, 3 Source OS checks green each | Request independent review; merge separately with main-level revalidation |
| Broad Artifact bridge | #98 draft, 230 changed files, 3 Source checks green | Perform focused architectural and ownership review and actual canonical Artifact round-trip; merge before dependent #102 |
| Attachments | #100 draft, 19 files, 3 Source checks green | Reconcile with CI fix #112; review Quick vs Temporary privacy and backend storage |
| Signed-in Chat | #102 draft, base `omp/finance-terminal-chat` (the #98 stack), 3 Source checks green | Do not merge child before base; validate native draft/route manifest and source rights |
| Research | #116 draft, 3 green; #117 **stacked on #116**, 3 green | Merge parent first, then rebase/recheck child; no duplicated source panel |
| Other low-overlap UI | #105, #107, #108, #109, #112, #113, #114 source green (draft) | Review accessibility, scope, evidence; stage after core or in non-overlap slots |
| Macro Manager | #111 draft, Linux/Windows green, **macOS failed** on a golden routing speed budget test | Diagnose platform run before treating as clean |
| Chat message actions | #115 draft on moving #102 parent; **Linux/Windows/macOS failed** due inherited route-manifest mismatch observed in Linux logs | Refresh #102 ancestry/manifest after its fix; rerun all target checks |
| New discovery/plan | #119 draft, 3 Source OS checks green before this plan update | This PR contains the one new proposed UX program and donor discovery annex; review documentation, no UI shipped |
| Parallel runtime | #120 GM/P13 draft, outside dedicated UI ownership | Coordinate exact runtime events/approval path; don't modify in UX project without owner |

**Merge dependency:** `#112 → #100` (file/test-runner overlap where needed); `#98 → #102 → #115`; `#116 → #117`; independent green small PRs reviewed and merged before they become stale. Always recheck moving base and Source status; no forced merge, check bypass or assumed independent review.

**Rule:** Update `main` only through independently reviewed, qualified PRs. Deletion/closure of old PRs requires explicit evidence of merged/superseded work, not a green new plan.

## 3. Recommended architecture and authoritative boundaries

```text
User intent
  → Existing P2 conversation runtime, consent and permission checks
  → TC Experience Selector (typed, deterministic first; optional AI proposal later)
  → Existing LIOS component catalog of approved read-only/mutation-review views
       · Answer / evidence digest
       · Source-backed comparison + change panel
       · Research progress + evidence Prism
       · P4 Artifact preview / model assumption form
       · Consequential action review
  → Existing P4 Artifact object & ownership (same ID, immutable version)
  → Existing Dockview professional Workbench (same engine, source and layout)
  ↔ Return to original Chat and work context
```

Do **not** let model output inject JSX, HTML, executable props, arbitrary URLs, queries, tool grants, financial figures or an independent Artifact store. The selector maps a structured intent to a predefined LIOS renderer and approved source/Artifact references; authoritative data is fetched with the current user scope and entitlement. For write actions, preview values and require existing P4/GM governed review and server receipt. Fallback is a normal accessible text response.

**Single owners:** TC governs visual experience and selected Lens; P2/GM runs the conversation and agent tools; P3/P5 own sourced data, entitlements, entity/period/units and evidence truth; P4 owns stored Artifacts, versions, engine edits and exports; P9 owns opt-in scheduled tasks; CA owns import provenance and package/adaptor decisions; Dockview is merely the existing layout renderer. All 20 approved product decisions in `docs/LIOS_UX_SYSTEM.md` remain binding.

## 4. Outside-catalog donor research — source compatibility gates

See the discovery annex for the 16 researched UI sources and license cautions. Three preferred donor experiments (new OSS **candidate**, not approved packaged payload):
- **Kibo Dropzone**: coherent MIT source in `shadcnblocks/kibo` `packages/dropzone/index.tsx`; actual upstream tree `3d63cdb15b79d972e3dc38a10997987672f9b263`. It uses `react-dropzone`; upstream package targets React19 for development, LiOS React18. **Adapt/port only after dependency, keyboard, native/Electron and exact source license tests**; preserve #100's 5-file, ≤20 MiB file, ≤6 MiB image, types, permissions and Temporary refusal.
- **Tremor**: Apache-2.0 copy/paste source patterns for comparison data views (Radix/Tailwind) only where they beat existing P4/ECharts; bind values to P4, source provenance and Unknown state, never bundled example market values.
- **assistant-ui**: MIT composable Chat UX; current React package supports React18 peer but introduces additional dependencies including Zod4; source-copy/adapter trial against existing P2 runtime before any runtime adoption. Not a second thread store or cloud backend.

**Later comparison:** CopilotKit/AG-UI agent review patterns, React Flow node editor, Excalidraw sketches, Motion Primitives for subtle transitions, Kokonut for accessible widgets. Avoid eager package additions. **Do not directly import json-render v0.21.1**: current React package needs React19, core Zod4, shadcn package Tailwind4; LiOS main React18/Zod3/Tailwind3. Borrow the declarative catalog *mechanism* in LIOS-native typed code initially.

**Rights/maintenance exclusions:** Tambo's hosted cloud ends 2026-10-31 (self-host source distinct; also a competing backend); legacy AI Elements is scheduled for deprecation after Nov 2026; coss UI contains mixed AGPL/MIT; React Bits/Animate UI Commons Clause is not plain MIT. Don't import wholesale without exact path/rights review. Excalidraw/React Flow or analytics component source should be selected only for a proven interaction gap and verify third-party media/assets.

**Donor selection scoring:** mandatory hard pass on license/asset rights, architecture/permission fit, Electron/offline and security. For eligible sources, score usefulness 25%, coherent package reuse 20%, integration fit 20%, accessibility/testability 15%, maintainability/footprint 10%, UX distinctiveness 10%. Record upstream commit/path, adopted/modified/excluded files, notices, peer dependencies, upstream tests and actual installed behavior; building equivalent code afresh needs recorded rejection evidence.

## 5. One ordered 65-workstream backlog — grouped by dependency

Each row states a concrete change *and* a required artifact-level outcome. A row is NOT automatically incomplete because its PR is unmerged: record separate implementation/test/merge/installed acceptance status before coding.


### Phase 1 — Audit, consolidation, integration (WS-01–05)

**Exit objective:** One verified inventory and a conflict-free, independently reviewed integration baseline.

| WS | Priority | Feature / change | Canonical location / existing owner | Exit evidence |
|---|---|---|---|---|
| **WS-01** | P0 | Code-first surface and consumer audit | `App.tsx, pages/*, terminal/*, routes, event consumers` | Enumerated route→screen→interaction→owner map with main/PR comparison |
| **WS-02** | P0 | Feature-gap and evidence matrix | `docs/ux/*, docs/PENDING_WORK.md, 65 IDs` | Verified main / draft / partial / missing / tested / accepted status for each |
| **WS-03** | P0 | PR collision and dependency reconciliation | `#98–#119; shell, Artifact, Chat, Sources, CSS` | Diff-overlap graph, chosen one canonical owner, safe merge order |
| **WS-04** | P0 | Review/merge existing UX stack | `#98–#119 under protected main` | CI exact head, independent review, staged merges, post-merge regression |
| **WS-05** | P0 | Rendered visual and journey baseline | `visual smoke harness, real Desktop target` | Screenshots+keyboard+viewport test record; source-only assumptions clearly labelled |

### Phase 2 — Design system and visual quality (WS-06–12)

**Exit objective:** A single canonical graphite/gold UI system with accessible default behavior.

| WS | Priority | Feature / change | Canonical location / existing owner | Exit evidence |
|---|---|---|---|---|
| **WS-06** | P1 | Graphite/gold visual tokens | `terminalStyles.ts, terminal-shell.css, index.css` | One imported canonical style authority; semantic finance colors unchanged |
| **WS-07** | P1 | Typography and hierarchy | `local fonts, Chat, Connections, Workbench chrome` | Readable normal and 200% zoom; no sub-11px interactive labels |
| **WS-08** | P1 | Responsive shell and density | `project-conversation-shell.css, Dockview, layout` | No inaccessible controls/clipped critical journeys at target widths |
| **WS-09** | P1 | Shared accessible components | `components/ui Radix, source-level shadcn/Kibo` | One dialogs/menu/inputs pattern; upstream tests and provenance |
| **WS-10** | P0 | Loading, empty, denied and recovery states | `ProjectExperienceShell, ArtifactPane, Connections` | Truthful and actionable error/loading/permission outcomes |
| **WS-11** | P1 | Motion, focus and interaction feedback | `CSS/motion, overlays` | Reduced-motion, restored focus, no misleading busy indication |
| **WS-12** | P2 | Optional contextual visual environments | `VisualCanvas, 10 local environment families` | Visuals recede in focus; saved choice honored, low-resource fallback |

### Phase 3 — Universal Chat and daily interactions (WS-13–25)

**Exit objective:** A first-time user can ask, attach, inspect, stop, resume and reopen without mandatory Projects.

| WS | Priority | Feature / change | Canonical location / existing owner | Exit evidence |
|---|---|---|---|---|
| **WS-13** | P0 | Auth and entry journey | `App.tsx, Login, PublicProductPreview, #99` | Sign-in/error/session restore; universal Chat start, no incorrect data claims |
| **WS-14** | P0 | First-use product guidance | `ProjectExperienceShell, EnvironmentSetup` | User reaches first useful answer/AI-setup recovery without wizard |
| **WS-15** | P0 | Signed-in universal Chat shell | `ProjectExperienceShell, AuthenticatedNavigation, #99/#102` | One Chat experience, no duplicate runtime or workbench |
| **WS-16** | P1 | Conversations and sidebar operations | `AuthenticatedNavigation, Chat stores` | New/recents/rename/archive/trash/switch preserve draft and ownership |
| **WS-17** | P1 | Universal search and commands | `WorkSearchDialog, QuickSwitcher, #101/#114` | Permission-scoped search and keyboard open/select/escape/focus |
| **WS-18** | P0 | Composer behavior and draft safety | `ProjectExperienceShell, WorkspaceComposer` | # user-entered text lost on failure or incidental navigation; reliable Stop/Send |
| **WS-19** | P0 | Real-file import and upload UX | `ProjectExperienceShell, P12 #100; Kibo trial` | Up to five permitted real files; retry; privacy and temp refusal unchanged |
| **WS-20** | P1 | Context references and advanced controls | `composer @mention, /commands, source registry` | Selected objects and commands resolve authorized context without silent Project |
| **WS-21** | P1 | Model, source and voice controls | `ChatSourcesControl, voice providers, #102` | Availability, cost/privacy/consent and connect/retry truthful |
| **WS-22** | P0 | Streaming, cancel, retry and receipt | `ConversationRuntimeTrace, P2 runtime` | Observed-only status, exact cancel and no replayed side effects |
| **WS-23** | P1 | Readable responses and code | `ChatMarkdown, Chat Markdown parsers, #113` | Safe links, readable tables, escaped code, accessible copy |
| **WS-24** | P1 | Message Copy/Quote/follow-up actions | `#115 and ProjectExperienceShell` | Actions prefill/operate exactly once, don't auto-send |
| **WS-25** | P0 | Quick/Project/Temporary persistence | `#100/#102; chat/project stores` | Quick saved correctly; Temporary remains ephemeral |

### Phase 4 — Research, evidence and intelligence display (WS-26–33)

**Exit objective:** A user can understand observed progress, verified source coverage, gaps and continuation.

| WS | Priority | Feature / change | Canonical location / existing owner | Exit evidence |
|---|---|---|---|---|
| **WS-26** | P0 | Natural research entry | `P2/P7 research service, Chat` | Bounded plan initiated from plain request; no fabricated capability |
| **WS-27** | P1 | Observed progress and partial findings | `#117, ConversationRuntimeTrace` | Statuses/results from current live run, no fake percentage |
| **WS-28** | P0 | Canonical Source selector | `ChatSourcesControl, SourceRegistry/P5` | Actual searchable catalog with Auto/rights; no second registry |
| **WS-29** | P1 | Inspectable citations and sources | `#116, ResearchSourceList, chatMarkdown` | Recorded sources open only when safe; no unearned verified claim |
| **WS-30** | P0 | Evidence Prism / source truth | `ConversationTrustPanel, P3 ledger, P4 provenance` | Click claim → source/date/unit/class/assumptions/entitlement |
| **WS-31** | P0 | Contradiction, unknown, revoked source UX | `P3/P5 data gaps, trust contracts` | Unknown remains unknown; conflicts visible; recoverable |
| **WS-32** | P1 | Checkpoint and deep research continuation | `P2 resumable states, #117` | Partial work truthful; authorized resume only where runtime really supports |
| **WS-33** | P1 | Research history, notes and pinning | `ResearchTray, #110` | Local-save failure clear, accessible edit, controlled deletion |

### Phase 5 — Canonical Artifacts and editing (WS-34–42)

**Exit objective:** One ID/version/ownership/evidence path from a preview to useful editable professional output.

| WS | Priority | Feature / change | Canonical location / existing owner | Exit evidence |
|---|---|---|---|---|
| **WS-34** | P0 | Task-shaped Artifact previews | `SavedArtifactCards, P4 Artifact types` | Real authorized Artifact references, no decorative fake outputs |
| **WS-35** | P0 | Chat-owned canonical Artifact persistence | `P4 store, #98/#102` | Regular Chat save exact ID/version; Temporary no save |
| **WS-36** | P0 | Resizable sidecar/focus/expand | `ConversationArtifactSidecar, ArtifactPane` | Exact owner+ID+version; narrow focus; keyboard back |
| **WS-37** | P1 | Rich document/report editing | `RichArtifactDocumentEditor, Tiptap` | Typed user edits, governed save, valid citations/versions |
| **WS-38** | P1 | Spreadsheet/data table editing | `UniverSpreadsheetEditor, cell source inspect` | Formula/paste/bounds/error/dirty draft correctness |
| **WS-39** | P0 | Source-backed charts and comparisons | `ArtifactChart/ECharts, valuation, Tremor trial` | Real data/period/unit labels; unknown handling; keyboard table fallback |
| **WS-40** | P0 | Artifact version/compare/restore | `ArtifactPane, p4ArtifactWorkspace` | Historical exact revision and safe conflicts; no stale response swap |
| **WS-41** | P1 | Exports and Office round-trip | `Artifact export, OfficeArtifactReturn` | Real file opens and externally modified content reconciles |
| **WS-42** | P0 | Recovery, failure and source continuity | `P4 drafts, native draft grants, #102` | Crash/draft/version/data ACL negative journeys exercised |

### Phase 6 — Full Workbench and specialist outcomes (WS-43–49)

**Exit objective:** Round-trip Chat↔P4 Artifact↔existing Dockview with original context and engine truth.

| WS | Priority | Feature / change | Canonical location / existing owner | Exit evidence |
|---|---|---|---|---|
| **WS-43** | P0 | Exact Chat↔Workbench handoff | `Terminal, DockviewWorkspaceGrid, #98/#102` | Owner/entity/source/assumptions/version/layout preserved both directions |
| **WS-44** | P1 | Dockview layouts and workspace controls | `DockviewWorkspaceGrid, settings` | Restore/select/reflow/resizing across useful panes |
| **WS-45** | P1 | Contextual specialist discovery | `terminalCatalog, Terminal, CommandBar` | Full authorized tools available on demand, not first-use clutter |
| **WS-46** | P1 | Entity, company and market research UX | `entity/search, analyst panels, P5` | No fabricated ticker; entitled data or explicit absent result |
| **WS-47** | P0 | Valuation and model assumption workflow | `ValuationArtifactView, P11 deterministic engines` | WACC or input change → governed revision/recalculation/trace |
| **WS-48** | P1 | Portfolio/risk/quant UX | `specialist panels, provenance and quant engines` | Units, signed data, alternative views and failure correctness |
| **WS-49** | P1 | Decision review and professional reports | `DecisionArtifactEditor, professional work` | Decision/evidence/risk/proposed action truthfully separated |

### Phase 7 — Agents, connections and continuity (WS-50–57)

**Exit objective:** Approved capabilities and workflows are understandable, connected and revocable.

| WS | Priority | Feature / change | Canonical location / existing owner | Exit evidence |
|---|---|---|---|---|
| **WS-50** | P1 | Agent activity and receipts UX | `P2 runtime, agent composer, AG-UI ideas` | Compact observed progress and trace; no hidden unreviewed action |
| **WS-51** | P0 | Risk-scaled approval and action review | `ConversationRuntimeTrace, governed approvals` | Exact reviewed input/target/scope and denial/reconciliation |
| **WS-52** | P0 | Connections discovery and setup | `DataConnectionCenter, #105` | Dialog semantics, one provider at time, return to original task |
| **WS-53** | P1 | Skills and plugin capabilities UX | `P13 GM/CA tools, existing extensions panel` | Installed vs available vs missing with rights/health; no shadow plugin auth |
| **WS-54** | P1 | Projects, knowledge and memory UX | `ProjectHome/continuity, search, memory` | Permitted retrieval and edit/restore without unrelated Project mutation |
| **WS-55** | P1 | Scheduled/conditional workflow management | `ProjectAutomationPanel, MacroManager #111` | Opt-in, scheduled execution truth, pause/resume/edit |
| **WS-56** | P1 | Monitoring/notifications UX | `P9, alert interfaces, notifications` | Relevant material event, delivery, privacy and clear notification states |
| **WS-57** | P2 | Home/devices/offline continuation UX | `GM/P9 device/trust and Client shell` | Device capability/revocation/outbox/reconnect not invented |

### Phase 8 — Installed-product quality and acceptance (WS-58–65)

**Exit objective:** Keyboard, AT, layouts, failures, privacy, performance, shipped-target journeys independently exercised.

| WS | Priority | Feature / change | Canonical location / existing owner | Exit evidence |
|---|---|---|---|---|
| **WS-58** | P0 | Keyboard+screen-reader UX | `Radix, UX tests, Mac VoiceOver/Win Narrator` | Focusable full critical flow, real assistive-technology proof |
| **WS-59** | P0 | Small-window/high-zoom behavior | `CSS, Dockview, sidebar, Artifact sidecar` | 320/375/390/768/1280/1440 widths and 200% zoom tested |
| **WS-60** | P1 | Words and progressive disclosure | `UX system, all core views, #118` | Quiet default, material consent/cost/source/errors visible when needed |
| **WS-61** | P0 | Offline, disconnected and permission recovery | `P2/P4/P7 responses, saved drafts` | No lost input or fake success through representative faults |
| **WS-62** | P1 | Responsiveness and rendering performance | `stream, search, charts, large tables` | Defined device benchmark, memory/scroll, cold+warm traces |
| **WS-63** | P0 | Privacy, data rights, sharing and trusts UX | `P1/P3/P4, #109` | Explicit consent, no cross-tenant, revoked source or unsafe share |
| **WS-64** | P0 | Seven end-to-end product scenarios | `SP-01..07, UX scenario harness` | One full flagship plus non-finance/connected/file/denied/restart |
| **WS-65** | P0 | Installed UX and release evidence | `macOS/Windows Electron, P14 acceptance` | Native clean install, keyboard, VoiceOver/Narrator and owner sign-off |

## 6. First product slice (never a decorative prototype)

**Flagship task:** "Compare Apple, Microsoft and Alphabet, show which assumptions explain differences, and create a source-backed valuation scenario."

1. **Initial Chat:** user asks. If provider/data unavailable, retain the prompt and show plain, useful unavailable/recovery action. Nothing claimed as researched.
2. **Lens selection:** approved intent `compare` yields read-only Comparison Lens; model may propose layout later, but data and authorized source identity come from existing P3/P5/P4.
3. **Evidence Prism:** select a value to reveal recorded source reference, as-of period, currency/unit, data class (observed/deterministic/assumption/inference/unknown), entitlement and conflicts.
4. **Canonical work:** preserve the exact P4 Artifact ID/version, show one or few cards, open P4 sidecar and expand the **original** Dockview layout.
5. **Governed edit:** set WACC = 9% in existing P4/P11 review and deterministic compute; show change summary, version and source/model limitations; if data unavailable, offer user-supplied assumptions explicitly instead of fictitious computation.
6. **Continuity:** return to original Chat with entity/sources/assumptions/artifact/version preserved; restart client and reopen same revision. Temporary Chat must not persist it.
7. **Next action:** "Monitor" suggests opt-in authorized P9 task only after useful work; does not create task automatically.

**Pilot A (only if blocking user value):** file-to-insight uses Kibo-inspired compact drop experience in existing #100 P12 attachment flow, not a separate uploader or screen. Avoid changing the base shell until #100 is reviewed and integrated.

## 7. Dependency-first delivery waves (do not code before plan review)

| Wave | Mandatory order, no speculative deadlines | Gate to enter next wave |
|---|---|---|
| **0. Lock plan + rebase audit** | Review this plan and PR #119; confirm #91 ownership; classify existing #98–#118 work. | One reviewed plan and one real-code gap/backlog, no duplicate feature PR |
| **1. Integrate foundation** | Diagnose #115 route-manifest ancestry and #111 macOS failure. Review/merge small ready green PRs (#99/#101/#106/#110/#118) and relevant independent UX fixes; sync branch heads. | Verified protected main + no unreviewed blockers |
| **2. Chat/P4 continuity** | Reconcile #98→#102→#115 and #112→#100. Test Quick/Project/Temporary, Artifact exact version and signed-in Chat; no new donor. | Real saved Chat→Artifact→Workbench→Chat→restart pass on target |
| **3. Evidence-led read-only Lens** | Integrate #116→#117. Add one discriminated UI schema and P4-backed comparison/evidence renderer using existing components, then source-level selected Tremor composition only if useful. | Real source-backed values or clearly Unknown; keyboard, source rights, baseline screenshots |
| **4. Controlled write Lens and import UX** | Add typed, governed WACC/scenario review via existing engines/P4; pilot Kibo upload if gain proven; compare assistant-ui Chat seam in isolated spike. | Exact revision, no duplicate stores, permissions/rollback tests, installed UX |
| **5. Scale component catalog** | Expand to research, report, risk, portfolio, coding and task-review only when each has real canonical data/actions; systematically close 65 rows with source + target evidence. | One consistent default UI; domain-neutral flagship plus Finance depth |
| **6. Release-quality UX** | Real Mac/Windows fresh users, narrow windows/200% zoom, VoiceOver/Narrator, failed provider/privacy/restart; performance and P14. | Recorded installed target evidence, applicable SP/P14 accepted separately |

**No time-based commitments** until environment/model/provider/target dependencies are available and engineering samples have produced measured throughput. Parallel agents may inspect non-overlapping donors, native test harnesses or screen baselines, but must not concurrently mutate `ProjectExperienceShell`, `ArtifactPane`, `terminal-shell.css` or core shared contracts. Branches stack on the named canonical owner; each PR has one outcome, exact file scope, linked blocker/owner and rollback plan.

## 8. Acceptance matrices — test actual behavior, not just source strings

| User journey | Key cases | Required proof |
|---|---|---|
| Public entry and login | 320/390/768/1440px; sign in, form errors, back to Chat | Rendered images + keyboard/label focus, no fake live market data |
| Basic Chat no model | Intro, preserved draft, optional Connect AI, non-finance | No false answer/provider status; source + real UI |
| Chat modes & attachments | Quick 5 valid files, invalid type/size, upload retry, Temporary nonpersistence | Exact owner+chat storage, no forced Project, server refusal |
| Research | Real authorized source; progress/Stop/error, source list, citations, contradiction | Real tool events, entitlement, deterministic/AI truth |
| Lens/compare | Read-only three company comparison; no data; revoked source; as-of/unit conflict | No guessed values, safe render, useful accessible table alternative |
| Saved Artifact | Card→sidecar→focus→Workbench→edit→return→restart | Stable ID/version/hash/entity/source/posture and recalculation receipt |
| Consequential agent | Approval/deny/expire/replay, stale grant, cross-tenant | No action before canonical governed approval and reconciliation |
| Provider/Connections | Connect/search/test/revoke/offline; keyboard modal focus | Same catalog/rights, secrets handled through existing vault |
| Accessibility | Mouse-free all seven flows; zoom and reduced motion | Actual VoiceOver/Narrator on claimed targets, not static regex |
| Visual/performance | Long Chat, source list, large table, Dockview resize, streaming | Measured startup/interaction/scroll/memory on declared target |
| Full product | Finance research → report/model and one non-finance, one no-ticker data gap | Real configured model/provider and lawful source; exact recorded run |
| Native release | Fresh account/macOS & Windows install, update, restore/backup | P14 signoff separately from UI, source CI and PR merge |

**Test strategy upgrades:** keep the existing `visual_smoke_capture.cjs` harness, add stable screenshot/diff checks for actual full user-flow states (not fixture-only smoke), add React rendering+keyboard tests to critical components beyond source-regex checks, preserve existing `npm run test:ux`, `npm run acceptance:ux`, `npm run acceptance:accessibility`, and use installed Electron target tests. Do not claim that running those commands happened during this planning-only audit. Fix stale "finance-only four-line hero" expectation through reviewed requirement reconciliation when changing public entry.

## 9. Definition of done and truthful status reporting

Track per item:
1. **Code-audited**: source, actual consumer, branch and owner identified.
2. **Donor decision**: exact source/reuse/rights or evidence-backed no-import.
3. **Implemented**: changed code in bounded PR, protects canonical state.
4. **Source qualified**: automated tests, React interactions, Linux/Windows/macOS required checks, review.
5. **Merged**: current protected `main` contains intended feature; no stale overlapping PR.
6. **Rendered**: screenshots, keyboard, focus, narrow view, error/recovery tested.
7. **Installed accepted**: real target/user/provider/data flow, restart and SP/P14 where applicable.

"No evidence" is **unverified**, not "unimplemented" or "completed". Count workstream closure only at its documented required level; keep user-journey evidence distinct from source CI. Donor fork or package listed ≠ component imported ≠ connected to real data ≠ user-accessible ≠ shipped.

## 10. Decisions fixed by current owner direction

- **Yes:** explore outside original donors; import substantial useful legal OSS components; combine ideas to innovate; use the strongest mature visual interactions; turn static outputs into real interactive work surfaces.
- **No:** copy entire second product shell; add a different provider/chat/Artifact store; replace Dockview or professional engines; require Projects for regular Chat; move hosted data to a new service without consent; expose raw AI reasoning as evidence; use fake terminal stats to demonstrate source-connected finance.
- **Success test:** a first-time user completes an ordinary non-finance Chat, and an advanced user completes an actual research→source→versioned Artifact→governed edit→original Workbench→return/restart with fewer unnecessary steps and demonstrably higher UI quality.

**Next user-approved engineering task after reviewing this plan:** complete Wave 1 PR integration; then one thin *read-only Evidence-led Comparison Lens* tied to existing authoritative P4/P5 data. Do not begin several independent component experiments before that first journey works.
