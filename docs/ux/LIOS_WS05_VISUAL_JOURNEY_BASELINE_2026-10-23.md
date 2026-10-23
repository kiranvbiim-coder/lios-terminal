# WS-05 — Rendered Visual and User-Journey Baseline

**Authority:** [65-workstream UI/UX execution plan (PR #119)](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [WS-01/02 code-backed gap matrix](https://github.com/kiranvbiim-coder/lios-terminal/blob/docs/tc-beyond-donors-ui-innovation-20261023/docs/ux/LIOS_UI_UX_WS01_WS02_GAP_MATRIX_2026-10-23.md), `docs/LIOS_UX_SYSTEM.md`, `docs/PENDING_WORK.md`, [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). The existing TC/UX owner retains responsibility; this document is an evidence annex, **not** a new acceptance authority.

**Status on this PR:** Capture instrumentation + five Node unit tests prepared. **Rendered screenshots NOT_RUN in this session; installed application journeys NOT_RUN.** Do not mark WS-05 complete based only on source/CI, donor import, or simulated fixtures.

## Existing code reused — no second visual harness

The repo already has `src/client/visual-smoke.html` and `src/script/visual_smoke_capture.cjs`: a deterministic Electron fixture with 15 desktop 1440×900 captures. It renders a subset of the real UI/components, **but its Chat and Artifact examples are synthetic**, not an authenticated P4 work product or entitled provider response. The WS-05 runner adds diagnostics **without replacing that test path**.

The new `src/script/ws05_visual_baseline_capture.cjs` generates **19 screenshots** plus a non-overwriting JSON manifest:

- Fixture `conversation`, `conversation-artifact` and `workspace-focus` at viewport widths **320, 390, 768, 1280, 1440 CSS px**.
- `conversation-artifact` at **200% zoom** and widths 390 and 1440.
- Actual Dockview component fixture `workbench-real` at 1440 and `workbench-real-narrow` at 1000.
- Records CSS viewport and root dimensions, root/document horizontal overflow, **usable primary content width** (so `overflow:hidden` cannot masquerade as responsive success), screenshot size, fixture readiness and renderer errors.
- Sends a **native Electron Tab key event** to probe focus visibility and keyboard reachability of the fixture's `Show Work` button. It does not claim that the button executes a real work action.
- Records `fixture-probes-pass`, `gap-observed` or `capture-error` for every sample. A gap creates a non-zero process exit **after writing the manifest**; do not discard red results.

The manifest **always** marks installed keyboard-only, VoiceOver/Narrator, authorized sources, native Mac/Windows and authenticated Chat→P4 Artifact→original Dockview→Chat→restart as `NOT_RUN`, regardless of fixture status. Passing unit tests is **not** proof screenshots were captured.

## Reproduce on a trusted local developer machine

Use a fresh checkout of the **exact reviewed commit**, Node 22+, the checked-in lockfile and a working Electron GUI. First terminal:

```bash
cd src
npm ci
npx vite --host 127.0.0.1 --port 4173 --strictPort
```

Second terminal:

```bash
cd src
node --test script/ws05_visual_baseline_core.test.cjs
node --check script/ws05_visual_baseline_capture.cjs
npx electron script/ws05_visual_baseline_capture.cjs
```

On headless Linux with the appropriate installed runtime, prefix Electron with `xvfb-run -a`. A Linux fixture run does not validate macOS or Windows behavior. The capture restricts the URL to the **local loopback `/visual-smoke.html` fixture**, never actual customer sessions. The default output is ignored `src/visual-smoke-artifacts/ws05-baseline/`. The shared output helper **refuses overwrites**. To rerun, supply a fresh output directory via `LIOS_WS05_OUTPUT_DIR`. Keep screenshot files beside the exact SHA and `manifest.json`; do not commit private/user/provider screenshots or live profile data to this public repository. Synthetic fixture screenshots require inspection before sharing.

## Real user journey qualification — still separate and outstanding

| Journey | Required *observed* evidence | Status |
| --- | --- | --- |
| First run | Fresh signed-in Chat-first entry, accessible navigation, permissions denial/retry | **NOT_RUN** |
| Files and Sources | Quick, Project, Temporary uploads; rights/source selection, invalid file and revoke | **NOT_RUN** — #100/#122 overlap |
| Evidence in Chat | Authorized actual sources, provenance, useful empty/error states | **NOT_RUN** — #116/#117 overlap |
| Artifact continuity | Exact P4 ID/version → sidecar → original Dockview → return same Chat → restart | **NOT_RUN** — #98→#102→#115 overlap |
| Responsive/a11y | 320/390/768/1280/1440, 200% zoom, reduced motion, keyboard focus/escape, denied and offline states | **Fixture diagnostics ready; installed NOT_RUN** |
| Native qualification | Actual approved macOS/Windows packages, keyboard-only, VoiceOver and Narrator, restart/recovery | **NOT_RUN** — P14 separate |

### First evidence entry (update only after actually executing)

- Source commit, host OS and target Electron version: **NOT_RUN**
- Captured PNG manifest, counts and exact viewport gaps: **NOT_RUN**
- Confirmed actual product bugs linked to issue #91 with screenshots: **NOT_RUN**
- Authenticated real journey and native macOS/Windows proofs: **NOT_RUN**

**Next:** execute this diagnostic runner against its exact merged/reviewed source, keep fixture-only findings distinct from real-product defects, fix observed clipping/focus flaws in the existing WS-07/08 owners, then qualify real authenticated and installed journeys. Do **not** combine screenshots from different PR heads or count synthetic finance data as observed. Current fixed 260px fixture rail may itself produce narrow-layout gaps; that observation is not proof the installed production shell fails until independently reproduced.
