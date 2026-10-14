# browser-use → LiOS GM-14: download safety

The already-controlled fork `kiranvbiim-coder/browser-use` is a source reference, not authorization to install another browser runtime.

**Approved original source pin:** `browser-use/browser-use@a6e103e27d28c390ac6421a6ee8ac21f1b1dfc1c` (MIT). Selected original source paths:
- `browser_use/browser/watchdogs/downloads_watchdog.py`, blob `beb2d8b2212c1057439c90ffd6ca220fe4518544`: original path basename and containment behavior.
- `tests/ci/security/test_download_filename_sanitization.py`, blob `aa0c06619b72b8d40bb77f6bab09763c47b2cdab`: regression cases including Unix/Windows traversal, filename fallback, sibling-root confusion and symlinks.
- `tests/ci/security/test_upload_file_containment.py`, blob `c1646ce1438e0fc9d2c7f60c8947083fbd5d8ed0`: caution around symlink/realpath trust and file-system-owned identities.

Root full license `third_party/licenses/browser-use-MIT.txt`, original upstream Git blob `1ea3836ce58a4cd32c90c0b4f4e736d840d23780`. Attribution in `THIRD_PARTY_NOTICES.md`.

**Actual adaptation:** `src/server/browserDownloadSafety.ts` adds a pure safe filename and lexical/realpath Project-root containment validator; `browserConnectorRuntime.ts` sends only a safe basename to **any** underlying adapter, checks bounded byte accounting, and refuses sibling-root prefix false positives and a reported path outside approved roots; `playwrightBrowserAdapter.ts` uses the same filename, resolves the root, refuses symlinked roots and uses exclusive file creation. Tests port the donor's attack cases and prove the existing canonical browser connector executes them.

**Canonical authorities maintained:** GM-14 strict sandbox, Project network policy, BYOAI run approvals, cancellation, Playwright Browser Runtime Pack and P13 URL/network controls. No ambient CDP, new internet permissions, donor browser profile/global host fallback, automatic downloads or storage authority.

**Limitations:** An isolated/remote worker is still independently responsible for pre-write filesystem isolation; a returned path observed only post-write cannot prove every pre-write filesystem restriction. Post-write lexical checks and local `realpath` verification do not guarantee a remote sandbox if it lies about the path. Do not advertise complete computer/browser automation adoption or SP-05 owner acceptance based on these tests. Follow-on packages should tackle actor/page lifetime, isolated worker transport, redirects, popups and observer receipts with real customer journeys, not blanket copy a runtime.

**Tests:** native `node --import tsx --test server/browserDownloadSafety.test.ts server/browserConnectorRuntime.test.ts`, existing Playwright adapter regression and `npm run check`; target platform package validation remains separate.
