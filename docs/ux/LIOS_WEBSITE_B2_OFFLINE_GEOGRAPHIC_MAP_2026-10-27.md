# LiOS Website Donor B2 — Offline Geographic Intelligence Map

**27 October 2026** · [Website gap tracker #258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258) · Stacked on B1 [#274](https://github.com/kiranvbiim-coder/lios-terminal/pull/274) → A4 #270 → A3 #266 → A2 #263 → A1 #261 → cumulative #253.

## Real source implementation

**User journey:** From an existing Project, open Investigation → choose a source-backed P7 insight → Geography. The previously blank coordinate-only diagram now draws **real (generalized) world coastlines and country boundaries** from a fully local, prebundled Natural Earth map. Only P7 geography nodes with valid **numeric, already recorded** latitude/longitude which connect to the chosen insight are plotted. No search-based guessed geocoding, no network tiles, no external map key, no device location, no user coordinates uploaded.

- **World atlas:** `src/client/public/maps/natural-earth-110m-world.svg` is a static, 128 KB, offline vector basemap derived from the original Natural Earth **1:110m admin-0 countries** GeoJSON. Source pinned at [`nvkelso/natural-earth-vector@ca96624a56bd078437bca8184e78163e5039ad19`](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_admin_0_countries.geojson). Source includes 177 country features. Geometry was transformed to a deterministic 1152 × 576 equirectangular projection, coordinates rounded to 0.1 drawing units; **one antimeridian-crossing ring** was split into stroked segments rather than drawing a false solid line across the globe. The atlas is deliberately simplified, **not** detailed local streets or politically authoritative borders.
- **License:** Natural Earth provides all map vector/raster data **in the public domain**, including commercial derivative/electronic redistribution: [Natural Earth Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/). This does not grant rights to commercial hosted maps or third-party imagery. We bundle only the derived world SVG; no third-party basemap service is invoked. Public-domain attribution is optional, but we credit Natural Earth in the UI and source.
- **Presentation:** `OfflineProjectWorldMap.tsx` replaces only the existing Project geography diagram inside `ProjectInvestigationDesk`. Accurate equirectangular pin positions, pan/zoom/fit controls, keyboard arrow-key viewport panning, focusable pins plus keyboard-accessible list, source ID/time detail, source-linked and date-layer filters, honest bounded count (at most 60 pins), empty states, responsive 310/420px viewport. Users see a failure notice if the bundled atlas is not present; **no online fallback** is requested. Alt/aria labels acknowledge that the geometric country outlines are decorative, while the meaningful details and evidence references are available in text.
- **Canonical authority:** `recordedGeographicPoints(projectId, validGraph)` and the existing `recordedConsequenceTrail` determine eligibility. The map is **read-only**; its presentation helper independently rejects invalid/overflowing/NaN coordinates and duplicates. The same Project Intelligence owner handles the selected insight, Chat action and authorization. The evidence list, relationships graph, Scenario/P4 Artifact path and P9 alerts remain unchanged.

## Exact accepted scope and limitations

- P7 sourceRef is an **evidence reference**, not independently validated location truth or a public URL. Geography with no sourceRef is visually differentiated and labeled unverified; date filter uses only stored `occurredAt`, never implied timestamps. Nothing is inferred from the basemap shape.
- Natural Earth's generalized boundaries include simplification and disputed boundary policies. Do not use the atlas for legal sovereignty adjudication, cadastral claims, high-precision routing, emergency navigation or election boundary determination.
- **MapLibre candidate**: reviewed `maplibre-gl` as a BSD-3-Clause interactive renderer with local GeoJSON layers. **Not imported in this PR** because npm-ci lockfile compatibility/renderer/bundle and WebGL native acceptance could not be reliably verified using connector-only GitHub editing. An accurately pinned, locally bundled world atlas with existing React/SVG markers avoids breaking source CI and works offline with no tile API or paid provider. If advanced layer styling, GIS geometry interactions or datasets require MapLibre in a subsequent benchmark, generate a reproducible lock update, import its correct BSD-3-Clause notices and run installed Electron/WebGL tests. **Do not misrepresent the current viewer as MapLibre.**
- A real high-zoom street, ward, building, road or satellite map is **not implemented**. No rights-cleared offline street-tile package has been imported. Explicit P7 node-level source references remain necessary, and no live geolocation access is added.

## QA

`offlineWorldMapPresentation.test.ts` covers world-edge/normal projection, source/date gating, NaN/string rejection and the60-pin limit. `OfflineProjectWorldMap.test.tsx` exercises SSR, controls, attribution/keyboard details, no online URLs and the sanitised public SVG asset, alongside existing P7/Investigation behaviors. Incidental source-wiring assertions were removed, not treated as geolocation/network execution proof. `npm run test:website-b2` retains these behavior tests.

```bash
cd src
npm run test:website-b2
npm run check
npm run test:offline
npm run build
```

**Code committed for review, not accepted:** hosted CI must pass. On actual macOS ARM64 and Windows x64 Electron, verify local atlas loads while offline, 390px/768px/200% zoom, keyboard/Tab/arrow-pan/marker focus, screen reader, focus traps, high-density map memory, project switching, source revocation and no network requests. Never claim installed acceptance or release simply because the public-domain map file exists.

## Next

**B3:** target remaining Kibo/beUI source-backed comparisons and analytical chart presentations *only* where actual typed LiOS source data supports them. Do not duplicate existing ECharts, add a decorative dashboard, launch paid map tile services, or reintroduce false map evidence. Then C1 typed AI visual answer authority and C2 real Scenario → P4 receipt/Artifact. Keep #258 as the sole website-donor work tracker and #91 as release-readiness gate.
