# LiOS website assimilation A4 — one Home/Search/Chat discovery journey

**27 October 2026** · [Website gap tracker #258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258) · A4 stacked on A3 [#266](https://github.com/kiranvbiim-coder/lios-terminal/pull/266) (A2 #263 → A1 #261 → main integration #253).

## Implemented in source (real files, not another roadmap)

### 1. One reviewed source → Chat handoff
The **existing** `ProjectExperienceShell` Search action already provided an explicit guarded `stageUniversalChatQuestion(current, pulseStoryQuestion(card))` and a user-reviewed Send. A4 makes that **the single shared function** `stageRecordedIntelligenceToChat` for **both** Search's Intelligence tab and the existing Home Intelligence panel. Home cards now expose an accessible Ask LiOS button alongside attributed citations and the canonical Inbox review actions.

No new Chat, Project, temporary context, second source index, privilege grant, external provider subscription, auto-send or silent text replacement. The preexisting composer retains unsent text and refuses a stage while sending, creating a Chat/Project or holding unsaved Artifact edits. The user must choose Send. Rejected and failed stages remain in Home and show actionable errors without claiming anything ran.

### 2. Real user-reviewed What Changed checkpoint
`GET /api/wave-d/pulse` returns `discoveryChanges` derived from **currently authorized and visible Wave D cards**, their retained source IDs and their own recorded timestamps. The user explicitly clicks **Mark current source snapshot reviewed**, which calls the existing authenticated Wave D authority through `POST /api/wave-d/pulse/review` (no user-supplied card IDs or fake observed facts). The endpoint computes and persists SHA-256 revision fingerprints inside the **existing per-user tenant-scoped Wave D preferences**, at most 120 card records. No news text, external URLs, credentials or new database are persisted as history.

Before the first review, the status is `not_reviewed`: never pretend the user visited before. After a confirmed saved review, Home can show a count of **new or revised recorded card/source-reference identities**. An optional “Show only new or revised” filter narrows this existing source feed, retaining existing Home subject/source filters and pagination. Duplicate/reordered source lists are stable, and records without a retained source identity are not incorrectly called new evidence.

This is **not a historical world-event diff** and does not infer source additions/removals, causal explanations, important macro changes, publication updates, personal reading time or why the business world changed. Project P6 What Changed remains its separate, canonical aggregate-snapshot owner. The previous source reviewed checkpoint may not include data unavailable/offline at capture time, so a later authorized card may appear new when it re-enters the available feed. This is described as **recorded source revision continuity**, not a factual difference to the world.

The canonical Action Inbox, P9 automations/monitoring, independent Watchlists and user Follow/Mute remain unchanged. Acknowledging the discovery snapshot never resolves an alert or submits a model request. A3 muted subjects cannot reappear through comparison because the comparison is computed over the already server-filtered visible cards.

### 3. Responsive / continuity safety
Home remains an **optional, collapsed** section inside a non-temporary empty conversation. No new Home sidebar destination, no expensive initial fetch, no duplicate published feed, no image scraper. Source citations remain safe HTTPS/HTTP links with secrets rejected by the existing `safePulseSourceUrl` guard; no auto-navigation. Review, filter and Ask controls reuse 40px+ touch targets, text wrapping, 1-column-to-2-column responsive Home layout, keyboard-focus outlines, inline `role="alert"/"status"` and existing 390px+ layout rules.

Home's React Query identity now includes the authenticated account scope, with zero cache retention after unmount and refetch on mount. This is a defense against accidentally showing a previous account's cached Home data in a shared desktop session, not evidence of full multiaccount native testing.

### 4. Evidence added
- `src/server/pulseReviewContinuity.ts` and focused pure test: stable cryptographic source fingerprints, no URLs/contents saved, unchanged/new/revised/missing evidence, malformed history, 120-record bounds.
- `src/server/waveDRoutes.test.ts`: actual isolated database/test server, explicit review, forged-ID 400, saved status, new card comparison, separate owner account and unchanged actionable Inbox.
- `src/client/src/components/terminal/HomeAttentionPanel.test.tsx`: static render with honest Ask UI, no automatic execution and staging-disabled state.
- `src/client/src/lib/websiteA4Integration.test.ts`: single Chat handoff, no extra permission/Project switch, scoped Home read, explicit review, existing authenticated Wave D write.
- Updated existing Phase 2 Home/Search source integration assertions to check the new shared handoff.
- `cd src && npm run test:website-a4 && npm run check && npm run test:offline`; existing **standard public Linux** source CI adds the focused command. No paid runner, new dependency or release credential.

## Release/UX gates not yet accepted

A4 is **code committed for review**, not installed acceptance or a guarantee of screenshot-perfect 390px/768px/200% zoom, screen-reader behavior, Electron restart, offline/reconnect, login switch and live provider source revisions. Verify on actual packaged macOS ARM64 and Windows x64 before any release claim, as required by #91. CI TypeScript and unit results must pass first; parent stack may have unrelated red premium-chat tests, which must not be silently ignored.

## Next website donor work (keep #258 as owner)

The four **A** discovery slices (A1 safe story clustering, A2 strictly licensed local media, A3 durable Follow/Mute, A4 source-to-Chat/explicit review) now have code candidates. Do not reopen them by importing decorative kits unless real native QA finds a defect. Proceed to **B1: interactive evidence graph using suitable MIT React Flow donor implementation over existing P7 GraphExplorer and permissions**, then **B2: MapLibre only with legal/offline base map rights**. Kibo/beUI chart import remains conditional on a proven typed data/UI gap. No unrelated UX shell rewrite or duplicate feature phase.
