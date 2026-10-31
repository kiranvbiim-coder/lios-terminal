# WS-39 — Source-aware chart context and exact keyboard comparison

**Date:** 2026-10-24. **Owner:** canonical P4/Chat [PR #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98), [TC/UX plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), tracking issue #91. **WS-39:** P0 source-backed charts and comparisons.

## Code audit: retain existing investments

- The actual P4 `ArtifactChart` already delegates all chart rendering to `prepareArtifactChart` / `selectArtifactChartViewport` and real recorded series. Recharts and optional ECharts consume the **same data projection**. The projection rejects unsupported chart types, duplicate X within one series, non-finite values, excessive counts and invalid viewport offsets. It preserves zero and negative numbers, exact original point indices, full-source shared Y scaling and **null gaps**, not assumed zeros.
- The existing `Exact chart point inspector` is keyboard operable but exposes just one selected X and one series at a time. There was no keyboard-readable **side-by-side comparison table** spanning **all** saved series and the full data window, including those hidden in the plot.
- The P4 chart schema records `series[]` with X/Y and arbitrary `options`; **axis units, time period, sourceRefs and external source rights are not required**. Charts cannot infer currencies, percentages, fiscal periods or source freshness from numeric X or Y values. The domain may be financial or non-financial.

## WS-39 implementation

1. `artifactChartContext.ts`: small pure, bounded projection of **explicit saved** chart options: `xAxisLabel`, `yAxisLabel`, `xUnit`, `yUnit`, `periodLabel`, and (only in a derived chart without P4 version context) `sourceRefs`. The normal canonical ArtifactPane now passes the **actual access-checked `data.version.sourceRefs`** to the chart; these exact P4 version refs take precedence, including when the version records no sources, over advisory chart option refs. An exact count is retained for a large saved inventory; the on-screen disclosure limits itself to the first **100** unique references and says so instead of falsely declaring all sources absent. Missing or malformed fields show **unknown/not recorded**, never guessed units, implied periods, fake citations or live provider rights. SourceRef strings remain recorded assertions, not verified freshness, identity or entitlement. Numeric -0 and full JS roundtrip precision are retained.
2. Existing `ArtifactChart.tsx`: adds a visible, structured **Recorded chart units, period and source context** surface, source availability caveat and an optional disclosure listing each recorded source reference. No network calls, no imported source links or unverifiable badges. Chart types, raw observations, shared axis domain, saved-version flow, and original point inspector remain unchanged.
3. New `ArtifactChartRecordedTable.tsx` is a *read-only* accessible alternative: **all series**, including those hidden in plot-only filters, exact original recorded Y values, each row's original X, distinct "Not recorded (gap)" cells, source-point ordinals for screen readers, sticky table headers, `scope=row/col`, caption and an independently paged **40-X-position** table. It is derived directly from the existing P4 projection; no second plot engine, data interpolation, zero filling, currency conversion, aggregation or source mutation.
4. A **plot-only error boundary** keeps the exact comparison table and keyboard point inspector visible even if ECharts or Recharts drawing fails. Rendering failure is labelled explicitly; no false saved-work status or recomputed values.
4. New `artifactChartContext.test.ts` asserts unknowns vs explicit options, unverified source caveats, full-precision values, a three-position sparse two-series rendered table, per-cell gaps/source-point ordinals, all-series visibility, independently paged 101-position dataset and keyboard/source-guard code paths.

## Validation from `src/`

```sh
node --import tsx --test client/src/lib/artifactChartContext.test.ts client/src/lib/artifactChartProjection.test.ts client/src/lib/artifactEChartsOption.test.ts client/src/components/terminal/ArtifactReadableViews.test.ts
npm run check
npm run test:p4
npm run test:ux
npm run validate:visual-environments
```

**Not yet qualified until observed:** exact-head cross-platform hosted CI, signed-in exact P4 revision/owner isolation, source rights and revoked access negative cases, 200% zoom, narrow-layout keyboard/screen reader traversal for 100 series, long table scrolling, chart-legend hiding vs independent comparison, real ECharts + Recharts mounted browser acceptance, user accessibility tests, independent review and P14/SP release approval.

**Boundaries:** `options` fields are descriptive saved Chart Artifact metadata, not an independently validated financial data source, signed provenance chain, exchange-rate engine or entitlement oracle. The table is an alternative display of the **same** saved P4 observations. Chart comparison remains limited to the existing P4 series; no extra synthetic data, backfills or unknown-to-zero substitution is allowed.

**Merge plan:** Parent #98 first. Rebase this WS-39 child onto it, reconcile sibling #163 (WS-34), #167 (WS-35), #171 (WS-36), #172 (WS-37), #173 (WS-38), and existing valuation plot/research report stacks without overwriting their original ownership.
