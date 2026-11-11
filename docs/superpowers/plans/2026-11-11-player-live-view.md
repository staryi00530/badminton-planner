# Live Player View Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for root work, with independent model, subscription and organizer-publication domains delegated under superpowers:dispatching-parallel-agents. User explicitly approved building on beta; continue through verification and deployment.

**Goal:** A live read-only All games/My games player link driven by the organizing iPad.
**Architecture:** Separate viewer entry route `?view=players&share=ID`; pure presentation model over existing public payload; reader-only subscription hook; existing shared organizer remains publisher.
**Tech Stack:** Existing React/TypeScript, Firebase Realtime Database, Vite/GitHub Pages, Vitest/Playwright.
**Spec:** ../specs/2026-11-11-player-live-view-design.md

## Global constraints
- Beta first; no database rules, generation, ranking or private-metadata changes.
- Viewer never renders planner/hydrates its storage or invokes any share mutation/expiry cleanup.
- Future games tentative; live court/lineup overrides authoritative; retained history deduplicated.
- Player preference only in share-scoped isolated storage; stable-ID rename safe, removed/ambiguous selection never silently reassigned.
- Failed publication retains draft/link; no silent snapshot fallback presented as live.

## Review focus
- Old shares lacking IDs and duplicate names: All games remains usable, identity filter is conservative.
- Late subscription callbacks after link/retry: ignored, with last valid view visibly stale on transient failure.
- Recovery rerolls: immutable played history appears once alongside current plan.
- Offline/expiry/delete: truthful status and no stale roster presented as live; no reader writes.
- Organizer local copy/pending Finish/conflict: player link shown only after confirmed publication, sharing from the iPad establishes source.

### Task 1: Public view model and URL helpers
Files: new src/utils/playerView.ts + test.
- [x] Test then implement `playerViewModel(data: SharePayload)` returning public player options and current/upcoming/played game cards, stable identity keys and tentative times; `playerViewUrl(organizerUrl:string):string` changes only view marker; `playerShareId(search:string):string|null` validates ID.
- [x] Export exact interfaces to root; test live overrides, alias-free stable IDs, duplicate legacy names, inactive/retained players, history reuse, scores and plan times. No storage or Firebase calls.

### Task 2: Reader subscription
Files: new src/hooks/usePlayerSession.ts + test; src/firebase.ts add connection-only subscription.
- [x] Test then implement `usePlayerSession(shareId:string|null)` -> `{data:SharePayload|null,status,message?,receivedAt?,retry:()=>void}`. Status: loading/live/reconnecting/offline/error/not_found/expired/invalid. Validate payload via decoder, own 30-day expiry timer, preserve last valid view only on transient errors, clear terminal invalid/missing/expired. Unsubscribe/ignore late responses. No fetchShare or write APIs. First-data timeout with retry.
- [x] `subscribeShareConnection(onConnected,onError)` reads `.info/connected` only. Unit tests mock Firebase transport and verify no mutations, offline/reconnect/error/retry/expiry and cleanup.

### Task 3: Organizer publishing
Files: BadmintonPlanner.tsx, PlannerModals.tsx, relevant tests.
- [x] Test then make Firebase Share default URL player-view link, retain organizer URL separately in modal, retain organizer browser URL `?share=ID`. Reuse existing share after saveNow success; establish new connection after successful create. Force-new remains deliberate. Reader uses same ID.
- [x] Distinguish live Player link and organizer-session link; show publishing status and detached-copy implication. On Firebase publication failure keep draft/existing URL and error; do not silently provide Worker/hash snapshot as live. Preserve existing non-Firebase organizer fallback with explicit snapshot copy.

### Task 4: Isolated phone/iPad viewer
Files: new components/PlayerSessionViewer.tsx + tests; main.tsx route entry.
- [x] Test then implement All games/My games, dark searchable name picker, share-scoped persisted stable selection, removed/legacy selection handling, current/planned/played cards, selected-name highlights, current court/score display and truthful status/retry. No controls or private metadata. Render no planner component on reader route; lazy-load organizer entry.
- [x] Display no-plan/no-player/no-upcoming/history-empty states. Preference write errors never prevent viewing. Connection status and last-received time independent of private organizer state.

### Task 5: Integration/release
Files: scripts/e2e-smoke.mjs (root owned).
- [x] Browser fake transport tests 390px/1024px: reader route doesn't touch seeded planner data, All/My selection refresh and rename, Finish/substitution/regeneration updates automatically, no mutation calls, stale/offline/retry, no organizer controls, mobile layout. Existing organizer/private-handoff tests continue.
- [ ] Full Node24 typecheck/unit/browser checks, beta production build, independent review and fix blockers. Commit/push beta only; wait for Pages success and verify live asset. Main unchanged.

Release verification: default full npm test passed 724 tests/59 files and complete browser smoke, including 390px/1024px player view, stable selection/rename, Finish/substitution/regeneration updates, offline/reconnect, refresh and isolated storage. Independent review found and verified a fixed delayed-publication/detach race. Final RTDB empty-array normalization adds two tests; latest model/hook/UI/route focused run passed 39 tests and beta production build passed. Reader entry excludes the lazy-loaded organizer bundle. Beta push and Pages verification follow.
