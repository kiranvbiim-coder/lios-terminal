# WS-38 — Spreadsheet/data-table editing correctness

**Date:** 2026-10-24. **Owner:** [canonical P4/Chat #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98) · [TC/UX plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119) · master #91.

## Audited actual code

The repository already has a canonical P4 `spreadsheet` Artifact schema (worksheets, bounded cell data, calculation mode and source lineage), a mature built-in grid/financial formula engine, a native `UniverSpreadsheetEditor` with formula & paste support, an immutable `createArtifactVersion` save path, encrypted local draft recovery, conflict handling and `SpreadsheetCellSourceInspect`. The last component is a **recorded historical** source inspector, not an entitlement check or fabricated live data provider. `data` Artifacts currently have a recorded, separately governed columnar/query/preview experience; this change does not invent an unconstrained table-write API or duplicate the P4 store.

## Concrete gaps and changes

1. `shared/univerArtifact.ts` previously validated all **initial** saved cell references against each sheet's row/column bounds when projecting to Univer, but did not reject **new** row/column matrix entries outside dimensions when importing `current.save()`. An oversized native paste could silently produce an out-of-bounds draft. It now **rejects** those cells before P4 revision saving; source input remains unchanged.
2. New `client/src/lib/spreadsheetReviewBounds.ts` validates normalized A1 references against the **exact recorded sheet dimensions**; a nonexisting worksheet, malformed reference, oversized field or oversized cell contents yields a user-visible failure. Review diffs use the original canonical P4 `before` cell and preserve its lineage with historical `capturedRaw`. They never treat current uncommitted renderer edits as verified baseline.
3. Native `UniverSpreadsheetEditor` now shares that validated review projection, announces invalid review refs, disables review creation outside saved bounds, and prevents concurrent review submits. Its dirty indicator tracks a return to clean after an edit undo and refuses redundant Save on a pristine workbook. Existing P4 save/conflict/recovery handlers remain.
4. Built-in `ArtifactPane` spreadsheet editor now refuses invalid manual selected refs **before calling `grid.getCell`**, avoiding an entire editor crash. Valid selections continue to use the existing source inspector, including raw formula and historical lineage. Both built-in Save and Create review diff catch/announce errors and retain the draft; Save disables for no changes and during in-flight work. Advanced Univer handoff is still a separate, explicit P4 version choice.
5. No new spreadsheet calculation result is fabricated; formula text, cell data and source IDs are not rewritten or implicitly revalidated. Temporary Chat stays ephemeral.

## Regression coverage

- New `spreadsheetReviewBounds.test.ts`: exact sheet dimensions, case/whitespace normalization, A0/D1/out-of-bounds rejection, immutable source baseline, preserved historical lineage, unknown sheet/oversized value refusal.
- Incidental editor-source wiring assertions were removed; actual editor interaction, permission, dirty-state and persistence journeys remain required rather than inferred from function-name matches.
- Expanded `shared/univerArtifact.test.ts`: native row/column pasted cells outside declared worksheet dimensions block exact snapshot conversion without mutating canonical data.

Run from `src/`:

```sh
node --import tsx --test client/src/lib/spreadsheetReviewBounds.test.ts shared/univerArtifact.test.ts client/src/lib/artifactSpreadsheet.test.ts
npm run check
npm run test:p4
npm run test:ux
npm run validate:visual-environments
```

**Acceptance still required:** exact-head CI on Linux, Windows and macOS; installed Electron native workbook edit/paste/formula failure/undo/focus, view at 320px and 200% zoom; signed-in P4 ACL, multi-sheet stored format/provenance, owner/tenant denial, source-rights drift, autosave absence, revision conflict/refetch and explicit user review, independent reviewer and P14/SP shipping qualification. Test files are not proof of a successful run until checks finish.

**Integration:** Keep stacked on canonical parent #98; reconcile sibling WS-34 (#163), WS-35 (#167), WS-36 (#171), WS-37 (#172) and existing source UI owner PRs before merging. Do not add competing donor spreadsheet UI, P4 schema/storage, cloud sync or ungoverned Excel imports.
