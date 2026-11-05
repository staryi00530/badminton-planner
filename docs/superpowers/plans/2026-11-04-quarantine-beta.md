# Quarantine and five-level beta integration

User authorization on November 4: include both persistent quarantine and private levels 1–5, test and push beta only. This supersedes the older local plan's no-publication restriction. Main remains at 2144731.

Use the existing approved October 29 behavior: migrate private levels 1→1, 2→3, 3→5 once, default new players to 3, exclude quarantined players from upcoming generation/manual lineups/substitutions until explicitly returned, and preserve ongoing/completed games and scores. Replace Skip next with persistent Quarantine and show a separate return panel in Setup and Live.

## Integration constraints
- Preserve current beta's Firebase acknowledgement/error handling and omitted-empty-array decoding.
- Preserve pasted-roster replacement, known metadata and quarantine for retained players.
- Isolate beta local/session storage using beta: keys. Seed a one-time personal-data copy; never migrate or overwrite main's browser data.
- Share published quarantine availability as optional player indices, without publishing private levels.
- Keep browser tests isolated from Firebase writes. Retain strict TypeScript settings; register DOM matchers for Vitest 5's current assertion interface.

## Tasks
- [x] Integrate existing feature patch in an isolated checkout and resolve against current beta.
- [x] Add red/green regression tests for beta data isolation, retained quarantine during paste replacement, and quarantine share roundtrip.
- [ ] Run strict typecheck, full unit/E2E suite, beta build and audit.
- [ ] Fresh independent review, resolve material findings, and repeat relevant verification.
- [ ] Commit/push beta, watch deployment, and verify live quarantine/levels UI. Do not promote main.

## Ledger
- Original dirty checkout, signup-report changes and logs remain untouched.
- Existing feature tests were ported from the prior local implementation; new beta-specific regressions failed before their fixes.
- Preserved newer queue flow IDs and later-live-slot regeneration regressions during conflict resolution.
- Old level defaults in newer paste/logger tests were updated to the five-level migration contract. App/test strict type errors resolved without weakening compiler settings.
