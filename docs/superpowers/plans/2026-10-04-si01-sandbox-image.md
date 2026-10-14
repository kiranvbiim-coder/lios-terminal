# SI-01 Immutable Sandbox Image Plan

**Goal:** Supply the existing strict SI-01 sandbox backend with one locally built, immutable, verified OCI image containing the exact SP-01 document/spreadsheet tools.

**Authority:** Existing `sandbox-runtime-profile` + container backend + SI-01.16 provisioning. This plan does not create another runtime, package manager, registry, or hosted execution service.

**Pinned capability contract:**
- Node 22.12.0
- Docling 2.129.0
- vendored SheetJS 0.20.3
- `/bin/sh`
- `/usr/bin/base64`
- `/bin/tar`
- `/usr/bin/python3`
- `/usr/bin/node`
- `/opt/lios/node_modules/xlsx`
- numeric runtime user `10001:10001`

## Safety / provenance rules

- Base images must be named OCI references pinned with `@sha256:<digest>`; mutable tags fail before build.
- Build and runtime use an explicit local `unix://` Docker/Podman endpoint.
- Runtime uses the local built `sha256:<image-id>` with `--pull=never`; no LiOS-operated customer runtime cloud or registry is required.
- SheetJS is installed only from `vendor/xlsx-0.20.3.tgz`.
- No credential or API key is copied into the image.
- Runtime verification is read-only, network-denied, zero-capability and non-root.
- Isolated PDF parsing uses Docling's model-free native PDF pipeline so network-denied execution never needs a runtime model download.
- Docling's direct version is pinned. Transitive Python wheel/hash locking is a separate SI-01.16 release gate; hashes are not invented here.

## Tasks

- [x] Add a canonical image contract that matches strict runtime defaults and rejects mutable base refs / remote engine targets.
- [x] Add contract tests for paths, versions, base refs, target and local image id.
- [x] Add the OCI image recipe using immutable injected bases, Node copied from its pinned base, vendored SheetJS, and Docling 2.129.0.
- [x] Add local build/verify tooling that records exact base refs, final image id and observed tool versions.
- [x] Add optional direct handoff from verified image into existing `acceptance:si01-isolation-v2`.
- [x] Run focused offline-Docling contract + `npm run check` on self-hosted macOS (workflow run `37268554520`: PASS).
- [x] Resolve and record exact official Python and Node base digests through the explicit local Docker daemon.
- [x] Build and verify the immutable image on the explicit local engine.
- [x] Run the real SI-01.12 V2 harness with `--v2` on macOS arm64 (workflow run `37268794674`: 9/9 required PASS, 0 required FAIL).
- [ ] Merge only after integration owner accepts the validated branch into the SI-01 integrated candidate.

## Proven validation evidence

Self-hosted target: macOS arm64, Node `v22.12.0`, local Docker/Colima socket.

Immutable bases used for the successful V2 run:
- Python: `python:3.12-bookworm@sha256:e91fec3d1ac69f04e4eddcd29c327e630ce34658cf31075bfa7e8b0e052bafea`
- Node: `node:22.12.0-bookworm@sha256:0e910f435308c36ea60b4cfd7b80208044d77a074d16b768a81901ce938a62dc`

Verified local image:
- `sha256:94886944facc4d6ccd72b250a95ce3c9c5ea326f1221d72b74bc82c4d6bd2a42`

Required V2 checks proven green:
- workspace copy bridge
- host filesystem denial
- network denial
- PID limit
- runtime hardening (uid 10001, zero effective capabilities, no-new-privileges, read-only root)
- cancellation/extinction
- real Docling document parse
- Project PDF isolated route
- spreadsheet isolated route

Those five checks describe the historical SI-01 image above. SI-02 browser assets are now prepared in the canonical offline assembler, but browser qualification remains pending the real image and brokered navigation/cancellation/extinction proof; no historical image ID qualifies the new browser payload.

## Operator command

From `src/` on the self-hosted Mac:

```bash
export LIOS_EXECUTION_SANDBOX_ENGINE=docker
export LIOS_EXECUTION_SANDBOX_TARGET='unix:///path/to/local/docker.sock'
node script/sandbox_image_release.cjs sandbox-image-inputs sandbox-image-candidate --acquire-browser
node --import tsx script/si01_sandbox_image.ts --v2
```

The script prints and records the resulting `LIOS_EXECUTION_SANDBOX_IMAGE=sha256:...` value. That exact local image id is the only runtime image reference accepted for the resulting evidence.

### SI-02 Linux arm64 browser closure — 2026-10-06

`sandbox-image/source-lock.json` is the only image/runtime source owner. The legacy network-building `sandbox/si01/Dockerfile` is not invoked by the operator script; builds now delegate to `script/sandbox_image_release.cjs` using the existing locked base image, Node archive, Docling wheel/model closure, and browser inputs. Buildx uses `--pull=false --network=none`; `install-browser.py` independently verifies every browser input hash inside the build, installs the exact Debian package versions offline, validates module `browsers.json` and the native library closure, retains notices, and installs the configured worker paths:

- `/opt/lios/node_modules/playwright-core` — approved donor dependency 1.63.0, npm SHA-512 SRI verified, commit `1b025d7e20a026371cd5f98ba0cdce48892737c8`; LICENSE/NOTICE retained.
- `/opt/lios/browser/chromium` — open Chromium revision `1243`, version `153.0.8010.12`, archive SHA-256 `f144b7f58b61c6bea2c192c4c178faa9b606bdf758e2d47ca99fa03f759a13e4`; explicit executable path avoids host-browser discovery.
- `browser-artifact-inventory.json` and `browser-dependency-inventory.json` — independent SHA-256 locks, exact HTTPS URLs, 116 arm64/all Debian packages whose hashes matched signed APT metadata, source-package/version references and copyright paths.

The approved Playwright package defaults to Chrome for Testing in its current registry. That proprietary archive was inspected but is **not** shipped: its ABOUT says Google Chrome/all rights reserved and it includes Widevine. The matching open Chromium archive from [Microsoft's revision CDN](https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1243/chromium-linux-arm64.zip) contains no Widevine and matches the package's Chromium revision; it wins over both proprietary CfT and an unmatched Debian Chromium version. The Chromium [BSD license](https://raw.githubusercontent.com/chromium/chromium/153.0.8010.12/LICENSE), embedded `chrome://credits`, module notices, Debian copyright files/common licenses, and exact source references are retained. Actual runtime compatibility still requires proof, not this metadata comparison.

Acquisition is online and hash-locked; existing correct inputs are reused, corrupt/missing/unavailable inputs fail closed. The image build is offline. `--candidate` permits building/exporting an **unqualified** image into a separate output directory; the checked-in lock remains `releaseStatus=inputs-locked`, `verifiedImageId=null`, browser qualification pending. No build, navigation, cancellation or extinction result is asserted by this preparation.

For a capacity-constrained host, `--reuse-runtime-base` is an explicit optional build input treatment, not a fallback. The full source build remains the default. It adds only the locked browser payload offline to the independently pinned previously shipped image `sha256:f17d897b7f01fb8e9389faf83ca9db7178cb620c2f8fd8f95b18eda95deb7cde`. The existing baseline release manifest (SHA-256 `82e36b1a88b8b39a9f29040670150bbc26c70cd64fac432c4e787d15710822b6`) and source lock (SHA-256 `c229904193c2e290fc277e501b62f9e5ca433ae14e76fdec5ca55fa586955818`) must match, as must current Node/SheetJS/Docling/base source pins. The local engine must have exactly that immutable ID/platform; no mutable tag, automatic download or unverified archive import is accepted. A deny-network/rootless probe rechecks installed Python/Node/SheetJS, every locked wheel version, OpenCV import/version and all Docling model bytes/layout before extension. The final extended image still runs the full smoke and requires the same parent browser qualification. Preserve baseline metadata before replacing `sandbox-image-dist`; `LIOS_SI01_SANDBOX_RUNTIME_BASE_RELEASE` may identify a preserved directory, but cannot change its trusted hashes.

```bash
node --import tsx script/si01_sandbox_image.ts --reuse-runtime-base
```

Actual prepared input sizes: browser artifacts/dependencies **266,755,960 bytes** (~254.4 MiB), Chromium expanded entries **673,406,885 bytes** (~642.2 MiB); full source context inputs total **2,225,383,652 bytes** (~2.07 GiB), including the 1,438,596,608-byte Docling model tar and 416,324,388-byte wheelhouse. Reuse removes those large inputs from the build context and avoids re-extracting inherited runtime layers. APFS scratch payload copies use `COPYFILE_FICLONE` (filesystem clone when supported; normal copy otherwise). Exporting a complete installer image still needs a full archive: the existing baseline compressed archive is **3,531,956,432 bytes** (~3.29 GiB), so reuse does not claim a browser-only installer or eliminate final archive space. Extended archive/layer footprint remains an estimate until the real build/export.

When exporting a qualified image built this way, pass both `--reuse-verified --reuse-runtime-base` to retain inherited-runtime provenance; this does not rerun the build. Use a fresh release-output directory, then perform the parent's controlled installer metadata cutover.


After parent proves the actual image and browser journey, it must record the exact image ID, set browser qualification to `qualified` and releaseStatus to `ready`, then assemble the installer payload from that exact local image without rebuilding:

```bash
node script/sandbox_image_release.cjs sandbox-image-inputs sandbox-image-dist --reuse-verified
```

Normal desktop packaging already copies `sandbox-image-dist`; its canonical desktop/server provisioning owners now require the exact qualified image ID, browser provenance and inventory hashes, inject the locked in-image browser paths, and reject legacy/host-path overrides. Browser assets reside inside the exported image rather than outside the installer. Missing Docker Buildx/local engine and any unavailable locked upstream artifact remain environmental prerequisites; redistribution notices/source references must remain with the artifact.

