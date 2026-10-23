# WS-23 — Readable Responses, Tables, Code and Citations

**Date:** 2026-10-23. **Canonical repo:** kiranvbiim-coder/lios-terminal. **Tracking:** [TC/UX master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91) and [65-workstream plan PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119).

## Real code audit and workstream ownership

- The existing pure Markdown parser (src/client/src/lib/chatMarkdown.ts) already strips machine directives, safely renders plain untrusted HTML as text, refuses images and unsafe or credential-bearing links, and creates citations **only from exact runtime/saved-message source references**. It already uses bounded parsing, supports streamed content, ordered lists, fenced code, real tables and aligned numeric columns. None of those facilities should be replaced by an unsafe Markdown or HTML rendering package.
- Open [PR #113](https://github.com/kiranvbiim-coder/lios-terminal/pull/113) already introduces ChatCodeBlock with readable language labels, a scrollable focusable code region, a genuine clipboard write, disabled copy while streaming, and failure feedback. WS-23 **starts from #113's branch** feat/ux-chat-code-copy-20261022 and reuses ChatCodeBlock. No duplicate code-copy implementation.
- Prior ChatMarkdown table rendering produced semantic table markup, but had no **copyable tabular output** or genuine success/failure feedback. Wide tables could be scrolled via keyboard, but lacked a descriptive caption, table dimensions, clearly labelled scrolling and a separate accessible 40px copy action.
- A table copied naïvely into a spreadsheet can execute a formula from an untrusted assistant answer: =, +, @, or a nonnumeric leading - must never be passed through as active spreadsheet formulas. A copied tab/newline must not shift the text into another cell/row. The original splitTableRow toggled inline code parsing on **each** backtick, so a multi-backtick span such as double-backtick a|b could be split into two false table cells.
- Code snippets, citations and untrusted Markdown may contain private or malicious input. Clipboard copying must remain an explicit user interaction and must never send to a backend, open external URLs, run code, claim unresolved citations are linked, or manufacture source evidence.

## Implemented

1. **src/client/src/lib/chatTableCopy.ts:** pure Inline-to-visible-text serializer with the original citation markers retained literally (no invented evidence). Copies real table headers/rows as tab-separated plain text. Flattens tabs/newlines/control characters within a cell into spaces. Neutralizes formula-like leading =, +, @ and nonnumeric - by prefixing an apostrophe. Simple negative financial values remain numeric. Clipboard success is returned **only when writeText resolves**; unsupported or rejected writes return false and never claim copied.
2. **src/client/src/components/terminal/ChatTableBlock.tsx:** original semantic th(scope=col)/td, numeric alignment and all trusted inline links/citations remain, but wide tables now have an accessible descriptive caption and heading with column/row counts, a labelled and keyboard-focusable horizontal scroll region, long-content wrapping, and a 40px focus-visible Copy table button. Copy is **disabled while the answer streams** (never copies a half table), status is announced on confirmed success, and an accessible manual-copy fallback is displayed if the clipboard fails.
3. **src/client/src/components/terminal/ChatMarkdown.tsx:** only the table branch delegates to ChatTableBlock. It retains **PR #113's ChatCodeBlock** for all normal/streaming fenced code, the existing parser, strict safeHref and real-source CitationChip. Citation focus target height is modestly improved; unknown numeric or named sources remain inert text.
4. **src/client/src/lib/chatMarkdown.ts:** splitTableRow now tracks matching backtick **run lengths** when deciding whether | separates columns. Pipes between matching double/multi backtick runs stay inside their original code cell. Escaped literal pipes retain the original behavior. No HTML passthrough, URI policy, source collection, source numbering or Markdown parser dependency changed.
5. **Tests:** 9 pure table-copy tests in client/src/lib/chatTableCopy.test.ts; 8 React server-rendered table/citation/code coexistence tests in client/src/components/terminal/ChatTableBlock.test.ts; 3 extra parser/render tests appended to existing ChatMarkdown.test.ts; 8 source-owner/security/evidence tests in script/validate_ws23_readable_answers.test.mjs. **28 additional test cases authored**, existing PR #113 code-copy tests retained.

## Execution and acceptance

Run on the exact WS-23 stacked head from the src directory:

```bash
node --import tsx --test client/src/lib/chatTableCopy.test.ts client/src/components/terminal/ChatTableBlock.test.ts client/src/components/terminal/ChatCodeBlock.test.ts client/src/components/terminal/ChatMarkdown.test.ts script/validate_ws23_readable_answers.test.mjs
npm run test:ux
npm run acceptance:ux
```

| Evidence | Status |
| --- | --- |
| Incremental source committed on original PR #113 code-copy branch | IN_PR |
| 28 new unit/SSR/parser/source regression cases | AUTHORED_NOT_EXECUTED |
| Exact-head Node suite, TypeScript check, hosted Linux/Windows/macOS CI | PENDING |
| Actual clipboard success/failure in Chrome, Safari, Firefox, Edge | NOT_RUN |
| Wide finance table at 320/390/768/1280/1440 and 200% zoom | NOT_RUN |
| Real keyboard-only Tab/Enter/scroll, screen reader table navigation | NOT_RUN |
| Native macOS/Windows VoiceOver/Narrator | NOT_RUN |
| Real citation source, unknown citation, malicious links/HTML, stored vs streamed answer | NOT_RUN |
| PR #113 merge, WS-23 rebase, other UI PR review and protected-main acceptance | PENDING |

## Safety and merge boundaries

- **Merge [PR #113](https://github.com/kiranvbiim-coder/lios-terminal/pull/113) first**, then rebase/retarget this WS-23 draft to the current main. Do not copy PR #113's implementation again or replace its tested ChatCodeBlock with another code implementation.
- [PR #145](https://github.com/kiranvbiim-coder/lios-terminal/pull/145) owns observed streaming/cancel/receipt correctness, including whether the answer is finished; WS-23 only *disables table copy* while ChatMarkdown.streaming is true, it never settles a Home run. [PR #115](https://github.com/kiranvbiim-coder/lios-terminal/pull/115) owns whole-message Copy/Quote/follow-ups in the original Chat shell; WS-23 table copy is distinct and does not reimplement those commands.
- No new image network loads, provider keys, DOM HTML injection, backend source references, fake citations, executable code, storage of clipboard data, external sharing, pricing, donor package, or licence change. The parser's source evidence is always distinct from text that happens to resemble a citation.
- Real screen-reader, clipboard and native acceptance plus exact source head collision reconciliation are **required** before calling the workstream shipped or complete. Source tests alone are not evidence of real device behavior.

**Next:** WS-24 — message-level Copy/Quote/follow-up actions, coordinating with existing owner #115.