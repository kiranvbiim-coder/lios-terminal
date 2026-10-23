# WS-12 — Optional Contextual Visual Environments

**Date:** 2026-10-23. **Track:** TC/UX. **Canonical source plan:** [65-workstream UI/UX plan in PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), master [issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Actual source audit (no duplicate visual system)

The original LiOS code already has **one** `VisualCanvas` behind the terminal's `main[data-visual-host]` and a single late-loaded `visual-intelligence-canvas.css` layer. Its source registry `visualEnvironment.ts` defines **10 contextual families**, each shipped as one local SVG and one dedicated `low-resource/` SVG (20 local assets). Saved Project environment pins take priority over context inference. `TerminalUxSettings` already exposes contextual environment enable/disable, low-resource, reduced motion and visual animation choices; **visual environments default OFF**.

There are three source-level gaps:

1. **Focus and cost:** Focus, Presentation and Workbench select `intensity="focus"`, dimming a still-mounted full-size 1920×1080 SVG to opacity 0.035. The image/light/grain tree still requires DOM/image decoding/compositing. Existing preloading also continues in Focus when visuals are enabled. A decorative layer is not analytically useful there.
2. **Software fallback:** `ambientMotionAllowed` already disables animated drift on software renderers, but the SVG path and grain/light compositing originally remained full-resolution unless the user independently enabled low-resource mode.
3. **Saved choice resilience:** Project pin writes, context-runtime writes, saved-state restore and unpin-runtime remove called `localStorage` without a catch. Private browsing, locked desktop/webview storage or quota failures can throw during an entirely optional decorative preference transition. Reading already catches storage failure. Optional visuals must never crash Chat/Workbench or affect data authority.

## Code changes

- **`lib/visualCanvasPolicy.ts`** adds a simple read-only policy: `renderScene`, `useLowResourceAsset`, `preloadScene`. Off or Focus is a **solid, zero-image-children backdrop**. Contextual/Immersive render the existing chosen local scene. Low-resource or software-rendered sessions select the dedicated lightweight SVG and skip speculative image preloading. Software render fallback is driven by the existing desktop render-mode signal. No extra scene registry, image generator, packages, CSS duplicate or finance data operations.
- **`VisualCanvas.tsx`** consumes that policy and returns the matte `lios-visual-canvas--solid` node for Focus/Presentation/Workbench or explicit opt-out; it does not write a new environment choice, unpin a Project or mutate semantic context. At other intensities, it still respects current Project pins, context, animation preferences and decorative `aria-hidden`.
- **`visual-intelligence-canvas.css`** removes light/grain, image transitions and software-renderer blur/compositing when the policy selects a low-resource scene. Original dense analytical surfaces remain matte/opaque. `@media (prefers-reduced-motion: reduce)` and `data-reduced-motion` rules stay intact.
- **`visualEnvironment.ts`** catches optional storage writes/removals. Only presentation-scoped pins and runtime environment state are retained in a **process-local, in-memory fallback** if disk persistence is unavailable; it never claims a disk save, adds a new provider or suppresses a storage denial affecting a separate permission or data flow. Persisted pins still take precedence over inference, and unpin clears matching runtime continuity even when removal fails. Events still dispatch so users can see a newly selected environment in their current session.

## Tests and evidence

Added **6 executable policy tests** in `src/client/src/lib/visualCanvasPolicy.test.ts`, **5 executable denied-storage tests** in `src/client/src/lib/visualEnvironmentResilience.test.ts`, and **8 static source/asset contract tests** in `src/script/validate_ws12_visual_environments.test.mjs`. Existing `src/client/src/lib/visualEnvironment.test.ts` remains and must pass as well.

From `src/` on **exact reviewed PR head**:

```bash
node --import tsx --test client/src/lib/visualCanvasPolicy.test.ts client/src/lib/visualEnvironmentResilience.test.ts client/src/lib/visualEnvironment.test.ts script/validate_ws12_visual_environments.test.mjs
npm run test:ux
npm run acceptance:ux
```

| Evidence | Status |
| --- | --- |
| Source work and tests committed in draft PR | IN_PR |
| Exact-branch Node, TypeScript check and GitHub CI | PENDING |
| All 10 standard and 10 lightweight SVGs present in repository | SOURCE_CONFIRMED |
| 320/390/768/1280/1440px screenshots (before/after; scene opt-out) | NOT_RUN |
| 200% zoom, keyboard focus and text contrast with visual modes on/off | NOT_RUN |
| Real OS reduced-motion and software renderer resource profile | NOT_RUN |
| Real private WebView/storage denial with Project pinned choice/unpin | NOT_RUN |
| Actual native macOS/Windows package and VoiceOver/Narrator | NOT_RUN |
| Independent approval, protected-main merge, release acceptance | PENDING |

## Dependency and ownership control

[PR #108](https://github.com/kiranvbiim-coder/lios-terminal/pull/108) owns workbench comfort/preferences in `TerminalUxSettings.tsx`; this PR does **not** edit that component. [PR #125](https://github.com/kiranvbiim-coder/lios-terminal/pull/125) owns canonical graphite/gold tokens in `terminal-shell.css`; no edit here. [PR #131](https://github.com/kiranvbiim-coder/lios-terminal/pull/131) owns OS-level portal motion focus and `index.css`; this PR leaves both untouched. The plan already provides the 10 environment assets, so no donor intake, external images, Kibo/shadcn copy, runtime permission change or package update was necessary.

Before accepting WS-12: confirm in an actual rendered authenticated LiOS window that Focus and disable show a solid matte; immersive and contextual scenes switch based on Project/semantic selection; low-resource/software scenes never preload the large assets; returning from Focus restores the same saved choice without overwriting Project pins; and neither a denied storage write nor an image load failure can break the underlying Chat and analytical work. Attach exact commit/target environment logs and screenshots to #91. This PR is **not** a claim that those native acceptance checks have passed.

**Next:** WS-13 — universal authentication/entry journey.
