# P9 — Automation & Continuous Intelligence

Supporting technical specification. The [SI execution plan](../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md) governs strategic execution; [LIOS_EXECUTION_ROADMAP.md](../LIOS_EXECUTION_ROADMAP.md) retains canonical task and historical evidence detail. P9 supports SI-06 through singular GM runtime/execution authority; S0–S10 are validation journeys only.

## Goal

Turn a one-time Project analysis into continuous, inspectable intelligence without creating a second scheduler, secret store, chat runtime, Artifact model or notification system.

The P9 product loop is:

> analyze → Save Workflow → run manually / on schedule / on supported event → compare fresh output → apply relevance policy → notify only when configured → inspect run/evidence history.

P9 reuses the canonical LiOS Project, Conversation Runtime, Artifact OS, P3 Ledger, P5 provider/data contracts and existing restart-safe server lifecycle.

## Product rules

1. **Project-scoped by default.** Workflows, runs and notifications carry Project, owner and organization scope.
2. **No credentials in workflow definitions.** Saved definitions contain only LiOS references, transmission policy and existing approval grants; credential-shaped fields are rejected.
3. **Permission does not silently expand.** A saved conversation preserves its execution mode, approvals and AI transmission policy. Every AI-requiring rerun also re-checks the user’s current Master AI switch; if Master AI is off/unavailable or a fresh high-impact approval is required, the background run fails closed instead of auto-approving. Preserved grants and these checks are not full current GM-11 exact-operation, revocation, credential, sandbox and trust-receipt revalidation; that convergence must be proven before privileged reruns or interactive `exec.*` exposure.
4. **Durable definitions and history.** Workflow definitions, run receipts and notifications persist in Postgres/PGlite. The scheduler is only a wake-up loop; state does not disappear on restart.
5. **Idempotent events.** Event runs use a durable workflow+event dedupe key.
6. **Low-noise notifications.** Relevance threshold, configured reasons, unchanged suppression and cooldown are applied before delivery.
7. **In-app delivery first.** P9 does not create an email/SMS/Slack credential or routing subsystem. Other channels can be adapters later.
8. **Simple UX first.** Save Workflow / Run Now / pause / inspect history is canonical. React Flow remains deferred until this path is proven.
9. **No opaque automation.** Runs retain source, engine, Artifact and execution-receipt references and also write P3 Ledger execution events.

## Canonical contracts

### Workflow definition

`shared/p9AutomationContracts.ts`

A workflow contains:

- name / description / canonical template;
- trigger: manual, bounded schedule, or supported event;
- action: saved governed conversation, Project What Changed, Thesis refresh, or provider health;
- explicit notification policy;
- source refs;
- engine refs;
- Artifact refs;
- enabled state.

Canonical templates:

- filing monitor;
- earnings monitor;
- Thesis refresh;
- valuation refresh;
- portfolio monitor;
- provider health;
- report refresh.

Valuation / portfolio / report / filing / earnings templates reuse a saved governed Conversation Runtime request. Thesis and provider-health templates bind to their deterministic native executors.

### Trigger contract

Supported trigger types:

- `manual`;
- `schedule.interval` — 5 minutes through 7 days;
- `schedule.daily_utc`;
- `event`.

Declared event types (provider/bridge readiness is separate):

- filing;
- earnings;
- data refresh;
- price threshold;
- risk threshold;
- provider health.

Event envelopes can carry Project, owner and organization scope. Private risk/provider events therefore cannot wake a different tenant's workflow.

### Durable persistence

Migration `0071_lios_p9_automation_continuous_intelligence.sql` adds:

- `project_automation_workflows`;
- `project_automation_runs`;
- `project_automation_notifications`.

All three tables are owner/org scoped and RLS protected.

Event runs have a unique `(workflow_id, dedupe_key)` constraint.

### Scheduler

`server/p9AutomationService.ts` starts a bounded scheduler from the normal server lifecycle.

The runtime:

1. scans due enabled workflows;
2. atomically leases a due workflow;
3. reconstructs its tenant and request identity;
4. executes through a LiOS-owned executor;
5. stores run history;
6. advances `nextRunAt`;
7. evaluates notification policy;
8. persists delivered or suppressed notification receipts.

A process restart does not lose the workflow. A due workflow whose lease expires becomes claimable again. While a scheduled run is legitimately active, P9 renews its short lease every minute so long-running analysis cannot be reclaimed by another scheduler instance.

### Event bus

`emitP9AutomationEvent()` is the canonical event hook.

Existing P9 integrations include:

- SEC filing observer → `filing`. Each filing workflow persists its latest matching accession in `eventCursor`; first observation establishes a baseline and only a changed accession emits an event. The observer runs every five minutes while LiOS is running and survives restart through the durable cursor.
- Data Spine changed snapshot → `data_refresh`;
- price alert trigger → `price_threshold`;
- Decision Monitor breach → `risk_threshold`;
- source-connection health test → `provider_health`.

The current earnings calendar explicitly has no verified provider and returns no fabricated events. P9 therefore exposes `publishP9EarningsObserved()` as the canonical adapter seam and reports earnings readiness as `waiting_for_verified_provider`. Once a verified provider observes a real earnings event, it publishes through this seam; no parallel scheduler is created.

Event contracts/templates are not evidence of every live provider. The scheduler and filing observer require a running LiOS process; durable cursors/leases do not prove always-on user Home, remote-node/mobile delivery or execution while the app is stopped. Normal operation assumes user-owned infrastructure, never a LiOS-operated customer runtime cloud.

## Execution adapters

### Saved conversation rerun

A saved request preserves:

- message;
- execution mode;
- approval grants;
- AI transmission policy;
- active Project/object context.

The runtime reconstructs:

- Project;
- chat;
- Project resources;
- recent chat history;
- configured provider/model context.

The documented current adapter calls `executeConversationRuntime()` directly and records runtime events through the existing P3 Conversation Ledger recorder. This is not equivalent to entering the canonical conversation-run lifecycle/journal; the P9 bypass is tracked in issue #211. Durable P9 run rows and P3 events do not establish canonical run streaming/cancellation/reconnect/recovery parity. Convergence must reuse the existing run/journal authority, not introduce a second runtime.

If execution reaches a fresh approval boundary, the background run fails closed with an explicit approval-required error.

Temporary chat's intentional lack of a durable conversation journal is a privacy contract, not a blanket run-parity defect. P9 is a durable Project workflow; its direct runtime bypass must be evaluated separately from Temporary's deliberate non-retention.

### Project What Changed

Rebuild Project Intelligence and compare the latest immutable snapshots. Notification relevance is based on actual added/changed/removed indexed sources.

### Thesis refresh

Refresh a Thesis against current Project evidence and contradiction signals. A new Thesis Artifact version is created only for a material state/contradiction change; no-op scheduled refreshes do not churn Artifact versions.

### Provider health

Combine credential-safe built-in provider capability status with user-owned source-connection health. Raw credentials/config secrets never enter the workflow run output.

## Notification policy

P9 supports:

- enabled/disabled;
- in-app channel;
- notify reasons: failure, condition met, change detected, success;
- minimum relevance score;
- cooldown;
- suppress unchanged.

A notification receipt is persisted even when suppressed, so the user can inspect why LiOS did not interrupt them.

## User experience

### Project Home

`ProjectAutomationPanel` shows:

- active/paused workflows;
- template and trigger;
- next run;
- latest run state;
- Run Now;
- pause/resume;
- delete;
- unread material in-app notifications;
- quick Project What Changed and provider-health workflows.

### Project chat

After a real Project-chat analysis, **Save Workflow** captures the governed request and lets the user choose:

- template;
- manual / schedule / event trigger;
- event filter;
- notification relevance threshold;
- cooldown.

The UI explicitly says unchanged runs are suppressed and that advanced visual workflow editing is deferred.

## Task mapping

| ID | Implementation |
| --- | --- |
| LIOS-P9-01 | Shared workflow/trigger/action/notification contracts; durable workflow/run/notification tables; restart-safe scheduler lifecycle. |
| LIOS-P9-02 | Project-chat Save Workflow endpoint/dialog plus Run Now/manual, schedule and event triggers. |
| LIOS-P9-03 | Filing/earnings event templates, Thesis refresh, valuation refresh, portfolio monitor and provider-health workflows. |
| LIOS-P9-04 | Explicit Project-scoped in-app notification policy; no credential-bearing external routing. |
| LIOS-P9-05 | Simple Save Workflow UX implemented first; React Flow explicitly deferred. |
| LIOS-P9-06 | Canonical event bus declares filing, earnings, data refresh, price threshold, risk threshold and provider health; existing data/risk/price/provider bridges are documented, filing observation requires the running app, and earnings awaits a verified provider. |
| LIOS-P9-07 | Canonical templates for Thesis, valuation, portfolio, provider health and report refresh. |
| LIOS-P9-08 | Definitions/runs retain source/engine/Artifact refs and saved conversation reruns record P3 receipt refs; this does not close issue #211 canonical run/journal convergence. |
| LIOS-P9-09 | Relevance threshold, unchanged suppression, configured reasons and cooldown prevent noisy automation. |

## Acceptance gate

P9 is complete only when:

- P8 remains centrally registered and its acceptance gate remains green;
- migration 0071 remains correctly journaled/applied in the migration chain; its historical introduction does not require it to remain the latest migration;
- Project workflows are tenant scoped and credential safe;
- schedule calculation is deterministic and bounded;
- event delivery is tenant-aware and idempotent;
- saved conversations preserve permission/transmission policy and revalidate current exact-operation authority/credentials through GM-11 rather than treating saved grants as perpetual authorization;
- AI-requiring reruns re-check the current Master AI state and fail closed when it is off/unavailable;
- high-impact background execution fails closed on missing approval;
- Project What Changed, Thesis refresh and provider health use canonical existing engines;
- canonical filing/earnings/valuation/portfolio/report templates converge on the canonical Conversation Runtime run/journal path; issue #211 direct-runtime bypass is resolved with appropriate lifecycle evidence;
- P3 Ledger receives workflow execution/reproducibility evidence;
- notifications obey explicit Project scope, relevance, unchanged suppression and cooldown;
- Save Workflow, Run Now, pause/resume, run history and notification UX are wired;
- advanced React Flow is still deferred;
- P9-01 through P9-09 are represented exactly once in the canonical roadmap;
- TypeScript, server/client suites, trust/security, P1→P9 acceptance, tenancy, production build and release preflight pass.

SP-06 acceptance additionally follows the [Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md): a real one-shot → saved task → actual trigger → current permission/credential/freshness recheck → useful result/notification → supported restart/topology continuity MSJ. All five gates (real journey, applicable target execution, no fake success, regression protection, exact evidence) apply; templates, durable rows or historical subsystem gates do not infer an accepted SP-06.

## Boundary to P10

P9 owns continuous intelligence behavior. P10 retains packaging/performance/accessibility, runtime-pack, observability and OSS-hardening tasks under the SI program; P14 remains final release authority. Neither may replace P9 workflow state or GM execution authority with a separate scheduler/runtime.
