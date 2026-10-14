# Live Queue Transition Design

## Goal

Make live-court state transitions explicit and testable so roster edits, substitutions, completions, and queue promotion cannot accidentally stop unrelated current games or exceed the configured court capacity.

## Scope

This refactor covers runtime queue state only. The scheduling algorithm remains responsible for generating fair future slots. The UI remains responsible for rendering and persistence. No new user-facing workflow is introduced.

## Invariants

1. A live game is identified by its `(slot, court)` location and remains live when its roster is edited in place.
2. A completed game records the roster that was actually played and is never reintroduced by regeneration.
3. The number of live games never exceeds the active court capacity.
4. When live capacity is available, promotion chooses the earliest future game whose players are not currently live, not completed, and not suspended.
5. Regeneration may change future schedule slots, but must preserve live and completed status references that still have valid court locations.
6. Court display lanes may move for presentation, but must not change the underlying schedule court identity.

## Design

Add a pure transition module, `src/utils/liveQueueTransition.ts`, with typed input and output structures. It will normalize status references, preserve valid statuses against an edited schedule, select promotable games, and return the next queue state plus promotion metadata. It will not call React, localStorage, Firebase, or the scheduler.

`useLiveQueue` will remain the integration boundary. It will provide the transition module with the current state and regeneration callback, apply returned state through `patchState`, and keep transient UI notices such as replacement messages in hook state. Existing callbacks (`toggleLiveGame`, player arrival/departure, suspension, and schedule-edit reconciliation) will use the shared transition path.

`BadmintonPlanner` will keep schedule-edit construction and scheduler invocation, but will stop implementing queue reconciliation itself. It will pass the edited result into the queue integration so active courts are reconciled against the new schedule before persistence.

## Failure Handling

If regeneration cannot produce a valid future schedule, the transition preserves the existing valid live and completed references and does not invent a promotion. The caller still persists the roster/result edit, allowing the UI to show fewer available courts when no legal game exists.

## Testing

Pure transition tests will cover completion, active-court edits, cross-court swaps, promotion, blocked players, completed-game exclusion, capacity limits, and invalid court references. Existing component and browser tests remain as integration coverage for rendering and interaction.

## Non-goals

- Rewriting the fairness scheduler.
- Moving all state out of React.
- Sharing private levels or preferred pairings through Firebase.
- Changing the visible current/next/past-games layout.
