# FinRobot → LiOS P4: immutable report snapshot integrity

Source: `AI4Finance-Foundation/FinRobot@2717499b8e30f242640af08c4ad9afd1113c2d45`, Apache-2.0. Pinned upstream `LICENSE` blob `6cc0d28c44e482825bba73c84761e3d65f138f42`, `NOTICE` blob `4ad1671f14994630695c91b14ee7cfa14cacb6af`; full copies in `third_party/licenses/`.

## Reused mechanics (adapted, not complete donor app)
- `finrobot_desktop/desktop/src/components/SourcedNumber.tsx`, upstream blob `1117c83dbd8f4a27acd5d84821aeb425687f9d98`: historical data `as_of` differs from provider `fetched_at`; warnings remain visible; missing or non-finite values are unavailable, not zero.
- `finrobot_desktop/desktop/src/pages/artifact-detail/reportData.ts`, blob `7474ca658631d5b846a9fd7e9cc02ccae8341315`: immutable persisted per-report financial snapshot, never silently overridden with present-day price or a fresh query.
- `finrobot_desktop/desktop/src/export/reportExportQueries.ts`, blob `eb98698746810ee54d1772dc8fefe2352e5a165e`: deterministic report export should identify unavailable read models rather than silently hide missing report sections.

Actual LiOS code: `src/server/finrobotReportSnapshot.ts`, native tests `.test.ts`, caller `src/server/artifactReviewPackage.ts`. The **existing P4 ArtifactStore** first authenticates the Project owner and retrieves a requested immutable Artifact version, then confirms its recorded content hash. This helper reports how many narrative blocks carry exact source refs, whether semantic `as_of` and actual acquisition `fetched_at` were recorded, warnings, and receipt counts. A new section in the existing version-bound review package discloses source gaps. No hidden live market data/LLM calls, fresh prices, version rewrites, advice or broker dispatch.

**Not a complete FinRobot import:** The finance agent team, model, database, web UI, report-specific data endpoints and many report chapters are deferred until P5/P11/P4 permissions, original third-party licenses, direct tests, datasets and managed installer rights are individually qualified. This selected subsystem replaces donor artifact identity, snapshots and React presentation with existing P4; retains provenance/vintage/report gap mechanics. SourcedNumber UI mechanics may be incorporated into LiOS product chrome only with accessible UI regression and product design approval; this backend change is read-only.

**Known limitation:** Old LiOS reports may not contain per-block `as_of`, `fetched_at` or `sourceRef`. In that case, the auditor reports a recorded gap; it cannot fabricate provenance or independently verify market sources. These aggregate counts are *not* a signal that a finance claim is accurate, a source license is sufficient, or an Artifact is approved.

**Qualification:** native helper/regression + existing P4 review route end-to-end, TypeScript, installer/export proof and SP-05 packaged owner acceptance still separate. Do not promote the FinRobot upstream Python/desktop runtime to integrated truth based on this read-only adapter.
