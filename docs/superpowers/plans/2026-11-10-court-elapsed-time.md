# Live court elapsed time
> Use executing-plans for local integration and dispatching-parallel-agents for independent display and shared codec domains; test-first and fresh final review.

User requests time passed since each court is up. Define it as elapsed actual wall-clock time since a game becomes Live, not scheduled slot time. Show elapsed mm:ss (h:mm:ss after one hour) on each active court. No countdown, automatic Finish, notification or schedule change. Legacy live games without recorded start show Elapsed — with explanation, never fabricated duration.

GameRef gains optional startedAt epoch milliseconds. Initial generated live games are untimed until the organizer presses Start session timers once (explicit user selection). That action starts only untimed live courts together and never resets a running timer. Explicit starts and newly promoted games get a start timestamp at actual activation; existing live games retain their timestamp across normalization, edits, lane/capacity changes and future regeneration. Finish's replacement gets a new timestamp; local and guarded shared Undo restore the original timestamp. Persist through local state, public shared runtime, complete private handoff and refresh.

Display uses a child-only timer, recomputing Date.now()-startedAt each second and on visibility return. No elapsed writes or autosave activity each tick. Clamp negative elapsed to zero. Shared transaction uses provided action.at (pure reducer), omitting startedAt for legacy actions without a valid timestamp. Validate finite nonnegative integer timestamps in shared/transfer boundaries. Ordinary public start time is not private metadata.

- [x] UI RED/GREEN: independent game elapsed format, ticks, background resume, unknown start, cleanup; render only live courts with no repeated screen-reader announcements.
- [x] Shared/codec RED/GREEN: start, Finish replacement, idempotent duplicate, Undo restoration, no timestamp reset on snapshot commit; runtime and private transfer preserve/validate field.
- [x] Local RED/GREEN: initial generation, explicit start, promotion, normalization, editing/preserved lane, completion/Undo and refresh; do not stamp legacy already-live games.
- [ ] Full strict checks, unit/browser tests, production build; fresh review; push beta only and verify deployment. Main and original dirty checkout unchanged.

Verification:650tests in50files pass; complete40-completion desktop/mobile browser suite and private35-player handoff pass. Browser proof initial5courtsuntimed, explicitStartsessiontimersall0:00, visibilityresume45seconds, replacementownnewclock andremainingcourts45seconds, transfer/refreshpreserveboth. Productionbuildpasses. Freshreview noimportantfindings; addedliveGames dependency tomemoizedlocalqueuecallback. Existinglineupstability tests nowignoreonlyvolatileelapsedtext; dedicatedclock/data tests verifytimestampsandUndo. No productioncloudwrites in automatedtests; mainunchanged.
