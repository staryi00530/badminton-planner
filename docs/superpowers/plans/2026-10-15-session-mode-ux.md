# Session Mode UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated session self-operating for players, while preserving current/live history during late arrivals, early departures, and mid-session court changes.

**Architecture:** Add a live-session view at the planner shell, keep `useLiveQueue` as the transition authority, and extract the live-board guidance into focused components. Add one undo snapshot at the planner-state boundary so live transitions and mid-session changes restore atomically. Availability and court changes regenerate only from the first upcoming affected slot.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Playwright/Vite smoke E2E.

**Spec:** `docs/superpowers/specs/2026-10-15-session-mode-ux-design.md`

## Global Constraints

- The current single-device workflow remains in scope; real-time synchronization between multiple devices is out of scope.
- Any player can finish a live game.
- Completed games, current live games, scores, and player snapshots are immutable when future availability or court capacity changes.
- The queue may inspect at most one lookahead game and must not cascade through an arbitrary number of future games.
- Existing admin PIN, skill levels, preferred pairings, and scheduler fairness rules remain unchanged.
- No new runtime dependency is required.

## Review Focus

- A late arrival or early departure must preserve completed/current games and regenerate only future slots; pin with queue transition and E2E tests in Task 4.
- Adding/removing a court while games are live must preserve physical court lanes and never reduce current live games; pin with capacity transition tests in Task 4.
- An accidental finish, substitution, promotion choice, or availability change must undo as one state restore; pin with planner-state tests in Task 5.
- A first-time player must see one clear action per court and a direct reason for waiting; pin with live-board component tests in Task 2.
- A generated session must enter live mode while setup remains recoverable; pin with shell tests and E2E coverage in Tasks 1 and 6.

### Task 1: Add session-mode navigation and startup state

**Files:**
- Modify: `src/types.ts` (`PlannerState.activeTab` and session UI state)
- Modify: `src/hooks/usePlannerState.ts` (default and persisted session view)
- Modify: `src/hooks/useScheduleActions.ts` (enter live mode after Generate/Re-roll)
- Modify: `src/BadmintonPlanner.tsx` (navigation and view routing)
- Test: `src/hooks/usePlannerState.test.ts`, `src/BadmintonPlanner.live.test.tsx`

**Interfaces:**
- Add `activeTab: 'live' | 'setup' | 'past' | 'archive' | 'about'`.
- Generate and Re-roll set `activeTab: 'live'` after the initial live games are created.
- When no result exists, Setup remains the fallback view.

- [x] **Step 1: Write failing tests** for a generated schedule selecting Live session and an existing schedule retaining the selected view on refresh.
- [x] **Step 2: Run the focused tests** and verify they fail because the current tabs do not have a live-session state.
- [x] **Step 3: Implement the session-mode state and navigation** without changing queue transitions.
- [x] **Step 4: Run focused tests** and verify they pass.
- [x] **Step 5: Run the existing planner and schedule component tests** to catch tab-label and prop regressions.

### Task 2: Extract the live session board and direct guidance

**Files:**
- Create: `src/components/LiveSessionBoard.tsx`
- Create: `src/components/LiveSessionBoard.test.tsx`
- Modify: `src/components/ScheduleGrid.tsx` (reuse court rendering and remove live-only layout responsibility)
- Modify: `src/components/SessionStatusPanel.tsx` (summary and player availability labels)
- Modify: `src/BadmintonPlanner.tsx` (render live board before setup)

**Interfaces:**
- `LiveSessionBoard` consumes `result`, `players`, `liveGames`, `completedGames`, `queueAdjustment`, `fromSlot`, `liveCapacity`, and the existing court action/edit callbacks.
- It produces a stable vertical Court 1–5 view, a session summary, a “What happens now?” status, current games, and the next queue.
- Court actions remain delegated to `useLiveQueue`; this component must not mutate queue state.

- [x] **Step 1: Write failing component tests** for stable court lanes, `Finish game`, `Start game`, `Waiting`, and direct waiting explanations.
- [x] **Step 2: Run the focused component test** and verify the component/layout contract is absent.
- [x] **Step 3: Extract the live presentation** and make the live board the first content in Live session mode.
- [x] **Step 4: Add direct banner copy** for live, ready, waiting, and no-more-games states.
- [x] **Step 5: Run component tests and existing `ScheduleGrid` tests**.

### Task 3: Simplify setup without removing advanced controls

**Files:**
- Modify: `src/BadmintonPlanner.tsx` (Setup view and navigation)
- Modify: `src/components/SessionSettingsPanel.tsx` (compact setup state)
- Modify: `src/components/PlayerList.tsx` (compact roster state)
- Test: `src/components/SessionSettingsPanel.test.tsx`, `src/components/PlayerList.test.tsx`, `src/BadmintonPlanner.live.test.tsx`

**Interfaces:**
- Setup remains fully functional on the Setup tab.
- Live session does not render setup controls above the live board.
- Levels, preferred pairings, regeneration, and debug export remain accessible from Setup/Admin view.

- [x] **Step 1: Write failing tests** proving setup controls are absent from the Live session view but accessible from Setup.
- [x] **Step 2: Run focused tests** and verify the current all-in-one schedule view fails those assertions.
- [x] **Step 3: Move setup-only controls behind the Setup view** while preserving their current state and callbacks.
- [x] **Step 4: Run component and live-flow tests**.

### Task 4: Make mid-session availability and court changes future-only

**Files:**
- Modify: `src/types.ts` and `src/hooks/usePlannerState.ts` (persisted `courtOverrides: Record<number, number>` keyed by 1-based slot)
- Modify: `src/hooks/useLiveQueue.ts` (shared future-only transition boundary)
- Modify: `src/hooks/useScheduleActions.ts` (future regeneration with preserved history)
- Modify: `src/components/SessionStatusPanel.tsx` (late/early controls and confirmation copy)
- Modify: `src/components/LiveSessionBoard.tsx` (Add court/Remove court controls)
- Modify: `src/utils/liveQueueTransition.ts` (capacity and availability transition helpers)
- Test: `src/utils/liveQueueTransition.test.ts`, `src/BadmintonPlanner.live.test.tsx`, `scripts/e2e-smoke.mjs`

**Interfaces:**
- Add a transition input with `boundarySlot`, `targetCapacity`, `overridePlayers`, and the existing live/completed snapshots.
- Store on-the-fly court counts in `courtOverrides`; `getCourtsPerSlot()` applies each override from its slot onward without changing the base session configuration.
- Preserve all games with `slot < boundarySlot`, all current live game refs, and all completed refs.
- Regenerate from the first upcoming affected slot; update `fromSlot` and capacity metadata without resetting the session.
- `Add court` and `Remove court` affect the current/upcoming capacity only and are limited to 1–5 courts.

- [x] **Step 1: Write failing transition tests** for late arrival, early departure, adding a court, removing a court, and preserving current games.
- [x] **Step 2: Run transition tests** and verify current regeneration behavior resets or drops the affected future/current references.
- [x] **Step 3: Implement one future-only reconciliation path** shared by availability and court-capacity changes.
- [x] **Step 4: Wire the controls and add explicit confirmation/status copy** showing the affected upcoming slot and active court count.
- [x] **Step 5: Run live-flow tests** across 2, 3, 4, and 5 courts.

### Task 5: Add atomic undo for session actions

**Files:**
- Modify: `src/types.ts` (undo snapshot type and planner state)
- Modify: `src/hooks/usePlannerState.ts` (record/restore snapshot)
- Modify: `src/hooks/useLiveQueue.ts` (record queue action snapshots)
- Modify: `src/BadmintonPlanner.tsx` (record roster/court changes and render Undo)
- Create: `src/utils/undoSnapshot.test.ts`

**Interfaces:**
- Add `UndoSnapshot` containing `result`, `scores`, `players`, `liveGames`, `completedGames`, `suspendedPlayerNames`, `fromSlot`, and `fromSlotCourts`.
- Expose `recordUndo()` and `restoreUndo()` at the planner state boundary.
- Keep one snapshot only; a successful restore clears it.

- [x] **Step 1: Write failing state tests** for restoring a finish, substitution/promotion, availability change, and court-capacity change atomically.
- [x] **Step 2: Run the focused tests** and verify no undo snapshot exists.
- [x] **Step 3: Implement snapshot capture before state-changing session operations.**
- [x] **Step 4: Add the visible `Undo last action` control and clear it after restore.**
- [x] **Step 5: Run all unit and live-flow tests.**

### Task 6: Expand standard E2E workflow and verify the redesign

**Files:**
- Modify: `scripts/e2e-smoke.mjs`
- Modify: `src/BadmintonPlanner.live.test.tsx`
- Modify: `src/components/LiveSessionBoard.test.tsx`

- [x] **Step 1: Add E2E steps** for entering Live session, navigating back to Setup, late arrival, early departure, adding/removing a court, and undo.
- [x] **Step 2: Run E2E** and verify the new workflow fails before the implementation tasks are complete.
- [x] **Step 3: Run the complete suite:** `npm run test:unit`, `npm run build`, `npm run test:e2e`, and `git diff --check`.
- [x] **Step 4: Verify mobile and desktop layouts** with the existing E2E/browser tooling, checking no court action or player name is clipped or overlapped.
- [x] **Step 5: Commit each completed task with focused messages, then request a final code review.**
