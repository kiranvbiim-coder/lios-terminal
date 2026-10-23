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
