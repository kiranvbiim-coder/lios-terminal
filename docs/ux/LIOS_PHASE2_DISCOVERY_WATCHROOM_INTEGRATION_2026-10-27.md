# LiOS Phase 2 — Discovery / Home / Projects / Watchrooms Integration

**Date:** 2026-10-27  
**Review base:** `integrate/phase1-premium-experience-20261027` (Phase 1 PR #237)  
**Cumulative code branch:** `feat/phase2-watchrooms-project-resume-20261027`  
**Source-donor PRs:** #240 (Home), #242 (Project What Changed), #245 (Visual Search). **Do not merge donor PRs separately after accepting the consolidated Phase 2 PR.**

## The actual end-to-end product experience

LiOS remains a single local-first, BYOD/BYOAI desktop product, with Home/Chat, existing Search, Projects, canonical P4 Artifacts and Workbench; no second router, dashboard runtime, user-facing marketing sidebar page or duplicate P9 schedule engine.

1. **Discover:** From a new regular Chat, expand the optional Home intelligence desk. Query the existing authenticated `GET /api/wave-d/pulse` snapshot, filter/sort only returned cards, inspect evidence, review/snooze/reopen only actual returned Inbox records. No automatic feed fetch before opening and no Home panel in Temporary Chat.
2. **Find:** Open existing global Search. Saved Work retains `/api/work-search` and original navigation ownership checks. Select Intelligence and type two characters. Query the same Wave D endpoint once per search session; refine subject, market and research facets locally. Cards use original source names, safe recorded links, timestamp, kind and relevance. Do not infer thumbnails, provider search coverage or personal data.
3. **Ask:** Click Ask LiOS on recorded intelligence. Add an evidence-aware prompt to the existing Chat draft, preserve any unsent input, enforce active Chat/Artifact mutation guards and require user to explicitly Send. No automatic research call or Project switch.
4. **Resume:** Open a Project. Above collapsed Saved work and Advanced tools, offer current Project's latest active conversation/session and P6's exact retained continuation queue. Subject, decisions and workflows remain Project-scoped and are not extrapolated from other work.
5. **Watch:** Open Project Watchrooms. Show the exact P9 workflow state, latest recorded run, source and execution-receipt counts, latest delivered unread notifications. Enabling is an intent; running Home, user permissions, actual triggers and receipts determine execution. All create/pause/enable/edit/delete/run/mark-read actions stay in the existing P9 management component with review, version checks and offline/manual-run recovery. No second write engine.
6. **Compare:** Open Project history. The existing P6 snapshot comparison exposes real aggregate added/changed/removed counts and recorded reference IDs, with missing comparison distinguished from observed zero difference. Do not infer per-source change type from aggregate counts.
7. **Return:** Reopen exact saved Chat, Session or Decision Artifact through the existing Project callbacks. Existing saved-work and Artifact guard semantics remain controlling.

## Owner / endpoint matrix

| Concern | Existing controlling owner | Phase 2 presentation |
| --- | --- | --- |
| Intelligence source | Wave D / `GET /api/wave-d/pulse` | `HomeAttentionPanel`, `VisualIntelligenceSearch` |
| Review state | Wave D Action Inbox status endpoint | `HomeIntelligenceCard` |
| Saved work | `/api/work-search` + existing saved-object validation | `WorkSearchDialog` (dual presentation) |
| Conversation execution | P2/GM existing Chat composer | Search-to-Chat **draft only** |
| P6 retained continuity | `/api/projects/:id/continuity` | `ProjectResumeDesk`, `ProjectChangeActivity`, `ProjectContinuityPanel` |
| P9 monitors, runs and notifications | Existing `useP9Automation` / canonical P9 routes | `ProjectWatchroomDesk` → `ProjectAutomationPanel` |
| Saved artifacts | P4 and canonical owner callbacks | Exact existing Project open action |

## Safety and regression rules

- Never invent a review Inbox ID, monitor run, work-search authorization, before/after source change, image right, reference URL, background execution, or notification success.
- No source image/favicons imported from private remote pages; external anchor URLs must be explicit and verified by the existing `safePulseSourceUrl` helper, not converted to media rights.
- Do not show client-local saved data from one Project as another's. P6 snapshot validation and P9 Project/workflow ID matching are mandatory.
- Do not permit Temporary Chat personalized intelligence search. Saved-work Search and existing product permissions remain unchanged.
- Query deep P9 state only while Project Watchrooms are deliberately expanded, avoid duplicate workflow panels and extra standalone Watchrooms service.
- $0 additional release spend: no required new cloud, data subscription, frontend package, database service, scheduler, image API or licensing purchase.
- P9 Home is only as live as the actual running local service; an enabled schedule or locally stored offline draft does not guarantee background execution.

## Phase 2 exit gates and current evidence

| Gate | Truth at code handoff |
| --- | --- |
| Source implementation: F01/F06 Home / F07 Project What Changed / F10 recorded-source visual discovery / F12 P9 Watchrooms / Project resume | **Code present on integration branch** |
| Focused source tests and guard tests | **Authored, not all executed/confirmed** |
| Hosted GitHub source validation | **Check on final PR head required** |
| TypeScript typecheck and repository-wide UX test | **Unverified until runner executes** |
| Installed Electron journey (macOS / Windows) | **Unverified** |
| Keyboard, VoiceOver, 390/768px/desktop, 200% zoom, offline | **Native validation required** |
| Follow/mute as first-class persisted subject preferences, source images with verified display rights, semantic global search, richer Watchroom topic linking | **Not claimed or inferred; dependent on real persistent contracts and legal/source-rights evidence** |
| Product accepted / production released | **No** |

### Required final regression command

```bash
cd src
node --import tsx --test \
  client/src/lib/homeIntelligenceDiscovery.test.ts \
  client/src/components/terminal/HomeAttentionPanel.test.tsx \
  client/src/lib/phase2HomeDiscoveryIntegration.test.ts \
  client/src/components/terminal/ProjectChangeActivity.test.tsx \
  client/src/lib/intelligenceVisualSearch.test.ts \
  client/src/components/terminal/VisualIntelligenceSearch.test.tsx \
  client/src/lib/phase2ProjectPresentation.test.ts \
  client/src/components/terminal/ProjectWatchroomDesk.test.tsx \
  client/src/lib/phase2ExperienceIntegration.test.ts \
  client/src/lib/phase1SavedWorkNavigation.test.ts
npm run check
npm run test:ux
```

### Native acceptance steps

Sign in → open fresh regular Chat → expand Home → inspect sourced card and no-source states → filter and update exact Inbox item → search saved work → switch to Intelligence → source card → Ask → confirm prompt staged only → create/open Project → resume saved Chat and Session → inspect historical changes → open Watchrooms → review proposed paused P9 monitor → deliberately save → re-read status → verify notifications/receipts → quit/reopen app and repeat continuity. Repeat with a non-finance subject, offline/unavailable data, missing provider permission, stale results, 390px/768px and 200% zoom, keyboard/screen reader. Capture actual application evidence; CI green alone does not establish installed UX acceptance.

**Merge discipline:** Phase 1 #237 must be reviewed first (it is stacked on the essential navigation branch). This integration PR should be reviewed, rebased onto accepted Phase 1, and merged only after conflicts, CI and installed visual checks. Source donor PRs #240/#242/#245 are not separate merge steps once this integrated version is accepted. Review concurrent TC visual work (e.g. standalone artifact gallery/timeline/scenario/graph and TC integration #247) before touching common owners. Do not alter protected `main` directly.
