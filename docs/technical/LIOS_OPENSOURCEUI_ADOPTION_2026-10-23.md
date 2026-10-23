# opensourceui.in — source-reuse evidence and MIT notice

**Origin:** https://github.com/bidyut10/opensourceui  
**Exact source pin:** `892f486fdf0d46a44b21ddf3fa32a41a3a71173a` (`main` at inspection 2026-10-23)  
**Source file:** `components/inputs/search-input.tsx` (source blob `af74baf91c45b8cf89e33677b00607f6aafd0572`)  
**LIOS destination:** `src/client/src/components/terminal/SourceCatalogueSearch.tsx`  
**License:** MIT. © 2026 Bidyut Kundu. Full notice below.

## What was adopted

The coherent SearchInput composition: native typed searchable field, labelled searchbox, controlled or uncontrolled state, clear-to-refocus affordance, error/hint linkage, forwarded ref and form-reset behavior. Adapted to LIOS's React 18, Tailwind 3, existing `@/lib/utils`, Lucide icon set, graphite theme, interactive focus treatment and provider/source language. This adaptation uses no Next.js, third-party API, host analytics, new package or separate data authority.

The immediate consumer is the existing P1 `ChatSourcesControl` registered source-catalogue read-only view. Filtering happens only against the same fetched `/api/setup/source-registry` response, with source-connection and source-scope policy unaffected. It **does not** select provider entitlements, connect credentials, authorize web/AI data export or persist user data. UI state is ephemeral and no new database exists.

## Material exclusions

- Upstream homepage, documentation, component-showcase, SaaS integrations, other 200+ catalog components: unrelated to this bounded source-chooser improvement; evaluate later on proven gaps.
- Upstream Next.js16 / React19 / Tailwind4 package root: incompatible/redundant with LIOS React18/Vite/Tailwind3; not imported.
- Upstream neutral light-theme styles: replaced with existing LIOS semantic tokens; not copied.
- Upstream `@/lib/cn`: existing LIOS `@/lib/utils` already provides `cn`; no duplicate helper.
- Upstream forms/graphics/media/icons: not needed; existing Lucide used.

## Validation and ownership

- `src/client/src/lib/filterSourceCatalogue.test.ts` exercises exact search and connected-only filtering and server-rendered input semantics.
- Additional real keyboard, mobile/narrow view, screen reader, permission and Electron checks required before installed-product acceptance.
- Base branch stacks on Quick Chat attachment PR #100 because that branch also owns `ChatSourcesControl` and its Temporary Chat safety rules. This PR must **not** be merged directly into main before parent integration/rebase.
- Project authority: `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`; P1 registry is still the only source authority.

## Full third-party license notice

MIT License

Copyright (c) 2026 Bidyut Kundu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
