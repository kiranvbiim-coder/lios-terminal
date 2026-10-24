# SI-04 Native Unicode PDF — packaged application acceptance

**Status: acceptance procedure, not a shipping receipt.** PR #170 remains draft until actual installed builds are tested.

## Opt-in native smoke

On a packaged signed/installed LiOS executable, run the executable with argument **--unicode-pdf-smoke**. Example:

    "/path/to/LiOS Intelligence Terminal" --unicode-pdf-smoke

Set the environment variable **LIOS_UNICODE_PDF_SMOKE_REPORT** to an absolute local JSON path if a receipt is required. The smoke refuses development/unpackaged Electron.

The test uses no user Project, login, local data, provider, network API or secret. In an isolated sandboxed Chromium process, it renders synthetic Tamil and Hindi text, a typed table, a 1 × 1 PNG with verified SHA-256 and a source-labeled line chart. No PDF is saved on disk. The smoke destroys the temporary window.

Expected successful JSON receipt: status **native-pdf-rendered**, source **synthetic**, a nonzero byte count, content coverage and **visualAcceptance: not_tested**. Any error or nonzero exit code is a blocker. A PDF envelope proves native print execution, **not** readable Indic glyphs, correct extraction or final layout.

## Manual installed-app acceptance, still required

1. Install an exact signed candidate on a clean Mac and Windows. Check login, restart, and reopening a saved Research/Report Artifact.
2. Open a governed editable report with Tamil and Hindi text, a source-linked photo, a table, and a chart containing missing observations.
3. Use the existing Artifact Export PDF action. Verify the save dialog and real PDF file.
4. View every page: Tamil combining signs, Hindi conjuncts, page breaks, table headers, image/caption, chart axes, intentional chart gaps, and source references.
5. Select/extract representative Tamil/Hindi passages and compare with exact saved Artifact text. Record local OS font availability and layout defects.
6. Edit the saved report to a new canonical version. Export again, verify no stale content or silently changed rights, and reopen the older immutable version.

Attach a sanitized receipt, screenshots, extracted-text checks, exact packaged binary identity and platform to the P14 tracker. Do not commit private source material or any font files.

## Qualification boundary

Source GitHub Actions validate TypeScript, offline research-to-report, package allowlists and mocked native smoke wiring. They **cannot** prove a real packaged Electron render on an installed operating system. Green source CI is necessary but not sufficient for release.
