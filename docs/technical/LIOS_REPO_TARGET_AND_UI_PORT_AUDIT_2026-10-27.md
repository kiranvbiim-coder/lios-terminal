# Correct public-repository target and UI donor port — 2026-10-27

## Repository identity (owner decision; effective 2026-10-15)

**ACTIVE:** `kiranvbiim-coder/lios-terminal` (public). All new LiOS product source, technical artifacts, donor imports, and feature PRs must target this repository unless the owner explicitly replaces it.

**LEGACY:** `kiranvbiim-coder/lios-v1.0.0` (private), formerly active until 2026-10-14. Its older implementation and documentation are historical reference; no ongoing LiOS product development goes there by default.

### Wrong-repository audit

On 2026-10-27, assistant-created private-repo draft PRs **#714** (beUI) and **#715** (beUI + Kibo) mistakenly targeted the legacy repository after the October 15 switch. The legacy main had last visible commit on October 14. Both wrong-repo PRs were unmerged. A review of the old repository's latest 100 PRs found only those two with creation timestamps on/after 2026-10-15; this is **not** proof that all older private branches or unsubmitted work were examined.

Port scope from these private PRs into this public follow-on: MIT beUI button, Kibo searchable tags and status primitives, with source/licence notices. This is a **selective component adaptation**, not copying the legacy Project/Chat/Workflow shell.

### Public-repository collision check

The public repository has distinct **beUI**, **Watermelon UI**, and **Opensource UI** donor work tracked on draft PRs #259, #268, cumulative #272, #278 and #280, and a separate four-phase aggregate #302. These are **not merged** to public main at the time of this audit. The new Kibo import in this follow-on is not a replacement for Watermelon activities, Opensource UI spreadsheet chooser, or beUI Pulse navigation. Those stacks must be reconciled exactly once by their owners.

This PR is stacked on #302's exact head; do not merge it to main separately before the upstream #302 disposition and test/visual validation. Existing public `WorkspaceComposer` retains dialog accessibility, unsaved Artifact guard, slot capacity check, and original `onApplyWorkspace` return-value handling; imports only enhance selection and action styling.

### Imported mechanics

- beUI `starc007/ui-components` MIT, `components/motion/button/base.tsx`, `lib/ease.ts`, `lib/hooks/use-hover-capable.ts`, pinned source commit `fa3393a3891723d4d2daec1f1d82ead175442f44`, adapted to installed `framer-motion`. The beUI button replaces only the existing Apply Workspace control.
- Kibo UI `shadcnblocks/kibo` MIT, commit `3d63cdb15b79d972e3dc38a10997987672f9b263`, `packages/status/index.tsx`, `packages/tags/index.tsx`. Status reflects real Project P9 enabled/paused and governed execution session states. Tags filters existing published intelligence-object tags locally; no new data authority.
- Original licenses shipped in the component vendor directories; `THIRD_PARTY_NOTICES.md` and the OSS source registry preserve provenance. No new npm packages or paid/runtime services.

### Validation boundary

Source is integrated in a GitHub feature branch, **not shipped or merged**. GitHub readback/source diff can verify imports and call sites. Offline TypeScript check, targeted UI tests, full local Electron keyboard/reduced-motion/zoom, source-license audit and packaged beta acceptance have not been executed in this connector environment. The public aggregate and this UI follow-on must pass their exact-HEAD checks before merge.
