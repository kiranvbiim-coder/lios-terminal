# LiOS Website Assimilation A3 — Authenticated Follow/Mute

**Date:** 27 October 2026  
**Tracker:** [#258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258)  
**Stack:** A3 on A2 #263 on A1 #261 on integrated source candidate #253. Protected `main` untouched.

## Implemented source journey

In the existing Watermelon/beUI-attributed expandable Pulse story, a user inspects a real saved/server-returned Wave D source-backed card and may explicitly **Follow** or **Mute** its recorded `subjectKey` (fallback `symbol`). The interaction is submitted using the **currently accessible card ID**, not a source-free string or inferred entity. The existing authenticated `/api/wave-d/pulse/preferences` API persists the exact normalized preference through `waveDStateStore.updateWaveDState` and its existing tenant/user-scoped `userPersonaPreferences` transaction.

The same server then returns the persisted status and applies it to Pulse (including all requested channels and manual query subject filters). A muted subject cannot be reintroduced by a `?subjectKeys=` parameter or by the former client-side quote-to-Pulse synthetic fallback. Briefings use the same muted editorial-discovery filter. The canonical Action Inbox, configured Watchlist and monitoring/notifications remain **untouched**, regardless of Mute. Mute does not disable a safety/price alert; Follow never automatically subscribes to a provider, sets up P9 jobs, changes portfolio or purchases data.

**Following channel** retains the legacy watchlist-based source coverage plus explicitly followed subjects, excluding mutes. Unfollowing a separately saved topic does not delete an independently held Watchlist item; a watchlisted subject can still appear in Following until the user manages their Watchlist or explicitly mutes discovery. This behavior must be explained in the UI and tested against real account data. New Follow records select **already connected/authorized** available source records; the feature does not fabricate new real-time data or subscribe to external feeds.

When Mute hides an item, the user can open the existing Pulse **Muted subjects** disclosure to restore it; there is no orphaned hidden item that can only be unmuted through an unsafe URL. The UI waits for a server-acknowledged write, reloads current Pulse, exposes errors without falsely marking success, disables duplicates in flight, and offers a Retry action after connection failure. Existing source inspection, Ask LiOS, Project navigation and rich-media permissions are unchanged. No second Home/Explore page, generic cross-user localStorage list or new backend store.

## Implementation authority

- `src/shared/pulseSubjectPreferences.ts`: exact canonical key, bounded 60 Follow + 60 Mute identities, contradiction normalization, mute precedence, watchlist union, pure fail-closed Pulse projection.
- `src/server/waveDStateStore.ts`: existing authenticated tenant-scoped durable owner, backward-compatible empty normalization.
- `src/server/waveDRoutes.ts`: GET and POST preferences, per-request authentication, single accessible-card authorization, persisted transaction, server-enforced mutes for Pulse and daily briefs. Other users cannot import private card identifiers.
- `src/client/src/components/terminal/WaveCExperienceShell.tsx`: reuse existing Pulse load and server mutation/refresh; no separate feed.
- `src/client/src/components/terminal/FusionPulseBoard.tsx`: accessible disclosure and restore, unfiltered-source fallback eliminated.
- `src/client/src/components/terminal/LiosPulseStoryCard.tsx`: confirmed actions with keyboard-sized buttons and status state.
- Unit/integration tests: `shared/pulseSubjectPreferences.test.ts`, `server/waveDRoutes.test.ts` (real isolated route/persistent SQLite fixture and two separate users), `client/src/lib/pulseFollowMuteIntegration.test.ts`.
- `cd src && npm run test:website-a3 && npm run check && npm run test:offline`. Source CI executes `test:website-a3` on existing standard Linux runner; full offline suite includes the backend route test.

## Acceptance and safety evidence required

1. Build passes TypeScript, focused tests and full offline suite (CI not assumed green).
2. Real signed-in user follows a backed subject, sees it in Following after restart; another user's account preferences remain independent.
3. Muting hides the item from all discovery channels, manual filter overrides and briefings; Action Inbox and P9 notifications stay unchanged.
4. Saved unmute restores current sources without creating data; empty/unavailable states and revoked access are truthful.
5. Narrow and wide screen (390px/768px), keyboard, 200% zoom, screen reader labels, offline/reconnect/restart and native Mac/Windows acceptance remain to be observed.
6. If source backing, role access or user preference document is unavailable, **don't mark a new preference as persisted**.

**Status:** Committed for code review; CI/native results pending. No production release, no extra spend, no third-party contact, no new paid data entitlement.

## Next item

**A4** — integrate the remaining cohesive discovery experience into the conversation-first shell without creating another Home: source-linked story transitions, read-state/What Changed continuity, responsive accessibility, selective Watermelon/beUI presentation-only improvements and real screenshot verification. After A4, proceed to B1 interactive grounded graph and B2 rights-cleared geographical map in issue #258.
