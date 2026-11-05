# Shared-session reliability and unattended play

## Intent
An organizer should be able to join the games while players use their phones to finish matches. Shared edits must survive refresh, the queue must prioritize waiting people, and pasted roster text must map to stable player identities. All implementation and deployment stays on beta until the user chooses to promote it.

## Agreed behavior
- Organizer edits autosave to the current shared session.
- Players press a larger, prominent Finish game button; this advances the shared session.
- Retain the approved quarantine and private 1–5 level behavior.
- Paste replaces the roster, but review lets each name map to an existing player, create a new player, or be ignored.
- Obvious scheduling instructions such as “4th court at 9:30” are not players.
- Name/gender changes update metadata and keep the current team assignments; they do not reroll the schedule.

## Approach
The prior read-on-open/Save-to-publish snapshot approach was rejected in favor of a shared session. Keep React on GitHub Pages and the existing Firebase service. Extend the current share record with schema/revision information, full public session settings, game identities, and live/completed progress. Do not introduce a hosting migration or a wholesale database rewrite in this release.

Each connected tab listens to its specific session. Organizer autosaves use a revision check so an old tab cannot overwrite newer progress. Store pending edits in a session-specific local recovery record before sending them; refresh restores pending edits or the latest confirmed cloud version, rather than silently discarding work. Show Saving/Saved/Offline/Conflict status and retry recoverable failures. Conflicts retain the unsaved draft and explain recovery rather than choosing silently.

Finish is an idempotent transaction against a game identity: two phones finishing the same game can complete it only once. A Finish action updates progress without replacing the whole organizer plan. A successful finish automatically fills a free court when a playable group exists. Never place someone on two live courts.

## Queue and generation priorities
1. Preserve ongoing/completed games, applied results, eligibility and quarantine.
2. Prefer longest-waiting eligible players and use actual played/live history for runtime decisions.
3. Put fully playable waiting-player groups first. With four courts and 28 players, 12 people are waiting: the first three ready groups should use those 12 before blocked repeat players.
4. Apply gender/level balance, preferred pairings and variety within those constraints. Private levels remain organizer-side and are never put in a public share.

Proposed default for blocked queues: automatically choose a playable planned group first, or form a group from eligible waiting players if needed. Preserve planned lineups only when the user chooses that alternative. If fewer than four are eligible, show who/what is being waited for; do not demand organizer intervention for an ordinary finish.

## Player identity and paste review
Assign permanent player IDs to the roster and bank, preserving IDs across rename and aliases. Migrate legacy name-only records once. Keep historical lineup display snapshots, while ID-based references connect their history to the current player. Preserve existing win/loss associations through a compatibility mapping; migrating the entire global statistics database is outside this release.

Paste review shows the original text and resolved player, offers existing-player/New/Ignore choices, and records confirmed aliases. Do not guess between ambiguous people. Deduplicate by resolved identity. Keep known level/quarantine metadata for retained players. Scheduling notes are shown as ignored lines so users can correct a mistaken exclusion.

## Permissions and scope
Retain the current organizer PIN/role flow for this beta iteration; do not describe a browser PIN as backend authentication. Public viewers can perform the existing Finish action; organizer controls remain gated. Firebase Auth/server-enforced organizer roles are a separate infrastructure change. Avoid publishing private levels or notes while extending public session progress.

Main and beta browser data remain isolated. Do not change the original dirty checkout, production branch, or unrelated signup-report work. The existing Firebase database remains shared infrastructure; automated tests must isolate cloud writes.

## Verification
- Reproduce and test shared-link editing/regeneration, including a shared duration different from local settings and visible no-op/failure feedback.
- Test edit/autosave/refresh/offline recovery and two-client stale-save/double-Finish races.
- Test 28/30/32-player four-court queues and staggered court finishes; no overlapping live players.
- Test parser instruction rejection, alias mapping, ambiguity, duplicate IDs, and live name/gender edits without lineup regeneration.
- Re-run quarantine/level migration, strict typechecks, full unit tests, desktop/mobile E2E, and beta deployment checks.

## User clarifications — November 5
These decisions supersede any automatic substitution or phone-first wording above:
- The iPad is the normal Finish control point. Other devices may also finish games. Make Finish prominent and easy to tap.
- Provide shared undo for an accidental Finish. Target that action without reverting unrelated edits. When a subsequent game depends on it and has already started, explain the dependency and require deliberate resolution rather than changing a live court silently.
- Prefer a fully playable planned game when a court becomes free. For blocked games, propose substitutions explicitly and show how many games each candidate has waited. Do not silently substitute.
- Fix initial grouping so waiting players form playable games rather than distributing busy players across every next game.
- Show a game-quality score and breakdown: waiting fairness, MF/MM/FF pair constraints, level balance, repeated partners/opponents, and preferred pairings. Eligibility and live-player conflicts remain hard constraints that cannot be outweighed by points. Higher scores mean better fit among eligible games under the displayed weights. Start with proposed weights and make them reviewable and tunable; the score is a decision aid, not a guarantee.
- Verify accidental Finish undo across devices, concurrent finishes, and undo dependencies alongside the existing verification cases.
