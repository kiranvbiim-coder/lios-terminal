# LiOS current UI/UX — code-evidence baseline audit (22 October 2026)

> **Status:** source-backed audit annex and proposed remediation order, **not** a new plan, implementation completion claim, independent release authority, acceptance result or visual sign-off. **Canonical authority** remains \`docs/LIOS_UX_SYSTEM.md\`, the SI program, the P4/P5/TC/GM/CA owners, master issue **#91**, Shipping Points and P14. **Base:** public \`main\` at \`1fa37cc372746b7bfd61c4f8b79093ed707c5ea0\`. Target: improve the **existing** universal intelligence product's friendliness, attractiveness, consistency, accessibility and workflow continuity, without sacrificing the original financial Workbench or safety.

## 1. Method, evidence level and important limitation

Inspected real default-branch source files, route/surface code and open overlapping PR heads through the connected GitHub repository, not documentation alone. Scope included:
- Application/router/auth: \`App.tsx\`, \`main.tsx\`, \`pages/Login.tsx\`, \`PublicProductPreview.tsx\`, \`DomainPicker.tsx\`, \`not-found.tsx\`, \`lib/experienceShell.ts\`.
- Signed-in conversation: \`pages/Terminal.tsx\`, \`ProjectExperienceShell.tsx\`, \`AuthenticatedNavigation.tsx\`, \`ChatSourcesControl.tsx\`, \`ConversationArtifactSidecar.tsx\`, \`ProjectHome.tsx\`.
- Dense workflows: \`pages/DataConnectionCenter.tsx\`, \`EnvironmentSetup.tsx\`, \`components/terminal/TopBar.tsx\`, \`Sidebar.tsx\`, \`QuickSwitcher.tsx\`, \`ShortcutOverlay.tsx\`, \`TerminalUxSettings.tsx\`, \`WorkspaceComposer.tsx\`.
- Layout/visual contract: \`terminalStyles.ts\`, \`index.css\`, \`terminal-shell.css\`, \`terminal-theme-lock.css\`, \`reference-entry.css\`, \`project-conversation-shell.css\`, \`docs/ux/*\`, \`docs/LIOS_UX_SYSTEM.md\`.
- Draft code overlapping the experience: PR **#98** (Finance Workbench ↔ Chat Artifacts), **#99** (universal first-entry/public/nav), **#100** (Quick Chat attachments), **#101** (Quick Switcher / keyboard map).

**No rendering or hands-on native test happened during this audit.** There was no locally executable repository checkout or target installed app available to the auditor. Source-level evidence establishes the listed code behaviors/patterns, but does **not** establish computed CSS, clipping on a specific device, native screen-reader results, final contrast, performance, real permissions, successful model calls, or shipping acceptance. Do not call anything a "verified screenshot defect" absent a reproducible screen. Existing \`npm run validate:visual-environments\` checks only static UX/assets; it is not a substitute for real UI review.

## 2. Current user-facing surfaces (inventory, not a replacement architecture)

| Surface | Source authority | Observed code behavior | Main experience concern |
| --- | --- | --- | --- |
| Public preview | \`PublicProductPreview.tsx\`, \`reference-entry.css\` | Public marketing, illustrative terminal/ticker, demo and sign-in/registration entry | On main, finance product positioning dominates universal LiOS; inline/mobile styling has brittle overrides |
| Registration/sign-in | \`Login.tsx\` | Login and account-creation modes, error/loader handling | Several visible labels are not programmatically tied to the actual inputs; microtype |
| Session restoration | \`App.tsx\`, \`sessionLifecycle\` | Restores session; retry and sign-out error surfaces | Keep restore failure and pending work understandable, not generic technical text |
| Authenticated first entry | \`experienceShell.ts\`, \`Terminal.tsx\`, \`ProjectExperienceShell.tsx\` | Defaults to \`projects\` surface, which contains actual conversation entry; optional explicit Workbench restore | UI naming still suggests Projects/finance are the product rather than optional destinations |
| Chat variants | \`ProjectExperienceShell.tsx\` | Quick, Project and Temporary Chat with distinct retention rules, input, streams, status, starters | Consistent everyday Chat, attachment/source semantics and simple controls need strict integration |
| Sidebar and navigation | \`AuthenticatedNavigation.tsx\`, \`Sidebar.tsx\`, \`TopBar.tsx\` | Chat history rail and separate advanced Workbench nav | Hierarchy, labels, shortcuts and touch/accessibility need consistency |
| Connected providers/AI | \`DataConnectionCenter.tsx\`, \`ChatSourcesControl.tsx\` | Optional setup, source catalogue, AI model/provider selection, credentials, connections | Dense single page; several secondary controls are very small; custom modals need keyboard/focus work |
| Artifacts | \`ConversationArtifactSidecar.tsx\`, \`ArtifactPane.tsx\` | Same saved Artifact can be opened next to Chat or in focus and expanded | Narrow-layout handoff, version clarity, responsiveness and continuity require real end-to-end checks |
| Original Workbench | \`Terminal.tsx\`, \`DockviewWorkspaceGrid.tsx\`, \`Sidebar.tsx\` | Full professional panel stack and specialized analysis | Preserve depth but do not expose complex layout as first-use default |
| Workspace settings and help | \`TerminalUxSettings.tsx\`, \`QuickSwitcher.tsx\`, \`ShortcutOverlay.tsx\` | Existing professional preferences, tabs and command shortcuts | Legacy density and modal focus/reading concerns; #101 improves only two overlays |
| Unknown route | \`not-found.tsx\` | White 404 card and developer message | Immediate mismatch with LiOS brand and no clear path back to work |

### Strengths to protect

- Authenticated conversation entry can be used without creating a Project; Temporary Chat is visibly marked not saved.
- Chat empty state has explicit prompt examples and a readable composer with Enter/Shift+Enter behavior; can stop in-progress work.
- Source selection reuses the canonical source registry rather than a second connection authority; source rights and unsupported data are explained.
- P4 Artifacts have a real sidecar/focus model; original Dockview financial Workbench already exists.
- Connection setup includes truthful unconfigured, unavailable and source-licensing feedback and an optional first-use bypass.
- Local fonts are bundled (Barlow Condensed, Inter, JetBrains Mono); the approved graphite/gold visual direction and optional environment intensity rules are documented.
- Separate loading/error/retry/recovery states exist in several major flows.

**Do not throw these away to re-create them from a donor, design mockup or second React shell.**

## 3. Prioritized findings — code observed, not visual test results

Severity is proposed UX remediation priority (P0 essential before polished onboarding, P1 core experience, P2 refinement); it does not imply an exploited security flaw or signed release blocker without separate qualification.

| ID | Priority | Finding and concrete source evidence | Action / owner / existing overlap |
| --- | --- | --- | --- |
| UX-A01 | P0 | **Main markets LiOS as only financial:** \`PublicProductPreview.tsx\` hero literally reads “Financial Intelligence Operating System”; main signed-in \`ProjectExperienceShell.tsx\` empty eyebrow reads \`LiOS · Financial intelligence\` although user intent is universal. | Reconcile **draft #99** for public landing; **separately correct signed-in empty-state positioning** with #98/#100 owner coordination. Keep finance as deep specialist and clearly mark mock data. |
| UX-A02 | P0 | **Regular Chat file workflow on main still forces a Project:** \`ProjectExperienceShell.tsx\` > Tools > Attach files shows “Files are saved with a Project. Move this chat into a Project before attaching files.” | **Draft #100** is specifically implementing regular Quick Chat attachments. Review + test this PR; do not re-code elsewhere. Temporary uploads must remain nonpersistent. |
| UX-A03 | P0 | **Source chooser on main disables My Data/Files when \`projectAvailable\` is false:** \`ChatSourcesControl.tsx\` receives \`chatMode === "project" && Boolean(selection.projectId)\`; Quick Chat is blocked. | **Draft #100** passes \`chatMode !== "temporary"\`. Verify actual retained Quick Chat source scope, ACL and model source restrictions before merging. |
| UX-A04 | P0 | **Authentication accessibility:** \`Login.tsx\` renders labels for name, organization, email, password and confirm-password as separate \`<label>\` elements with no \`htmlFor\`, while their inputs are siblings inside divs and have no explicit accessible names. | Make form fields have stable \`id\`/associated \`htmlFor\`, error text \`aria-describedby\`, correct autocomplete and focus error handling. Add rendered label-to-input tests. |
| UX-A05 | P0 | **Connection modal keyboard/a11y semantics:** \`DataConnectionCenter.tsx\` \`ModalShell\` is a clickable \`div\` without \`role="dialog"\`, accessible title association, Escape handling, focus containment/restoration or accessible close name. | Reuse existing shared Dialog primitives and accessible modal conventions; no new modal framework. Test outside-click, Escape, focus return, sensitive credential form and narrow screens. |
| UX-A06 | P1 | **Micro typography:** \`DataConnectionCenter.tsx\` contains 72 source occurrences of \`text-[8px]\`, 33 of \`text-[9px]\`, 14 of \`text-[10px]\`; \`EnvironmentSetup.tsx\` 25 and 27 respectively, \`TopBar.tsx\` many 7–10px controls, and \`Login.tsx\` has 7–11px copy. These are source-class counts, not viewport measurements. | Use 14–16px typical UI/body, 12–13px secondary metadata and readable dense Workbench data where justified; avoid sub-11px user-operable control text. Confirm computed CSS and accessibility zoom before changing all selectors. |
| UX-A07 | P1 | **Dense single-screen connection configuration:** \`DataConnectionCenter.tsx\` is 1,831 lines, contains many provider/catalog/AI/runtime/database/API/storage setup branches, low-density labels and permission copy. It **does** allow skip/continue, so calling setup mandatory would be wrong. | Progressive flow: connect when asked → search → one provider sheet → permissions/status → return to original task; advanced provider parameters only on demand. Preserve canonical connectors and rights. |
| UX-A08 | P1 | **Default sidebar identity on main says “PROJECTS”** in \`AuthenticatedNavigation.tsx\` even during conversation, while the actual default is Chat within the “projects” experience surface. | **Draft #99** corrects general-Chat brand. Integrate and verify rail, recent Chat, New Chat, optional Projects and Workbench destinations without duplicating navigation. |
| UX-A09 | P1 | **Two identically named “Open workspace” actions** are offered in \`ProjectExperienceShell.tsx\` Tools dropdown: inside Advanced and again at the root. | One contextual **Expand Workspace** / Workbench entry is enough; preserve both accessibility and advanced source operations. Touching this file must wait for #98/#100 reconciliation. |
| UX-A10 | P1 | **Style authority is spread:** \`terminalStyles.ts\` actively imports 11 style modules including legacy-named specialist files and \`terminal-shell.css\`; \`index.css\`, \`terminal-shell.css\`, and a separate checked-in \`terminal-theme-lock.css\` each define partially different root brand/background values. The lock file is **not imported by the central entry** and its mere presence is not evidence it affects rendering. \`terminal-shell.css\` contains 197 \`!important\` declarations (source occurrence count). | Trace the actual imported cascade in browser, build one tested token/typography/chrome owner, remove only proved dead/conflicting overrides, preserve analytical semantics and saved user themes. Avoid visually overhauling based only on filename. |
| UX-A11 | P1 | **Mobile marketing hierarchy:** \`PublicProductPreview.tsx\` uses a large inline-styled multi-CTA header; \`reference-entry.css\` at ≤767px changes navigation font to 9px and hides the last auth CTA in the header. This is a confirmed CSS rule, not proof that registration becomes unreachable elsewhere. | Test the real 320/375/390/768px landing and authentication journey; keep visible Sign in and Try/Sign up actions and readable navigation without clutter. Reconcile #99. |
| UX-A12 | P1 | **Workbench↔Chat version and layout acceptance is in a draft:** \`ConversationArtifactSidecar.tsx\` uses a 42% side pane in non-focus mode; PR **#98** changes 151 files. Code shows a version-aware expand button, but that does not prove a real native same-version bidirectional workflow. | Accept #98 only on exact Artifact ID/version, source, entity, assumptions, edit conflict, return, restart and non-finance flows; require rendered screen/narrow view. No second Workbench/Artifact engine. |
| UX-A13 | P1 | **Keyboard/help surface:** main \`QuickSwitcher.tsx\` and \`ShortcutOverlay.tsx\` have tiny controls and incomplete dialog keyboard behavior; changed by **draft #101**. | Review #101; confirm correct ARIA patterns and actual Tab/Escape/result selection/focus return in browser/screen reader, not only static test strings. |
| UX-A14 | P1 | **Plugin/connection discoverability:** there are surfaces named Plugins, Connections & AI, advanced source registry, Tools and Settings. The features are real but labels and locations make the user reconstruct the structure. | One canonical discover/connect/manage pattern accessible contextually from Chat and Settings; no permanent plugin-based sidebar growth. Test Browse/Installed/Search, consent, account selection, revoked/offline states. |
| UX-A15 | P2 | **404 is developer-facing and off-brand:** \`not-found.tsx\` is a light \`bg-gray-50\` screen reading “Did you forget to add the page to the router?” with no obvious safe return-to-Chat action. | LiOS-styled accessible missing/expired-work explanation and safe Back to Chat action; avoid implying erased data. |
| UX-A16 | P2 | **Optional domain-picker vocabulary remains finance-biased:** \`App.tsx\` and \`lib/domains.ts\` fall back to the finance domain; \`DomainPicker.tsx\` asks users to “Choose a workspace” across business-domain tiles. It is not launched as a mandatory first-use picker; it opens on explicit switch. | Keep specialist filters under Advanced/Workbench; make Chat universal regardless of stored domain. Do not erase existing access/entitlement boundaries. |
| UX-A17 | P2 | **Context side pane and narrow-mode transition:** \`project-conversation-shell.css\` intentionally hides Chat main content below 1200px while Project context opens. This may be valid focused navigation but needs a clear “Back to Chat”, visible state and return focus. | Verify 320–1440px context, sidecar/focus/Workbench transitions and keyboard state restoration. Do not infer broken layout without rendering. |
| UX-A18 | P2 | **Marketing mock and professional preview hierarchy:** \`PublicProductPreview.tsx\` displays illustrative ticker/sample terminal values (labelled in source) while the broader universal experience remains unclear on main. | #99 moves universal Chat to first position and keeps finance demo as a clearly labelled specialist example. Test that visitors cannot mistake preview values/actions for connected market data. |

**Important collision facts as of audit:** #98, #99, #100 and #101 are open **drafts**, not merged into \`main\`; #98 and #100 both touch \`ProjectExperienceShell.tsx\` and \`ChatSourcesControl.tsx\`. The latest main does not inherit their fixes until reviewed and merged.

## 4. Desired visual and interaction quality — apply to the *existing* app

- **Identity:** consistent matte graphite/gold LiOS shell with the approved locally bundled Barlow Condensed for selective display headlines, Inter for readable interface/prose and JetBrains Mono for numerical data/code. Do not make every label all-caps monospace or elevate finance ticker imagery to universal home.
- **Hierarchy:** primary action is the Chat composer. Top bar provides identity and current context; left rail has New Chat, Search, Recent, optional Projects/Artifacts and clearly secondary Connections/Settings. Advanced Workbench navigation appears only when expanded.
- **Quiet intelligence:** Chat shows readable progressive results, clear source confidence, meaningful Artifact cards and one relevant status/Stop. Tool traces, agent logs, provider registries, raw settings and complex finance tabs remain available on demand, not visible by default.
- **Progressive depth:** default Chat → small Artifact preview → same canonical Artifact sidecar/focus → contextual full original Workbench → versioned edits → return to unchanged Chat. No duplicated work product or break in the investigation.
- **Readable desktop and small-window presentation:** aim for body 14–16px, supporting text 12–13px only where readable, interactive hit areas around 40–44px, 14–16px minimum composer input and visible focus. Check at 200% zoom and 320px viewport without horizontal page clipping.
- **Attractive through restraint:** deliberate whitespace, consistent border/radii/spacing, one primary gold accent, meaningful hover/selected/disabled/error distinctions, professional chart semantics and minimal motion; avoid decoration that obscures data or creates fake interaction affordances.
- **Clear control language:** Ask LiOS, Sources, Attach, Stop, Show evidence, Open Artifact, Expand Workspace, Back to Chat, Connect AI and Manage connections. One operation, one predictable label. Technical identifiers only in expert inspection.
- **Trustful failure states:** truthful offline, source permission, licensing, entitlement, AI-unavailable, in-progress and recovery states; never imply that a disconnected model, financial quote, missing file or stopped runtime succeeded.

## 5. Evidence-based execution order under existing #91 (no second board)

1. **First reconcile overlapping draft PRs.** #99 for first-entry copy, #100 for Quick Chat files/sources, #98 for exact original Workbench/Artifact handoff, #101 for keyboard overlays. Verify independent review/current-head CI and overlapping file conflict before merging. All remain **unaccepted**.
2. **Accessible first-use P0 (bounded UI PR):** fix \`Login.tsx\` field semantics and the \`DataConnectionCenter.tsx\` custom dialog (separate files, or separately coordinated PRs) with keyboard/error regression coverage, without redefining auth/credential authority.
3. **Chat-first design consolidation P1:** harmonize sidebar labels, generic Chat starter identity, Action/Tools duplication, default connection surfaces, composer/Artifact hierarchy and narrow screens *after* #98/#100 lands. Preserve current P4/GM/P5 ownership.
4. **Visual system P1:** inspect computed style snapshots to resolve real active CSS conflicts; establish a supported type/spacing/color/interactive-control inventory and incrementally modernize Login, Chat, Connections, sidebar, Workbench chrome and public entry. Do not globally delete historical CSS on assumption.
5. **End-to-end hands-on acceptance P1/P2:** native macOS + Windows, small desktop window and high-density multi-panel Workbench; real provider and source rights; accessibility and error paths. Evidence must include exact commit, app version, OS, display/zoom, screenshots/video where authorized, journey, expected result, actual result and blockers.

## 6. Minimum validation matrix to attach to relevant bounded PRs

| Journey / viewport | Validate |
| --- | --- |
| Public visitor 320, 390, 768, 1440px | Plain-language universal product value, visible sign-in/registration, accessible hero/navigation, properly labelled non-live previews, no clipping |
| New account / returning sign-in | Accessible labels/error focus, password errors and recovery, keyboard traversal, session-restoration retry, first composer reached without wizard |
| First generic prompt, no provider | Clear optional Connect AI guidance, no fictitious output, prompt retained through setup, truthful AI-off path |
| Regular Quick Chat with file | Stage/attach/send/saved reopen/download where authorized; no forced Project, source/permission denial correctly enforced, exact #100 code |
| Temporary Chat | Clearly nonpersistent; no saved file/Artifact/memory, restart doesn't restore private temporary content |
| Generic non-finance research | Relevant sources and citations, useful progressive results, Stop/cancel, error and research continuation |
| "Research Apple" specialist finance | Chat → cited Artifact → same original Workbench and source/assumptions → versioned authored edit → back to Chat → restart exact state |
| Artifact sidecar | In desktop/full/narrow focus, same P4 ID/version and expected evidence/history; keyboard open/exit and remembered context |
| Provider/connection | Search, connect, test, authorization, unavailable/revoked/offline, focus trap/return and safe secret entry |
| Plugins and command palette | Search/browse/installed, keyboard shortcuts, active result, permission prompts, no duplicate sidebar destinations |
| Dense Workbench | Charts/legends/tables/inputs legible; resize/reflow, panel focus, correct source/currency, no silent version switching |
| Cross-cutting | 200% zoom, 320px, 375px, 768px, 1280px, keyboard-only, screen reader, reduced motion, distinguishable contrast, error/empty/loading/disabled and slow network |

### Definition of done for every material UX item

- Actual integrated code, not a mock alone; no duplicate shell/registry/workbench and no regression to Quick/Project/Temporary semantics.
- Automated TypeScript/source/behavior tests on **exact reviewed head**; pass/fail documented separately.
- Screen walkthrough at target widths and zoom, keyboard/screen reader where relevant, with annotated screenshots or video and real observed issues.
- User tested flow start → task → result → save/reopen/return; permissions and missing-state outcomes correct.
- Later target packaged desktop / applicable Shipping Point / P14 evidence as governed by existing release authority. **Not asserted here.**

## 7. Practical conclusion

**Current state:** existing components have enough depth to become a distinguished product, but the main usability risks are **universal product identity drift, Quick Chat feature gates, unreadable dense typography, inconsistent controls/dialog accessibility, long connection/setup surfaces and unproven full-workflow continuity**. The most important next act is to **measure the existing rendered UI and fix the P0 code defects**, then consolidate styling and navigation around the retained Chat + Artifact + original Workbench workflow. Attractive aesthetics should follow clear hierarchy, not replace function.

**Verification truth:** this document is a source audit only. No accessibility certification, browser screenshot sign-off, real-data finance pass, hosted CI result, native installed-app walkthrough, SP-07 or P14 success is implied.
