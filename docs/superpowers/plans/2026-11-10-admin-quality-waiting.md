# Admin game quality and player waiting panel
> Execute with test-first steps; independent card display and durable wait tracking domains may run in parallel. Fresh full review before beta push.

User approved real elapsed waiting plus games waited, beginning when a person is available (session start, Finish, join/return) until their next game starts. Playing, unavailable and preparation do not accrue time. Use the app's existing availability/attendance semantics, not a new wall-clock arrival scheduler. Do not change selection/generation weights or ranking.

Show matchup quality points directly on current/upcoming court cards for admins, computed from existing live assessment and full projected future history. Keep weighting/breakdown panel. Waiting stays separate from matchup score. No private card score in player view.

Persist WaitingClockState {trackingStartedAt?:number,since:Record<playerIdentity,epochMilliseconds>} under independent beta local key and public shared runtime. Only actual state transitions mutate clocks; display ticks never write. Start session timers initializes waiting tracking for eligible off-court players. Preserve a waiting timestamp while still eligible/off-court. Finish starts a wait for newly off-court players; Start removes it. Departure/quarantine/suspension/absence clears it; return/join begins a new wait. Retain across refresh, history-preserving recovery rerolls and private organizer handoff; explicit session-history reset clears it. Source timestamps are authoritative on remote apply. Legacy missing timing remains unavailable until real activity begins tracking; never invent earlier duration. Label tracked baseline.

Local reducer reconciles clocks after runtime/availability patches, including ledger capture, and Undo restores state. Shared transactions reconcile from before/after using action.at, and Finish action snapshots prior waiting clocks so guarded Undo can restore newly waiting promoted players' original waits without reverting unrelated players. Public snapshot CAS already serializes organizer attendance changes; codecs validate finite nonnegative integer values and bounded maps; private handoff whitelist preserves fields.

Admin panel is collapsible to keep Finish controls near the top. Summary shows waiting count and longest recorded wait. Expanded table shows player, status, wait time, eligible game completions waited and completed games; longest waiting first, tie by games waited and fewer played. Separate Playing/Unavailable/pre-session states, no fabricated zero for unknown legacy time. One component-only display timer; no scheduler or autosave tick effects.

- [x] Durable clock helper and local/shared storage/Undo/codec tests: initial start, Finish/Start, late joins, return, quarantine, stable IDs/rename, no wait while unavailable/playing, history reset/keep, shared refresh and guarded Undo.
- [x] Admin card points display tests, no player-view disclosure; current vs projected scoring semantics unchanged.
- [x] Waiting panel UI tests sorting/status/count/format/background return; root wiring and no DB writes from display ticks.
- [ ] Strict/full unit/browser checks, production build, fresh review, beta-only deployment and verify main unchanged.

Validation: full Node 24 typecheck and 663 unit tests passed, then complete browser smoke (40 games, 2–5 courts, eight desktop/mobile workflows, 35-player private handoff and waiting-clock refresh). Final stale-timer-request regression added and 50 helper/shared tests passed. Production beta build passed. Independent review findings fixed and re-reviewed. Beta deployment verification follows push.

Follow-up: first CI run hit the existing five-second Setup Apply/Undo UI test limit (663 other tests passed). Lazy-mount the waiting table only when expanded to reduce hidden DOM work. Independent delta review passed. Fresh full validation: 665 unit tests, complete browser smoke, and beta production build passed. Native details-toggle test flushes its browser event before asserting the single display interval.
