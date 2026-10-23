# WS-15 — One Signed-In Canonical Chat, Workbench Is an Optional View

**Date:** 2026-10-23. **Workstream:** TC/UX WS-15 from the [65-item plan PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119). **Tracking:** [issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Main PR:** WS-15 draft pending exact-head CI, review and actual client journeys.

## Audit against real code

The existing App owns one authenticated `Terminal`; the original `ProjectExperienceShell` renders one signed-in Chat for Quick, Project and Temporary conversations. `Terminal.tsx` **keeps that Chat component mounted when `experienceSurface` changes**, rendering it under a hidden element rather than allocating another Chat. The Workbench has an existing saved-Artifact handoff with projectId/chatId/artifactId/version custody, dirty-draft protection, and an explicit return to the same Chat. There is **no need for another runtime, tab-based Chat clone, backend API or donor implementation**.

However, `Terminal.tsx`'s `handleAskLios` path still opened `AgentPanel` when a client used Workbench's **Ask LiOS** action; `activePane.view === "agent"` short-circuited into that specialist pane too. This diverted client messages from the existing canonical Chat to a competing UI/provider route, contrary to the accepted universal signed-in Chat direction. On compact Workbench canvases there was not an obvious, keyboard-accessible **Return to Chat** affordance that kept a general Workbench session without requiring a saved Artifact handoff.

## Implementation

- **`lib/universalChatHandoff.ts`**: a pure, ephemeral `{request,prompt}` navigation signal. A question is an **editable draft only**; user-selected ticker/view context is written as clearly labeled text with an instruction to use only authorized sources and identify missing evidence. A strict symbol shape prevents raw/untrusted context text being interpolated. Preserve an existing unsent draft with a separator; make repeat staging idempotent. No provider, data or saved conversation operation occurs in this helper.
- **`pages/Terminal.tsx`**: client `handleAskLios` now routes directly to `handleSurface("projects")`, requests a handoff for the already-mounted `ProjectExperienceShell`, and does **not** call `openViewInNewPane(...,"agent")` or `handleNav("agent")`. The Workbench dirty Artifact guard remains authoritative and blocks loss-prone return. Internal specialist audiences retain the established AgentPanel flow, rather than removing their independent professional panel unexpectedly. The existing `ProjectExperienceShell` is still mounted **exactly once** across surface switches. The non-Chat Workbench surface now provides an accessible **Return to Chat** button with an explanation of preserved draft state, disabled while saved Artifact edits are dirty.
- **`components/terminal/ProjectExperienceShell.tsx`**: consume each handoff exactly once by request number. Switch its existing section to conversation (without changing current Project/Quick/Temporary ownership), keep the original selected chat and saved Artifact, stage any incoming question **without sending**, and focus the existing `Ask LiOS` composer after the surface transition. Do not invoke a new Chat/project creation action or import another agent runtime.
- Source explicitly avoids changing auth/session routes, provider policy, permission grants, Workbench revision/dirty state, draft-attachment custody, finance calculations or native command bridges.

## Dependencies / no-duplication policy

- [#99](https://github.com/kiranvbiim-coder/lios-terminal/pull/99) owns public universal entry and navigation; no overlap with its public preview or navigation files.
- [#102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102) already owns saved-Chat/Artifact behavior and modifies **both** `Terminal.tsx` and `ProjectExperienceShell.tsx`. [#98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98) also touches both; [#100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100), [#115](https://github.com/kiranvbiim-coder/lios-terminal/pull/115), [#130](https://github.com/kiranvbiim-coder/lios-terminal/pull/130), and [WS-14 #134](https://github.com/kiranvbiim-coder/lios-terminal/pull/134) touch `ProjectExperienceShell.tsx`. **Compare actual current heads and merge/rebase deliberately**, retaining their attachment, research, first-use, chat runtime and recovery logic. Do not merge WS-15 over #102's saved-work ownership or imply code integration is already complete.
- This PR uses original component/runtime ownership with no fork, donor code, dependency upgrade, change in entitlements, new data egress, license import or backend mutation.

## Test plan and evidence

- **6 executable pure tests** in `src/client/src/lib/universalChatHandoff.test.ts` for no implicit send, correct selected context, invalid-symbol rejection, unsent-draft retention, idempotence and no-provider fallback.
- **8 source-contract tests** in `src/script/validate_ws15_universal_chat_shell.test.mjs` checking one mounted Chat, correct client Ask route, untouched internal specialist, idempotent handoff, Workbench dirty guard, saved Artifact identity, consistent signed-in entry, and native acceptance honesty.
- Run on exact reviewed head from `src/`:
  ```bash
  node --import tsx --test client/src/lib/universalChatHandoff.test.ts script/validate_ws15_universal_chat_shell.test.mjs
  npm run test:ux
  npm run acceptance:ux
  ```

| Check | Status |
| --- | --- |
| Original shell/Workbench integration coded and 14 regression tests authored | IN_PR |
| Exact-head Node tests, TypeScript, Linux/macOS/Windows CI | PENDING |
| Workbench Ask from Quick/Project/Temporary, with and without ticker | NOT_RUN |
| No duplicate Agent runtime in actual client renderer and no extra network send | NOT_RUN |
| Unsent draft, file attachments and current saved Artifact retained after return | NOT_RUN |
| Dirty Artifact blocked, save/reset then clean return | NOT_RUN |
| Normal/mobile Workbench at 320/390/768/1280/1440px | NOT_RUN |
| 200% zoom, keyboard-only navigation, focus return | NOT_RUN |
| VoiceOver/Narrator, real native macOS/Windows signed-in experience | NOT_RUN |
| Actual review, PR conflict reconciliation, protected-main merge | PENDING |

Tests and source inspection do **not** establish actual browser-computed accessibility, native package acceptance, signed-in provider execution or a verified correct answer. Reviewer must test a real client account and an internal specialist account separately, with exact SHA, no private user data/screenshots, and demonstrate that the original Chat's existing history/attachments/saved Artifact are unchanged after optional Workbench navigation. [Issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91) remains the authoritative acceptance checkpoint.

**Next:** WS-16 — conversations/sidebar ownership, new/recents/rename/archive/trash and draft-preserving switching.
