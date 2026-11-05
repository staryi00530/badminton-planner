# Session Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for integration and superpowers:dispatching-parallel-agents for independent roster and scheduling domains. Steps use checkbox syntax for tracking.

**Goal:** Make beta shared sessions durable, queue sensible, and roster editing identity-aware.
**Architecture:** Keep GitHub Pages and RTDB. Revision-checked complete public snapshots and session-scoped recovery protect edits; stable player IDs preserve identity; eligibility precedes scored scheduling preferences.
**Tech Stack:** React 18, TypeScript, Firebase RTDB, Vitest, Playwright, Node 24.
**Spec:** docs/superpowers/specs/2026-11-05-session-reliability-design.md (including November 5 clarifications).

## Global Constraints
- Beta only; main and original dirty checkout untouched.
- Private levels never enter shared records. Automated tests never write production Firebase.
- Preserve ongoing/completed games and provide explicit substitution proposals.

## Review Focus
- New shared link opened over another draft must not recover the wrong session.
- Two clients finishing concurrently must never overwrite one another.
- Refresh while saving must retain unsent edits.
- Rename must not orphan live games or scores.
- 28 players on four courts must yield three fully waiting next groups.

### Task 1: Independent scheduling reliability and explanations
**Files:** algorithm/scheduler.ts, utils/gameQuality.ts, components/LiveSessionBoard.tsx, components/SlotCard.tsx and their tests.
**Interfaces:** Existing PlannerResult and Player structures remain compatible; game-quality function is pure and accepts public/private roster context without publishing levels.
- [x] Write and run failing 28/30/32-player ready-cohort and quality constraint tests.
- [x] Pack waiting groups before repeat players while retaining hard constraints; expose weighted score breakdown with tunable weights.
- [x] Enlarge Finish; display candidate waiting counts in existing substitution flow through integration if needed.
- [x] Run scheduler/board/card tests and typecheck; record results.

### Task 2: Stable roster identity and mapping
**Files:** hooks/usePlayerRoster.ts, components/PlayerList.tsx, utils/rosterPaste.ts, utils/playerIdentity.ts and tests; additive optional ID fields in algorithm/types.ts and types.ts.
**Interfaces:** Player.id?: string, aliases?: string[], statsKey?: string. Legacy inputs stay readable; IDs allocated/preserved in roster and bank. Metadata patch callback keeps schedule names/genders coherent without regeneration.
- [x] Write failing instruction-filter, alias-resolution, duplicate-mapping and metadata-no-reroll tests and observe failures.
- [x] Add identity migration and New/Existing/Ignore paste review, preserving aliases/levels/quarantine and existing stats associations.
- [x] Support inline name/gender edits; integration updates active references without changing teams.
- [x] Run roster/parser/UI tests and typecheck; record results.

### Task 3: Shared snapshot schema and regeneration feedback
**Files:** utils/sharePayload.ts, firebase.ts, hooks/useSharedSessionSync.ts, utils/sharedSession.ts, BadmintonPlanner.tsx, hooks/useScheduleActions.ts and tests.
**Interfaces:** SharePayload remains v1 compatible, adds schema=2, revision, full public settings, roster IDs, runtime and per-game identities. commitShare(id, expectedRevision, payload) returns committed snapshot or conflict. subscribeShare(id,onValue,onError) returns unsubscribe.
- [x] Write failing round-trip full settings/runtime tests and revision conflict/double-action tests.
- [x] Encode/decode settings, identity and runtime; legacy missing runtime restores conservatively.
- [x] Implement revision transaction and listener; never overwrite concurrent newer snapshot.
- [x] Integrate autosave with session-keyed local journal, saving/saved/offline/conflict status, retry and explicit recovery controls. Keep remote application out of autosave feedback loop.
- [x] Replace silent regeneration/edit exits with visible outcomes and sanitized diagnostics.
- [x] Run share/sync/regeneration tests; record results.

### Task 4: Shared Finish and Undo integration
**Files:** hooks/useSharedSessionSync.ts, utils/sharedSession.ts, BadmintonPlanner.tsx, hooks/useLiveQueue.ts, components/PlannerModals.tsx and tests.
**Interfaces:** Revision transaction protects whole runtime state; game identity binds finish to lineup. Retry a progress intent against latest public state, reject stale organizer snapshots. Action history records before/after progress for guarded undo.
- [x] Write failing two-client finish, duplicate finish and dependent undo tests.
- [x] Integrate optional device Finish with safe transaction, prominent iPad controls, shared guarded Undo; preserve unrelated later changes.
- [x] Show games waited beside substitution proposals; keep proposal confirmation.
- [x] Run runtime/shared integration tests.

### Task 5: Verify and release beta
- [x] Run strict typecheck, full unit/E2E, build and audit; inspect every result.
- [x] Fresh whole-branch review, fix important findings with regression tests.
- [ ] Commit approved work, push beta only, verify deployment and main SHA unchanged.

## Execution decisions
User approved the design and instructed execution. Continue without another plan approval round. Independent scheduling and roster domains may run concurrently with shared-session work; integrate their interfaces sequentially and perform one whole-branch review before release.
