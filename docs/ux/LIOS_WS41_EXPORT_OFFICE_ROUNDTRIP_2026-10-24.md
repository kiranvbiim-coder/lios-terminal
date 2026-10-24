# WS-41 — Real exports and safe Office round-trip

**Date:** 2026-10-24 · **TC/UX plan:** [#119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119) / [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91) · **P4 owner:** [PR #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98). **Word-download owner:** [PR #162](https://github.com/kiranvbiim-coder/lios-terminal/pull/162), separately stacked on #161/#159/#156; do not duplicate its authenticated direct Word download.

## Actual source audit

- Canonical P4 Artifact export supports JSON/CSV/XLSX/PDF/PPTX/DOCX/MD. Native DOCX and PPTX use real OPC ZIP packages with typed layout, saved version metadata, and built-in read-back via `readOfficeArtifactRoundtrip` (bounded ZIP/XML, no macros/remote relationship retrieval, recorded bookmarks, typed cells, provenance). `ArtifactPane` already captures `artifactId/version/contentHash` and checks the export plan against that revision before dispatch.
- `OfficeArtifactReturn` loads an edited native DOCX/PPTX in the **local browser** and requires exact embedded source identity/hash/version. The authenticated server `proposeOfficeArtifactReturn` rechecks P4 ownership, active source entitlements, original content hash and *current* head before staging an inert proposal. A user must separately inspect and accept it in the existing P4 proposal review; Office changes are never silently written.
- The backend previously derived the `officeEdited` / `sourceQuoteEdited` flags from a saved baseline but **accepted all other file-supplied `attrs` and research/claim metadata**. A forged returned payload could change a recorded citation source, evidence ID, original content hash, provenance, source policy or claimed research/Thesis status as a normal proposal. A proposal is not automatic acceptance, but these should not enter a trusted review as plausible source truth.
- Text and DOCX browser downloaders revoked their Blob URL **synchronously** after click. Native PPTX deferred only to the next event-loop tick, risking file delivery race in browsers that begin downloading after the click handler finishes.

## Scoped WS-41 changes

1. New server-owned pure `officeArtifactProvenance.ts` checks each returned document block against the **authorized P4 baseline**. Original `sourceRef(s)`, evidence identity/hash/digest, source URL/provenance/truth/receipt fields may not change through a file. New unsourced blocks can be authored, but cannot claim an existing filing/citation. Text/formatting edits remain allowed; changed sourced quote blocks are marked `officeEdited/sourceQuoteEdited/officeEditProvenance=user_asserted`. Unchanged markers are reset to the actual baseline.
2. Research `evidence`, `sourcePolicy`, `executionTrail`, `contradictions` and `plan` cannot be modified by Office import; existing claim sourceRefs are immutable and edited/new claims are `user_asserted`, never elevated to `source_backed` via file metadata. Thesis claim references remain frozen and edited claims reset to `open`, null confidence/date; unchanged claims inherit real saved status. No provider call or trusted rights grant is fabricated.
3. The existing authenticated `officeArtifactReturn.ts` now invokes that **server-side reconciliation before hashing, comparing or staging**. It preserves the original immutable version, current-head check, owner/entitlement gate, no-change idempotency and proposal acceptance workflow. This is a restrictive existing-API change; not a second importer or an automatic save.
4. The original client `artifactExport.ts` and native `exportDocx.ts` / `exportPptx.ts` delay revoking Blob URLs for 1.5s after a browser download click, rather than revoking them before the browser has the chance to consume the real bytes. Neither changes file contents or export plan authority.
5. New unit tests `server/officeArtifactProvenance.test.ts` check genuine quote edits, unsourced new prose, original citation/source/truth rejection, research evidence/policy/claim protections, and thesis status resets. Extended actual DB/P4 `officeArtifactReturn.test.ts` with authenticated forged-citation and claimed-source negative cases. New `client/src/lib/ws41ExportDelivery.test.ts` regenerates an actual native DOCX ZIP, reopens it and checks saved version/hash/content; verifies deferred blob-URL cleanup.

## Test commands (from `src/`)

```sh
node --import tsx --test server/officeArtifactProvenance.test.ts server/officeArtifactReturn.test.ts shared/officeArtifactRoundtrip.test.ts client/src/lib/ws41ExportDelivery.test.ts client/src/lib/artifactDocumentExport.test.ts
npm run check
npm run test:p4
npm run test:ux
npm run acceptance:ux
```

**Gates pending until observed:** exact-head GitHub Actions Linux/macOS/Windows, real local-home DOCX/PPTX download/open/change/save/return with installed Office/LibreOffice, UI reviewer approval and source-rights drift tests, keyboard/screen-reader responsive and 200%-zoom acceptance, independent review and P14/SP signoff. Generated bytes parsing in automated tests does **not** prove all installed Office versions open them without warnings. A file's user-supplied hash is a proposal audit field and is not server-verified against uploaded bytes (the endpoint accepts parsed content, not raw file bytes); this is not an independent file authenticity certification.

**Merge plan:** #98 establishes canonical P4 first, reconcile #162 through its original #156/#159/#161 owner stack. This WS-41 child modifies original backend return validation and client download handoff, not the direct /report.docx endpoint; rebase and test overlaps rather than duplicating them. Coordinate WS-34–40 sibling PRs #163/#167/#171/#172/#173/#174/#175.
