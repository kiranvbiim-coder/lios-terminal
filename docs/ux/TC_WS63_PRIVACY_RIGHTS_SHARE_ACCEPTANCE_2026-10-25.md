# WS-63 — Privacy, data rights, sharing and trust UX

**Status:** stacked draft source implementation, pending CI, native-device trials, two-owner cross-tenant verification and privacy sign-off. Canonical 65-workstream plan PR #119, WS-63 (P0). Reuses four feature/test files from PR #109, which was closed without merge; avoids duplicating its share work.

## Audited security and UX gaps

- Previously the public share URL serialized an entire WorkspaceState, possibly including private Artifact projectId, chatId, artifactId, version and extra keys; it also inherited signed-in query and hash. The original tiny overlay claimed more privacy than the code implemented.
- Old incoming URL loading accepted a full WorkspaceState from untrusted ws query and could restore manually supplied private Artifact pane references before server authorization.
- Artifact export already fetched an owner-scoped plan, checking the exact content hash/version, but there was no visible rights acknowledgement, and saved trust evidence showing revoked access did not block the download UI.

## Reused and implemented boundaries

1. Safe share builder: allowlist pane view + symbol + position/focus only, preserve 1–4-pane arrangement; generic Market replaces Artifact pane. A clean HTTP(S) root link strips query, private path, hash and userinfo; file/custom protocols fail. No mutation of private source or saved layout.
2. Safe receiver: cap untrusted ws parameter at 10,000 chars; always re-project decoded state onto the public allowlist. Existing audience restrictions still apply before projection.
3. Share consent: readable Radix Dialog previews exact outgoing symbols and exclusions, requires unchecked-by-default affirmative acknowledgement before clipboard copy, and does not report successful copy on error. Local Home URLs may not be reachable by others.
4. Artifact export: explicit per-version checkbox acknowledging local copy and redistribution restrictions; explicit P3 evidence access denial, revocation or expiration blocks UI export. Remaining licensed/unknown sources display caution; no new permission is invented.
5. Preserve authenticated server route: getArtifactExportPlan(ctx(req), artifactId, version), exact P4 Artifact version/hash checks and canonical P3 manifest remain authoritative. UI is not an entitlement engine or a replacement for server ACL.

## Source checks (from src/)

```sh
node --import tsx --test client/src/lib/terminalWorkspace.test.ts client/src/lib/artifactExportDisclosure.test.ts
node --import tsx --test client/src/components/terminal/workspaceShareUxContract.test.ts
node --test script/ws63_privacy_rights_share.test.mjs
npm run check
npm run test:offline
npm run build
```

## Manual release acceptance (not yet performed)

1. Verify decoded URL, clipboard, history and receiver from a four-pane workspace with private clientdata and P4 Artifact. No private tenant/account/project/chat/artifact IDs, filename, revision, source rights or credentials. Check the original saved workspace is unchanged.
2. Forge incoming ws with private Artifact IDs, arbitrary root/pane keys, malformed values, oversize input and unsupported views. Verify audience filtering, no private artifact requests, and no cross-owner access using TWO real user accounts (server-side RLS evidence).
3. Clipboard denied / unavailable; unchecked vs checked consent; 320/390/768/1440px and 200% zoom; keyboard Tab/Escape/return; VoiceOver and Narrator focus/readout; private Home URLs and deployed subpath routing.
4. For P4 export, test source access states permitted, revoked, denied, expired, entitlement required, unknown legacy and dynamically revoked after initial plan; stale version/content hash, owner switch; PDF/XLSX/CSV/JSON/MD/DOCX/PPTX. Confirm server rights and tenant owner checks, not only the saved P3 snapshot.
5. Confirm P2 AI transmission consent, Temporary Chat boundary, P3 attribution/rights and P4 revision/source authority; no private source, permission or connector is auto-granted.

## Explicit limitations

- A saved P3 access state is NOT a real-time grant. The new UI refuses recorded denials but cannot verify an externally revoked entitlement without an authoritative server/source check at export time. Recheck source redistribution rights in the server/data layer before claiming production access control.
- Source tests and CI are not native browser authorization evidence; two-account tenant probes, active revocation, browser OS clipboard and P14 installed Electron acceptance remain open.
- Localhost/private Home share URLs may not work on another device; any deployment needing a non-root public app base path needs dedicated routing acceptance.
- Keep this PR in draft until exact-head Linux/macOS/Windows CI, privacy review and installed UX sign-off pass. WS-64 follows.
