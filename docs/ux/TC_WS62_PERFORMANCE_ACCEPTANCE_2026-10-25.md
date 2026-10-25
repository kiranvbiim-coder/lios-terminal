# TC/UX WS-62 — Rendering and interaction performance acceptance

**Status:** implementation in stacked draft PR; **source constraints are not installed-user proof**. Canonical scope: 65-WS adaptive experience plan #119, WS-62 (P1). Parent WS-61 draft #199. Project Chat, Quick Chat and Temporary Chat remain distinct. No new renderer, source system, chart projection, table API or result inference.

## Original-source audit and implemented performance budgets

| Surface | Existing owner and baseline behavior | WS-62 decision | Verification |
|---|---|---|---|
| Chat history | `ProjectExperienceShell` rendered every persisted message, including all ChatMarkdown and Artifact cards, on every streamed text update; accumulated text events could retain every full-answer snapshot | Render latest **80** messages initially. Person-initiated Show earlier reveals **80** each time, retaining the original data and message identities. Preserve vertical scroll anchor when prepending. Keep user, assistant, attachments and Artifact cards intact | `conversationRenderBudget.test.ts`, `ws62_rendering_budget.test.mjs`, keyboard and 10k-message screenshot/trace |
| Streaming | `conversation.event` text is a **cumulative snapshot**, not a token/delta; all screenshots were stored in the UI trace, multiplying memory by token count | Record every event for existing telemetry; only the latest text snapshot *per request* is retained in the presentation trace and text paint is coalesced to at most **one per animation frame**. Flush before any nontext evidence (error, trust, approval, done, saved Artifact) and do not discard nontext receipts | 1k-5k snapshot tests, render probe, terminal/error and same-run reconnect traces |
| Search | `WorkSearchDialog` already debounces 140 ms, aborts stale requests, caps response at **30** results and supports keyboard selection | Retain the canonical API and interaction; guard its 30-result/abort contract, rather than duplicating search or introducing stale local indexing | `ws62_rendering_budget.test.mjs`, key/aborted-fetch manual test |
| Chart | Original P4 chart projection already validates up to 100k exact points/series, renders an exact **250-x-position** viewport, uses no point sampling and lazily loads ECharts | Preserve exact source domain and coordinate provenance; do not replace it with thumbnails/aggregates. Probe preparation and bounded rendering | Existing `artifactChartProjection.test.ts` and `ws62_render_probe.bench.mjs` |
| Tables | Original P4 `ArtifactPane` already renders **100** rows/page, uses server-offset paging on Data Artifacts and retains the displayed page on failed loads | Preserve authoritative data paging, no eager 100k-row DOM insertion; guard limits | `ws62_rendering_budget.test.mjs`; keyboard and API 100k-row manual trace |

## Reproducible source probe (not native benchmarks)

From `src/` on each target machine:

```sh
node --import tsx --test client/src/lib/conversationRenderBudget.test.ts
node --test script/ws62_rendering_budget.test.mjs
node --import tsx script/ws62_render_probe.bench.mjs
npm run check
npm run test:offline
```

Save the exact **branch SHA, Node/runtime, CPU, RAM, OS, probe JSON, command and date** for each run. Probe reports elapsed wall-clock milliseconds and approximate process heap change for selecting a tail of 10k messages, refreshing 1k times, retaining 1k cumulative stream snapshots, preparing 100k exact chart points, and taking a 100-row table slice from 100k rows. It is an environment-relative regression aid, **not** React commit duration, GPU latency, Electron heap, memory leak proof, cold-start trace or native acceptance. Existing CI may take substantially longer than one isolated probe.

## Actual browser/native matrix and proposed acceptance thresholds

Execute on both **macOS and Windows installed Electron packages**, clean (cold) and warmed workspaces, hardware model/CPU/RAM recorded. Repeat in Chrome/web where supported. Test the following with **device pixel ratio and zoom recorded**: 320, 375, 390, 768, 1280, 1440 px usable content widths; **200% zoom**; low-power 4-core/8GB target; one normal laptop and one high-density laptop. Use production builds, not React development profiles.

Record and attach all raw trace/recordings:
1. Initial launch / open empty Quick Chat; cold and warm **first useful content**, JS main-thread long tasks and renderer RSS/private working set.
2. **10,000 recorded Chat messages** from a verified owned dataset. Initial DOM bubble count <=80. Sequential Show earlier confirms exact chronological content and fully accessible user/assistant/Artifact/attachment controls; mouse wheel, PageUp and keyboard focus maintain scroll anchor; no forced jump-to-bottom. Work Search must still find older messages by canonical server search.
3. Stream **1,000 cumulative text events** over the same run with source, approval, error and done evidence interleaved. Verify max **one presentation update per animation frame** and all nontext events plus final text intact. Capture React Profiler commits, long tasks, dropped frame rate, memory peak, and after-idle heap.
4. Search 30 results using fast typing and deliberate cancellation, stale/denied requests, Arrow keys/Enter and result open; measure input-to-paint latency.
5. Chart Artifact with **100,000 exact canonical points** and multiple series, first/last 250-x window, keyboard point inspector; compare exact X/Y, source-index, gaps and full Y domain with canonical projection. Capture preparation blocking time and plot window latency.
6. Data/Spreadsheet with **100,000 canonical rows**: page 0, middle page, last page, keyboard focus, failed page fetch and revision edit/save. Check no full-table DOM mount or loss of pending edits. For spreadsheet, observe existing Univer lazy-load separately.
7. Return from Artifact focus to Chat, switch Quick/Project/Temporary, offline/reconnect and rerun, OS scale changes and 200% zoom. Verify source/permission disclosures remain accessible and no cross-project or temporary history retention.

**Proposed gate only (must be validated on agreed representative hardware, not asserted by this PR):** Chat initial render of 10k records <=2 seconds at P95, keyboard and type-to-paint <=100ms P95 when idle, sustained streaming <=1 long task >50ms per 5-second interval, navigation to next chart/table page <=500ms P95 after data is ready, no unbounded retained cumulative snapshots and no monotonic heap growth across five repeat open/close cycles after GC. Collect minimum five reproducible samples per device and record outliers; an unmet gate blocks WS-62 acceptance. True native budgets may need amendment from observed baselines before final signoff.

## Remaining evidence, release gates and nonclaims

No actual cold/warm DevTools or native traces, hardware measurements, memory leak evidence, performance signoff or P14 installed release qualification were available at authoring. Structural tests are **not** proof of FPS, latency or crash resilience; native testing and A11y remain mandatory. Chart/document sources, permissions, exact P4 Artifact IDs/versions and data APIs are untouched. No new external donor/fork adoption, credentials, model or architecture. PR must remain **draft** until exact-head CI across Linux/macOS/Windows and manual matrix both pass.
