# Task 6: Standard E2E Workflow and Redesign Verification

Current status: verification completed in the follow-up against `928692b` below.
The initial handoff and its failed verification history are retained for context.

Base: `f54c697`. Test implementation committed; verification incomplete.
Stopped at the user's explicit request. No agents used. Production application files are unchanged;
pre-existing untracked plans, spec and logs are preserved.

## Implementation

- Retain the standard 40-game flow across 2, 3, 4 and 5 courts, including
  single-game roster editing and the existing one-lookahead decisions.
- Add eight standard session workflows: 2-5 courts at 1280x900 and 390x900.
  Exercise Live entry, Setup return, Start, Here now, Leaving, Add court,
  Remove court, cancellation, confirmed updates and one-step undo.
- Assert current physical lanes, lineups, initial slot and scores remain intact;
  future capacity and availability change; undo restores the previous schedule,
  roster, confirmation and archive without undoing an earlier action.
- Assert visible board text fragments (including long player names) and court
  buttons stay inside their containers/viewport and do not overlap. Closed
  disclosures are excluded from geometry, but their visible summaries are checked.
- Add a shell regression for undo across a Setup round trip and four board
  regressions retaining live lanes/actions/names after upcoming capacity removal.
- Replace network-idle and fixed UI sleeps with DOM readiness and bounded
  observable state checks. Block optional Google font hosts only, preserving
  local asset requests and uncaught application errors as failures.
- Use an available strict Vite port, capture startup diagnostics, save screenshots,
  close the browser on all exits, and terminate the owned server with a kill fallback.
  Bounds: 10s startup/navigation, 500ms readiness fetch, 5s actions/assertions,
  5s screenshots (3s on failure), 180s overall watchdog with stage reporting.

## Initial Verification (Historical)

- Baseline runner: passed all 40 games within a 40s command cap. The previous
  network-idle/font timeout did not reproduce in this session.
- Historical RED: running the expanded standard runner against a separate
  `/tmp/task6-pre-red` archive of `fc699c5` failed at the missing Setup navigation
  within its 5s assertion bound (exit 1, 30s command cap). The active checkout was
  not rewound or modified for this check.
- Initial development runs exposed test assumptions, not application defects:
  completed counts can change after editing a queued slot; Setup intentionally
  retains the board below its controls; collapsed details still expose text
  geometry; initial normalized storage must settle before snapshots are compared.
- First full unit run: 355 passed, 3 failed in 57.13s. One new assertion incorrectly
  expected no board in Setup (corrected); existing confirmed Setup Apply
  auto-archive `cancel` and `failure` cases hit Vitest's 5000ms per-test limit while
  browser/build work was also running. No process-level timeout occurred.
- Final `timeout -k 5s 120s npm run test:unit`: PASS, exit 0; 28 files,
  358/358 tests in 46.68s. No per-test or process timeout on this rerun.
- `timeout -k 5s 60s npm run build`: PASS, exit 0; Vite reported 8.72s.
  Existing greater-than-500-kB chunk warning remains.
- `timeout -k 2s 10s git diff --check`: PASS, exit 0.
- Latest `timeout -k 3s 180s npm run test:e2e`: FAIL, exit 1, not a
  process timeout. All 40 games across 2-5 courts passed, followed by the full
  1280px/2-court workflow. At 1280px/3 courts, `cancel must not mutate the session`
  failed: the original storage snapshot contained raw seeded players and missing
  courtOverrides/archive keys, while the later snapshot contained normalized
  levels and empty defaults. The initial persistence readiness assertion did not
  resolve this mismatch. Root cause remains unresolved; do not treat this as
  verified application corruption or a passing E2E suite.
- Earlier E2E attempts: one 5s assertion timeout at 2-court game 4 (incorrect
  completed-count assumption, corrected); geometry assertion failure on collapsed
  details (corrected); one 5s assertion timeout expecting the board absent in
  Setup (incorrect assumption, corrected); cancellation snapshot mismatch at
  1280px/4 courts. One attempt fully passed desktop 2- and 3-court workflows.
- No verification command reached its process-level timeout. The historical
  negative test and the two development E2E assertion timeouts are expected/test
  failures, not successful full runs. The first unit run's two existing per-test
  timeouts are recorded above, and passed in the final unit rerun.
- Desktop geometry passed ready/capacity/availability-undo checks for the completed
  workflows. Mobile scenarios are implemented but were not reached in these runs;
  no claim of completed mobile screenshot or layout verification is made.
- At the stop request, all known verification sessions had already exited. No
  further suite runs or application fixes were attempted.

Logs: `/tmp/task6-{baseline-e2e,historical-red,unit,unit-final,build,e2e,e2e-final}.log`.
Actual screenshots: `/tmp/badminton-e2e/live-1280-{2,3}.png`,
`setup-1280-{2,3,4}.png`, and `failure.png`. Artifacts may be overwritten by later runs.

## Initial Decisions and Review (Historical)

- Use a separate historical archive for the planned pre-implementation RED check:
  Tasks 1-5 were already reviewed at the user's baseline, so production code must
  not be reverted. Cost: this demonstrates the first missing public contract, not
  an individual RED for every already-implemented feature.
- Keep the user's checkout and reports; do not create a worktree, delete scratch
  artifacts, or dispatch a final reviewer agent. Final review is an author
  self-review, weaker than an independent review.
- Self-review: scope is limited to the standard smoke runner and the two requested
  test files. No dependencies or production logic changed. The expanded workflow
  is present, but the unresolved fixture/storage mismatch prevents an E2E pass;
  mobile acceptance and final independent code review remain outstanding. Task 6
  must not be marked fully verified. Independent review was not requested through
  an agent because the user explicitly prohibited agents.
- Existing build warning: the minified application chunk exceeds 500 kB.
  This task does not change runtime dependencies or application behavior.

## Follow-up: Snapshot Stabilization and Completed Verification

Baseline: `928692b`. No agents used. Only the standard E2E runner and this report
changed; production code, dependencies, docs/plans/specs and existing logs are untouched.

### Root Cause and Fix

- Reproduced the unchanged runner's strict cancellation failure at 1280px/4 courts
  (exit 1). The snapshot contained raw players and missing defaults.
- Added one combined bounded readiness assertion for all 24 normalized player
  levels (`2`), `courtOverrides: {}` and `saved-plans: []`. The remaining snapshot
  fields are explicitly seeded. Readiness alone still failed at 1280px/3 courts
  (exit 1): storage reverted to raw fixture values after readiness had passed.
- Temporary init-script tracing reproduced that failure and showed reCAPTCHA's
  child frames, including same-origin `about:blank`, executing the fixture script.
  Those frames cleared and reseeded the top page's storage after initial persistence.
- Restricted fixture initialization to `window === window.top`, retained the
  combined persistence readiness assertion, and removed diagnostic logging.
- Cancellation and undo still deep-compare all six fields: result, players, scores,
  courtOverrides, saved-plans and is-confirmed. No fields or assertions were removed.

### Final Verification

- First stabilized run, `timeout --signal=TERM --kill-after=10s 210s npm run test:e2e`:
  PASS, exit 0; all 40 games and all eight workflows passed.
- Final user-requested rerun, `timeout --signal=TERM --kill-after=5s 180s npm run test:e2e`:
  PASS, exit 0; all 40 games across 2-5 courts and all eight session workflows at
  1280x900 and 390x900 passed again. No process timeout or internal 180s watchdog
  expiration occurred in either stabilized run.
- Desktop and mobile workflows completed Setup return, Start, Here now, Leaving,
  Add/Remove court, cancellation, confirmed updates and one-step undo. Strict
  snapshots, current lineup/score preservation, future capacity/availability,
  clipping/overlap checks and uncaught-app-error assertions all passed.
- All 16 Setup/Live screenshots exist at `/tmp/badminton-e2e/{setup,live}-{1280,390}-{2,3,4,5}.png`.
  Visually inspected the five-court Live screenshots at both widths as well.
  `failure.png` is retained from a failed diagnostic run, not the passing run.
- `timeout --signal=TERM --kill-after=5s 180s npm run test:unit`: PASS, exit 0;
  28 files, 358/358 tests, 42.81s. No per-test or process timeout.
- `timeout --signal=TERM --kill-after=5s 60s npm run build`: PASS, exit 0;
  Vite 3.65s. Existing >500 kB chunk warning remains (521.18 kB minified).
- `git diff --check`: PASS, exit 0.

Final command outputs were captured with `bash -o pipefail` and `tee` at
`/tmp/task6-followup-e2e-development.log`, `/tmp/task6-followup-e2e-final.log`,
`/tmp/task6-followup-unit.log` and `/tmp/task6-followup-build.log`. The E2E logs
contain the two passing stabilized runs; earlier failed attempts above were
observed directly, not captured in these logs.

### Self-review

- Reviewed the runner diff against persistence initialization and write order.
  Top-frame-only seeding prevents later child-frame resets; combined polling
  requires normalized players and both defaults in the same storage read before
  the baseline is captured. Seeded result, scores and confirmation stay included.
- No production changes or weakened assertions; existing action, navigation,
  screenshot and overall time bounds remain intact. No blocking findings.
- This is an author self-review, not an independent review. No subagents were
  spawned, as requested. Task 6 desktop/mobile acceptance and verification are complete.
