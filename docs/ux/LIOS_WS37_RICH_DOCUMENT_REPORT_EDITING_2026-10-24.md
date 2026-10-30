# WS-37 — Rich document/report editing (2026-10-24)

**Canonical owner:** P4 parent [PR #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98) · [TC/UX plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119) · [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Source inspection and reuse

- `RichArtifactDocumentEditor.tsx` already provides Tiptap editing, headings, lists, quotes, code, marks and undo, plain-text-only paste, denied/drop handling, safe URLs, read-only embedded tables/charts/images and canonical block IDs. It is embedded in the **one** P4 `ArtifactPane.tsx` `DocumentEditor`; alternative built-in block editor and native encrypted draft recovery already exist.
- `shared/richArtifactDocument.ts` already enforces the P4 report/research schemas, canonical source attributes, original opaque block IDs, formatting spans and duplicate-ID refusal. `ArtifactPane` saves only through `createArtifactVersion` with the recorded base version; conflict/refresh handling remains authoritative. PRs #159/#161/#162 separately own evidence-to-research/report creation and direct Office export, not this interactive editor.
- **Real gap:** `fromTiptapDocumentProjection` previously removed references for deleted blocks, but did not include **newly inserted report blocks** in any report section. The report could show text in the editor yet its ordered sections omitted that text. Additionally, Tiptap's local `knownSections` cache updated only when the **blocks array** changed, so a real updated report outline/sections with identical blocks could be overridden by stale section metadata on the next edit.
- **Governance gap:** the built-in textarea and Save button omitted the `disabled` read-only guard even though the rich editor accepted it. The advanced JSON edit action also omitted that guard. The P4 API ultimately controls the version, but a historical/read-only view should not offer a misleading save or allow editing.

## Scoped changes on this P4-based branch

1. Shared `reconcileReportBlockSections(sections, previousIds, nextIds)` deterministically attaches each genuinely **new user-authored** block to its nearest recorded section in document order (preceding block preferred; following if inserted before the first; first section if no anchor). Retains the exact original section IDs/titles, existing unresolved refs and all original source/citation metadata. Never generates or inherits evidence/citations; never fabricates a new report section when none exists. A 5,000-block section limit rejects edits without truncation.
2. `fromTiptapDocumentProjection` now applies that section reconciliation during the shared decode against canonical P4 inputs. Deleted known blocks are removed from sections, preexisting unresolved refs are kept, and inserted IDs remain stable across repeated conversions/undo/reopen.
3. `RichArtifactDocumentEditor` tracks the baseline P4 block IDs and separately reconciles **locally seeded** Tiptap insertions (because seeded IDs are otherwise already in its undo metadata). It retains the updated section list for successive edits and refreshes it when an external section-only update arrives. No second save system or editable provenance attrs.
4. `ArtifactPane.DocumentEditor` rejects saving when `disabled` or native recovery is blocked; built-in fallback text areas, mode switching, Save and Advanced JSON controls are disabled in read-only/blocked states. Existing base-version conflict, pending state, recoverable local edits, P4 create-version API and encrypted recovery remain.
5. `richArtifactDocument.test.ts` covers the inserted block in its saved report section, cross-section reconciliation, deletion/unresolved refs, overflow, exact provenance and round-trip behavior. Incidental mounted-source/guard/P4-call string assertions were removed; actual UI/permission journeys remain required.

## Target tests from `src/`

```sh
node --import tsx --test shared/richArtifactDocument.test.ts
npm run check
npm run test:p4
npm run test:ux
npm run validate:visual-environments
```

**Acceptance not complete:** exact-head hosted Windows/macOS/Linux checks, live Tiptap undo/redo, insert/delete/section move, accessibility (focus/keyboard/screen reader), 320–1440px and 200% zoom, signed-in historical revision/read-only UI, per-tenant P4 denial, concurrent author conflict, packaged Electron/native, P14/SP gate and independent review/merge. Authored tests are not reported as passed until CI confirms.

**Dependency:** Base #98 first, then rebase/retest this WS-37 child; reconcile report creation #161, downloadable Word #162, sidecar #171 and saved cards #163 without moving their owners into this PR.
