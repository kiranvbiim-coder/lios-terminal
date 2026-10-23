# WS-14 — Universal First-Use Guidance Without a Mandatory Wizard

**Date:** 2026-10-23. **Scope:** TC/UX 65-workstream plan [PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). Code-first improvement to the *existing* authenticated Chat welcome state, not a new onboarding runtime, required setup or alternative conversation engine.

## Actual source audit

- `App.tsx` already mounts `AppRouter` → one `Terminal` without gating on data or AI setup. Its `DataConnectionCenter` opens as an optional separate view while the original `data-lios-workspace` is **hidden, not unmounted**, preserving the unsent composer input and conversation draft.
- `ProjectExperienceShell.tsx` already exposes a `textarea[aria-label="Ask LiOS"]`, a start-with-question hint, three finance-specific starter cards, optional `Connect sources`, and existing Connection Center/AI setup access via `BoundedAgentComposerControl`. Starter cards **stage text in the existing composer** and select placeholders; they do not automatically send a request.
- However the welcome eyebrow was **"LiOS · Financial intelligence"** and all three first-use cards were finance-only, contradicting the agreed universal Chat entry goal and [PR #99](https://github.com/kiranvbiim-coder/lios-terminal/pull/99), which is already implementing universal first-entry public copy. The gold primary empty-state CTA was **Create a Project**, making it appear that creating a Project was mandatory before asking.
- `ConversationRuntimeTrace` can emit an actionable recovery from missing AI/provider/data. Existing `onRecoveryAction` handled strings starting **connect** or exactly **open connection center**, but **Configure AI** / **Set up AI** fell into the composer as literal text instead of opening optional Connections with the failed task preserved.
- `src/client/src/pages/EnvironmentSetup.tsx` is a legacy environment configuration surface. The **active user path in App.tsx is `DataConnectionCenter`**. Do not improve the wrong setup screen or add a required onboarding wizard.

## Implementation, respecting ownership

1. **`firstUseJourney.ts`**: extend the existing explicit, immutable first-use contract rather than duplicate it. Add **three universal examples** (Explain a topic, Plan a task, Compare approaches) which require users to select their topic/goal and explicitly mention missing verification, consent and/or assumptions. Each is a **draft**, not a guaranteed output or AI-provider connection. Existing three specialist finance examples remain in their original file without changing deterministic/evidence semantics. Make Connect data/AI explicitly optional.
2. **`ProjectExperienceShell.tsx`**: re-label the existing welcome **"LiOS · Ask anything"**, render universal examples **before** the three finance specialist examples, labelled General vs Finance specialist, without a new tab, duplicate conversation state or an API call. A deliberate **Ask LiOS** CTA focuses the original composer and becomes the primary gold action; Project creation is secondary, and Connect data or AI is the optional third action.
3. **Existing runtime recovery callback only**: `firstUseRecoveryDestination(action)` routes known **connect**, **configure AI**, **set up AI** and explicit Open Connections actions to **the existing `onOpenEnvironment`**. It first restores the actual `lastSubmittedMessage` to the composer, maintaining task context while App hides the underlying workspace. Unknown actions remain editable composer text; no recovery string executes code, sends data, opens an arbitrary URL, grants provider access or changes entitlements.
4. No changes to `App.tsx`, `DataConnectionCenter.tsx`, `EnvironmentSetup.tsx`, `projectExperienceVisualState.ts` or other agents' control owners.

## Overlapping PRs and merge discipline

- [PR #99](https://github.com/kiranvbiim-coder/lios-terminal/pull/99): public universal entry language and AuthenticatedNavigation. WS-14 does not touch those files, and should be reviewed for consistent universal terminology.
- [PR #102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102): saved Chat/Artifact flow and starter prompt file; **`ProjectExperienceShell.tsx` overlaps**, but this PR deliberately does not alter `projectExperienceVisualState.ts` and uses its existing finance starter array.
- [PR #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98), [#100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100), [#115](https://github.com/kiranvbiim-coder/lios-terminal/pull/115): overlapping `ProjectExperienceShell.tsx` research/attachments/message actions. Reconcile before merging; do not replace other feature logic.
- [PR #105](https://github.com/kiranvbiim-coder/lios-terminal/pull/105): Connections accessible first-run dialogs; it retains ownership of credential and data setup. No modification here.
- [PR #130](https://github.com/kiranvbiim-coder/lios-terminal/pull/130): Chat/Connection recovery and fail-closed permissions; preserve its safety during reconciliation.
- [PR #133](https://github.com/kiranvbiim-coder/lios-terminal/pull/133): WS-13 truthful entry/auth, not edited here.

## Regression tests and honest evidence

- `client/src/lib/firstUseJourney.test.ts`: four new executable pure tests appended to existing contract tests; default no-required-connection, universal examples, placeholder and consent semantics, explicit task-preserving recovery classification.
- `script/validate_ws14_first_use_guidance.test.mjs`: eight source-contract tests asserting real original App/Chat surface, mixed general/finance examples, source chooser, AI setup recovery, preserved typed request and no autonomous execution.
- Existing `projectExperienceVisualState.test.ts` and other Project/Chat tests must continue passing. Source tests **cannot prove a real useful answer**; that requires a configured provider or available deterministic capability and an actual authenticated end-to-end run. Never claim the system invents free model credentials or gets live data without access.

From `src/` on the exact PR head:
```bash
node --import tsx --test client/src/lib/firstUseJourney.test.ts script/validate_ws14_first_use_guidance.test.mjs
npm run test:ux
npm run acceptance:ux
```

| Acceptance | Status |
| --- | --- |
| Code and twelve new regression tests committed | IN_PR |
| Exact-head hosted CI and full repository test execution | PENDING |
| New user starts a typed Chat request without creating a Project | NOT_RUN |
| AI/provider missing → Configure AI → recover original composer draft | NOT_RUN |
| Consent, denied source/entitlement and invalid AI credential journeys | NOT_RUN |
| First useful server answer with verified source provenance | NOT_RUN |
| Browser 320/390/768/1280/1440 screenshots | NOT_RUN |
| 200% zoom, keyboard-only focus, starter placeholders | NOT_RUN |
| VoiceOver/Narrator and installed macOS/Windows apps | NOT_RUN |
| Conflict reconciliation, review, protected-main merge and release | PENDING |

Evidence should include the exact commit/target OS, first-request source posture, what AI/deterministic capabilities were **actually** configured, user input/returned error without private data, and whether the original request survived optional setup. Empty-state copy must never imply successful source/provider activation. Confirm source/entitlement choices with the genuine runtime before asserting a useful first answer or closing WS-14.

**Next:** WS-15 — signed-in universal Chat shell integration, avoiding duplicate runtime or Workbench implementation.
