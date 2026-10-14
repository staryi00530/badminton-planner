# Live Queue Transition Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract live-game state transitions into a pure, tested module so active courts remain stable and queue promotion is deterministic and capacity-safe.

**Architecture:** Add `liveQueueTransition.ts` for pure reference normalization, status preservation, candidate selection, and promotion. Keep regeneration and persistence in `useLiveQueue`; pass edited schedules into the transition boundary. Keep `BadmintonPlanner` responsible only for constructing edited schedules and invoking the queue integration.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, existing scheduler and `GameRef` types.

**Spec:** `docs/superpowers/specs/2026-10-14-live-queue-transition-design.md`

## Global Constraints

- Do not rewrite the fairness scheduler.
- Do not add runtime dependencies.
- Preserve the existing current/next/past-games UI.
- Preserve live court identity by `(slot, court)`.
- Never exceed configured live court capacity.

## Review Focus

- Editing a live court must not stop an unrelated live court; test cross-court roster swaps in Task 1.
- A completed game must not reappear after regeneration; test completed exclusion in Task 1.
- A blocked or suspended player must not be promoted; test candidate filtering in Task 1.
- An edited schedule must be used for promotion and regeneration rather than stale state; test override-result behavior in Task 2.
- A partial or invalid schedule must not create invalid references; test invalid court references in Task 1.

### Task 1: Pure Queue Transition Module

**Files:**
- Create: `src/utils/liveQueueTransition.ts`
- Create: `src/utils/liveQueueTransition.test.ts`
- Modify: `src/utils/liveQueue.ts` only if shared reference helpers need to be moved or re-exported

**Interfaces:**
- Consumes `PlannerResult`, `GameRef`, player-name availability, suspended names, and a target live capacity.
- Produces normalized live/completed references, promotable candidates, and queue transition metadata without side effects.

- [ ] **Step 1: Write failing pure tests** for preserving active court references after roster edits, excluding completed/live/blocked players, respecting capacity, preserving recorded completed rosters, and rejecting invalid court references.
- [ ] **Step 2: Run `npm run test:unit -- --run src/utils/liveQueueTransition.test.ts` and verify the new tests fail because the module does not exist.
- [ ] **Step 3: Implement the smallest pure functions in `src/utils/liveQueueTransition.ts`**, reusing existing `GameRef` helpers where appropriate. Keep display-lane assignment separate from schedule identity.
- [ ] **Step 4: Run the focused tests and then the full unit suite; both must pass.
- [ ] **Step 5: Commit the pure transition module and tests.**

### Task 2: Integrate the Hook

**Files:**
- Modify: `src/hooks/useLiveQueue.ts`
- Modify: `src/utils/liveQueueTransition.ts`
- Modify: `src/hooks/useLiveQueue.test.ts` if a hook-level test file is needed

**Interfaces:**
- `useLiveQueue` remains responsible for regeneration callbacks, React state, and transient notices.
- The pure module receives the current or override schedule and returns the next status state for the hook to persist.

- [ ] **Step 1: Add a failing integration test** proving `applyLiveGamesUpdate` uses an edited schedule as its source and fills a vacancy without dropping other live courts.
- [ ] **Step 2: Run the focused test and verify the failure demonstrates stale-result or lost-court behavior.
- [ ] **Step 3: Replace duplicated inline normalization/promotion logic in `useLiveQueue` with the pure transition module. Preserve regeneration callbacks and replacement notices.
- [ ] **Step 4: Run the focused test and full unit suite.
- [ ] **Step 5: Commit the hook integration.

### Task 3: Simplify Schedule Edit Integration

**Files:**
- Modify: `src/BadmintonPlanner.tsx`
- Modify: `src/BadmintonPlanner.live.test.tsx`

**Interfaces:**
- Schedule-edit handlers construct `newResult`, preserve active court references by location, preserve completed history by recorded lineup, and call the queue integration once.

- [ ] **Step 1: Add or strengthen the end-to-end regression test** for editing one current court, then another current court, while keeping all configured courts live.
- [ ] **Step 2: Run the regression test and verify it fails against the pre-refactor behavior.
- [ ] **Step 3: Remove queue-transition decisions from `BadmintonPlanner.tsx`; route both edit modes through the hook transition boundary.
- [ ] **Step 4: Run the live-flow test file and full unit suite.
- [ ] **Step 5: Commit the schedule-edit integration.

### Task 4: Full Verification

**Files:**
- No production changes expected.

- [ ] **Step 1: Run `npm run test:unit` and confirm all unit tests pass.
- [ ] **Step 2: Run `npm run build` and confirm the production bundle succeeds.
- [ ] **Step 3: Run `npm run test:e2e` and confirm 2-, 3-, 4-, and 5-court flows complete without exceeding capacity.
- [ ] **Step 4: Run `git diff --check` and review the final diff for stale queue logic or duplicated invariants.
- [ ] **Step 5: Commit any final test-only or cleanup changes.

