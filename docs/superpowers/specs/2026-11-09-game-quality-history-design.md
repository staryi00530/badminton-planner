# Matchup quality and durable played history

## Intent and scope
Beta must separate rotation priority from matchup quality, avoid unnecessary MF/MM/FF mismatches, and retain completed games when a broken or unwanted plan is replaced. Keep React/GitHub Pages, the existing Firebase service and organizer controls. Main and the original dirty checkout remain untouched.

The user authorized the quality work and requested history preservation plus a reroll reset choice. The user selected continuing the same session and generating only its remaining original slot/court budget.

## Current findings
Past games currently derive from completed slot/court references into the mutable plan. Full Generate and Clear erase those references and scores. A slot number is therefore insufficient as a historical identity. The latest five-court simulation completed 100 schedules but averaged185.9points, of which180.7came from waiting;7.82of60games per schedule had mismatched team formats. Waiting cohort packing can override earlier gender parity repairs.

## Approach
Considered retaining active-plan references, archiving whole plans, and an independent played-game ledger. References cannot survive slot reuse; plan archives alone do not reliably seed rotation or prevent duplicate records. Use an independent ledger of actual completions, with plan archives remaining a separate feature. This is the only approach that preserves both the past-game view and usable history across rerolls without merging abandoned future games into history.

### Completed-game records
Automatically save each confirmed Finish as a self-contained record. No separate manual Save is required. Store a unique game identity, plan identity, completion ordering/time, source slot/court and physical lane, two ordered teams with permanent player IDs and public name/gender snapshots, and the score if present. Preserve the waiting/attendance context at completion using eligible waiting player IDs, so rerolling slot numbers or changing attendance cannot retroactively alter waiting history. Private levels and aliases never enter public shared history.

The local session ledger persists under its own beta browser key independently of bp-result. Shared ledgers live in the existing session record and use its revision transactions, subscriptions and per-tab recovery. Public snapshot/backup export includes the history. No separate global player-history database or authentication migration is introduced.

New plans receive a permanent plan ID; game IDs include that plan ID. Old delayed Finish requests therefore cannot finish a different game after slot numbers are reused. Legacy completed references are converted to ledger records once, before any destructive plan replacement. Migration never reapplies already credited win/loss results. Empty legacy Firebase arrays remain readable.

Finish is idempotent, including concurrent devices and reply-loss retries. Undo removes/reverses the corresponding ledger completion only when its existing dependency checks permit it; immutable request receipts survive Undo. A historical record from a replaced plan is not offered as an undoable live-game action in the new plan. Historical lineups/scores remain readable even if a player leaves or is renamed.

### Reroll, clear and recovery
A full reroll with completed history always presents a choice, even when the plan is not Confirmed:
- Keep played history and reroll (default): keep completed records and their scores, seed the new rotation from them, and replace the unplayed plan.
- Reset session history and reroll: explicitly clear session completion/rotation/repeat history and start fresh. The dialog states the number of completed records and requires a deliberate reset selection; Cancel changes nothing.

If games are marked live, the full-reroll dialog also warns that these unfinished games will be replaced. They are not recorded as completed. The existing regenerate-upcoming action continues preserving live courts and completed history; it does not ask to erase history. Clear schedule removes the plan but retains played history. Past games must remain accessible with no current plan. History reset is offered explicitly inside the reroll dialog.

The history choice and new plan are committed together only after generation succeeds. If generation fails or is cancelled, keep the previous plan, live state, scores and history. Autosave never publishes an intermediate empty plan during generation. A newer remote completion during generation causes a retained conflict/reconciliation rather than being overwritten. Reset history never silently erases a newer device completion.

Reset session history affects this session's records and rotation only. Player bank, aliases, private levels and existing all-time win/loss records remain separate. Previously confirmed plan archives retain their existing archive behavior and are not the authoritative ledger.

### Continued generation from retained history
Use player IDs to carry completed-game counts, actual eligible waiting events, and previous partners/opponents into generation. Do not count discarded future games. Current roster eligibility/quarantine/attendance still governs who may play. Departed players remain visible in past games but are not selected. Repeated regeneration must neither double-count ledger games nor make completed games re-enter the queue. Planned totals distinguish already played games from newly scheduled games.

## Two separate quality signals
Show rotation information separately: games completed, games waited while eligible, current busy/available state and the reason a candidate has priority. Remove waiting points from the matchup total and from the matchup weighting controls. Rotation remains a selection priority, not points capable of hiding weak pairings.

Matchup points include matching format, team-level balance, repeated teammates/opponents and preferred pairings. Keep the existing configurable component weights initially (format15,level4,partner3,opponent1,preferred12), with a clear higher-is-better points label rather than an invented percentage. Show the component breakdown. Unknown private levels use3 and are identified as assumed. Persist organizer matchup weights in beta browser preferences.

Show a projected average over the full unplayed plan, not just the next eight games. Score future games in plan order using retained completed history plus earlier projected games; label that assumption. Existing live/explicitly forced games are shown separately and not silently altered to raise an average. Never include waiting bonuses in the matchup average.

## Gender-format and waiting priorities
Hard eligibility, four distinct players and no overlapping live players always win. For automatic planning, choose and partition players so teams have matching formats (MF/MF,MM/MM,FF/FF) whenever the available pool permits it. Maximize fully playable waiting-player groups within that constraint, then apply level/repetition/preferred-pair quality.

With twelve waiting players containing an odd number of women, three all-waiting matching-format groups are mathematically impossible. In that case prefer two matching-format waiting groups and use a returning compatible player in the remaining groups, rather than silently creating MF/MM. Do not let an optional preferred pairing force an avoidable format mismatch. If a forced manual lineup or the complete available pool makes matching formats impossible while filling courts, preserve the explicit lineup/use the best feasible plan and label the unavoidable format compromise with its reason. Do not conceal it as an ordinary valid pairing.

## Verification
- Finish, refresh, clear, reroll-with-history and reroll-with-reset, locally and on a shared session.
- Same slot/court reused across two plans; duplicate/concurrent Finish; stale requests after reset/reroll; guarded Undo after a plan replacement.
- Failed generation keeps the prior plan and ledger; remote Finish during generation/reset cannot disappear; per-tab offline recovery retains history.
- Legacy completed references migrate once; removed/renamed players and historical scores survive; all-time statistics are not reapplied by migration/reset.
- Retained history affects rotation/repeat penalties exactly once; abandoned unplayed games never count.
- Repeat the logged32-player12-slot five-court simulation across100seeds, plus28/30players and varying genders/availability. Assert complete unique lineups, maximal feasible matching-format ready groups, zero avoidable format mismatches and matchup scores independent of waiting.
- Compare before/after matchup averages, format compromises, game-count spread, repeat groups and waiting; do not claim better quality from a waiting-inflated total.
- Strict typechecks, unit/integration tests, desktop/mobile E2E and beta deployment; main unchanged.

## Builder decisions
Exact component boundaries, migration marker names, algorithm implementation and routine layout details are delegated. Preserve native dark dropdown styling and the prominent Finish control. Do not broaden scope into a global statistics rewrite or a hosting migration.

## Builder review and open decisions
Builder review completed. Waiting remains one eligible completed-game event, not one round or elapsed minute; live players do not accumulate waiting credit. This preserves the existing user-facing games-waited unit. The ledger stores the contemporaneous eligible waiting IDs so later attendance edits cannot change those past events.

## Approved decisions
The user selected continuing the same rotation/repeat history and generating only the remaining original session. Remaining is the configured logical slot/court budget minus completed games assigned to each session slot, across plan IDs. A partially completed five-court slot with three recorded games therefore has two replacement games, not five. Empty consumed slots do not create new waiting credit. A history-reset reroll starts a fresh configured block. Finish timing is asynchronous; this budget does not invent an elapsed wall-clock deadline when session start is blank.
