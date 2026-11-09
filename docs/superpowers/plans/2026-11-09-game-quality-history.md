# Durable History and Matchup Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for root integration and superpowers:dispatching-parallel-agents for independent scoring/format and ledger helper domains. Test-first steps track below.

**Goal:** Preserve played games through recovery rerolls, continue the remaining session fairly, and make matchup scores independent of waiting.
**Architecture:** Immutable played-game records are independent of the mutable plan. New plan IDs prevent stale actions after slot reuse. Current Firebase revision checks and per-tab recovery carry history; local storage isolates beta. A reroll consumes only the unplayed court budget for each logical session slot.
**Tech Stack:** React18, TypeScript, Firebase RTDB, Vitest/Playwright, Node24.
**Spec:** docs/superpowers/specs/2026-11-09-game-quality-history-design.md, including approved decisions.

## Global Constraints
- Beta only; main and original dirty checkout unchanged.
- Public history has IDs, name/gender snapshots and scores; never private levels/aliases.
- Kept history continues counts, eligible waiting and repeat penalties. Reset is explicit and commits only on successful reroll.
- Keep existing Finish idempotency, Undo dependency checks, receipt tombstones and shared revision conflict recovery.

## Review Focus
- Clear/refresh with no current plan must retain readable history.
- Same slot and lineup in a new plan must reject an old Finish request.
- Remote Finish during local generation must not be overwritten or lost during recovery.
- Partial slots and repeated recovery rerolls consume each completed game's budget once.
- Removed/renamed players remain readable in historical snapshots and do not duplicate statistics.

### Task 1: Played history helpers and view (independent domain)
**Files:** new utils/playedHistory.ts/tests; components/PastGamesTab.tsx/tests; optional utils/playerStats.ts/tests.
**Interfaces:** export PlayedPlayer{id,name,gender}; PlayedGame{id,planId,slot,court,displayCourt?,completedAt,teamA:[PlayedPlayer,PlayedPlayer],teamB:[PlayedPlayer,PlayedPlayer],score?:{a,b,applied},waitingIds:string[]}. Pure migration records actual completed games; no runtime storage side effects. Export migratePlayedGames(result,players,completed,scores,existing=[]):PlayedGame[], mergePlayedGames(existing,records):PlayedGame[], historyCourts(history):Court[], historyGamesWaited(history,players,live=[]):Record<string,number>, historyScheduleState(history,players,keptSlots=[]):ScheduleState, remainingCourtsPerSlot(history,nominal):number[]. Legacy planId='legacy'; record IDs use plan identity, slot, court and permanent participants. Merge also deduplicates equivalent provenance to tolerate legacy ID encoding.
- [x] RED tests: immutable teams/scores survive no plan, duplicate migration, renamed identity, partial budget, exact count/repeat seed, eligible waiting events.
- [x] Implement helper/view behavior and run targeted GREEN tests. Past view accepts optional playedGames and exports JSON backup; all-time W/L independent.

### Task 2: Matchup/rotation split and format grouping (independent domain)
**Files:** algorithm/scheduler.ts/tests, utils/gameQuality.ts/tests, components/LiveSessionBoard.tsx/tests, optional new format grouping helper.
**Interfaces:** keep compatibility .score but make it matchup-only (waiting excluded); expose rotation separately. Board optional playedGames?:PlayedGame[] uses ledger history for actual repetition/waits, and shows projected average for full pending plan. Default matchup weights unchanged apart from waiting not affecting total/control. Root persists weight preferences.
- [x] RED: waiting does not inflate matchup score; odd waiting-gender pools preserve matching formats and maximize feasible ready groups; 28/30/32 players4/5courts, no duplicates/availability violations.
- [x] Implement and verify GREEN. Flag unavoidable forced/odd complete-pool compromises; preserve the generation substitute exclusivity fix.
- [x] Repeat100-seed five-court simulation, report matchup-only mean, avoidable mismatches, rotation counts and waiting tradeoffs.

### Task 3: Local ledger persistence and completion capture
**Files:** types.ts, hooks/usePlannerState.ts/tests, utils/undoSnapshot.ts, root integration.
**Interfaces:** PlannerState/PlannerPersistedState.playedGames:PlayedGame[] and historyEpoch:number; PlannerResult.planId?:string. Persist beta:bp-played-games independently of result. Migration before any replacement. Reducer merges ledger completion snapshots when completed refs change, preserves history on clear, and restores it with Undo. Explicit supplied history+cleared refs on reset avoids remigration.
- [x] RED hydrate legacy completion once; clear/reload retains records; local Finish/score update captures true lineup; Undo removes only the undone new completion; old plan history remains.
- [x] Implement local persistence/reducer integration, including independent share exemptions; run GREEN state/runtime tests.

### Task 4: Shared ledger and plan-scoped transactions
**Files:** utils/sharePayload.ts/tests, utils/sharedSession.ts/tests, firebase.ts, hooks/useSharedSessionSync.ts/tests, root apply/build share callbacks.
**Interfaces:** SharePayload schema2|3, planId?:string, history?:PlayedGame[], historyEpoch?:number. Codec validates public ledger records. Shared Finish migrates existing completed refs then appends once, snapshots eligible waiting IDs, and guarded Undo removes its own history record. New plan IDs participate in sharedGameId; absent legacy plan IDs preserve old identity compatibility. Snapshot commits merge same-epoch history and reject invalid epoch transitions; epoch+1 reset requires a new plan. Existing revision conflict protection remains authoritative.
- [x] RED concurrent/double/replayed Finish, migration/codec/private-level exclusion, new plan same slot stale Finish rejection, reset-vs-Finish race, Undo after reroll.
- [x] Implement GREEN pure/transport/hook tests. No production writes in automated tests.

### Task 5: Remaining-session generation and recovery
**Files:** hooks/useScheduleActions.ts/tests, utils/liveQueue.ts/tests, utils/runtimeScheduleState.ts/tests, root scheduling callbacks.
**Interfaces:** runGenerate(resetHistory?:boolean). Nominal court array comes from current configured session; remainingCourtsPerSlot subtracts records per logical slot across plans. Seed generation with historyScheduleState; preserve original slot indices and attendance windows. Start at first nonempty remaining slot with empty consumed prefixes, without treating them as played/rested. Initial live selection fills physical capacity with earliest non-overlapping games across partial slots. doRegen uses retained history plus active/current refs without double-counting.
- [x] RED three-of-five complete -> onlytwo replacements in slot; 60planned minusNcompleted=Nremaining; repeated reroll invariant; no remaining budget -> visible completion notice.
- [x] Keep old plan/runtime/history until success, then publish new planId and history/reset atomically. Failure restores nothing destructive because old state was retained. Guard progress actions during generation.
- [x] Shared sync planEditing flag blocks autosave and buffers/conflicts newer remote revisions until generation reconciles. RED/GREEN remote Finish during generation and offline recovery.

### Task 6: Reroll/reset choices, backup and quality preferences
**Files:** components/PlannerModals.tsx/tests, BadmintonPlanner.tsx/live tests, weight preference helper ifneeded.
- [x] RED unconfirmed plan with played history prompts; defaultkeep, explicitreset, cancel unchanged; clear retains Past games; settings weights survive refresh.
- [x] Modal gives Keep history & reroll / Reset history & reroll, explains unfinished live-game replacement and number retained/removed. Existing regenerate-upcoming keeps live games. Reset occurs only after success; archive existing confirmed plans as before.
- [x] Wire ledger into board/history/stats and shared codec; backup export works without a plan. Run UI integration GREEN tests.

### Task 7: Verify and release
- [x] Full strict typecheck/unit/E2E/build/audit; focused local+shared recovery, history/score persistence and mobile layout.
- [x] Fresh whole-branch review and regression fixes for important findings.
- [ ] Commit and fast-forward push beta, verify Pages deployment and main SHA unchanged.

## Execution decisions
User approved both proposed defaults after design review. Preserve native execution for root integration; dispatch independent domain work with disjoint file ownership. Continue without another approval loop. The original history builder review asked three questions: the user answered the two behavioral choices; waiting remains one eligible completed-game event per existing behavior.

## Verification evidence
- Full npm test: 540 tests across 46 files, plus 40 browser completions, 8 desktop/mobile session workflows, quarantine workflows and five-court history keep/reset/refresh recovery.
- Subsequent Firebase omitted-empty-wait-list regression: 22 share codec tests pass; strict typecheck passes.
- Beta production build passes; production dependency audit reports 0 vulnerabilities.
- Fresh whole-branch review completed; event-order waiting and physical court numbering findings fixed with regressions. Standalone history reset deferred; explicit reset in reroll meets the requested scope.
- Five-court 100-seed simulation: matchup mean 8.183833, format mismatches 0, exact repeated groups 0, 20 unique players per slot, 3 ready groups per transition, 7–8 games/player.

### Release follow-up verification
- Apply-and-regenerate retains prior-plan history and plan identity (root integration regression).
- Upcoming regeneration subtracts consumed prior-plan budgets, skips zero-budget boundaries, and keeps physical court capacity separate from remaining games (10 hook tests pass).
- Full follow-up suite: 543 unit tests and complete E2E pass; subsequent boundary regressions and strict typecheck pass.
- E2E fixture clears storage after document unload to prevent old effects repopulating state in CI.
