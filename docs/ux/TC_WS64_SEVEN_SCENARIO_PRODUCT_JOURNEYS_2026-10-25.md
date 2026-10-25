# WS-64 — Seven end-to-end product scenario acceptance

**Owner:** TC/UX WS-64 (P0), canonical 65-workstream plan PR #119. **Stack:** WS-63 PR #202 → this PR. **Status:** source integration candidate; **zero installed scenarios accepted** as of authoring. Next WS-65 handles target-device proof. This file does not declare the product ready.

## What the existing repo already proves (avoid duplicates)

- `evals/golden/journeys.json`, `evals/journeys.ts`, `server/goldenJourneys.test.ts`: 5 fixture-based Conversation Runtime journeys, including research, explicit missing valuation assumptions, unselected private source, and an honest attachment request. Actual Runtime, planner, receipts, Artifact candidates and trust record run; network-facing tools are fixed labelled fixtures, **not live providers**.
- `server/flagshipArtifactPersistence.test.ts`: offline real DB lifecycle verifies Project/Chat, keep P4 Artifact, reviewed revision, exact export plan and reopen after closeDb/initDb, including tenant ownership. It is included as an independent real store check in the WS-64 command.
- `client/src/lib/gateway/conversationRun.test.ts`: controlled fake-WebSocket transport tests same-run reconnect, Home restart, no queued new non-idempotent request and truthful failed/unknown outcomes.
- `client/src/lib/terminalWorkspace.test.ts` and `shared/artifactExportRights.test.ts`: allowlisted public URL and explicit denied/revoked source safeguards, with tests of forged incoming links.
- WS-59/60/61/62/63 already cover responsive panels, quiet material limitations, offline draft retention, render budget and source-rights UX. This workstream does NOT add another Chat, Artifact store, data provider, search, or automation engine.

## Seven scenarios and acceptance status

| Scenario | Real user task | Source tests | Installed/live gate (not yet proven) |
|---|---|---|---|
| WS64-01: flagship | Compare Apple, Microsoft and Alphabet, inspect source/value/assumptions, review WACC=9%, keep P4 Artifact and return to saved Chat | JR01+JR02 actual Runtime with **single-entity labelled fixtures**; source receipts, conflicts, and no invented valuation | Real three-company live rights/denied paths, governed WACC revision/receipts, return/restart, optional P9 monitor after explicit consent |
| WS64-02: non-finance | Create useful general writing/work without mandatory connectors or finance context | First-use contract and Quick starter; JR05 real Runtime with simulated authorized AI response | Real general assistant, user controls/keyboard, auth, no forced provider |
| WS64-03: connected | Authorized connection, observed market/financial facts with freshness and conflicting evidence | JR01 instrument-master/market-data/company-intelligence fixture receipts/trust | Real configured connector with entitlement and explicit conflicts/lag/cost |
| WS64-04: file | Ask to analyze owned document before attaching it | JR04/JR05 prevent arbitrary finance tools; demand actual file selection | Upload true owned file, check source citations, partial/unavailable, delete/revoke |
| WS64-05: denied | Revoked external source, cross-tenant Artifacts, unsafe share/export | Shared rights classifier + conservative P3 UI, same-owner match and exact public share projection | Two accounts, dynamic connector rights revocation, recipient sharing, server 403/404 |
| WS64-06: restart | Save, edit, reopen exact Artifact ID/revision in saved Chat | Governed replay dependencies + separately executed **actual DB flagshipArtifactPersistence** test | Real installed macOS/Windows restart, attachment/dirty-state recovery and exact revision continuity |
| WS64-07: disconnected | Drop Home network mid-stream, preserve pending input/files, distinguish Temporary Chat | WS-61 fake Gateway, conversation readiness and scope, latest cumulative text only | Real network drop, same-run resume evidence, no duplicate work or Temporary retention |

## Run the executable source gate

From `src/`:

```sh
npm run test:ws64
```

The script executes `server/ws64SevenProductScenarios.test.ts` (seven scoped tests plus false-acceptance negative control), the **actual offline DB** Artifact reopen suite, fake WebSocket resume/recovery suite, public URL and rights-denial suites. On success it outputs a seven-row JSON report with `sourceSuiteCompleted:true`, `installedEvidence:NOT_PROVIDED`, `acceptedScenarioCount:0` and every missing installed gate. The report never claims it tested a live provider, package or native desktop.

Run the full protection checks before PR acceptance:

```sh
npm run check
npm run test:offline
npm run test:ws64
npm run build
```

## Required complete flagship proof (real user, no simulated acceptance)

1. Start from signed-in clean macOS/Windows Electron build and ask the exact Apple/Microsoft/Alphabet question. Record the raw input, source rights, provider status, assistant outputs, completion ID and elapsed time.
2. Read-only Comparison Lens must show attributed, as-of observations for each entity; missing source, entitlement gap or material conflict must remain visible with P3. Do not substitute a generic report or fixture for a three-company comparison.
3. Inspect source prism details for provider/field/value/units/as-of classification, entitlement and disagreement. Verify exact P4 content and provenance; record not only screenshot but immutable Artifact ID/version/content hash.
4. Change WACC to 9% only through the existing governed P4/P11 reviewed deterministic action; capture inputs, approval, calculation receipt, old/new versions and observed diff; do not simulate an engine output.
5. Return to original Chat; reopen exact Artifact in Workbench and after full client/Home restart, confirm same Project/Chat/reference/version/receipts and no other user/tenant exposure.
6. Ask to monitor work: user must deliberately approve a P9 task and receive a durable audited schedule/receipt, or the UI must correctly say the capability is unavailable. No automatic agent or task is created.

## Release evidence rules

- Each scenario requires (a) the declared source check on exact PR SHA, (b) every `requiredManual` gate in `evals/ws64ScenarioMatrix.ts` independently recorded, and (c) the authorized domain/UX owner signoff. The source test deliberately asserts source-only evidence cannot mark accepted.
- Use the existing `shared/flagshipReleaseEvidence.ts` and P14 installed native acceptance framework for final packaged build/device receipts; WS-64 must not invent another release authority. Preserve screenshots, screenreader transcripts, raw traces, OS/CPU/RAM, viewport/zoom, account setup, fixture/live status, provider/source rights, hash, build SHA, log links, and reviewer.
- Test both expected success and blocked outcomes: disconnected Home, unconfigured/expired rights, denied other tenant, missing file, invalid input, cancelled tool, interrupted session, and native relaunch. Do not treat "no exception" or HTTP 200 without exact receipt as user success.
- WS-64 **cannot** be accepted on repository tests alone. Existing `JR01` Apple fixture is not three live sources or WACC computation. Any failed scenario is reported as a gap and tracked in the PR; do not mark it passed using source-only snapshots.

## Blockers / handoff to WS-65

- Exact-head CI across Linux, Windows and macOS and successful `npm run test:ws64` are required.
- Installed-device testing needs approved real data and BYOAI configuration, screenshot/trace capture, native accessibility and two-account isolation, then actual artifact/revision/approval evidence.
- Link per-scenario release evidence to existing packaged P14 flagship and UX owner checklists. Keep upstream PRs #193 through #202 reconciled on protected main; no stacked draft is automatically accepted.
