# LIOS UI/UX WS-01/02 — Code-backed inventory and gap matrix

**As of:** 2026-10-23. **Main SHA:** `9f7fee80b5189adb533825197fc54c2c4adfbbfc` (unmerged code is not main).  
**Audit scope:** untruncated `main` tree listing (3,049 entries), all 65 canonical UX execution breakdown IDs, primary route/shell/Artifact/Connections/Research controls, October 22 source audit reconciliation, open PR dependency/CI inspection.  
**Meaning:** **Main state is a source-audit classification, not a user-facing feature completion level.** `source-present-unqualified` only means an owning file exists, not that the workstream passes functional, responsive, permission, packaged or release acceptance. `gap-confirmed` is a source-observed UX gap, not a confirmed native screenshot defect. `pr-only` means candidate improvements remain outside `main`. `needs-runtime-evidence` means tests/screenshots haven't been run in this audit.  
**Authority:** [Original source audit](LIOS_UI_UX_CODE_AUDIT_2026-10-22.md) (historical at `1fa37cc`), [single master execution plan](LIOS_ADAPTIVE_EXPERIENCE_EXECUTION_PLAN_2026-10-23.md), [source shortlist](../technical/LIOS_UI_UX_REUSE_FINAL_SHORTLIST_2026-10-23.md), canonical `docs/PENDING_WORK.md`, issue #91. **This is an evidence annex to WS-01/02, NOT an additional roadmap, project board or completion record.**

## 1. Inventory and code ownership

| User journey / surface | Concrete main source | Source-level observation | Next gate |
|---|---|---|---|
| Public preview and onboarding | `src/client/src/pages/PublicProductPreview.tsx`, `src/client/src/pages/Login.tsx` | Public finance-led preview coexists with general identity; login labels now associated; draft #99 alters first-use | Actual marketing-to-Chat responsive and keyboard journeys |
| Authenticated route and Chat | `src/client/src/App.tsx`, `src/client/src/lib/projectEntry.ts`, `src/client/src/components/terminal/ProjectExperienceShell.tsx` | Quiet Chat entry and regular/Temporary/Project modes exist; project-first labeling remains in rail | Actual signed-in no-Project, draft retention, Stop and file paths |
| Chat navigation and search | `src/client/src/components/terminal/AuthenticatedNavigation.tsx`, `src/client/src/components/terminal/WorkSearchDialog.tsx` | New Chat, navigation, permission-scoped search UI exist; #101/#114 pending | Result keyboard, permissions, stale-selection, return-focus tests |
| Source controls and permissions | `src/client/src/components/terminal/ChatSourcesControl.tsx`, `src/shared/sourceRegistry.ts` | Single P1 registry fetched; main control lacks searchable full catalogue; #122 adds filter stacked on #100 | Search filtering, entitlement and Temporary boundaries |
| Research and trust | `src/client/src/components/terminal/ConversationRuntimeTrace.tsx`, `src/client/src/components/terminal/ConversationTrustPanel.tsx`, `src/client/src/components/terminal/ResearchTray.tsx` | Real presentation components; #110, #116→#117 pending | Observed tool events, source opening, gaps and reviewable evidence |
| Versioned P4 Artifacts | `src/client/src/components/terminal/SavedArtifactCards.tsx`, `src/client/src/components/terminal/ArtifactPane.tsx`, `src/client/src/components/terminal/ConversationArtifactSidecar.tsx` | Real selected Artifact and version-aware sidecar; large #98→#102 stack pending | ID/version, guarded changes, crash-save, ownership and restart |
| Specialist Workbench | `src/client/src/pages/Terminal.tsx`, `src/client/src/components/terminal/DockviewWorkspaceGrid.tsx` | Original professional layout and deterministic engine interfaces exist | Bidirectional Chat↔Workbench exact-state journey |
| Connected providers | `src/client/src/pages/DataConnectionCenter.tsx` | Large mixed setup surface; custom ModalShell and microtype still on main; #105 pending | Rendered dialog/keyboard/first-use AI connection test |
| Assistive/visual test harnesses | `src/script/visual_smoke_capture.cjs`, `src/script/validate_ux_flagship_acceptance.ts`, `src/script/validate_desktop_accessibility.ts` | Fixture smoke cases and mostly static source-based checks exist | Real rendered UI screenshot and installed macOS/Windows AT proof |

**Counts from indexed tree:** 3,049 total entries (untruncated); 343 React `.tsx` component files, 48 `components/ui` files, 123 `components/terminal` files, and 25 CSS files in the client/source scope counted during plan audit. Large, high-coupling owners include `ProjectExperienceShell.tsx` (2,474 lines), `Terminal.tsx` (1,110), `ArtifactPane.tsx` (798), `DataConnectionCenter.tsx` (1,831). Code size is a change-risk indicator, **not** a defect by itself.

## 2. Reconciliation of all 18 prior audit findings

| Finding | Disposition on current main | Draft/ready PR evidence | What is actually established | Source path |
|---|---|---|---|---|
| UX-A01 | gap-confirmed | #99 | Universal identity is finance-led in current public/signed-in source; existing PR proposes first-entry improvements. | `src/client/src/pages/PublicProductPreview.tsx` |
| UX-A02 | pr-only | #100 | Main upload path is project-scoped; Quick Chat attachment implementation is unmerged. | `src/client/src/components/terminal/ProjectExperienceShell.tsx` |
| UX-A03 | pr-only | #100 | Main source scope gating uses projectAvailable; PR #100 adjusts regular Quick Chat. | `src/client/src/components/terminal/ChatSourcesControl.tsx` |
| UX-A04 | source-fixed-unqualified | — | Login now uses htmlFor/ID label associations; rendered focus/validation still unverified. | `src/client/src/pages/Login.tsx` |
| UX-A05 | pr-only | #105 | Connection ModalShell is a custom div without validated dialog focus/keyboard behavior on main. | `src/client/src/pages/DataConnectionCenter.tsx` |
| UX-A06 | gap-confirmed | #105/#108 | Connections and other screens still contain many 8–10px Tailwind classes; computed typography unverified. | `src/client/src/pages/DataConnectionCenter.tsx` |
| UX-A07 | gap-confirmed | #105 | One dense Connections Center still owns many separate setup flows; skip-first-use exists. | `src/client/src/pages/DataConnectionCenter.tsx` |
| UX-A08 | pr-only | #99 | Main conversation header still explicitly reads PROJECTS; brand correction exists in PR. | `src/client/src/components/terminal/AuthenticatedNavigation.tsx` |
| UX-A09 | needs-source-followup | #98/#102 | Prior audit reported duplicate Open workspace paths; verify after canonical shell PR consolidation. | `src/client/src/components/terminal/ProjectExperienceShell.tsx` |
| UX-A10 | needs-rendered-audit | — | 11 style imports; terminal-shell.css includes 197 !important occurrences. Legacy theme-lock file is not imported by primary entry. | `src/client/src/terminalStyles.ts` |
| UX-A11 | needs-rendered-audit | #99 | Marketing narrow navigation uses small typography; login route availability must be verified in real rendering. | `src/client/src/reference-entry.css` |
| UX-A12 | pr-only | #98/#102 | Sidecar and Workbench exist, but same-ID/version round-trip + restart are not qualified. | `src/client/src/components/terminal/ConversationArtifactSidecar.tsx` |
| UX-A13 | pr-only | #101 | QuickSwitcher/ShortcutOverlay improvements drafted; real Tab/Escape/focus tests outstanding. | `src/client/src/components/terminal/QuickSwitcher.tsx` |
| UX-A14 | needs-user-journey | #105/#122 | Connections/Plugins/Sources paths exist, but discovery and authority need end-to-end usability validation. | `src/client/src/components/terminal/ChatSourcesControl.tsx` |
| UX-A15 | source-fixed-unqualified | — | 404 page now has LIOS dark treatment and Back to LiOS Chat link; native click unverified. | `src/client/src/pages/not-found.tsx` |
| UX-A16 | intentional-optional | — | Domain chooser is optional specialist navigation, not mandatory onboarding; evaluate vocabulary in real journeys. | `src/client/src/pages/DomainPicker.tsx` |
| UX-A17 | needs-rendered-audit | #98 | Below 1200px Chat may hide when Project context is open; assess focus/back/viewport behavior. | `src/client/src/components/terminal/project-conversation-shell.css` |
| UX-A18 | pr-only | #99 | Existing illustrative ticker/financial preview remains; universal framing and demo-label UX pending qualification. | `src/client/src/pages/PublicProductPreview.tsx` |

**Corrections to old issue claims:** UX-A04 (login label semantics) and UX-A15 (dark 404 with Back to Chat) are **already source-fixed on main**. They are **not** new implementation requests. UX-A16 is an optional specialist switch by design, not mandatory first-use friction. UX-A10 source CSS count alone does not prove an applied visual conflict. No absent rendered/installed evidence may be promoted to passed.

## 3. Live open PR overlap — audit snapshot (2026-10-23)

| PR or stack | Exact parent relationship / scope | Exact-head Source checks at audit | Integration/evidence interpretation |
|---|---|---|---|
| #98 → #102 → #115 | Workbench/Chat Artifact bridge → universal Chat → Copy/Quote actions | #98, #102 Linux/macOS/Windows green; #115 all three failing | Large shared shell and P4 ownership. Investigate #115 inherited route-manifest/base state, retest after reconciling. No accepted complete journey yet. |
| #112 → #100 → #122 | CI isolation → Quick Chat attachments → MIT Opensource UI source search | #100 three green; #122 was running after recent change | #122 **base is #100**, a separate display-only P1 catalogue adaptation; no duplicate uploader or source authority. |
| #116 → #117 | Research source inspection → observed progress/findings | Both three green | Parent first, then child; no inferred real provider/source qualification. |
| #99, #101, #106, #110, #118 | Independent Chat-entry, keyboard, specialist/research/guidance PRs | Each reviewed status ready for review; source green at latest checked heads | Source-green ≠ independently approved/merged/installed. |
| #105, #107–#109, #113–#114 | Connections, Workbench polish, sharing, code and search | Source checks green at latest checked heads | Preserve component ownership; do not redo work merely because unmerged. |
| #111 | Macro Manager and scheduling | Linux/Windows green; macOS failing on planning speed-budget assertion | Needs platform CI diagnosis, not arbitrary weakening of speed limit. |
| #119 | Master UX plan + OSS shortlist + this WS-01/02 annex | Checks must be verified on this **new** PR head | This audit is documentation/test guard only. No UI shipped or source PR merged. |
| #95, #120–#123 | Donors and active GM/provider work | Separate owner branches; varying source status | Coordinate agent/provider rights and truthful progress; not an independent UX UI replacement. |

**One-owner constraints:** `ProjectExperienceShell`, `ArtifactPane`, `ChatSourcesControl`, `Terminal`, canonical P1 registry and P4 store cannot have simultaneously competing implementations. Build remaining UX in owning branch or independently scoped non-overlapping PR. Never infer existence from a fork/PR title or count PR-only work as `main` behavior.

## 4. All 65 workstream gap entries — main vs PR vs acceptance

`audit-complete` = source inventory/gap classification authored, **not UI accepted**. `source-present-unqualified` = exact file exists, user journey not proven. `gap-confirmed` = concrete source discrepancy, inspect candidate PR before coding. `pr-review-pending` = integration blocked on independent review/test. `needs-runtime-evidence` = native/rendered testing absent. The last column is the **existing master plan's exit test**, not a newly invented task.

### Phase 1 — Audit and integration

| Workstream | Priority | Main state | Exact main evidence | Open PR overlap | Missing acceptance / next check |
|---|---|---|---|---|---|
| WS-01 | P0 | audit-complete | `src/client/src/App.tsx` | — | Enumerated route→screen→interaction→owner map with main/PR comparison |
| WS-02 | P0 | audit-complete | `docs/ux/LIOS_UI_UX_CODE_AUDIT_2026-10-22.md` | — | Verified main / draft / partial / missing / tested / accepted status for each |
| WS-03 | P0 | audit-complete | `src/client/src/components/terminal/ProjectExperienceShell.tsx` | #98/#100/#102/#115 | Diff-overlap graph, chosen one canonical owner, safe merge order |
| WS-04 | P0 | pr-review-pending | `src/script/run_project_tests.mjs` | #98–#119/#122 | CI exact head, independent review, staged merges, post-merge regression |
| WS-05 | P0 | needs-runtime-evidence | `src/script/visual_smoke_capture.cjs` | — | Screenshots+keyboard+viewport test record; source-only assumptions clearly labelled |

### Phase 2 — Design system and visual quality

| Workstream | Priority | Main state | Exact main evidence | Open PR overlap | Missing acceptance / next check |
|---|---|---|---|---|---|
| WS-06 | P1 | source-present-unqualified | `src/client/src/terminalStyles.ts` | — | One imported canonical style authority; semantic finance colors unchanged |
| WS-07 | P1 | source-present-unqualified | `src/client/src/index.css` | — | Readable normal and 200% zoom; no sub-11px interactive labels |
| WS-08 | P1 | gap-confirmed | `src/client/src/components/terminal/project-conversation-shell.css` | #107 | No inaccessible controls/clipped critical journeys at target widths |
| WS-09 | P1 | source-present-unqualified | `src/client/src/components/ui/dialog.tsx` | #105 | One dialogs/menu/inputs pattern; upstream tests and provenance |
| WS-10 | P0 | gap-confirmed | `src/client/src/components/terminal/ConversationRuntimeTrace.tsx` | #105 | Truthful and actionable error/loading/permission outcomes |
| WS-11 | P1 | source-present-unqualified | `src/client/src/terminal-shell.css` | #108 | Reduced-motion, restored focus, no misleading busy indication |
| WS-12 | P2 | source-present-unqualified | `src/client/src/components/terminal/VisualCanvas.tsx` | — | Visuals recede in focus; saved choice honored, low-resource fallback |

### Phase 3 — Universal Chat

| Workstream | Priority | Main state | Exact main evidence | Open PR overlap | Missing acceptance / next check |
|---|---|---|---|---|---|
| WS-13 | P0 | source-present-unqualified | `src/client/src/pages/Login.tsx` | #99 | Sign-in/error/session restore; universal Chat start, no incorrect data claims |
| WS-14 | P0 | source-present-unqualified | `src/client/src/lib/firstUseJourney.ts` | #99 | User reaches first useful answer/AI-setup recovery without wizard |
| WS-15 | P0 | gap-confirmed | `src/client/src/components/terminal/ProjectExperienceShell.tsx` | #99/#102 | One Chat experience, no duplicate runtime or workbench |
| WS-16 | P1 | source-present-unqualified | `src/client/src/components/terminal/AuthenticatedNavigation.tsx` | #99 | New/recents/rename/archive/trash/switch preserve draft and ownership |
| WS-17 | P1 | source-present-unqualified | `src/client/src/components/terminal/WorkSearchDialog.tsx` | #101/#114 | Permission-scoped search and keyboard open/select/escape/focus |
| WS-18 | P0 | source-present-unqualified | `src/client/src/components/terminal/ProjectExperienceShell.tsx` | #107 | No user-entered text lost on failure or incidental navigation; reliable Stop/Send |
| WS-19 | P0 | gap-confirmed | `src/client/src/components/terminal/ProjectExperienceShell.tsx` | #100 | Up to five permitted real files; retry; privacy and temp refusal unchanged |
| WS-20 | P1 | source-present-unqualified | `src/client/src/components/terminal/ProjectExperienceShell.tsx` | #106 | Selected objects and commands resolve authorized context without silent Project |
| WS-21 | P1 | gap-confirmed | `src/client/src/components/terminal/ChatSourcesControl.tsx` | #102/#122 | Availability, cost/privacy/consent and connect/retry truthful |
| WS-22 | P0 | source-present-unqualified | `src/client/src/components/terminal/ConversationRuntimeTrace.tsx` | #117 | Observed-only status, exact cancel and no replayed side effects |
| WS-23 | P1 | source-present-unqualified | `src/client/src/components/terminal/ChatMarkdown.tsx` | #113 | Safe links, readable tables, escaped code, accessible copy |
| WS-24 | P1 | source-present-unqualified | `src/client/src/components/terminal/ProjectExperienceShell.tsx` | #115 | Actions prefill/operate exactly once, don't auto-send |
| WS-25 | P0 | source-present-unqualified | `src/client/src/lib/projectEntry.ts` | #100/#102 | Quick saved correctly; Temporary remains ephemeral |

### Phase 4 — Research and evidence

| Workstream | Priority | Main state | Exact main evidence | Open PR overlap | Missing acceptance / next check |
|---|---|---|---|---|---|
| WS-26 | P0 | source-present-unqualified | `src/client/src/components/terminal/ProjectExperienceShell.tsx` | #117 | Bounded plan initiated from plain request; no fabricated capability |
| WS-27 | P1 | source-present-unqualified | `src/client/src/components/terminal/ConversationRuntimeTrace.tsx` | #117 | Statuses/results from current live run, no fake percentage |
| WS-28 | P0 | gap-confirmed | `src/client/src/components/terminal/ChatSourcesControl.tsx` | #122 (on #100) | Actual searchable catalog with Auto/rights; no second registry |
| WS-29 | P1 | source-present-unqualified | `src/client/src/components/terminal/ConversationTrustPanel.tsx` | #116 | Recorded sources open only when safe; no unearned verified claim |
| WS-30 | P0 | source-present-unqualified | `src/client/src/components/terminal/ConversationTrustPanel.tsx` | #116 | Click claim → source/date/unit/class/assumptions/entitlement |
| WS-31 | P0 | source-present-unqualified | `src/client/src/components/terminal/ConversationTrustPanel.tsx` | #116 | Unknown remains unknown; conflicts visible; recoverable |
| WS-32 | P1 | source-present-unqualified | `src/client/src/components/terminal/ConversationRuntimeTrace.tsx` | #117 (on #116) | Partial work truthful; authorized resume only where runtime really supports |
| WS-33 | P1 | source-present-unqualified | `src/client/src/components/terminal/ResearchTray.tsx` | #110 | Local-save failure clear, accessible edit, controlled deletion |

### Phase 5 — Artifacts and editing

| Workstream | Priority | Main state | Exact main evidence | Open PR overlap | Missing acceptance / next check |
|---|---|---|---|---|---|
| WS-34 | P0 | source-present-unqualified | `src/client/src/components/terminal/SavedArtifactCards.tsx` | #98 | Real authorized Artifact references, no decorative fake outputs |
| WS-35 | P0 | source-present-unqualified | `src/client/src/components/terminal/ArtifactPane.tsx` | #98/#102 | Regular Chat save exact ID/version; Temporary no save |
| WS-36 | P0 | source-present-unqualified | `src/client/src/components/terminal/ConversationArtifactSidecar.tsx` | #98/#102 | Exact owner+ID+version; narrow focus; keyboard back |
| WS-37 | P1 | source-present-unqualified | `src/client/src/components/terminal/RichArtifactDocumentEditor.tsx` | #98 | Typed user edits, governed save, valid citations/versions |
| WS-38 | P1 | source-present-unqualified | `src/client/src/components/terminal/UniverSpreadsheetEditor.tsx` | #98 | Formula/paste/bounds/error/dirty draft correctness |
| WS-39 | P0 | source-present-unqualified | `src/client/src/components/terminal/ArtifactChart.tsx` | #98 | Real data/period/unit labels; unknown handling; keyboard table fallback |
| WS-40 | P0 | source-present-unqualified | `src/client/src/components/terminal/ArtifactPane.tsx` | #98 | Historical exact revision and safe conflicts; no stale response swap |
| WS-41 | P1 | source-present-unqualified | `src/client/src/lib/artifactExport.ts` | #98 | Real file opens and externally modified content reconciles |
| WS-42 | P0 | source-present-unqualified | `src/client/src/components/terminal/ArtifactPane.tsx` | #102 | Crash/draft/version/data ACL negative journeys exercised |

### Phase 6 — Workbench and specialist journeys

| Workstream | Priority | Main state | Exact main evidence | Open PR overlap | Missing acceptance / next check |
|---|---|---|---|---|---|
| WS-43 | P0 | source-present-unqualified | `src/client/src/pages/Terminal.tsx` | #98/#102 | Owner/entity/source/assumptions/version/layout preserved both directions |
| WS-44 | P1 | source-present-unqualified | `src/client/src/components/terminal/DockviewWorkspaceGrid.tsx` | #107 | Restore/select/reflow/resizing across useful panes |
| WS-45 | P1 | source-present-unqualified | `src/client/src/components/terminal/Sidebar.tsx` | #106 | Full authorized tools available on demand, not first-use clutter |
| WS-46 | P1 | source-present-unqualified | `src/client/src/components/panels/EntityWorkspacePanel.tsx` | #98 | No fabricated ticker; entitled data or explicit absent result |
| WS-47 | P0 | source-present-unqualified | `src/client/src/components/terminal/ValuationArtifactView.tsx` | #98 | WACC or input change → governed revision/recalculation/trace |
| WS-48 | P1 | source-present-unqualified | `src/client/src/components/panels/PortfolioPanel.tsx` | #98 | Units, signed data, alternative views and failure correctness |
| WS-49 | P1 | source-present-unqualified | `src/client/src/components/terminal/DecisionArtifactEditor.tsx` | #98 | Decision/evidence/risk/proposed action truthfully separated |

### Phase 7 — Agents, connections and continuity

| Workstream | Priority | Main state | Exact main evidence | Open PR overlap | Missing acceptance / next check |
|---|---|---|---|---|---|
| WS-50 | P1 | source-present-unqualified | `src/client/src/components/panels/AgentPanel.tsx` | #120 | Compact observed progress and trace; no hidden unreviewed action |
| WS-51 | P0 | source-present-unqualified | `src/client/src/components/terminal/ConversationRuntimeTrace.tsx` | — | Exact reviewed input/target/scope and denial/reconciliation |
| WS-52 | P0 | gap-confirmed | `src/client/src/pages/DataConnectionCenter.tsx` | #105 | Dialog semantics, one provider at time, return to original task |
| WS-53 | P1 | source-present-unqualified | `src/client/src/pages/Terminal.tsx` | #95 | Installed vs available vs missing with rights/health; no shadow plugin auth |
| WS-54 | P1 | source-present-unqualified | `src/client/src/components/terminal/ProjectHome.tsx` | #114 | Permitted retrieval and edit/restore without unrelated Project mutation |
| WS-55 | P1 | source-present-unqualified | `src/client/src/components/terminal/ProjectAutomationPanel.tsx` | #111 | Opt-in, scheduled execution truth, pause/resume/edit |
| WS-56 | P1 | source-present-unqualified | `src/client/src/components/terminal/P9DesktopNotificationBridge.tsx` | #111 | Relevant material event, delivery, privacy and clear notification states |
| WS-57 | P2 | source-present-unqualified | `src/client/src/components/settings/DevicesSettings.tsx` | — | Device capability/revocation/outbox/reconnect not invented |

### Phase 8 — Quality and installed acceptance

| Workstream | Priority | Main state | Exact main evidence | Open PR overlap | Missing acceptance / next check |
|---|---|---|---|---|---|
| WS-58 | P0 | needs-runtime-evidence | `src/client/src/components/ui/dialog.tsx` | #101/#105/#107/#108 | Focusable full critical flow, real assistive-technology proof |
| WS-59 | P0 | needs-runtime-evidence | `src/client/src/components/terminal/project-conversation-shell.css` | #105/#107 | 320/375/390/768/1280/1440 widths and 200% zoom tested |
| WS-60 | P1 | gap-confirmed | `src/client/src/components/terminal/AuthenticatedNavigation.tsx` | #118 | Quiet default, material consent/cost/source/errors visible when needed |
| WS-61 | P0 | source-present-unqualified | `src/client/src/components/terminal/ProjectExperienceShell.tsx` | #102 | No lost input or fake success through representative faults |
| WS-62 | P1 | source-present-unqualified | `src/client/src/components/terminal/ArtifactChart.tsx` | — | Defined device benchmark, memory/scroll, cold+warm traces |
| WS-63 | P0 | source-present-unqualified | `src/client/src/components/terminal/ConversationTrustPanel.tsx` | #109 | Explicit consent, no cross-tenant, revoked source or unsafe share |
| WS-64 | P0 | needs-runtime-evidence | `src/script/validate_ux_flagship_acceptance.ts` | #98/#102 | One full flagship plus non-finance/connected/file/denied/restart |
| WS-65 | P0 | needs-runtime-evidence | `src/script/validate_desktop_accessibility.ts` | — | Native clean install, keyboard, VoiceOver/Narrator and owner sign-off |

## 5. Actionable prioritized gaps (not a second backlog)

1. **Do not re-fix UX-A04 or UX-A15**: retain source correction, add focused rendered accessibility/navigation confirmation later.
2. **Review existing candidates before new feature code**: #99 for project-first branding, #100 for Quick Chat file/source scope, #105 for semantic Connections dialogs, #101/#114 keyboard search, #122 for searchable registered source catalog, #98/#102/#115 for version-aware P4 continuity, #116/#117 for research evidence and status.
3. **Source-confirmed main gaps not yet product accepted**: Project-vs-Chat labeling, no general Quick Chat file upload on main, unsearchable source listing on main, Connections dialog/very small control text, questionably active CSS cascade, unqualified narrow/focus handoff.
4. **First user journey to qualify**: signed-in default Chat → attach permitted file or investigate supported company → inspect genuine source references/unknown values → open actual P4 Artifact ID/version → expand original Dockview and return → reopen saved version after restart. Never use invented market data/ETAs/agent receipts.
5. **Native/visual evidence remains a distinct gate**: screenshot comparison at 320/390/768/1280/1440px and 200% zoom; keyboard, focus, reduced motion, permission/denied/offline; macOS VoiceOver and Windows Narrator; real provider and installed release requirements remain **NOT_RUN** in this source-only audit.

## 6. Qualification and handoff

The automatically discoverable `src/script/validate_ui_gap_matrix.test.mjs` checks all **65 unique WS IDs** against the canonical master plan, reconciles **18 original UX-A IDs**, verifies exact source-path existence, ensures evidence statuses use constrained labels and prevents accidental duplicate row insertion or silent disappearance. This is a **source consistency gate**, **not a rendered UI test**. User-facing acceptance requires later actual target proof.

**WS-01/02 conclusion:** the code-backed map and classification are ready for review. Findings are *not* claimed resolved merely because mapped or covered in a draft. Remaining implementation follows the canonical master plan/issue #91, with no extra tracker.

## 7. Current integration reconciliation — owner-authorized WS-01–65 closure

**2026-10-23:** owner approved completing all 65 items, preserving finished work. Baseline integration `1725e1b2bc7e601405da70b27c2c5d4b47b85748`, public main `9b7d99b0f31e5e10b111a9ab7c5248dbc8eae2f4`. Earlier sections retain their historical main snapshot; they do not describe today's integration branch. Existing local changes are preserved. This section is an evidence update to the same matrix, not a second acceptance ledger; `docs/PENDING_WORK.md` and #91 remain authoritative.

Three independent read-only source investigations covered exactly 01–12/58–65, 13–33 and 34–57. Their findings identify current code and concrete omissions; they did not run tests or establish installed acceptance. Prior journey evidence refers to the canonical pending ledger, not a newly repeated test. No row below is a blanket release-complete claim.

| ID | Existing work to preserve | Remaining action / exact gate |
|---|---|---|
| 01 | Existing route, shell and source audits; #119 annex adopted locally | Complete route→screen→interaction→consumer map, including current branch differences |
| 02 | All 65 original definitions and 18 UX-A findings retained | Keep this current reconciliation distinct from historical main classifications |
| 03 | Existing #98/#102 custody and reviewed selective integrations | Reconcile exact overlaps; do not overwrite shared shell/Artifact/source/CSS owners |
| 04 | #99/#101/#105/#106/#107/#112/#116/#117/#118 have local integration evidence | Finish selective stack integration; independent review and exact-head CI before protected-main merges |
| 05 | Existing visual smoke harness and bounded real renderer journeys | Adopt #124 diagnostics; include375px and real authenticated flows, not only19 fixtures |
| 06 | Existing graphite/gold tokens and import authority | #125 recovery consumer adapted locally; retired inactive palette removed; actual recovery rendering/focus remains to qualify |
| 07 | Existing readable Connections forms; local comfort settings improvements | Adapt #126 scoped hierarchy without reverting forms; computed fonts in every density and200% zoom |
| 08 | Original responsive shell and full Dockview retained | Adapt #127 after token/type changes; qualify hidden Chat/focus/back and pane bounds |
| 09 | Existing shadcn/Radix; #129 bounds/targets and Project destination adopter adapted locally | Reproduced then fixed clipped long dialog;320×400 dialog/panel/menu replay passed; full adopter/zoom/AT qualification remains |
| 10 | Existing visible errors, approvals, native recovery locks | Select #130 truthful recovery changes against current owners; never discard drafts on fetch/save failure |
| 11 | Existing modal focus return and reduced-motion preferences | Reconcile #131 portals and preferences; real focus/busy/reduced-motion replay |
| 12 | Existing local VisualCanvas and retained preferences | Reconcile #132 resource/focus fallback; qualify all supported scene families without visual interference |
| 13 | Universal public entry and labelled Login already present | #133 auth mutex, verified session entry, bootstrap-unknown recovery; remove simulated authentication progress |
| 14 | Mode-aware Quick/Temporary starters already integrated | Select #134 Ask-focus/AI recovery only; preserve mode starters and newer unsent draft |
| 15 | Original mounted signed-in Chat and P4 return owners | Adapt #136 Workbench Ask handoff without competing AgentPanel entry; dirty-state/ref/version custody |
| 16 | Existing Chat stores, archive/trash and saved work | #137 deferred draft discard, single-flight creation, error-aware recents; fence async navigation against newer draft/selection |
| 17 | #101 keyboard overlays and exact same-Chat Artifact opening | Compose #114/#138 filters and explicit selection success; cancellation retains query, preflight before discard |
| 18 | Existing composer and terminal-operation/panel branches | #137→#139 synchronous Send guard across ALL branches; same exact-run Stop owner as#145; newer drafts survive |
| 19 | #100 regular Quick/Project file backend and real attachment custody | #140 incremental upload progress/retry; partial success, invalid2xx and Temporary denial |
| 20 | Existing mention and slash-command surfaces | #141 shared parser and server ambiguity refusal; emails must not become resource references |
| 21 | Existing Master proof/readiness and Radix source Popover | Compose #143 availability/voice privacy with#122 search; configured is not verified permission |
| 22 | Existing P2 streaming, journal and trace | #145 exact acknowledged cancel, observed terminal outcome, no reattached directive replay; Retry stages only; latest-terminal semantics |
| 23 | Safe semantic Markdown and exact citation parser | #113 accessible code copy with clipboard failure and streaming nested-fence behavior |
| 24 | Existing saved/Temporary message owners | #115 Copy/Quote with synchronous single-flight and newer-draft safety; never auto-send |
| 25 | Chat-owned P4, Quick files, Temporary memory-only and mode-aware starters | Preserve throughout lifecycle patches; actual promotion/restart/account-switch/Temporary nonpersistence |
| 26 | Existing governed P7 research tools/runtime | Real plain-language Quick/Project research with lawful configured sources and useful missing-capability recovery |
| 27 | Current request/latest-plan progress and retry result invalidation already integrated | Actual retry/replan/Stop journey; preserve stronger local projection over older#117 |
| 28 | One canonical source registry and Radix Popover | #122 searchable full catalog plus#143 operational/rights truth; no second registry |
| 29 | Safe exact recorded URLs, expandable references and saved citation independence | Actual live/saved/revoked source inspection; safe link is not evidence coverage |
| 30 | Existing Trust source/claim/formula/assumption/receipt cards | Accessible claim→exact evidence detail with recorded units/date/class/rights; unknown metadata remains unknown |
| 31 | Existing missing/conflict/source-free warnings | Claim-level revoked-source replay; recovery stages rather than executes or overwrites newer draft |
| 32 | Explicit same-run interrupted-agent Resume and server checkpoint authority | #145 interruption truth first; same-run no-replay and source/model/grant revocation journeys |
| 33 | Existing ResearchTray local notes/history | #110 explicit save/cancel/delete and persistence errors across ALL pin callers; account-boundary review |
| 34 | Authorized exact-version SavedArtifactCards and original typed renderers | Task-shaped source-backed comparison preview through existing P4; no fake data or output store |
| 35 | Chat-owned immutable P4 and adoption-survives-origin-clear correction | Full installed Quick/promotion/Temporary/foreign/sibling lifecycle qualification; do not reintroduce donor origin-Chat deletion dependency |
| 36 | Exact-version sidecar/focus and pointer resize | Keyboard resize must share pointer80%-viewport cap; narrow/zoom/focus/back replay |
| 37 | Tiptap typed editing, encrypted checkpoint and canonical-save evidence | Full citation/format/history/conflict/permission/restart journey on installed target |
| 38 | Built-in worksheet/Univer recovery and real facade edit/save evidence | Formula/paste/bounds/source/dirty-state qualification; keyboard-entry claim requires actual committed edit |
| 39 | Original P4/ECharts source-backed chart projection | Unit/period/class/freshness, unknowns and keyboard table alternative across supported kinds |
| 40 | Exact historical revisions, dirty conflict protection and stable canonical reconciliation | Full compare/restore/no-stale-response race journey; preserve immutable history |
| 41 | Existing Office import/export and semantic return validation | Actual external Office open/edit/reimport for supported features; unsupported edits remain explicit |
| 42 | Session-bound native grants, OS encryption and recovery consumer fixes already exercised | Actual two-account/process-restart/clean-target packaged qualification; no plaintext fallback |
| 43 | Same P4/original Dockview handoff and exact Chat return | #102 persisted navigation/layout recovery absent; integrate without replacing current editor ownership |
| 44 | No-eviction four-pane composition and dirty-Apply refusal already proven | Saved layout/reflow/resize/stale-pane recovery across useful viewport sizes |
| 45 | Optional specialist picker cancellation/retry and retained workspace | Real authorized catalog discoverability and first-use quietness; no claim from UI-only registrations |
| 46 | Existing entity-resolution and nullable/no-ticker source paths | Real ambiguity/rights/no-data/private-company journeys without invented ticker/quotes |
| 47 | Existing governed same-identity deterministic recomputation and immutable revision | Real sourced model→WACC edit→review→recompute→export/reopen with independent numeric validation |
| 48 | Original portfolio/risk/quant panels and persisted receipts | Qualified data units/sign/PIT/source handling, alternatives, failures and numerical reconciliation |
| 49 | Existing Decision editor and professional report projection | Evidence/assumption/risk/action distinction through real review/export/reopen |
| 50 | Existing bounded agent tool execution and receipts | Compose#145 observed state plus governed tools; no hidden action; real model/tool restart proof |
| 51 | Existing exact opaque governed review IDs and server approval owner | Stale/expired/denied/replayed review and exact input/target/scope reconciliation |
| 52 | Accessible Connections modal/focus return and async removal already exercised | Broader#105 readable discovery/setup/retry/revoke and original-task continuity |
| 53 | Existing P13 extensions/catalog/runtime owners | Reconcile#121/#128 without losing stronger live auth; actual install/authorize/invoke/revoke/uninstall |
| 54 | Existing Project continuity/search/knowledge/memory owners | Permission-aware inspect/correct/delete/retrieve; no unrelated Project mutation |
| 55 | Existing automation manager and canonical P9 | #111 safe Macro Manager run/delete/draft/dedup changes;#135 saved grants at existing server owner |
| 56 | Existing canonical notifications and desktop bridge | #144 committed event→paired-device delivery, rights/materiality/privacy/restart; do not invent delivery success |
| 57 | Existing Home/device trust/offline outbox | #142 live paired-device authority plus real topology/revocation/outbox/reconnect qualification |
| 58 | Existing Radix focus behavior and bounded keyboard proofs | Full keyboard journeys and real macOS VoiceOver/Windows Narrator; source/DOM checks are not OS AT proof |
| 59 | Existing narrow Chat/sidecar and320×400 primitive replay | Complete320/375/390/768/1280/1440 and actual200% zoom through critical product flows |
| 60 | Existing quiet defaults and disclosure guidance | Vocabulary/consent/cost/source/error audit across core flows; preserve material warnings |
| 61 | Existing offline/refusal/restore mechanisms | No lost input or fake completion through provider/source/network/permission faults; supported whole-app egress isolation still required |
| 62 | Existing bounded rendering and resource controls | Measured cold/warm/long-Chat/search/chart/table/resize latency, memory and scroll on declared hardware |
| 63 | Existing tenant/source/session grants and privacy controls | #109 safe sharing absent; remove whole-workspace/url-context disclosure, qualify consent/revoke/foreign-tenant negatives |
| 64 | Bounded real finance, non-finance, attachment and restart evidence exists | Complete all seven SP journeys on exact candidate with lawful model/data; no synthetic-only flagship claim |
| 65 | Existing source/package-contract checks and local native evidence | Clean installed macOS+Windows, OS AT, full P14 evidence and owner sign-off; signing costs previously deferred, not silently waived |

**Execution order:** preserve current#98/#100/#102/#116/#117 → shared primitive/token/type/responsive foundation → exact-run#145 with lifecycle#137/#139 → mention#141/auth#133/first-use#134/one-Chat#136 → search#114/#138/upload#140/source#122/#143 → code/actions/tray#113/#115/#110 → persisted handoff/sharing/Macro/evidence Lens → remaining governed backend/device integrations → complete actual-source/native/viewport/performance/SP/P14 journeys. Existing work is not reopened merely because its upstream PR remains unmerged.

**Current bounded new proof:** shared long dialog before fix had top≈−472px/bottom≈924px in320×400 with visible overflow; after selective#129 adoption top16px/bottom384px, internal scrolling and reachable Save. Escape restored the actual opener after Radix close. Long Sheet scrolled to bottom action and nested menu End reachedOption20 within viewport. These are real browser-mounted shared controls with synthetic fields, not installed full-product or OS assistive-technology acceptance. No source-string primitive assertions were imported.

## 8. Current entry route and interaction ownership map

Verified against current `src/client/src/App.tsx` and its existing `AppRouter`; these are actual mounted state branches, not proposed routes. Hash-address resolution and data access remain server/P1/P4 governed.

| Entry / state | Screen and interaction consumer | Canonical owner / existing integration |
|---|---|---|
| Session loading | App status, no authenticated screen mounted | App/session restoration; WS13/61 |
| Session restoration error | App alert and explicit retry | App, existing session authority; WS10/13/61 |
| Anonymous entry | PublicProductPreview; embedded login/bootstrap flow | Existing public/Login owners; #99/#104/#133 |
| Verified session requiring password change | ForcedChangePassword; no Terminal/Gateway execution | Existing auth owner; WS13/63 |
| Authenticated `#/` or empty address | AppRouter→Terminal→existing selected Chat/Workbench surface | TC/P1, #98/#102; WS15/25/43 |
| Authenticated `#/p/*` | Same Terminal; hash-derived Project/Chat selection | P1 Project and existing shell, not another router/store |
| Authenticated `#/c/*` | Same Terminal; canonical regular Chat ownership | P1/P4 Quick Chat, #98/#100/#102 |
| Unknown authenticated address | NotFound→Back to Chat | #104 source fix retained; WS13/17 |
| Contextual Connections open | Mounted workspace hidden, DataConnectionCenter visible | Existing setup/vault owners; #105/WS52; closing must restore original task |
| Optional specialist picker open | Mounted workspace hidden, DomainPicker visible | Existing domain selection; #106/WS45; cancel retains workspace |
| Signing out | Blocking status while existing session owners clean up | App/server session and account-scoped memory/outbox owners; WS63 |
| Sign-out failure | Explicit retry or stay; no invented successful logout | Existing App error state; WS10/61/63 |
| Chat answer / source / approval | ProjectExperienceShell→ChatMarkdown/ConversationRuntimeTrace/Trust | P2/P3/P5/GM; #113/#115/#116/#117/#145 |
| Saved output / full workspace | SavedArtifactCards→P4 sidecar/editor→original Dockview→same Chat | P4/P11 and Terminal; #98/#102; WS34–49 |

## 9. Concrete PR collision and integration ownership

**Integration writer:** the existing #98 branch; read-only specialists investigate/review. Public main remains unchanged by these local edits. Do not wholesale accept stale donor versions of shared files.

| Shared path / contract | Candidate collision set | Required reconciliation |
|---|---|---|
| ProjectExperienceShell | #98/#100/#102/#115/#130/#134/#136/#137/#138/#139/#140/#141/#143/#145 | Preserve current P4/native/file/mode work; integrate lifecycle+Send+exact-run cancellation as one state machine; stage recovery/retry rather than invoke |
| ConversationRuntimeTrace | #98/#116/#117/#130/#145 | Keep local request/plan/attempt fences and exact sources; one actual receipt/approval/cancel owner |
| ArtifactPane / sidecar / Terminal handoff | #98/#102/#107/#127/#130/#136 | Preserve same ID/version/editor baseline, no-eviction layout and exact origin return; add navigation recovery, not shadow persistence |
| ChatSourcesControl | #100/#102/#122/#143 | Preserve existing Radix Popover and one P1 registry; compose catalog search with current readiness/rights; Temporary live-only scope |
| terminal-shell.css | #125→#126→#127, #131 | Single imported palette; readable hierarchy before responsive geometry; reconcile actual applied cascade, not source-string assertions |
| Shared dialog/sheet/menu/input | #129/#131 plus existing overlayProps local edit | Keep Radix focus/trap semantics and local overlayProps; viewport bounds and reduced motion once in shared owner |
| Login/App/public entry | #99/#104/#106/#133/#134 | Preserve mounted workspace during setup, server-verified identity, universal entry and actual trial constant |
| Gateway runtime / receipt store | #145 with #139 composer | No false completion, synthetic terminal events or buffered action replay; exact acknowledged Stop; explicit Resume distinct from draft-only Retry |
| P13/AI authority/P9/devices | #121/#123/#128/#135/#142/#144 | Separate canonical backend owners; preserve current credential/session/model/grant freshness and tenant authority |

No PR is marked merged merely because its mechanism was adapted locally. Exact-head hosted CI and independent review remain required before protected-main integration.

## 10. Historical per-workstream status (2026-10-23, superseded where noted below)

Levels: **L** = locally implemented and source-gated; **E** = exercised in source-Electron; **X** = external prerequisite open. Nothing below is protected-main, installed-app or SP/P14 accepted.

| WS | Level | Exact remaining prerequisite |
|---|---|---|
| 01-03 | L | none (audit/reconciliation) |
| 04 | L | exact-head hosted CI + independent review per donor PR |
| 05 | L,X | add 375px to diagnostics; production-flow captures on signed native build |
| 06-08 | L | rendered contrast/crash and 200% zoom on installed build |
| 09, 11, 12 | L,E | shared-dialog bounds exercised 320-1440; assistive technology and installed build |
| 10 | L | actual offline/permission replay on installed build; whole-app offline isolation needs authorized VM |
| 13-15 | L,E | clean installed profile |
| 16-25 | L,E | installed app; real provider tool-calling beyond verified local llama3.2:3b chat |
| 26-33 | L | real entitled research sources; lawful provider data |
| 34-43 | L,E | native download/external-Office edit/return; logout/account-switch grant replay on signed binary |
| 44-49 | L | licensed inputs for valuation/portfolio lineage |
| 50-57 | L | #121/#123/#128/#135/#142/#144 backend integration through existing P2/P13/P9/GM owners; paired signed device |
| 58, 59, 61 | X | VoiceOver/Narrator, true 200% zoom, offline isolation |
| 60 | L | real-task disclosure audit |
| 62 | X | measured cold/warm/long-Chat/scroll/memory on declared hardware |
| 63 | L | cross-tenant/revoked-source replay with real rights |
| 64 | X | `validate_ux_flagship_acceptance` is intentionally NOT_RUN in this source distribution (withheld `ux-visual-smoke.yml`); needs private qualification |
| 65 | X | clean macOS/Windows install-update-restart, signing/notarization, owner sign-off |

## 11. Current product-integration correction — 2026-10-26

The grouped **L** labels above are not proof that every consumer landed in consolidated main. Main `1234514` lacked closed #190/#191/#192/#193 runtime consumers. Integration PR [#207](https://github.com/kiranvbiim-coder/lios-terminal/pull/207) restores them and selectively adopts the remaining UX stack without replacing newer P4, draft or Gateway safeguards. No WS-04–65 full installed acceptance follows from these source changes. Exact local commands, isolated Mac journeys and limitations remain in `docs/PENDING_WORK.md`.

| Workstream | Current implementation / exercised boundary | Still required |
|---|---|---|
| 54 | Project-scoped collection search, explicit context modes, revision-fenced resource updates and continuity; resource/Session lifecycle UI; source failed-read Retry and healthy-Project switching. Owner chose Project knowledge as memory; real legacy Ollama turn omitted unrelated memory and created no durable row; confirmed Chat inspection now displays/persists its result with multi-approval isolation regression | Complete native resource/Session lifecycle and failure/recovery qualification; no unrelated Project mutation; same-Chat inspected text retention remains disclosed |
| 55 | Reviewed paused creation, schedule/event-type/filter editing, enable/pause/delete and SQL stale-write refusal; real 5-minute source schedule survived restart without replay. Event-filter UI preserved false/zero, Cancel and failed-save drafts; synthetic canonical event smoke refused mismatch, ran match once and refused replay; restarted UI showed the single result | Live external conditional/current-input sources and installed restart/no-replay; synthetic event proof is not a live provider observation |
| 56 | Project history, explicit OS opt-in, owner-fenced passive delivery and private generic banners; source manual provider-health run created one delivered notification; UI read persisted across restart without duplicate; scheduled successes recorded suppressed under failure-only policy | Real failure/material event and native delivery/banner/read/suppression across restart |
| 57 | Existing-Gateway/device scope truth and explicit network/pairing/Home/revoke review; actual network review Cancel retained listener OFF | Real paired-device execution/revoke/offline continuity; network review is not server CAS |
| 58 | Shared modal reuse; actual Save Workflow name focus, twelve contained Tabs and final Escape → Tools/pointer restoration | Complete keyboard flow and actual VoiceOver/Narrator |
| 59 | 768px mobile navigation and same-instance stacked Artifact; short-phone focus-only access prevents Send occlusion; final 390×600 Send hit test and Focus passed | Native true zoom, declared hardware and independent Windows |
| 60 | Quiet agent guidance and compact Trust metrics preserve canonical rights/error caveats | Whole-task material-disclosure review |
| 61 | New work preflight before upload/start, no reconnect queue, honest unknown outcome; actual offline Send retained prompt/CSV with zero writes/starts | Mid-run transport/restart/permission scenarios and whole-app offline isolation |
| 62 | Bounded Chat history and cumulative-text coalescing; source-browser 1,000-message HTTP fixture rendered latest 80, explicit reveal showed 160 with reading-anchor shift 0.25 CSS pixels; removal restored canonical empty Chat without saving fixture messages | Installed cold/warm/scroll/memory benchmarks on declared hardware; synthetic source-browser counts are not native performance acceptance |
| 63 | Sanitized public ingress/root URL, exact-preview consent, local export acknowledgement and server recorded-denial veto; HTTP/DB regressions | Live source entitlement/recipient rights and complete multi-owner native replay |
| 64 | Existing seven-scenario catalogue/Runtime-fixture suite integrated, 48 focused tests; report still accepts zero installed scenarios | All live/installed scenario gates and owner review; no mandatory private workflow for the $0 beta |
| 65 | Existing strict signed-production schema/CLI retained; six evidence-negative tests, incremental hashing and linked-parent refusal | Production remains unqualified; $0 beta has a separate honest observation track, not weakened signing evidence |

Owner [#206](https://github.com/kiranvbiim-coder/lios-terminal/pull/206), merged as `66b4917`, locks additional release spend to **$0**. Storage and RAM blockers were subsequently cleared sufficiently for actual canonical brokered-browser navigation/extraction/cancellation and a Mac ARM64 beta build. Packaged self-test passed protected secret custody, workspace reopen, bundled Python calculation and resource immutability. Actual packaged sign-in, Connections draft/focus preservation, saved Chat restart without duplicate execution and explicitly reviewed hash-locked Core activation to ready were observed. This qualifies only those paths on the recorded beta binary, not later source-only changes or all WS04–65 journeys. Complete installers exceed per-asset hosting limits; owner selected authenticated split downloads and full-DMG exact-hash reassembly was exercised. Windows installer/installed journeys, VoiceOver/Narrator, full native scenarios, manual upgrade, operational release trust root and publication approval remain open. Exact identities and scoped evidence are in `docs/PENDING_WORK.md`; original user Desktop/profile/data remain untouched.

Creative image/video/audio generation remains optional and must be clearly unavailable when unsupported in beta, per the owner's quiz decision. General AI, research, professional outputs, specialist Finance, automation and devices remain in scope.