# WS-20 — Context References & Advanced Composer Controls

**Date:** 2026-10-23. **Track:** TC/UX [65-workstream plan PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Canonical repo:** `kiranvbiim-coder/lios-terminal`. No replacement composer, backend Chat runtime, Project database, plugin or model provider.

## Source-first audit

Original `ProjectExperienceShell.tsx` already contains `QUICK_COMMANDS`, a `runCommand` dispatcher, an `@mention` suggestion popover, selected-text actions, and `ChatSourcesControl`. Suggestions are drafts; `runCommand` uses existing governed `applyWorkspaceAction`, `saveCurrentSession` and `proposeSandboxTerminal` capabilities, not a new slash interpreter. The source catalogue comes from the authorized `/api/setup/source-registry`. The server already resolves on-demand Project resources via **normalized `@label` tokens** inside `includedResourceRefs`, filtered by source scope, context mode and AI transmission policy; it never accepts client-provided arbitrary resource IDs as an access grant. Its Project/Quick/Temporary context envelope already forbids a Quick conversation from silently inheriting Project scope.

Gaps verified in original code:

1. Client suggestions used raw substring label matching and replaced trailing `@query` with `@resource.label.replace(whitespace, "_")`, while the server applied a **different normalization** (lowercase, stripping all non-alphanumeric punctuation except `_.-`). A resource with punctuation or non-ASCII characters could display as a suggestion yet fail to resolve accurately.
2. The original suggestion list did **not filter** excluded/archived/trashed resources, did not explicitly check current Project/Quick/Temporary Chat scope, did not honor `sourceScope` or `allowResourceReferences`, and could suggest data the backend would refuse. It might also show options using stale Project resources.
3. Two Project resources with normalized tokens such as `Quarterly Report` and `Quarterly_Report` could be simultaneously included as on-demand context by one `@quarterly_report`, without the user selecting both. The original server token parser also accepted `alice@company.com` as an implicit `@company.com` reference.
4. Slash-command candidate buttons staged raw input but did not clearly indicate **staged, not executed**, and had no purpose-specific accessible names or return focus. The command execution itself already stays on the explicit Send/user action.

## Implementation and governed behavior

- `src/shared/mentionContext.ts`: the **single** editor/server `normalizedMentionToken` and `userMentionTokens` implementation. Only an `@resource` preceded by start/whitespace is recognized: ordinary email addresses are no longer resource references. A pure `ambiguousMentionTokens` detects duplicate normalized names among nonexcluded in-scope resources. Client-side `eligibleProjectMentions` suggests only active, nontrashed resources for the **selected current Project** while in **Project Chat** with permitted `auto` or `my_data` source scope and `allowResourceReferences: true`. No suggestions for Quick/Temporary, Web/Files scopes or refused transmission policies. Ambiguous labels are not suggested, and all suggestions are bounded to six.
- `src/server/conversationRuntimeCore.ts`: re-export those two original function names from the new shared source (the core's unchanged callers and tests keep their public interface). Do not maintain two conflicting normalization engines.
- `src/server/conversationRuntime.ts`: when handling on-demand mentions, reject ambiguous normalized label matches rather than silently selecting several on-demand resources; existing explicit saved attachment references, automatic permitted Project resources, `sourceScope="web"` refusal, `sourceScope="files"` explicit-attachment rule and server authorization remain authoritative. **No new Project resource permissions or source egress.**
- `src/client/src/components/terminal/ProjectExperienceShell.tsx`: call the exact shared helper for suggestions and insert the same canonical token only after selecting an eligible Project resource. Explicitly block Send if a hand-typed on-demand mention remains ambiguous within the selected, active Project resources. The unsent draft remains unchanged and the UI directs the user to rename duplicates or remove the mention. The original `runCommand` and slash selection remain intact; command/mention buttons now have staging-specific accessible labels, focus-visible outlines and return focus to the original composer. A short hint explains that selection only stages editable text and permissions/source scope are enforced on Send. No automatic provider call.
- *Important distinction:* mentioning a resource remains **textual intent**, not evidence of access or a new capability. The server's resource lookup, Project owner, context mode, sourceScope and transmission policies still decide what actually enters AI context. Existing Web, Files and explicit upload consent remain intact.

## Tests and evidence

- **11 shared executable unit cases:** `src/shared/mentionContext.test.ts`, including normalized spelling, email exclusion, Project/Quick/Temporary boundary, excluded/archived/trash, permissions and source scopes, duplicate normalized labels, bounded candidate list, staging without send.
- **4 additional server runtime cases:** appended to `src/server/conversationRuntime.test.ts` and run through the existing complete runtime test file. These assert ambiguous on-demand inclusion is refused, unique mention under Auto/My Data still works, Web/Files exclusions and email parsing.
- **8 source contracts:** `src/script/validate_ws20_context_refs.test.mjs` ensure the original Chat, shared resolver, server policy, source catalogue and staged-only slash buttons retain their ownership and no native acceptance is fabricated.
- Exact reviewed WS-20 head, from `src/`:

```bash
node --import tsx --test shared/mentionContext.test.ts server/conversationRuntimeCore.test.ts server/conversationRuntime.test.ts script/validate_ws20_context_refs.test.mjs
npm run test:ux
npm run acceptance:ux
```

| Acceptance | Status |
| --- | --- |
| Source changes and 23 additional regression cases committed | IN_PR |
| Exact-head Node suite, TS check, hosted Linux/macOS/Windows CI | PENDING |
| Unique owned on-demand Project resource resolves under actual account and approved source scope | NOT_RUN |
| Duplicate normalized labels and email content never disclose unintended Project resources | NOT_RUN |
| Quick/Temporary Chat cannot acquire Project context via suggestions | NOT_RUN |
| Archived/excluded/trashed and cross-tenant mention attempts | NOT_RUN |
| Slash command permission/approval, draft-only staging, rejected actions | NOT_RUN |
| 320/390/768/1280/1440px screenshots; 200% zoom and keyboard-only navigation | NOT_RUN |
| VoiceOver/Narrator and native installed Windows/macOS | NOT_RUN |
| Independent review, current-head conflict reconciliation and protected-main merge | PENDING |

## Coordination / collisions

This draft should independently target current `main` because the canonical server normalization/context gap is unowned by open source PRs except older [#98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98), which modifies `conversationRuntime.ts`. The original Chat TSX is modified by #98/#100/#102, #115, #130, WS-14 #134, WS-15 #136, WS-16 #137, WS-17 #138, WS-18 [#139](https://github.com/kiranvbiim-coder/lios-terminal/pull/139), and WS-19 #140. Compare those exact heads and preserve their Send/draft, attachment/file refs, saved Chat, Artifact, keyboard, recovery, first-use and security paths; **do not merge this entire shell file over the other agents' changes**. PR #101 owns the independent Quick Switcher, #114 owns saved-work search and remains separate.

No new donor/UI toolkit, model, credential, backend source API, telemetry, authorizations or uncontrolled action engine. Frontend source hints are not proof of server-side permission. Before accepting WS-20, perform signed-in owner/other-tenant fixture tests, backend denied-source evidence, real keyboard/screen-reader checks, and review every overlapping feature head.

**Next:** WS-21 — source, model and voice availability/consent controls, coordinated with the existing Source Registry and Voice Providers.
