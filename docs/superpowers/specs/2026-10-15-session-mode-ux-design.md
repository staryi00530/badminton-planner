# Session Mode UX Design

## Context

The organizer completes setup before play, but the session must continue
without requiring that person to explain every action. The live screen must be
self-explanatory for any player who picks up the device.

This work covers the current single-device workflow. Real-time synchronization
between multiple devices is explicitly out of scope.

## Goals

- Make the live board the primary view after a schedule is generated.
- Show what each court is doing and what action is expected next.
- Allow any player to finish a game without exposing scheduling complexity.
- Keep current courts stable and make substitutions and waiting states clear.
- Provide recovery from an accidental finish, promotion choice, or substitution.
- Preserve access to setup, scores, full schedule, history, and admin controls.
- Make late arrivals, early departures, and extra courts on the fly safe and
  understandable without restarting the session.

## Non-goals

- Firebase or multi-device live synchronization.
- Changes to the scheduling algorithm or queue fairness rules.
- Audio, vibration, or push notifications.
- Replacing the existing admin PIN or skill-level model.
- Rewriting already completed or currently live games when session conditions
  change.

## Proposed Experience

### Session mode

After a successful Generate or Re-roll, the application enters session mode.
The first viewport begins with the live board and session summary. Setup
controls remain available below the board or through an explicit Setup view,
but do not compete with the court actions during play.

The live board contains, in order:

1. A session summary: active courts, players on court, waiting players, and
   completed games.
2. A "What happens now?" banner describing the most important next action.
3. Stable court lanes for Court 1 through Court 5.
4. The next queued games, one per planned court.
5. Folded past games and the full future schedule.

### Court lanes

Each court lane keeps its physical court identity stable. A lane has one
primary action:

- `Finish game` when live.
- `Start game` when ready.
- `Waiting` when a player is unavailable, with the reason shown inline.
- `Done` when no game remains.

Edit, substitution, scoring, and schedule details remain secondary actions.
Finishing a court changes only that court's lane.

### Guidance and unusual states

The banner and lane status use direct instructions rather than scheduler
terminology. Examples:

- "Court 2 is ready. Send these four players to Court 2."
- "Court 1 is waiting: Mindy is still playing on Court 3."
- "Court 1 updated: Jess replaced Kayleen because Kayleen is still playing."

When the queue decision modal is required, it remains the blocking action for
the completed court only. The modal explains the blocked player, the available
one-game lookahead, and the substitution option.

### Recovery

The live board exposes `Undo last action` after a state-changing action. The
undo snapshot covers finish/start, queue promotion choice, substitution, and
single-game roster edits. Undo restores the prior live games, completed games,
schedule, scores, and notices as one atomic state update.

### Setup and navigation

Before a schedule exists, setup remains the primary view. Once a schedule is
active, session mode is selected by default. A compact navigation control gives
access to:

- `Live session`
- `Setup`
- `Past games`
- `Saved plans`
- `How it works`

Advanced regeneration, levels, preferred pairings, debug export, and other
administrative controls remain behind the existing admin view or setup view.

### Mid-session availability and court changes

The live session must support operational changes without making the organizer
rebuild the session manually:

- A late arrival can be marked `Here now`; the change applies to the first
  upcoming slot and preserves all completed and live game records.
- An early departure can be marked `Leaving`; the change applies to the first
  upcoming slot and preserves all completed and live game records.
- An available extra court can be added from the live board with an explicit
  `Add court` action. The court becomes available at the current or selected
  upcoming slot, and only future games are regenerated.
- Removing a court follows the same rule and never removes a completed or live
  game.
- After any such change, the UI shows a short confirmation identifying the
  affected slot and the number of courts currently active.

The regeneration boundary is the first upcoming slot that can be changed. The
state before that boundary is immutable for the operation: completed games,
current live games, scores, and their player snapshots remain intact. If a
future court cannot be filled because fewer than four eligible players are
available, the board explains that condition rather than silently dropping a
current court.

## State and component boundaries

- Add a session-mode/view state at the planner shell level; do not duplicate
  queue state inside presentation components.
- Keep `useLiveQueue` as the source of truth for live/completed transitions.
- Add an undo snapshot alongside queue state, with a single restore callback.
- Extract the live-board summary/banner from `ScheduleGrid` so the layout can
  be tested independently.
- Keep `ScheduleGrid` responsible for court lanes and schedule rendering, not
  setup controls.
- Use existing `QueuePromotionModal` for conflict decisions and extend its
  messaging only where needed.

## Acceptance criteria

- After Generate or Re-roll, the user sees the live session board first and all
  configured initial courts are live.
- A first-time user can identify the next action for every active court from
  the first viewport without reading the full schedule.
- Finishing Court 1 does not move, stop, or relabel the other current courts.
- Every blocked or waiting state identifies the unavailable player and the
  relevant court when known.
- An accidental state-changing action can be undone once without affecting
  unrelated schedule data.
- Setup and admin controls remain accessible without cluttering the live board.
- Late arrival, early departure, and add/remove-court operations preserve the
  history and current games while refreshing only the future queue.
- Unit, component, and multi-court E2E tests cover the live workflow.
