# LiOS Website Assimilation C1 — Governed Visual Answers in Chat

**27 October 2026** · [Website gap tracker #258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258) · C1 stacked on B3 #281 → B2 #277 → B1 #274 → A4 #270 → A3 #266 → A2 #263 → A1 #261 → cumulative #253.

## Implemented source journey

Universal AI can already emit a **persisted Artifact event** into the current conversation, and LiOS P4 already saves versioned **chart/table** content and provides an authenticated `GET /api/artifacts/:artifactId?version=N`. Previously the event could be inspected in Show Work and opened in the canonical P4 side panel, but a Chat response lacked an explicit read-only visual answer with a user-controlled permission check.

C1 now places a compact **Saved chart/table → View visual** control immediately in the conversation trace when an actual persisted runtime Artifact event names `chart` or `table` **and supplies recorded source refs**. It is not offered for unsaved, temporary, arbitrary prose, unsupported type or missing source references. The user must click to inspect. No change to the model runtime plan, message content, source database, existing Chart editor, monetization, portfolio, P9 workflow or Project navigation.

### One server-owned P4 source/value authority, no AI-authored chart points

1. `src/shared/governedVisualAnswer.ts` is a strict request schema with only `artifactId`, immutable positive `version`, `projectId`, `kind=chart|table`, bounded `sourceRefs`. Inline observations, user-provided code, arbitrary URLs, polygon coordinates, SVG/HTML, model-generated ECharts options and any unknown properties are **not accepted**. `visualRequestFromRuntimeArtifact` only converts the existing validated runtime saved-Artifact event.
2. On opt-in, `GovernedVisualAnswer` fetches the **exact server-permissioned saved P4 Artifact** using `credentials:"same-origin"`, `cache:"no-store"`, AbortController on cancellation/revision switch. HTTP denial, missing version, changed Project/kind/status, mismatched Artifact IDs, source IDs absent from the persisted version and invalid P4 content **fail closed**. A signature of version/scope/sources prevents a formerly validated visual from being shown under changed event references.
3. P4's canonical chart/table schema validates the returned **server's** recorded values. Charts allow only line/area/bar/scatter, at most 12 series and 5,000 exact data points (the full Artifact page continues to handle larger datasets); nonfinite values are rejected. The existing read-only `ArtifactChart` renders them, with exact saved `artifactSourceRefs`, chart table and inspector. Tables show the first 40 rows and 12 columns, preserve null-as-not-recorded, disclose truncation and point to the existing saved Artifact for full content. The UI never silently aggregates, interpolates or converts source observations.
4. Saved **P3 trust manifests**, when present, add a restrictive check: evidence source IDs must be in the manifest; explicitly denied/restricted/expired or entitlement-required observations block visual rendering. A historical trust manifest does **not** itself grant current provider entitlement; no independent live source-rights rediscovery is claimed. P4's authenticated GET remains the authorization boundary. Rendering doesn't export/redistribute protected source data, launch a tool, download assets, purchase credits or create new records.
5. The visual is collapsed by default and explicitly labeled **recorded, not independently verified**. It shows safe errors for unavailable/revoked P4 access; the ordinary saved Artifact remains available through its original Chat/Workbench flow.

### Existing owner and non-overlap

- `ConversationRuntimeTrace.tsx` remains the one Chat runtime event owner; C1 adds a gated `GovernedVisualAnswer` under the same validated saved event. No second Chat surface or client data source.
- `ArtifactChart` remains the canonical chart/point inspection adapter, using shipped Recharts/ECharts. No Plotly, D3, new UI kit or lockfile change.
- `src/shared/artifactContracts.ts` remains the sole chart/table schema; `useArtifacts.ts` and existing server `/api/artifacts/:id` stay the authority. No second stored visual payload.
- P7 geographic and relationship graphs remain in the existing Project Investigation owner. **C1 does not claim** a general model-directed dynamic map, SVG rendering, whole-dashboard composition or inline streaming chart synthesis. Those require typed, server-validated source-specific scopes and further product proof. This slice delivers actual saved chart/table visual answers.

### Tests and acceptance

```bash
cd src
npm run test:website-c1
npm run check
npm run test:offline
npm run build
```

Pure tests: exact validated P4 chart and table, no inline model data, resource bounds, source/Project/revision swap denial, invalid numeric observations, trust manifest restrictions, and no fake missing data. SSR tests: closed-by-default visual with no source-data leak or speculative chart. Integration tests: exact runtime persisted event, existing authenticated P4 GET, source refs into chart inspector, and no new writes/providers. Existing **standard public Linux source CI** executes `test:website-c1`.

**Source committed for review, CI and native not yet accepted.** Real Mac ARM64/Windows x64 Electron, 390/768px layout, keyboard/screen reader, 200% zoom, user/account changes, offline/re-auth and chart rendering must be observed. Browser network inspection must confirm preview calls only the existing same-origin Artifact endpoint. The previous stack has outstanding native/UI gates and inherited CI failures that should not be hidden.

## Explicit remaining C1 limitations

A comprehensive AI-directed visual answer would also need a **server-enforced live provider entitlement check** per dynamic source, typed `graph`/`map` response intents bound to authorized P7 data, controlled render choices and full streaming result lifecycle. Those are **not implemented** by this P4 chart/table slice; do not describe them as complete. Existing P7 graph and offline map cover interactive Project views but are not promoted as model-supplied content.

## Next #258 work

**C2**: governed calculation/scenario → exact P11 execution receipt → proposed P4 Artifact with explicit user review. Then **C3** linked evidence consequence analysis, and D integration/release QA. Keep existing P11/P4/P7/P9 source owners, no new decorative dashboards or paid services. $0 additional beta/release expense remains mandatory.
