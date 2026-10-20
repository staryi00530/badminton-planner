# 🏸 Badminton Match Planner

An interactive 2v2 badminton match scheduler and live-session board for recreational groups. Plan a session, keep courts moving, and record completed games.

**Main app → [staryi00530.github.io/badminton-planner](https://staryi00530.github.io/badminton-planner/)**<br />
**Beta app → [staryi00530.github.io/badminton-planner/beta](https://staryi00530.github.io/badminton-planner/beta/)**

---

## Scheduling Goals

The slot-by-slot scheduler considers availability, recent play/rest history, court capacity, team composition, matchup variety, and recorded results. Preferred teammate pairings are favored when the roster allows. These are goals and tradeoffs, not guarantees: a small or changing roster can lead to repeated groups, uneven matchups, or fewer playable courts than planned.

---

## Features

- **Fair rotation** — tries to distribute games and rests evenly while respecting availability
- **Matchup balance** — uses recorded results and organizer preferences when forming teams
- **Score entry** — enter results after each game; valid badminton scores (21-point rules) are enforced
- **Women's doubles** — aims to schedule women's doubles when the roster allows
- **Variety** — tries to avoid repeating partners, opponents, and the same four-player group
- **Extra court** — configure a sub-window where an additional court is available (e.g. +1 court from 60–150 min)
- **Multi-court** — configure 1–5 courts; add or remove courts during a session
- **Staggered arrivals** — All here / Early-Late groups / Per-player custom slot ranges
- **Live session** — games start on the planned courts; any player can mark a game finished
- **Queue recovery** — choose to substitute unavailable players in the waiting game or promote one playable game ahead
- **Late arrivals and early departures** — update availability and regenerate upcoming games without changing current or completed games
- **Skip next** — temporarily keep a player out of the next generated game
- **Undo** — restore the previous session state after an accidental action
- **Past games and player stats** — review recorded lineups, scores, games played, rests, and win-loss results
- **Mid-session edits** — regenerate upcoming games or change one game's lineup with "This game only"
- **Confirm & Saved Plans** — lock in the schedule for the session; past/saved schedules kept for ~2 weeks, restorable and updatable
- **Player Bank** — every player you've ever added is remembered; multi-select to bulk-add to today's roster
- **Persisted schedule** — auto-saves to browser storage; survives page refresh
- **Sharing** — generates a link that loads the schedule instantly; pushing your edits back to that link only happens when you hit Save (see [Sharing](#sharing) below)
- **Re-roll** — regenerate in one click until you're happy
- **Copy to clipboard** — formatted text for group chats
- **Save as image** — exports schedule as PNG via html2canvas

---

## How Scheduling Works

For each slot, the scheduler selects available players using their play/rest history and the courts available in that slot. It groups players by the session's team-composition settings, then scores possible teams using factors such as matchup variety, preferred pairings, gender composition, and recorded results. The schedule is recalculated on Generate or Re-roll.

During a session, current and completed games are preserved. Attendance or court-capacity changes regenerate from the next safe upcoming slot. If a queued game's players are unavailable, the app offers a substitution or a one-game lookahead; it does not skip through an arbitrary number of queued games. Some scheduling goals may be relaxed when the roster cannot satisfy them all.

---

## Configuration

| Setting | Options | Default |
|---|---|---|
| Session length | 60–240 min (slider, step = game length) | 180 min |
| Game length | 8–20 min (slider) | 15 min |
| Courts | 1–5 base courts; optional extra-court window when below 5 | 1 |
| Availability | All here / Early-Late / Per player | All here |
| Team composition | Mixed-team preference and preferred teammate pairings | — |

---

## Default Roster

| # | Name | Gender |
|---|---|---|
| 1 | Player 01 | M |
| 2 | Player 02 | F |
| 3 | Player 03 | F |
| 4 | Player 04 | M |
| 5 | Player 05 | M |
| 6 | Player 06 | F |
| 7 | Player 07 | M |
| 8 | Player 08 | M |
| 9 | Player 09 | F |
| 10 | Player 10 | M |
| 11 | Player 11 | M |
| 12 | Player 12 | M |

---

## Stack

- React 18 + TypeScript, built with Vite (`npm run dev` / `build` / `preview`)
- Vitest for the algorithm test suite
- Firebase Realtime Database for sharing and cross-device win/loss sync, with Firebase App Check (reCAPTCHA v3) and scoped database rules for security
- html2canvas for image export (loaded on demand)
- Hosted on GitHub Pages. GitHub Actions deploys `main` at the site root and `beta` under `/badminton-planner/beta/` when either branch is updated

See [CLAUDE.md](CLAUDE.md) for the full architecture, algorithm internals, and design rationale.

## Sharing

- **Share** writes the current schedule to `/shares/{id}` in Firebase and copies a `?share=<id>` link.
- **Opening that link** does a one-time read — it loads the schedule but doesn't keep listening for further changes.
- **Save** is the only thing that pushes edits back to the link, for anyone who opens or refreshes it afterward to see.
- The link stays stable across a page refresh in the same tab (so re-sharing reuses it), but the connection clears when the tab/browser closes — it can't resurface later and overwrite an unrelated schedule.

A Cloudflare Worker (`workers/share-links/`) and a base64-hash link remain as fallbacks if
Firebase isn't configured (`window.FIREBASE_CONFIG` unset in `index.html`), though neither
supports pushing edits back — just a one-shot link.
