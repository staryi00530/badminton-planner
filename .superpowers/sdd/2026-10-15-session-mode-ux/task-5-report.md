# Task 5: Atomic Undo

Base: `76ecb78` on the existing `beta` checkout. No subagents used.

## Implementation

- Added a single, deep-cloned `UndoSnapshot` at the planner reducer boundary.
- Exposed stable `recordUndo()` and `restoreUndo()` callbacks. Capture reads the
  reducer's current state, including preceding batched patches. Restore merges
  the entire snapshot in one reducer action and clears it; repeated restore is
  a no-op and never records another snapshot.
- Snapshot includes result, scores, win/loss, players, live/completed game refs
  and their player/lane snapshots, suspension, fromSlot/fromSlotCourts, court
  overrides, dirty/copied/confirmation/load metadata, saved plans (including
  automatic archives), editing state, generation metadata and overwrite state.
- Moved queue adjustment notices, queue promotion prompts, pending session
  changes and session notices into planner state so restoration is atomic.
- Capture is integrated before finish/start, queue promotion/substitution,
  both slot-edit commands, score edits/scored completion, session availability
  and suspension changes, court changes and future regeneration paths.
- Added the visible `Undo last action` control across session views, including
  for non-admin users. It disables when unavailable and after restoration.
- Undo is memory-only. Clearing/generating a schedule and loading/importing
  another plan clear stale undo/queue state. Navigation, setup-only drafts and
  PIN input are not restored.
- Preserved the Task 4 scheduler, future boundary, physical lane, confirmation,
  archive and one-lookahead behavior. Existing user docs/plans/logs untouched.

## Verification

All commands were bounded to 30 seconds; no browser/E2E or network-idle waits.

- RED: planner/hook tests exposed the missing snapshot/API; utility import was
  absent; shell tests exposed the missing Undo affordance. The compound test
  also exposed that pending session changes were outside planner state.
- GREEN: `timeout 30s npm run test:unit -- src/utils/undoSnapshot.test.ts src/hooks/usePlannerState.test.ts src/hooks/useLiveQueue.test.ts src/components/LiveSessionBoard.test.tsx`
  passed 71/71 in 2.79 seconds.
- `timeout 30s npm run test:unit -- src/BadmintonPlanner.live.test.tsx -t 'atomic undo'`
  passed 6/6 selected tests in 4.52 seconds.
- `timeout 30s npm run test:unit -- src/BadmintonPlanner.live.test.tsx -t 'undo restores schedule'`
  passed 5/5 selected tests in 7.32 seconds.
- Coverage includes every covered mutation class, a compound future
  availability/capacity change, restored notices/prompts, score and live player
  snapshots, scored finish/win-loss, both edit commands, confirmation/archive
  restoration, snapshot replacement/consumption, failed regeneration and
  invalid capacity, deep-copy isolation, excluded drafts/PIN and navigation.
- `timeout 30s npm run build` passed in 4.28 seconds. Existing bundle-size
  warning remains (521.04 kB output).
- `git diff --check` passed.

## Self-Review and Gaps

- Self-review checked reducer ordering/atomicity, capture-before-mutation,
  nested queue/regeneration paths, prompt restoration, metadata/archive
  restoration, shared-session persistence, reset paths and snapshot consumption.
- No outstanding findings in the reviewed covered session paths. Review was
  performed by the author, not an independent reviewer, as requested.
- The full unit run was attempted with `timeout 30s npm run test:unit` and
  exited 124 before the shell test file finished. No failing test was reported
  before timeout; this is not a full-suite pass. Logs: `/tmp/task-5-unit.log`.
- No new browser/mobile visual checks or broad E2E run; these remain Task 6.
- No standalone TypeScript check was run; prior reports document existing
  typecheck debt. Build success is not a typecheck claim.
- Setup-only roster/configuration drafts, manual saved-plan management and
  cloud synchronization are not newly covered undo workflows.

## Decisions

- Keep this checkout and all user/scratch artifacts, following the existing
  execution ruling and explicit request; do not create a worktree or clean up.
- Keep the selected view and setup/PIN drafts outside the snapshot because
  covered session mutations do not change them. Restore pending operational
  prompts exactly, so an undone confirmed change can be confirmed or canceled.
- Include savedPlans and winLoss because covered operations can mutate them;
  restoring only the brief's minimum fields would leave partial effects.
- Stop further scope/verification expansion at the user's wrap-up request;
  report the bounded full-suite timeout and browser/typecheck gaps explicitly.

## Review Fix Round (2026-10-15)

- Fixed both findings from `task-5-review.md` on parent `c1bf93d`.
- Manual Save/new-copy/update, Delete and expired-plan pruning now clear stale undo in the same patch as the archive write.
- Setup roster additions, bank additions, removal and field edits clear stale undo; roster resets already clear it through `result: null`.
- Automatic session archives remain in the covered action's snapshot and reverse with Undo.
- Opening/canceling a blocked queue decision keeps prior undo; acceptance captures the reducer-current pre-commit state, including the prompt.
- RED: five UI cases failed as expected: Save-new, Save-update, Delete, roster addition and canceled blocked Finish.
- GREEN: `timeout 30s npm run test:unit -- src/BadmintonPlanner.live.test.tsx -t 'atomic undo|undo restores schedule'`: 16 passed, 46 skipped (11.29s).
- GREEN: `timeout 30s npm run test:unit -- src/utils/undoSnapshot.test.ts src/hooks/usePlannerState.test.ts src/hooks/useLiveQueue.test.ts src/hooks/usePlayerRoster.test.ts src/components/LiveSessionBoard.test.tsx`: 85 passed (2.79s).
- `timeout 30s npm run build`: passed (3.74s); existing >500 kB bundle warning remains. `git diff --check`: passed.
- Self-review: checked both Save branches, deletion/load metadata, roster writers, reducer patch ordering, accepted/canceled prompts and automatic archive reversal; no outstanding findings in this fix scope.
- No agents, broad suite, E2E or standalone typecheck. Preserved unrelated docs/plans/logs. This fix round and report ship together in the follow-up commit.
