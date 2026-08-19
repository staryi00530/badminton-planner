# 🏸 Badminton Match Planner

An interactive 2v2 badminton match scheduler for recreational groups. Generates fair, varied, and well-paced round-robin schedules for a 3-hour session.

**Live app → [staryi00530.github.io/badminton-planner](https://staryi00530.github.io/badminton-planner)**

---

## Scheduling Priorities

The algorithm balances several goals, in this order:

| Priority | Rule | Type |
|---|---|---|
| 1 | Equal games — max ±1 spread across all players | Hard |
| 2 | No more than 2 consecutive games before mandatory rest | Hard |
| 3 | No more than 2 consecutive rests before mandatory play | Hard |
| 4 | All courts filled every slot (no empty courts) | Hard |
| 5 | Avoid repeating the same partner | Soft (3× penalty) |
| 6 | Skill-balanced teams — equalize combined skill ratings | Soft (2× penalty) |
| 7 | At least 2 women's doubles games per session | Grouping (4F court when target unmet) |
| 8 | Avoid repeating the same opponents | Soft (1× penalty) |
| 9 | Balanced gender matchups — MM vs MM, FF vs FF, or MF vs MF | Semi-hard (15× penalty for unbalanced) |
| 10 | Controlled randomness — variety across re-rolls | Jitter (0–1.5) |

**Hard constraints** are never violated. **Soft constraints** are scored — lower is better — and the best combination wins. When multiple arrangements score equally, jitter breaks the tie randomly so re-rolls produce different schedules.

---

## Features

- **Fair rotation** — equal game counts enforced by play-rate grouping + shuffle
- **Skill balancing** — win/loss records feed back into matchmaking on the next generate
- **Score entry** — enter results after each game; valid badminton scores (21-point rules) are enforced
- **Women's doubles** — at least 2 WD games per session, then relaxes to normal preferences
- **No burnout** — hard limits on consecutive play and rest
- **Group-repeat avoidance** — swaps players to avoid repeating the exact same 4-person court group
- **Extra court** — configure a sub-window where an additional court is available (e.g. +1 court from 60–150 min)
- **Multi-court** — 1, 2, or 3 base courts with color-coded court assignments
- **Staggered arrivals** — All here / Early-Late groups / Per-player custom slot ranges
- **Mid-session changes** — re-generate from any slot, or fix just one game without touching the rest ("This game only")
- **Confirm & Saved Plans** — lock in the schedule for the session; past/saved schedules kept for ~2 weeks, restorable and updatable
- **Player Bank** — every player you've ever added is remembered; multi-select to bulk-add to today's roster
- **Persisted schedule** — auto-saves to browser storage; survives page refresh
- **Sharing** — generates a link that loads the schedule instantly; pushing your edits back to that link only happens when you hit Save (see [Sharing](#sharing) below)
- **Re-roll** — regenerate in one click until you're happy
- **Copy to clipboard** — formatted text for group chats
- **Save as image** — exports schedule as PNG via html2canvas

---

## Algorithm

Greedy slot-by-slot with two phases per time slot:

### Phase 1 — Player Selection

1. Filter by each player's availability window
2. Classify players: `mustRest` (≥2 consecutive games), `mustPlay` (≥2 consecutive rests), `canPlay`
3. Compute eligible count = available − mustRest; derive `courtsThisSlot = min(courtsPerSlot, floor(eligible / 4))` — this ensures no court is left empty
4. Sort `canPlay` by normalized play rate (`gamesPlayed / availableSlots`), with `consecutivePlayed` as a secondary tiebreaker (spreads rest cycles to prevent mustRest cascade), then Fisher-Yates shuffle within tied groups
5. Fill `courtsThisSlot × 4` spots: mustPlay first, then canPlay by rate order
6. Post-selection even-F swap: if the selected female count is odd, swap one non-mustPlay female for an unselected male (or add one more female) — odd F count makes balanced court grouping impossible

### Phase 1.5 — Court Grouping (gender-aware)

Before pairing, players are assigned to courts to guarantee a balanced gender composition:

- **WD mode** (active when WD target < 2 and ≥4 females selected and ≥2 courts): groups all 4 females onto one court → guaranteed FF vs FF game. Remaining courts fill with males (MM vs MM).
- **Normal mode**: distributes 2F+2M per court → enables MF vs MF matchups.

This is the mechanism that produces women's doubles — it cannot be achieved via pairing score alone since FF vs FF requires all 4 players on a court to be female.

### Phase 2 — Team Pairing

For each court's 4 players, evaluate all 3 possible 2v2 splits and score each:

```
score = (partnerRepeat × 3)              // strongly avoid same partners
      + (skillImbalance × 2)             // equalize team skill totals
      + (genderTypesMismatch ? +15 : 0)  // semi-hard: MM vs MM, FF vs FF, MF vs MF only
      + (opponentRepeat × 1)             // lightly avoid same opponents
      + random(0, 1.5)                   // jitter for variety
```

Lowest score wins. Skill ratings are derived from each player's win rate from previously entered scores. The gender mismatch penalty (15) exceeds the realistic maximum of all other soft factors combined (~13), making it a near-hard constraint that only yields in extreme edge cases (e.g. mustPlay constraints force an ungroupable composition).

---

## Configuration

| Setting | Options | Default |
|---|---|---|
| Session length | 60–240 min (slider, step = game length) | 180 min |
| Game length | 8–20 min (slider) | 15 min |
| Base courts | 1, 2, 3 | 1 |
| Extra court | Off / On with start offset + duration | Off |
| Availability | All here / Early-Late / Per player | All here |

---

## Default Roster

| # | Name | Gender |
|---|---|---|
| 1 | Eamon | M |
| 2 | Jialin | F |
| 3 | Mindy | F |
| 4 | Yuta | M |
| 5 | Jae | M |
| 6 | Jess | F |
| 7 | Edwin | M |
| 8 | Stanley | M |
| 9 | Kayleen | F |
| 10 | Ricky | M |
| 11 | Tim | M |
| 12 | Henry | M |

---

## Stack

- React 18 + TypeScript, built with Vite (`npm run dev` / `build` / `preview`)
- Vitest for the algorithm test suite
- Firebase Realtime Database for sharing and cross-device win/loss sync, with Firebase App Check (reCAPTCHA v3) and scoped database rules for security
- html2canvas for image export (loaded on demand)
- Hosted on GitHub Pages, deployed automatically by GitHub Actions on every push to `main`

See [CLAUDE.md](CLAUDE.md) for the full architecture, algorithm internals, and design rationale.

## Sharing

- **Share** writes the current schedule to `/shares/{id}` in Firebase and copies a `?share=<id>` link.
- **Opening that link** does a one-time read — it loads the schedule but doesn't keep listening for further changes.
- **Save** is the only thing that pushes edits back to the link, for anyone who opens or refreshes it afterward to see.
- The link stays stable across a page refresh in the same tab (so re-sharing reuses it), but the connection clears when the tab/browser closes — it can't resurface later and overwrite an unrelated schedule.

A Cloudflare Worker (`workers/share-links/`) and a base64-hash link remain as fallbacks if
Firebase isn't configured (`window.FIREBASE_CONFIG` unset in `index.html`), though neither
supports pushing edits back — just a one-shot link.
