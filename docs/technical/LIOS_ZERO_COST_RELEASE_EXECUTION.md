# LiOS Terminal — $0 Release Execution Contract

**Owner decision:** 2026-10-26  
**Scope:** `kiranvbiim-coder/lios-terminal`, SI-07 integration, P10 desktop packaging, public beta distribution, and release operations.  
**Budget:** **Exactly $0 in additional cash expenditure for product release. This is a binding constraint, not a preference.**  
**Tracking:** [master closure issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91); use existing subsystem owners and P14 evidence. Do not open a duplicate master roadmap.

## 1. Non-negotiable cost and security rules

1. **No purchase or charge authorization.** Do not buy or require Apple Developer Program membership, Developer ID certificates/notarization, commercial Windows Authenticode signing, paid CI minutes/runners, cloud services, hosting/CDN/bandwidth, new domains, distribution platforms, support SaaS, paid SDKs, or other release expenses. Do not activate overage-billed or trial-to-paid services. Startup credits or "free until billed" are **not** a release prerequisite. Existing owned website, hardware, public-repository free standard GitHub Actions (within actual free-use limits), and public GitHub Releases are eligible.
2. **Stop at a cost gate.** If a step cannot be performed without a fee, explicitly mark it `BLOCKED_BY_ZERO_COST`; present a no-cash alternative or defer the feature. Never spend, ask for payment details, quietly switch to a paid provider, or suggest cost as the default workaround. Recheck usage limits and asset size before publishing.
3. **No false security claims.** Ad-hoc signed macOS packages are **not notarized**. Unsigned Windows installers are **not Authenticode trusted**. OS warnings and user-approval friction must be disclosed. Do not prescribe automated removal of quarantine, blanket Gatekeeper/SmartScreen disabling, trusting self-signed roots, or automatic `Run Anyway` prompts as the normal experience.
4. **Never weaken LiOS security to save money.** Preserve Electron `safeStorage`/OS credential custody, local-first private data boundaries, session/tenant permissions, update authenticity, pinned dependencies, sandbox, rights checks, and fail-closed behavior. Do not store BYOAI keys with application-embedded encryption keys. Do not set `verifyUpdateCodeSignature = false` in the existing production updater or silently install unauthenticated beta updates.
5. **Preserve release truth.** P14's production acceptance still explicitly requires Windows signing and macOS Developer ID notarization. The $0 beta is a separately named, lower-trust release channel. It **cannot** pass `P14 production qualified` by relaxing/faking evidence or marking unsigned binaries signed. Do not change P14's production validator to force a green result. A publicly downloadable beta is not production-certified.
6. **No product-scope regression.** Ship one installable user-owned Electron application with LiOS general AI, professional work/Artifacts, research, specialist finance, automation and connected capabilities as exercised/available. Do not turn LiOS into a finance-only or mandatory vendor-cloud service. Defer optional platforms/features transparently instead of hiding capability gaps.

## 2. Source-derived baseline to reuse, not recreate

At owner-decision time, public `main` is `12345140d1341e6933d762a2c9c50a0c0b6d7d9c`. Source CI on that commit passed on Windows, macOS and Linux; the public repository had **no GitHub Releases** and only `.github/workflows/source-cross-platform.yml`. This is historical inspection evidence, not a perpetual status claim: **recheck current main, PR heads, CI, assets, and branch protection before every implementation.**

- Electron 41 / `electron-builder` 26 / `electron-updater` 6 (verify current installed lockfile before editing).
- Reuse `src/script/desktop_build.cjs`, `src/package.json`, `src/desktopMacPackSigning.cjs`, `src/desktopUpdater.cjs`, `src/desktopSecretCustody.cjs` and existing P10/P14 checks.
- Native Python sidecar build and validation: `src/script/build_python_sidecar.cjs`, `src/script/verify_packaged_python_sidecar.cjs`. Package native/sandbox runtime assets, migrations, notices and the correct executable architecture.
- Existing `extraResources`, app-asar integrity fuses, headless packaged self-test and user-confirmed updater are foundations; keep working production code intact.
- Production workflows referenced in `docs/technical/P14_DESKTOP_LAUNCH_QUALIFICATION.md` are **not present** in this public source tree. Do not fabricate their existence, copy private workflows or inject protected credentials. Reconcile under the existing owner.
- Root `LICENSE` reserves rights in original LiOS code; public visibility does not turn it into OSI open source or qualify it for open-source-only signing subsidies.

## 3. Target channels

| Channel | Cost | macOS | Windows | Updating | Claim permitted |
| --- | --- | --- | --- | --- | --- |
| Local developer package | $0 | Ad-hoc signed or locally verified as appropriate | Local test pack | None | Development test only |
| **Zero-cost public beta** | **$0** | Apple Silicon DMG/ZIP, correctly ad-hoc signed; no notarization | NSIS x64 per-user unsigned installer | **Manual release verification + explicit user-installed upgrade** | Beta / unnotarized / unsigned Windows, with limits |
| P14 production (existing contract) | Not achievable under current $0 signing constraint with standard commercial distribution | Requires Developer ID signing, notarization/stapling | Requires trusted signing | Signed-updater qualification | **Not accepted under $0 beta** |

Start with macOS ARM64 on existing Mac hardware and Windows x64 on a standard free GitHub runner or an existing Windows system; require independent installed Windows acceptance. Intel macOS and Linux can follow only after core targets pass, without additional spending. Do not imply Homebrew or winget eliminates OS trust checks.

## 4. One execution queue; no new program

**R0 — Reconcile and freeze the candidate (SI-07 / issue #91).** Read `AGENTS.md`, `docs/PENDING_WORK.md`, open PRs, actual `main`, source CI and relevant security/rights ledgers. Land reviewed prerequisite changes in dependency order; do not merge outstanding drafts blindly or overwrite another agent's work. Pin one commit, lockfile and package version. **Exit:** passing source checks and an exact build identity, with remaining unmerged dependencies explicit.

**R1 — Create isolated $0 beta package modes (P10).** Extend the existing build wrapper with explicit `beta-mac` and `beta-win` modes while retaining current strict `mac`/`win` production paths. Mac: ARM64 DMG + ZIP and verified ad-hoc signing; audit nested code and entitlements. Windows: x64 NSIS one-click current-user install (`perMachine: false`; no default administrator requirement); test install directory and data retention. Build sidecars **on each target OS/architecture**. **Exit:** real package assets, not only source or `--dir` output.

**R2 — Prove self-contained runtime and secrecy (P10/P14).** Verify the packaged Python sidecar, native runtime, sandbox image, migrations, legal notices, cold startup/shutdown, secret custody and no write into sealed macOS resources. Review `mac.signIgnore`, JIT/unsigned-memory entitlements and Keychain continuity. Fail on missing, incompatible, oversize or unlicensed assets; no fake placeholders. **Exit:** installed native self-test and exact package inventory with hashes.

**R3 — Authenticate beta releases and handle updates safely.** Keep auto-install of unsigned beta updates **off**. A manual-upgrade notice may point to an **allowlisted official HTTPS release URL**; verify a release manifest using a locally controlled Ed25519 public-key trust root embedded in LiOS (plus hashes and version/channel checks) before identifying binaries as verified. Private signing keys never enter the public repo or untrusted CI; establish rotation/recovery before publication. If verification is not implemented/proven, show a plain official download notice without any verified claim; do not auto-execute it. Preserve `electron-updater` production flow and downgrade prohibition. **Exit:** real `beta.1 → beta.2` upgrade/reinstall and interrupted/corrupt download recovery without loss of workspace or vault.

**R4 — Free distribution (SI-07).** Prefer public **Releases on the existing repository** initially to avoid cross-repository credentials. Separate `desktop-beta-*` tags from production release refs; require owner-approved manual publishing, least-privilege credentials and exact tag/commit/package-version matching. Publish DMG, ZIP, NSIS, signed manifest/checksums, release notes, known OS warnings, and privacy/rights/support documentation. Ensure each asset is within the host's actual size limit and verify upload/download bytes. Put official download links on the **already owned** Limuria website only after links exist; do not invent filenames or URLs. No publishing on every `v*` push. **Exit:** links from the website download the exact reviewed release assets.

**R5 — Native end-to-end acceptance (P14 evidence remains separate).** Clean-install the exact candidate on macOS Apple Silicon and independent Windows x64. Exercise sign-in; ask-first Chat without mandatory connectors; real permitted BYOAI and connected evidence; research; Chat → Artifact sidecar → original Workbench → edit/export → return; one deterministic financial calculation; save/relaunch; permission revoke/deny; automation on a supported user-owned topology; backup/restore; update/recovery. Assess high zoom, keyboard, VoiceOver/Narrator, streaming, memory and startup. Use actual permitted data, no fabricated evidence. **Exit:** a beta-specific observed pass/fail board and reproduction steps for blocking defects; do not issue a `P14 passed` board.

**R6 — Public beta approval and maintenance.** Release only after R0–R5 have native evidence and no unresolved critical security/data-loss/installation defects. Label `beta` prominently; disclose unsigned Windows and unnotarized macOS warnings and possible launch restrictions. Provide manual verified download and recovery instructions, release notes, hashes and exact limitation list. Subsequent updates repeat all relevant gates. **Exit:** installable, honestly described $0 public beta with a working and repeatable release path.

## 5. Executable gates and progress reporting

Run the appropriate existing source gates from `src/` (e.g. `npm run check`, `npm run test:offline`, `npm run test:desktop`, `npm run build`, `npm run audit:licenses`, and platform-specific pack/sidecar verification). For beta, do **not** run the production-only signing preflight as though it could pass; add an explicitly scoped beta preflight that checks everything applicable and retains missing proof as failures. Follow `docs/technical/P14_DESKTOP_LAUNCH_QUALIFICATION.md` for production evidence rules.

Current beta commands use the existing build owner:

```sh
LIOS_BETA_VERSION=1.0.0-beta.1 npm run app:beta:mac
```

On Windows x64, set `LIOS_BETA_VERSION` in the shell and run `npm run app:beta:win`. Both modes require native sidecars and the qualified sandbox release; neither publishes. `-- --dir` is available only for local signing/launch qualification and does not produce installer acceptance. Embedded beta metadata disables the production updater; production `app:dist:mac` / `app:dist:win` keep their signed paths. Mac beta uses a bounded custom signing hook, beta-only entitlements and explicit Resources Mach-O verification while retaining the hash-pinned native-runtime exclusion. Actual installer, nested-code launch, upgrade and rights proof remain required.

**2026-10-26 size work:** owner selected single-installer optimization before multipart distribution. The previous Mac bundle occupied about 5.9 GiB, including a 3.8 GB sandbox archive. Docker history exposed redundant archived build inputs retained in lower layers; canonical Dockerfiles now use offline read-only BuildKit mounts instead. The old qualified image/source lock is not replaced until a new candidate passes numerical/model/browser/isolation qualification. No capability removal or new paid storage service is authorized by this optimization.

Every agent working this plan must report: **canonical owner + existing issue/PR, exact SHA and version, changed paths, actual commands/results, package OS/architecture and SHA-256, spent $0 / any blocked fee, native installed evidence, rights/security result, limitations and next single actionable dependency**. A unit test, green source workflow, synthetic JSON, unsigned package or PR merge must never be promoted to a native installed acceptance claim.

Do not change signed-production validators or bypass security policy to obtain a green beta status. Existing P14 issues including visual-count disagreement (9/13/15), shared release-asset overwrite names and missing actual Windows visual proof remain release-path issues; resolve under their current owners.

## 6. Agent coordination

- **Agent entry point:** `AGENTS.md` → this contract → `docs/PENDING_WORK.md` → issue [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91) → existing SI-07/P10/P14 and UX/security owners.
- **Do not open another master issue or duplicate subsystem.** Make small reviewed branches/PRs against current protected `main`, coordinate with existing work and preserve current user-facing architecture.
- **Cost gate is absolute:** if a signed/notarized commercial install is unavailable for $0, preserve it as an unmet P14 requirement rather than paying, bypassing OS protections, or inventing qualification.
- **Release goal:** ship an actual reliable customer-usable zero-cash **beta**, then iterate only with zero-cash methods; never promise a universally frictionless/warning-free commercial installation without required platform trust.

## Verified split-download transport — owner selected 2026-10-27

The complete Mac beta exceeds the per-asset hosting limit. Preserve its full capabilities and installer bytes; distribute numbered parts plus an Ed25519-signed transport index. This is not automatic installation, OS signing, native acceptance or owner publication approval.

Owner-only offline splitting: `node script/beta_release_parts.cjs split INSTALLER PARTS_DIRECTORY INDEX_JSON`, supplying the Ed25519 private PEM through standard input from owner-controlled off-repository storage. Never place private key bytes in argv, environment, repository, public CI or release assets. Default parts are at most 1,000,000,000 bytes. Output directories must already exist. Existing output files are never overwritten.

Recipient reassembly: `node script/beta_release_parts.cjs join INDEX_JSON PARTS_DIRECTORY OUTPUT_DIRECTORY INDEPENDENT_PUBLIC_KEY_PEM`. Obtain that public key through a separately verified owner channel—not merely beside the download. Signature, ordered part names, each size/hash and the complete installer hash are checked. The final filename appears only after successful verification; partial staging is removed on failure. Nothing launches the assembled installer. Follow normal OS protections and explicit installation review.

Source proof: two focused behavior tests cover exact byte reconstruction, tampering, foreign keys, symlink refusal and non-overwrite. The real 2,752,494,208-byte DMG round-tripped through three parts (1,000,000,000; 1,000,000,000; 752,494,208 bytes) to SHA-256 `a9f0babda94f32803c6984c75090fbad97605d87fc55701f1028b8f4419b3ec3`. Temporary smoke parts and ephemeral test key were removed. No durable release trust root or actual publication is established by this test; source commit/version review, native journeys, independent Windows acceptance, key custody/recovery and owner approval remain required.
