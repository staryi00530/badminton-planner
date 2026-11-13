# Court expansion, reserved games and recovery diagnostics

Source: logs/d22cc650-5d82-4003-b754-346cc8fce00e.json in the original user workspace (read-only), exported Nov12, deployed build Nov11. Work occurs only in isolated persistent worktree.

## Verified causes
- Actual overlaps: clean board160; apply:start161 edits live slot2court3 Cherie→Rena while Rena stays live in slot3court1. Regeneration receives the duplicate as input. Later edits418/426 similarly duplicate Mindy/Jess/Tee/Simon/Nathaniel. Both live edit paths lacked validation across logical slots.
- Wrong next game: Finish flow1794448771112-18 at01:59:31UTC reserves slot3court1 George+2/Yuta/Suebin/Steven. Regeneration starts atslot2; only its first slot receives forced courts, so later reservation is rewritten and Chel/Rena/George+2/Rachel is promoted without requested substitution. All seven Finish events completed the clicked snapshot; this is replacement-lineup drift, not evidence of the wrong completed game.
- Reset: user confirmed Keep history. Seven retained completions [3,2,2] subtract from nominal5 to produce [2,3,3,5...]; reduced partial slots are correct. Separately, keep-history regeneration called getCourtsPerSlot({}) and cleared courtOverrides, discarding the deliberately added-court plan and reverting future slots to base3 in the first logged reroll. Recovery must preserve those capacity changes and the effective current capacity while retaining the original remaining-game budget. Explicit reset can use the fresh base configuration. Logs previously omitted the choice, override plan and nominal-vs-remaining counts.

## Implementation/checklist
- [x] New live edit validation before mutation/generation in both apply paths. Detect newly introduced identity/game-pair conflicts across all current logical slots, show physical court, log blocked action; allow partial repair and same-slot swaps.
- [x] Preserve planId and player IDs on game-only edits, and live game IDs during normalization.
- [x] Start regeneration at the reserved first pending slot when later than the initial boundary, forcing its lineup and preserving earlier actual games. Add queue before/after/reason/lane/ID diagnostics.
- [x] Explicit generation intent/reset flag/source+retained history/epochs/configured capacity/nominal+remaining arrays and completion active/deferred counts. Dialog shows first3slot budgets and reset switch.
- [x] Log snapshots are immutable, retention increased500→2000, sequence/drop/export metadata exposes truncation.
- [x] Keep-history regeneration preserves intentional court overrides and current active capacity; explicit reset uses fresh base settings. Preview and logs distinguish these two plans.
- [x] Full typecheck/unit/browser checks with exact mixed-slot topology, blocked busy edits, 4→5courts and capacity preview; independent review and production build.
- [ ] Push beta only and verify successful deployment. Main and original dirty workspace remain untouched.

Recovery also persists capacityProgressFloorSlot independently of remaining game counts. This prevents a later Finish or repeated reroll from rewinding already-open courts when retained games leave partial early slots. Local/shared capacity and waiting availability honor the floor, explicit reductions still work, and reset clears it. Share/organizer transfer round-trips it; same-epoch legacy commits preserve it.

Validation: typecheck, 767/767 unit tests, complete desktop/mobile browser smoke suite including mixed-slot 4→5 recovery, and beta production build passed. Independent review found no critical/important findings.
