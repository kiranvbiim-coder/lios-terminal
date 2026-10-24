# SI-04 Native Unicode PDF — packaged application acceptance

**Status: acceptance procedure, not a shipping receipt.** PR #170 remains draft until actual installed builds are tested.

## Opt-in native smoke

On a packaged signed/installed LiOS executable, run the executable with argument **--unicode-pdf-smoke**. Example:

    "/path/to/LiOS Intelligence Terminal" --unicode-pdf-smoke

Set **LIOS_UNICODE_PDF_SMOKE_REPORT** to an absolute local JSON path to retain the machine-readable receipt. The smoke refuses development/unpackaged Electron.

To **retain the actual synthetic PDF for inspection**, explicitly set **LIOS_UNICODE_PDF_SMOKE_OUTPUT** to an absolute path ending in `.pdf` alongside the receipt. The PDF must **not already exist**: the native writer uses exclusive create and private file permissions. If the PDF path is absent, the smoke still discards the PDF bytes. These environment variables are read only in `--unicode-pdf-smoke` mode.

Example on macOS (replace the application and output paths with real installed paths):

```bash
LIOS_UNICODE_PDF_SMOKE_REPORT="/tmp/lios-smoke-receipt.json" \
LIOS_UNICODE_PDF_SMOKE_OUTPUT="/tmp/lios-smoke-synthetic.pdf" \
"/Applications/LiOS Intelligence Terminal.app/Contents/MacOS/LiOS Intelligence Terminal" --unicode-pdf-smoke
node script/verify_unicode_pdf_smoke.cjs /tmp/lios-smoke-receipt.json /tmp/lios-smoke-synthetic.pdf
```

Use corresponding quoted paths to the installed EXE and existing output directory on Windows.

The test uses no user Project, login, local data, provider, network API or secret. In an isolated sandboxed Chromium process, it renders synthetic Tamil and Hindi text, a typed table, a 1 × 1 PNG with verified SHA-256 and a source-labeled line chart. The temporary window is destroyed afterwards.

Expected receipt: status **native-pdf-rendered**, source **synthetic**, PDF byte length, `pdfSha256`, `pdfRetained` and **visualAcceptance: not_tested**. The offline verifier compares the PDF bytes, SHA-256, format envelope and receipt. **Checksum verification does not certify visually readable Indic glyphs or accurate PDF extraction.** An error, hash mismatch or nonzero exit code blocks the release.

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
