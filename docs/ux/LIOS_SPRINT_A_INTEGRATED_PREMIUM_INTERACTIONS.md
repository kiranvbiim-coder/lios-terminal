# LiOS — Sprint A: Unified Premium Interactions

**Status:** Integrated source on a stacked draft PR. Not installed, signed, accepted or merged into `main`.

## Existing canonical foundations reused

- **Omnibox:** `CommandBar.tsx` retains original Terminal parsing, dynamic tool discovery, entity lookup, authority checks and `onExecute`/Ask callbacks. Native Tab reaches every control, Alt+Right cycles result filters, input exposes combobox/results selection and modal focus is contained. No new command router or second search index.
- **Spatial Workbench:** `DockviewWorkspaceGrid.tsx` retains Dockview drag, snap and resize geometry while original LiOS tabs own PaneState, dirty P4 Artifacts and permissions. Save and restore-default act on the exact original tab's **geometry only**. Reset is blocked during unsaved Artifact edits, and save feedback is verified from local layout storage. The existing Workspace Composer retains four-pane exact-version reordering.
- **Observed AI activity:** `ConversationRuntimeTrace.tsx` adds a quiet, accessible, observed-only step/result count beside Stop and Show work. Planned steps are not represented as completed or successful; approvals are independently labelled and remain user-authorized. No invented execution timeline, polling, run or receipt storage.
- **Contextual dock:** `ImmersiveDock.tsx` shows Compare only for a real active symbol-aware context, opens existing Innovation Studio, and preserves deliberate Pin, Evidence, Research Tray, Pulse, Core and workspace composer routes. Opening tools cannot itself grant source permission or execute a numerical calculation.

## Source/donor provenance repair

Retains exact already-imported beUI, Watermelon, OpensourceUI, OpenClaw GM22 and MCP v2 pins; normalizes five `components.json` postures and notice bindings, supplies four previously missing immutable records to `third_party/upstream-lock.json`, and aligns the full headings in `THIRD_PARTY_NOTICES.md` with the repository's existing fail-closed legal audit. No donor import or new dependency is claimed from the other design-reference websites; no upstream copyright or external data rights are transferred.

## Tests / QA

- `sprintAObservedActivity.test.ts`: observed-vs-planned, duplicate step status, review waiting and no fake live progress on completed runs.
- `sprintAInteractionIntegration.test.ts`: Omnibox/accessibility, exact tab geometry, AI review boundaries and actual dock surface callback.
- `ConversationRuntimeTrace.test.ts`: server-rendered observed runtime status in the real component.
- `sprint_a_donor_registry.test.mjs`: five exact source pins, licence fields and human-readable legal notices.

Required **before merge**: source TypeScript/offline/desktop/build/OSS and licence/preflight gates on Linux, Windows and macOS; keyboard Escape/Tab/shift-Tab; mobile 390px and 200% zoom; reduced motion; 2–4 pane resize/save/tab switch with dirty Artifact veto; pending and denied AI tool review; context change during pin; live installed Electron acceptance. Re-run the unresolved packaged valuation and signed app gates from `docs/technical/LIOS_PHASE4_RELEASE_QUALIFICATION.md`. None of these native or release gates are inferred from passing source checks.

**Scope:** One Sprint A feature branch stacked after cumulative four-phase candidate and packaged Python valuation follow-up. It must be reconciled with its parent before release, not separately merged into main. Do not treat CSS inspiration as a licensed source import.
