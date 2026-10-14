# Active P6 — Project Graph, Decision Memory & Continuous Intelligence

## Purpose

“Active P6” names the continuation layer of the historical seven-phase LiOS program, not a current strategic phase or replacement for the stable finance-engine P6 task family. It composes existing P7 Project Intelligence, P4 Decision Artifacts and P9 Continuous Intelligence so LiOS can continue professional work across days and sessions. The [SI execution plan](../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md) now governs execution; this composition supports SI-03/SI-04/SI-06 without introducing another authority or implying those capabilities are fully validated.

The governing product flow is:

```text
Project evidence + chats + resources + sessions + Artifacts
  → Reactive Project Intelligence graph
  → versioned Decision Artifacts
  → saved workflows / monitors / run receipts
  → deterministic What Changed
  → Project Continuity snapshot
  → Continue Work queue
```

## State ownership

P6 deliberately introduces **no second database, graph store, scheduler or decision engine**.

- Project context/history remains owned by the existing Project, Session, Ledger and P7 Project Intelligence stores.
- Durable professional work remains owned by P4 Artifact/version/reference contracts.
- Project decision memory is the existing versioned `DecisionArtifact`; selected alternatives, assumptions, implementation steps and monitoring conditions remain inspectable Artifact state.
- Continuous intelligence remains owned by the existing P9 workflow/run/notification tables, scheduler and event bus.
- P6 adds a deterministic composition/read model over those authorities.

## Canonical implementation

- `shared/p6ContinuityContracts.ts` defines the versioned continuity graph, Decision Memory, automation summary, change summary and continuation queue.
- `server/p6ProjectContinuity.ts` composes Project Intelligence + Decision Artifacts + P9 workflows/runs + Project dependency counts.
- `server/p6ContinuityRoutes.ts` exposes authenticated Project-scoped GET and explicit refresh endpoints.
- `client/src/components/terminal/ProjectContinuityPanel.tsx` exposes a compact **Continue work** and **Decision memory** surface before deeper intelligence/automation panels.
- `conversationRuntime.ts` registers `lios.project.continuity`; explicit requests such as “resume this Project”, “Project continuity” and “decision memory” route through the same authenticated deterministic composition instead of an AI-only recollection path.
- Refresh rebuilds the canonical Project Intelligence index. It does not silently execute saved automations.
- The continuity fingerprint excludes request time and changes only when composed professional state changes.

## Deterministic continuation rules

The historical Active P6 queue is deliberately inspectable. It can surface:

- retained Project sources that changed between the latest immutable snapshots;
- Decision Artifacts with explicit next actions but no selected alternative;
- selected decisions with monitoring conditions but no linked monitor;
- enabled workflows with recorded failures;
- explicit Project Intelligence open questions, risks and stale-evidence signals.

These items are derived from typed state. AI may later explain or help act on them, but it cannot relabel an inferred suggestion as a deterministic P6 continuation fact.

## Security / privacy / tenancy

- All API access is authenticated and Project-scoped.
- P6 reuses tenant filters in Artifact, Project Intelligence and automation stores.
- Credentials, claim tokens, event cursors and notification internals are not projected into the continuity response.
- Source/dependency references are references only; no raw secrets are copied into the continuity graph.
- Missing evidence stays missing.

## Acceptance

The historical Active P6 subsystem acceptance requires:

1. one Project Continuity response combines context graph, Decision Memory, automations and What Changed;
2. Decision Memory comes from versioned Project Decision Artifacts;
3. continuation items are deterministic and reproducible from stored state;
4. existing P7/P9 authorities remain the persistence/runtime owners;
5. Project UI exposes Continue Work without requiring a separate module;
6. Project chat can invoke the same continuity state through a governed safe-auto deterministic tool;
7. active P6 tests and acceptance run alongside the historical finance-engine P6 evidence.

P7 Research/Project Intelligence and P9 Automation remain canonical subsystem contracts consumed by this continuity composition, not separate strategic phase choices. P9 direct-runtime/canonical-run convergence and GM-11 rerun authority remain bounded gaps; composing stored summaries does not close them.

Relevant SP-03/SP-04/SP-06 acceptance follows the [Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md): real bounded MSJs, applicable target execution, no fake success, protected accepted behavior and exact evidence records. A continuity response or historical subsystem acceptance does not infer Shipping Point acceptance.
