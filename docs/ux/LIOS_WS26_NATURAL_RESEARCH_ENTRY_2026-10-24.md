# WS-26 — Natural Research Entry (source review and acceptance)

Date: 2026-10-24 · Owner: TC/UX 65-WS plan [#119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119) · Coordination [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91)

## Boundary from actual source code

- `src/client/src/components/terminal/ProjectExperienceShell.tsx` already sends an unmodified user's Chat text through `runConversation`; no second composer, UI route or new Project is warranted.
- `src/server/conversationRuntime.ts` already owns `planConversationWorkflow`, runtime `plan`/status/receipt events, `executeAI`, provider policy, cancellation and budgets. It previously classified an unrecognized generic research request as `chat` without a research-specific plan.
- `src/server/conversationCapabilityResolver.ts` formerly assumed every entity phrase after “research …” was a named company/security. A lowercase subject such as “battery recycling in India” could be incorrectly routed to finance. This change only excludes an *explicit, low-ambiguity general research topic* from that broad financial heuristic. Named/company/ticker/financial cues remain on the existing professional path.
- P7 governed research tools, P5 provider/source rights, Workbench/Artifact stores, and #117 progress UI remain the single existing owners. This patch does **not** instantiate browsers, purchase data, add a second model agent, or grant tool permissions.

## Bounded implementation

1. Pure `naturalResearchEntry` recognizes explicit “Research …”, “investigate …”, “look into …”, deep dive, brief and primary-source requests; preserves the user's actual objective and rejects vague, ordinary Chat, slash commands and excess text.
2. A general topic with only `ai.answer` availability yields an observable `research` plan with a **single** existing `ai-assist` step, **1 AI-call budget**, **1-step budget**, **60-second wall clock**. The optional finance-oriented AI planner fallback cannot spend an extra model call in this research lane.
3. `executeAI` uses the normal configured-BYOAI execution, approvals, owner scope, cancellation, event stream and receipt. The response **explicitly says no external source retrieval was performed**, asks the model to expose gaps, and never assumes real citations. Without a permitted configured AI provider this lane must fail visibly; no local invented answer.
4. The original P5 company research, Project search, deterministic finance, and explicit `/research` command paths are unchanged. Temporary Chat persistence, source-scope limits and permissioned provider operation remain unchanged.

## Target tests and acceptance

Run from `src/`:

```sh
node --import tsx --test server/naturalResearchEntry.test.ts server/ws26NaturalResearch.test.ts server/conversationCapabilityResolver.test.ts server/conversationRuntime.test.ts
npm run test:p2
npm run test:ux
npm run validate:visual-environments
```

Written regression assertions: explicit research recognition/rejections; exact research plan, budget and existing AI capability; finance/generic non-regression; fake configured-provider run emitting an actual `plan` event, exactly one observed `ai-assist` start, attributed receipt, no artifact and explicit external-source boundary. The fake-provider test is **not live provider proof**.

**Still NOT_RUN / NOT_ACCEPTED** until executable CI and app review: full TypeScript/Node tests on current head, actual provider connected/disabled/denied, Web/My Data/Files permission and missing evidence UI, cancellation/retry, real cited source retrieval, keyboard/200% zoom/320–1440 screens, native Mac/Windows and packaged restart. A merged PR would not satisfy research/evidence WS-27–33, SP or P14. The user-facing claim is preliminary AI-assisted research initiation, **not full autonomous deep research or verified web results**.
