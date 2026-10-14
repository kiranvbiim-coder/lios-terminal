# LiOS Visual Environment Assets

This directory stores the editable vector masters for the production Visual Intelligence Canvas.

The ten canonical scenes are an optional library, not the shell default. New/unconfigured workspaces use the supplied Figma graphite/gold matte background with Barlow Condensed display/Inter prose/JetBrains Mono data; explicit saved environments are retained. Neutral is an enabled-library fallback, never a mandatory onboarding choice.

## Asset chain

```text
assets/visual-environments/masters/<scene>.svg
  → curated/optimized packaged desktop scene
src/client/public/visual-environments/<scene>.svg
  → simplified no-heavy-filter fallback
src/client/public/visual-environments/low-resource/<scene>.svg
```

The SVG masters are LiOS-authored project assets with no third-party images, logos, embedded fonts or stock artwork. The public manifest records scene ownership, safe-zone metadata and versioning.

The packaged files intentionally keep the center quieter than the edges. Dense analytical surfaces remain opaque and the Visual Canvas CSS controls how strongly each scene appears in Immersive, Contextual and Focus modes.

Preserve reduced-motion static rendering, disabled-imagery/solid and low-resource/software/reduced-data fallbacks, bounded current/likely-next preload and stable Project restore. Source assets and screenshots do not establish human aesthetic sign-off, packaged acceptance or release proof.

Do not replace these with generic finance wallpapers. New revisions must follow `docs/ux/VISUAL_ENVIRONMENT_PRODUCTION_BRIEF.md` and the one-time review in `docs/ux/VISUAL_ENVIRONMENT_AESTHETIC_REVIEW.md`.

Delivery follows the existing TC/GM/CA/P authorities under `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`. SP-01–SP-07 require real journeys, target execution where applicable, no fakes, accepted-behavior regression protection and exact evidence records; P14 remains final release authority. This asset record asserts no accepted Shipping Point or release.
