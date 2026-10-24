# WS-30 — Evidence Prism / Source Truth

**Date:** 2026-10-24. **Plan:** [65-workstream TC/UX #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Source audit and canonical ownership

- `ConversationRuntimeTrace` already provides Show work and the P3 `ConversationTrustPanel`; `ConversationTrustPanel` already renders summaries, source observations, claims, assumptions, conflicts, data gaps and methodology. It lacked a **claim-linked** inspection journey: the viewer had to manually correlate a claim's `sourceRefs` and `assumptionRefs` with separate long lists.
- `@shared/trustContracts` supplies the sole typed, strict `TrustManifest` with `EvidenceClaim` (path, status, confidence, sourceRefs, receiptIds, formulaRefs, assumptionRefs) and `EvidenceObservation` (sourceRef, class/kind, recorded observedAt/asOf, freshness, quality, access state, entitlement warning). `P3 trustFabric` already emits these manifest fields; this work **does not add another claim database or provenance authority**.
- The P3 claim/evidence manifest has **no measurement unit** field and contains receipt *IDs*, not contents. The P4 research Artifact has distinct per-claim content/provenance with a separate policy boundary. Never infer numerical units or claim linkage from a path or unstructured sentence; join **only exact references actually present in the one P3 manifest**.

## Implementation

1. Pure `client/src/lib/evidencePrism.ts` projects selected `claimId` onto exact `sourceRefs`, matching `EvidenceObservation.sourceRef`, referenced assumptions, formulaRefs and receipt IDs. It never resolves by approximate provider label, guesses missing observations or claims legal rights from connection status. Duplicate source refs are deduplicated but multiple actual observations remain visible.
2. `EvidencePrism.tsx` gives each **structured P3 claim** an accessible disclosure button (one expanded at a time, clear keyboard/focus affordance), with source observations, kind/class, as-of and observation timestamp, recorded quality/freshness, entitlement/access warning, fallback, fields and linked assumptions. Status and confidence are **recorded metadata, not verification**. Unknown links/units stay explicitly unknown. Receipt IDs and formulas are shown only as references; no fabricated receipt contents. The panel is read-only.
3. The existing `ConversationTrustPanel` uses `EvidencePrism` in place of the unlinked flat claim cards, while preserving its existing separate source, methodology, assumptions and exception/recovery views. `key={manifest.trustId}` prevents prior-run selection leaking into a replacement trust manifest. No change to source retrieval, AI plan, trust manifest schema, data/ledger storage, P4 Artifact authority, approval, egress or entitlement policy.
4. `evidencePrism.test.ts` covers exact claim-link custody, unsupported-but-styled-supported claim, duplicate observations and refs, absent units, missing assumption references, source class/date, explicit entitlement, safe structured-value display, SSR keyboard controls/closed-by-default semantics and no extra chrome when no claims exist.

### Target qualification commands

Run from `src/`:

```sh
node --import tsx --test client/src/lib/evidencePrism.test.ts client/src/components/terminal/ConversationRuntimeTrace.test.ts shared/trustContracts.test.ts server/trustFabric.test.ts
npm run check
npm run test:p3
npm run test:ux
npm run acceptance:ux
```

## Boundaries and remaining acceptance

- **NOT_RUN until current-head CI proves it:** Node/TS hosted tests/build on Windows, macOS and Linux; authenticated P3 user/tenant provenance; real source revocation/entitlement updates; P4 Artifact claim-to-P3 mapping (not present in canonical contract), real recorded source URLs with current license/access checks, actual claim-value/unit rendering (not recorded in P3), native screen reader/keyboard, 200% zoom and narrow mobile width, SP/P14 release acceptance.
- **Explicitly not claimed:** arbitrary unstructured chat sentence recognition, numerical unit derivation, verification of vendor data or document rights, receipt contents, real-time checks, P4 ledger graph query or complete cross-surface claim linking. These need canonical contract/read paths before any UI assertion; do not fake them.
- PRs #116 (WS-29 source inspection), #117 (WS-27 research progress), #122 (WS-28 source selector) own different surfaces. Keep this isolated to trust-panel claim display; merge/rebase carefully after unrelated parent PRs and never overwrite concurrent shell or ChatMarkdown feature work.
