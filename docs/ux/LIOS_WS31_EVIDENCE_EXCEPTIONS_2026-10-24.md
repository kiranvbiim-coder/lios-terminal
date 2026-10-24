# WS-31 — Contradiction, unknown and revoked-source UX

**Date:** 2026-10-24. **Plan:** [TC/UX #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119). **Master:** [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Parent:** [WS-30 Evidence Prism #150](https://github.com/kiranvbiim-coder/lios-terminal/pull/150), which remains an unmerged draft. WS-31 must be **stacked** on #150, not opened independently against main and duplicated.

## Real source audit

- P3 `trustManifestSchema` is the canonical authority for structured claim status, exact `sourceRefs`, evidence observations, `EvidenceConflict` relative differences, missing-data recovery actions and user-visible access/entitlement observations. There is **no** live entitlement call authorized from a React view and no arbitrary raw-value/unit field in the P3 conflict contract.
- The existing `ConversationTrustPanel` rendered conflicts as flat field/summary text with no per-source inspection. The always-visible `trustCaveats` displayed explicit missing/conflict/warnings but omitted structured *unsupported or unanchored supported claims*, and access-denied, expired or revoked **recorded** source observations.
- WS-30 (#150) already owns click-claim → exact-source / assumption inspection. WS-31 extends its existing Trust panel and `ConversationRuntimeTrace` caveat path rather than constructing another ledger, P5 connector registry, or source permission gate.
- P5 already owns real provider authorization and (where applicable) stream entitlement rechecks. This UI neither blocks the backend nor revokes credentials, and historical P3 access metadata must **never** be called live status.

## Scoped implementation

1. `client/src/lib/evidenceExceptions.ts`: pure projection of **the exact P3 manifest**, preserving conflicting source refs and all matching observations, the relative difference only if recorded, unsupported/partial claims and any references with missing observations. Historical access states are classified conservatively:
   - `revoked`, `entitlement_denied`, `policy_denied`, `expired`, `disabled`, etc. are marked **recorded blocked**;
   - `limited`, `rate_limited`, `degraded` and `entitlementRequired` are **recorded restricted**;
   - absent/`unknown` entitlement remains **unconfirmed**, never an implied grant or denial;
   - a recorded `allowed` state is displayed as a past observation **not a live rights check**.
   It never maps provider labels to source refs fuzzily or chooses one of multiple disagreeing values.
2. `EvidenceExceptionDetails.tsx`: shows conflicting sources and their available observations (or explicit missing observation), status/quality/date, partial and unsupported claims, access problems, and a link-by-description to the **existing** Missing & Recovery actions. No invented recovery workflows or navigable provider links.
3. The existing `ConversationTrustPanel` renders these structured exceptions while retaining existing Missing, Warning and Recovery buttons; its previous bare conflict cards are removed to prevent duplication.
4. The existing always-visible `trustCaveats` includes material structured-claim support gaps and recorded blocked/restricted access even with Show work closed. Previous conflict and missing-data warnings remain.
5. No change to trust contract, numerical data, P3/P5 provider policies, storage, AI/tool invocation, entitlements, migration, approvals, or import from donor repos. Read-only UI remains React-escaped.

## Tests and acceptance

Run from `src/`:

```bash
node --import tsx --test client/src/lib/evidenceExceptions.test.ts client/src/lib/evidencePrism.test.ts client/src/components/terminal/ConversationRuntimeTrace.test.ts shared/trustContracts.test.ts
npm run check
npm run test:p3
npm run test:ux
npm run acceptance:ux
```

New tests cover multiple observations per conflicting ref, unresolved evidence refs, exact recorded source state, revoked/denied/unknown/allowed distinctions, unsupported claims, original recovery actions, always-visible warnings and escaped adversarial provider/source labels. Tests require **exact-head hosted verification**; written test definitions do not establish a pass.

### Mandatory remaining acceptance

- **NOT RUN / NOT ACCEPTED:** authenticated provider access/revocation scenarios across account/tenant boundaries, live P5 entitlement recheck and refusal of access after revocation, real signed-in browser + packaged Electron Mac/Windows, screen-reader/keyboard/focus, 320px responsive and 200% zoom, PR review and merge to protected main, shipping point/P14 qualification.
- No dynamic entitlement checks are executed by this UI; it cannot establish *current* revocation. No fabricated numeric values are shown for conflicts. Where source evidence, claim support or rights are unknown, the product says so.
- Merge sequence: parent #150 first, reconcile any #116/#117 renderer/trace changes, then rebase WS-31 and rerun exact-head checks. Keep this incremental PR draft until verified.
