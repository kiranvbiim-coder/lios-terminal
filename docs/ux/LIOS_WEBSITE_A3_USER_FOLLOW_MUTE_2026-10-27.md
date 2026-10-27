# Website donor integration A3 — authenticated Follow / Mute

**27 October 2026** · Tracker #258 · stacked on A2 #263 and A1 #261, above four-phase integration #253.

## Source implementation

- `shared/pulseSubjectPreferences.ts` is the canonical pure source for normalized, bounded followed/muted subject keys and retained Wave D card filtering. Mute wins; repeated case variants collapse; invalid or control-character subjects are excluded. All IDs remain real source subjectKey/symbol identifiers, never inferred from a headline, content, social network or source URL.
- `server/waveDStateStore.ts` stores Follow/Mute within the **existing authenticated, transaction-scoped `userPersonaPreferences.waveD` document**, not browser-wide storage, a fresh data service or a second feed database. Tenant + user RLS still apply. Existing stored state is normalized on load and carries the new field through unrelated Wave D writes.
- Authenticated `GET /api/wave-d/pulse/preferences` and `PUT /api/wave-d/pulse/preferences` (body exactly `{subjectKey,choice:"follow"|"mute"|"clear"}`) return the saved state and confirmation; invalid input is rejected. Retail users can control their own discovery without gaining authoring/agent authority. Preferences are not connectors or AI instructions.
- `GET /api/wave-d/pulse` applies saved follows **and the owner's existing watchlist** to Following; filters out user-muted subjects from every discovery channel. Arbitrary `?subjectKeys=...` supplied by a client **cannot widen Following** beyond that owner. Mute also removes such subjects from the generated Morning/Evening discovery brief; it does **not** hide their Action Inbox, deliver/hide P9 notifications, silently change saved alert rules, or create a new monitor.
- The existing `WaveCExperienceShell → FusionPulseBoard → LiosPulseStoryCard` path now offers user-confirmed Follow, Unfollow, Mute, Unmute and Manage subjects. The authenticated save completes before state is shown as new; writes and controls are disabled while pending, errors are disclosed without pretending the mutation succeeded. Subject lists can be cleared in the same existing Pulse context without adding a sidebar page.
- **Fixed longstanding misleading fallback:** if Following (or a muted/empty channel) has zero authorized cards, it remains truly empty. `FusionPulseBoard` no longer substitutes quote-derived pseudo-story items to fill its editorial feed. Market metrics and price panels remain independent in the same screen.
- Reuses A1 source-identity grouping and A2 optional rights-reviewed media. No extra donor clone, dependencies or payment.

## Explicit limitations

- Following a free-form subject **only saves a preference** and filters the already authorized card stream. It does not automatically subscribe to a new feed, ingest web pages, monitor while the app is off, imply data coverage, or manufacture sources. Finance watchlist holdings continue to feed existing quote/news providers as before.
- Mute is discovery presentation, not safety, alerts, automated actions, regulatory retention or record deletion. Users can unmute in Manage subjects even when all related stories are hidden.
- Source tests and actual DB route integration are added, but CI/native installed acceptance are **not claimed passed** before validation.
- Subject preferences are scoped to the authenticated account and stored transactionally. Unauthenticated users cannot access those endpoints under their existing access policies.

## Acceptance

```bash
cd src
npm run test:discovery-preferences
npm run check
npm run test:offline
```

Tests assert case-normalized/valid subjects; exclusive follow/mute/clear state and bounded storage; client-filter bypass prevention; watchlist union; mute precedence and non-transitive source identity; no fake substitute cards; read-after-write durability and cross-user isolation in a real local DB; Action Inbox and P9 rules remain independent; current Watermelon-style controls and error states. Existing source Linux hosted CI runs the focused tests on the standard no-extra-cost runner.

## Next actual website gap

**A4 only:** finish one integrated discovery composition (source-derived story continuity, compact responsive layout and accessibility proof at 390px, 768px and 200% zoom) in the existing Home/Explore/Chat/Project shell; no new Pulse page, duplicate ranking owner or unnecessary donor library. Professional graph/map/visual-answer work remains Workstreams B/C/D under #258. Native installer QA remains the release gate separately under #91.
