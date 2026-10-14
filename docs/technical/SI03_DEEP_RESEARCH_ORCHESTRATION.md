# SI-03.08 — Bounded Deep Research Orchestration

Status: bounded P7 implementation for SI-03 / SP-03 Research Alpha. This document records the implementation seam and donor disposition only; it is not an SP-03 or full SI-03 completion claim.

## Canonical authority

SI-03.08 extends the existing P7 `researchService` / `ResearchInvestigation` evidence authority. It does not create a second research store, crawler, browser, index, memory system, source-policy authority, scheduler, or Artifact authority.

`buildDeepResearchOrchestration` is a deterministic, side-effect-free projection over one investigation, its persisted evidence, the required evidence types supplied by the caller, and the caller's explicit iteration count. Evidence belonging to another investigation is ignored.

## Bounded orchestration contract

- The plan preserves the caller-provided required evidence-type order and marks each step `pending` or `covered` from real investigation-scoped evidence.
- Evidence gaps remain explicit: no evidence, missing required evidence type, and insufficient distinct-provider diversity.
- Observed evidence types and provider names are deterministic and de-duplicated.
- Continuation is never recursive or background-triggered. `canContinue` is true only while the investigation is active, meaningful gaps remain, and the fixed explicit-run budget remains.
- `DEEP_RESEARCH_MAX_ITERATIONS` is fixed at 3 for this bounded slice. The projection does not itself increment or persist a counter; existing explicit investigation-run authority remains responsible for run execution/accounting.
- Continuation fails closed for inactive investigations, exhausted budget, no plan, or sufficient evidence.

## Donor disposition

### OpenClaw

Canonical LiOS provenance records `openclaw/openclaw` at release `v2026.9.7`, commit `c074824a27c96d3983043f9eeb33823cd1772d8c`, MIT (`third_party/upstream-lock.json`). SI-03.08 **ADAPTS THE PATTERN ONLY**: bounded plan/iteration-control semantics. No OpenClaw runtime, agent loop, research store, browser, or scheduler is imported.

### Goldmine research-planning references

The SI-03.08 task declaration references Goldmine `research_planning` / `iterative_research` as a planning/iteration benchmark. No canonical pinned Goldmine donor entry or exact source pin is present in the checked-in `third_party` provenance registries on the implementation baseline, so SI-03.08 makes **NO GOLDMINE CODE-IMPORT OR PINNED-DONOR CLAIM**. The implementation uses the canonical LiOS research authority and the task's bounded planning/iteration pattern only. Any future Goldmine code reuse requires an exact verified pin, license/path provenance, collision review, and its own acceptance evidence before import.

## Regression evidence

`server/researchService.test.ts` covers deterministic planning, investigation scoping, evidence-gap closure, source diversity, sufficient-evidence stopping, inactive stopping, and budget exhaustion. The regression is permanently registered in `npm run test:p7`.
