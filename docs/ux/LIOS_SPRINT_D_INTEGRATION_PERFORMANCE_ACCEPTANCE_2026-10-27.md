# Sprint D — integrated experience, performance and release acceptance

**Repository:** `kiranvbiim-coder/lios-terminal`  
**Stack parent:** Sprint C draft PR #308, pinned at `cd005d1f405557231db1c55a5f0f4be6f5e18ae1`; Sprint C itself depends on Sprint B #307 and Sprint A #304.  
**Status:** Unmerged and unshipped source candidate. GitHub-hosted CI and signed installed-app qualification are separate gates.

## Actual Sprint D changes

1. **Comparison disclosure is pair-scoped.** The existing A/B slots continue to be the authority. A cross-context warning acknowledgment is now keyed to the complete *ordered* identity/content of the two recorded captures. Changing, swapping or removing either capture revokes the old acknowledgment. Additional-field expansion is likewise pair-scoped. Same view/symbol comparisons remain available without needless acknowledgment. Cross-context differences remain explicitly opt-in, *not* a financial equivalence claim.
2. **Calculation-receipt selection cannot silently fall back.** The receipt diff uses `resolveRecordedReceiptPair`: exact current indices, separate published `id` identities, no clamping when a selected record disappears. Stale indices and same-ID selections produce the existing honest no-comparison state.
3. **Keyboard continuity without new overlay router.** `useManagedOverlayFocus` is attached only to the existing Analytical Studio modal (focus trap + Escape) and Evidence drawer (nonmodal Escape, no Tab trap). Both focus the close button on opening and restore previously focused element on dismissal. No additional global workspace or command owner. Graph Explorer keeps its already-working native focus trap.
4. **Market Canvas data and performance integrity.** Recharts retains its 90-observation bound, but the absent-series fallback is now a stable constant instead of an allocation on every render. 1W/1M/3M internal selections are relabelled **7S/30S/90S**, with explicit accessible names that reflect recorded session counts rather than falsely implying fixed calendar intervals. Index-period changes use finite values, while breadth highs/lows and the McClellan display no longer present invalid values as valid numbers.
5. **Hosted CI failures surfaced and addressed.** Earlier stacked PR runs showed TypeScript TS2657/TS1005 on the evidence drawer nested JSX and stale donor-evidence snapshot hashes. Replaced the nested conditional body with explicit source/receipt states. GitHub blobs were read at exact Sprint D ancestry: `components.json` SHA `0b53cbd60d292e2893fce9b975e3d5f313f2ae39`, `upstream-lock.json` SHA `50ad0d7dcbb88c24ad0ef00a1093ae77653111c0`. Baseline SHA was already correct. Checked 92 baseline entries, 55 component records and 55 lock rows for pin, lineage, registration and status consistency before updating only `sourceSnapshot.componentsSha` and `sourceSnapshot.upstreamPinsSha` in the existing audit ledger. **No donor package import, rights promotion, runtime approval, upstream pin change or source-file modification** was made to pass the gate.
6. **Regression checks.** `sprintDComparisonGuard.test.ts` covers changing and reversing snapshot pairs plus stale/duplicate receipt IDs. `sprintDIntegrationAcceptance.test.ts` uses TypeScript's public `transpileModule` diagnostics on the real four affected TSX views and checks focus, comparison, chart/period and no-animation-owner contracts.

## Validation requirements (not implied by commit)

On **the exact Sprint D PR head**, from `src`:

```sh
npm run check
node --import tsx --test client/src/lib/sprintDComparisonGuard.test.ts client/src/lib/sprintDIntegrationAcceptance.test.ts client/src/lib/sprintCMarketCanvas.test.ts client/src/lib/sprintBComparisonContext.test.ts client/src/lib/sprintBSourceReview.test.ts client/src/lib/graphExplorerPresentation.test.ts
node --test script/validate_universal_donor_adoption.test.mjs
npm run test:offline
npm run test:desktop
npm run build
npm run audit:oss
npm run audit:licenses
npm run release:preflight:ci
```

The actual hosted Linux / Windows / macOS job **conclusions and failing step logs** must be reviewed; a queued, in-progress or partially passing workflow is never reported as passed. Re-run if branch parent advances, and validate the final merge candidate, not a superseded merge ref.

## Installed native user journeys

- A/B capture swap/change while cross-context fields are visible: require a new user action; two captures with same issuer/view remain scoped. Removing a selected receipt cannot silently compare two copies of the same receipt.
- Open/close Analytical Studio by mouse, Tab, Shift+Tab and Escape; focus goes to the Close control and returns to triggering object. Evidence drawer is nonmodal: Tab may return to the workbench, Escape works while focus remains in drawer, close button restores focus.
- Market Canvas latest 7/30/90 recorded sessions; native data table matches visible chart exactly, invalid/empty data is announced rather than zeroed, keyboard buttons state selection, no overflow at 390px and at 200% zoom.
- High-density portfolio/research/valuation with split Dockview, installed hardware/software compositor, low-resource mode and OS reduced-motion settings: no perceived blocker, unnecessary background animation, added provider requests, or unsaved P4 draft destruction.
- Check revoked permissions, stale evidence, missing providers, out-of-range snapshots/receipts, multiple windows, source provenance, quit/relaunch and session continuity.

## No-release gates retained

Packaged valuation HTTP 502, signed/notarized native installers, SP-01 + P14 installed performance and reliability, real provider/permission/safety checks and all ancestor PR source audit requirements remain hard blockers. A draft PR with source tests is **not** deployed, merged or independently releasable.
