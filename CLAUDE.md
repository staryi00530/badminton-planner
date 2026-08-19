# 🏸 Badminton Match Planner

An interactive 2v2 badminton match scheduler for recreational groups. Generates fair, varied,
well-paced round-robin schedules for a session, lets you edit and confirm them, and optionally
shares them with the group via a link backed by Firebase.

**Live app →** [staryi00530.github.io/badminton-planner](https://staryi00530.github.io/badminton-planner)

Built iteratively with Claude.

## Features

- **Fair rotation** — everyone's game count stays within 1 of each other
- **No burnout** — max 2 consecutive games before mandatory rest; max 2 consecutive rests before mandatory play
- **Partner & opponent variety** — heavily penalizes repeated partners, lightly penalizes repeated opponents
- **Skill-balanced teams** — skill is each player's win rate (defaults to 0.5 with no recorded games); pairings are scored to keep each court's two teams close in combined skill
- **Balanced gender matchups** — favors symmetric matchups (MM vs MM, FF vs FF, MF vs MF) over mismatched ones (e.g. MF vs MM)
- **Women's doubles target** — tries to give an all-female court (FF vs FF) at least twice a session when there are enough women and courts, without leaving any court short-handed
- **Group-repeat avoidance** — actively swaps players to avoid repeating the exact same 4-person group on a court twice
- **Controlled randomness** — shuffling within tied game-count groups + jitter on pairing scores prevents deterministic repetition while preserving fairness
- **Multi-court support** — 1–3 courts, plus an optional 4th "extra court" active for a configurable time window
- **Staggered arrivals** — three modes: All here / Early-Late (with overlap) / Per-player exact slot ranges, plus a "leaves at" cutoff per player
- **Player Bank** — every player you've ever added is remembered; multi-select to bulk-add several to today's roster, or add someone to the bank without adding them to today's session
- **Two slot-edit modes** — "Apply & regenerate after" (forces your edit, regenerates everything later to keep fairness guarantees) or "This game only" (swaps players in just that one game, leaving every other slot untouched)
- **Confirm & Saved Plans** — mark a schedule as the one for the session; overwriting a confirmed schedule prompts first and auto-archives the old version; a rolling ~2-week history of past/saved schedules, each restorable and updatable in place
- **Sharing** — generates a link that loads the schedule instantly; edits push back to that same link only when you hit Save (see [Sharing](#sharing) below)
- **Per-slot player tracker** — each game card shows all available players with ON/OFF streak and cumulative game count
- **Copy to clipboard** — full schedule or matchups-only, formatted for group chats
- **Save as image** — exports the schedule as a high-res PNG via html2canvas
- **Admin PIN** — gates score entry, saving, confirming, and sharing behind an optional PIN

## Algorithm

The scheduler (`src/algorithm/scheduler.ts`) runs a greedy slot-by-slot algorithm, pure and
framework-free, with several phases per time slot.

### Phase 1: Player Selection

1. **Availability filter** — only players whose availability window includes the current slot are considered.
2. **Hard constraints**: `consecutivePlayed >= 2` → must rest this slot; `consecutiveRested >= 2` → must play this slot.
3. **Priority pool** — remaining eligible players are grouped by a normalized play rate (`gamesPlayed / availabilityWindow`), then shuffled within each group so ties don't resolve in a fixed order.
4. **Selection** — fill `courts × 4` spots from the priority pool, must-play players first; must-rest players are only drafted as a last resort to avoid leaving a court empty.
5. **Gender-count fix-up** — if the selected group has an odd number of women, swap one player in/out so courts can be evenly split (never 3F+1M or 1F+3M, which would force an unbalanced matchup).

### Phase 2: Court Grouping

Before pairing, each court is assigned a *gender composition* so the pairing step has a fair
hand to work with:

- **Normal mode** — prefers 2F+2M per court (enables MF vs MF), or groups remaining women onto one court if there are 4+.
- **Women's-doubles mode** — activates when the women's-doubles target (2 per session) hasn't been met yet and there are ≥4 women and ≥2 courts available. Puts 4 women on one court (FF vs FF) and fills the rest from whoever's left.
- The **"Spread F" / "1F+1M per side"** toggle controls a fallback case: with exactly 1 woman per court available, "Spread F" puts her with 3 men (1F+3M, she partners a man); "1F+1M per side" packs 2 women together onto one court instead of spreading them out.

### Phase 3: Group-Repeat Avoidance

If a court's exact 4-person group already played together earlier in the session, the
algorithm tries swapping 2 players (preferred — feels more different), then falls back to
swapping 1, pulling substitutes from anyone sitting that slot. Same-gender swaps are preferred
to avoid re-triggering the gender-count fix-up.

### Phase 4: Team Pairing

For each court's 4 selected players, all 3 possible 2v2 splits are scored and the lowest wins:

```
score = (partnerRepeat × 3)               // heavily penalize repeat partners
      + (opponentRepeat × 1)              // lightly penalize repeat opponents
      + (genderMismatch ? 15 : 0)         // heavily penalize MF vs MM/FF (asymmetric matchups)
      + (abs(skillA − skillB) × 2)        // keep combined team skill close
      + random(0, 1.5)                    // jitter to break ties
```

`skill` per player is their current win rate (`wins / (wins + losses)`, defaulting to 0.5 with
no recorded games yet) — see [Confirm & Saved Plans](#confirm--saved-plans) for where win/loss
records come from. The heavy partner-repeat and gender-mismatch penalties mean you rarely
replay with the same partner or see a lopsided MF-vs-MM game, while jitter still lets ties
resolve differently between re-rolls.

### Stagger Normalization

When players have different availability windows, selection priority uses
`gamesPlayed / totalAvailableSlots` instead of raw game count, so a player here for half the
session gets proportionally half the games, not fewer.

## Editing Without Breaking Fairness

Two distinct ways to fix a single game after generating:

- **Apply & regenerate after** — forces your edit for that one slot, then regenerates every
  later slot from that point using the algorithm above, so the fairness guarantees still hold
  for the rest of the session. Changes everything after the edited slot.
- **This game only** — swaps players within just the edited slot via `recomputeStats()`, a
  pure bookkeeping pass that recalculates the cumulative games-played/streak tracker without
  re-running the selection/pairing algorithm. Every other slot's matchups stay exactly as
  already generated or shared — trades a little fairness drift for not disturbing a schedule
  you've already sent out.

## Confirm & Saved Plans

- **Confirm** marks the current schedule as the one for the session (`isConfirmed` in state).
  Once confirmed, Generate/Re-roll, Clear, Import, and partial regenerate-from-slot all prompt
  ("Overwrite confirmed schedule?") before replacing it, and auto-archive the old version into
  Saved Plans first.
- **Saved Plans** is a rolling ~2-week history (`ARCHIVE_TTL_MS` in `constants.ts`), pruned on
  load. Entries get there either automatically (overwriting a confirmed schedule) or explicitly
  (hitting **Save** with a tag).
- **Save** behavior: typing a tag that matches an existing saved plan updates that entry instead
  of creating a duplicate (tags act as a soft unique key). Loading a saved plan remembers which
  entry it came from (`loadedPlanId`), so a later Save offers **Update** (overwrite that same
  entry) or **Save as a new copy instead**.
- If the current tab is showing a schedule opened from a share link, **Save** also pushes the
  current state back to that share (see below).

## Player Bank

`playerHistory` in state — every player ever added to a roster, persisted locally. The bank UI
lets you multi-select several entries and bulk-add them ("Add Selected"), or add a name+gender
directly to the bank without it affecting today's roster (for people who haven't played yet but
you want remembered).

## Sharing

Sharing went through a few iterations during development; here's the model that landed:

- **Share** button builds a compact payload (`buildSharePayload` — players, slot/court layout as
  index references, applied scores, confirm status) and writes it to a Firebase Realtime
  Database at `/shares/{id}` (`createShare`/`updateShare` in `src/firebase.ts`).
- **Opening a share link** (`?share=<id>` in the URL) does a **one-time read** (`fetchShare`) and
  applies it via `applySharePayload`. It does **not** keep listening for further remote changes —
  there's no continuous live sync. `shareId` and an `isSharedSession` flag are then kept in
  `sessionStorage` (not `localStorage`): this survives a page refresh in the same tab (so
  re-clicking Share reuses the same link, and reloading re-fetches the share's content, since
  that content is deliberately excluded from local persistence — see below), but clears the
  moment the tab/browser closes, so a stale share can never resurface days later and silently
  overwrite an unrelated schedule.
- **Save** is the only thing that ever pushes changes back to a share document. Regenerating,
  editing a slot, entering scores, or confirming while viewing a shared schedule stays purely
  local until you explicitly hit Save — at which point it updates both your local Saved Plans
  entry and the live `/shares/{id}` document, for anyone with that link to see next time they
  open or refresh it.
- **Opening a share also auto-saves it locally**: `applySharePayload` upserts a Saved Plans entry
  tagged by `sourceShareId` (shown as "Shared schedule" when untagged), so each device that opens
  a link gets it findable in its own Saved Plans without needing the link again. Reopening the
  same link updates that same entry instead of creating duplicates, and sets `loadedPlanId` so a
  subsequent Save offers Update against it.
- **Cross-tab safety**: while a tab is showing a schedule from a share (`isSharedSession` true),
  `players`/`result`/`scores`/`isConfirmed` are excluded from the normal `localStorage`
  persistence in `usePlannerState`. This means a tab idling on someone else's shared schedule —
  even left open indefinitely in the background — can never silently overwrite your own
  personal schedule sitting in another tab.
- **Security**: Firebase rules scope access to just `/shares` and `/winLoss` (with basic shape
  validation), denying everything else by default. Firebase **App Check** (reCAPTCHA v3) rejects
  any request that doesn't come from the real deployed page, so a stray script or `curl` call
  against the public `databaseURL` can't read or write the database even though that config is
  visible in the page source (Firebase web config is meant to be public; App Check + rules are
  the actual access control). Note that App Check enforcement also blocks server-side/`curl`
  inspection of the database — even for maintenance — so database housekeeping requires either
  the Firebase Console or a service-account credential, not direct REST calls.
- **Expiry**: each share is stamped with `createdAt` on creation (preserved across `Save`
  updates via a partial `update()`, never a full `set()`). The next time *anyone* opens a share
  older than `SHARE_TTL_MS` (30 days, in `src/firebase.ts`), it's deleted server-side and the
  opener sees an "this link has expired" notice instead. This is a client-triggered backstop,
  not a scheduled job — a share that's never reopened won't get cleaned up on its own, since the
  database rules don't allow listing `/shares` to scan for stale entries (that would require a
  Cloud Function on a paid plan, which this project intentionally avoids).
- A Cloudflare Worker (`workers/share-links/`) and a base64-URL-hash scheme remain as fallbacks
  if Firebase isn't configured (`window.FIREBASE_CONFIG` unset) — neither supports the
  Save-pushes-back behavior, just a one-shot link.

## Configuration

| Setting | Options | Default |
|---|---|---|
| Session length | 60–240 min (slider, step = game length) | 180 min |
| Game length | 8–20 min (slider) | 15 min |
| Courts | 1, 2, 3 | 1 |
| Extra court | Off / on with a configurable start + duration window | Off |
| Availability | All here / Early-Late / Per player | All here |
| Mixed teams | Spread F (1F+3M when only 1 woman per court) / 1F+1M per side | Spread F |

## Constraints Summary

| Constraint | Type | Implementation |
|---|---|---|
| Equal games (±1) | Hard | Greedy selection by fewest games played (normalized by availability) |
| Max 2 consecutive games | Hard | `mustRest` when `consecutivePlayed >= 2` |
| Max 2 consecutive rests | Hard | `mustPlay` when `consecutiveRested >= 2` |
| Even female count per slot | Hard | Selection swap-fix so courts can split without a 3F+1M/1F+3M court |
| No repeated 4-person group | Soft (actively fixed) | Swap 2 then 1 substitutes when a court's group matches `courtGroupHistory` |
| Vary partners | Soft | `partnerRepeat × 3` penalty in pairing score |
| Vary opponents | Soft | `opponentRepeat × 1` penalty in pairing score |
| Symmetric gender matchups | Soft | `+15` penalty when the two teams' gender types differ (MF vs MM/FF) |
| Skill-balanced teams | Soft | `abs(skillA − skillB) × 2` penalty, skill = current win rate |
| Women's doubles ≥2/session | Grouping | Court grouping packs 4F on one court while target unmet and players allow |
| Controlled randomness | Jitter | `random(0, 1.5)` added to every pairing score |

## Tech Stack

- **React 18 + TypeScript**, built with **Vite** (`npm run dev` / `build` / `preview`)
- **Vitest** for the algorithm test suite (`src/algorithm/scheduler.test.ts`); **Playwright**
  available for real-browser smoke testing during development (not part of CI)
- **Firebase Realtime Database** — sharing (`/shares`) and cross-device win/loss sync (`/winLoss`)
- **Firebase App Check** (reCAPTCHA v3) — rejects non-app requests to the database
- **GitHub Pages**, deployed via **GitHub Actions** (`.github/workflows/deploy.yml`) — builds and
  publishes `dist/` automatically on every push to `main`; no manual deploy step
- **html2canvas** (loaded dynamically) for the save-as-image export

## File Structure

```
├── CLAUDE.md                       # This file
├── README.md                       # Shorter public-facing overview
├── index.html                      # Vite entry point (injects FIREBASE_CONFIG, ADMIN_PIN, etc.)
├── vite.config.ts
├── src/
│   ├── main.tsx                    # ReactDOM root
│   ├── BadmintonPlanner.tsx        # Main component — state wiring, handlers, layout
│   ├── types.ts                    # PlannerState / PlannerPersistedState / SharePayload etc.
│   ├── constants.ts                # DEFAULT_PLAYERS, color tokens, ARCHIVE_TTL_MS, icons
│   ├── firebase.ts                 # Firebase app/App Check/Database wrapper
│   ├── hooks/
│   │   └── usePlannerState.ts      # useReducer store + localStorage/sessionStorage persistence
│   ├── algorithm/
│   │   ├── scheduler.ts            # Pure scheduling algorithm (no React)
│   │   ├── types.ts                # Player / Court / SlotResult / ScheduleState etc.
│   │   └── scheduler.test.ts       # Vitest suite
│   └── components/
│       ├── PlayerList.tsx          # Roster input + Player Bank
│       ├── ScheduleGrid.tsx        # Per-player game-count stats + slot list
│       ├── SlotCard.tsx            # One slot's courts, edit modes, score entry
│       ├── PlannerModals.tsx       # PIN/Save/Share/Import/Confirm-overwrite modals, Saved Plans tab
│       └── AboutTab.tsx            # In-app "How It Works" tab
├── workers/share-links/            # Legacy Cloudflare Worker fallback for sharing
└── badminton-planner.jsx           # Original single-file Claude-Artifact version (historical, unused)
```

## Usage

```bash
npm install
npm run dev       # local dev server
npm run build     # production build to dist/
npm run preview   # serve the production build locally
npm test          # run the algorithm test suite
```

Deployment is automatic: push to `main` and GitHub Actions builds and publishes to GitHub Pages.

### Configuration knobs

- **`DEFAULT_PLAYERS`** in `src/constants.ts` — your group's starter roster.
- **`window.ADMIN_PIN`**, **`window.FIREBASE_CONFIG`**, **`window.RECAPTCHA_SITE_KEY`**,
  **`window.SHARE_API_BASE`** — set in `index.html`'s inline `<script>`. `FIREBASE_CONFIG: null`
  disables sharing and win/loss cloud sync entirely (the app still works fully locally).
- **`ARCHIVE_TTL_MS`** in `src/constants.ts` — how long Saved Plans entries stick around.

### Legacy: single-file Claude Artifact version

`badminton-planner.jsx` at the repo root is the original single-file version this project
started from, before the Vite/TypeScript rewrite. It still works standalone (paste into a
Claude Artifact, or `cp` into any React project), but is no longer maintained in lockstep with
the deployed app — treat it as a historical snapshot, not the source of truth.

## Design Decisions

**Why greedy instead of constraint programming?** The problem is small enough (≤12 players,
≤15 slots) that a well-tuned greedy algorithm with randomization produces good results in
milliseconds. A CP solver would guarantee optimality but adds complexity and a dependency for
marginal gain at this scale.

**Why shuffle within tied groups instead of pure random?** Pure random violates the
equal-games constraint. Pure deterministic creates repetitive schedules. Shuffling within
game-count tiers gives variety while preserving the fairness invariant.

**Why a heavy penalty for asymmetric gender matchups instead of just preferring mixed teams?**
Early versions softly preferred mixed (MF) teams, but that still let lopsided games through
(MF vs MM). Penalizing *mismatched* team types instead — regardless of which type — keeps every
game internally consistent (MM vs MM, FF vs FF, or MF vs MF) without forcing mixed teams when
the gender split in a session doesn't suit it.

**Why "This game only" in addition to "Apply & regenerate"?** Once a schedule's been shared or
sent to a group chat, regenerating everything after a small fix (e.g. someone's running late)
reshuffles games other people already saw and planned around. Recomputing just the tracker
stats for a single-slot swap avoids that, at the cost of a small, accepted fairness drift for
that one game.

**Why read-once + Save-to-push for sharing instead of continuous live sync?** An earlier
iteration kept share links continuously subscribed and auto-pushed every local change. That
caused two real problems: a stale `shareId` persisted across visits could silently reconnect and
overwrite a device's current schedule, and a backgrounded live tab could clobber a separate
tab's personal copy via shared `localStorage`. The simpler model — read once on open, write only
on an explicit Save — removes the silent-overwrite surface entirely while still letting anyone
with the link view and (with the PIN) edit and publish changes back.

**Why `sessionStorage` for `shareId` instead of `localStorage` or pure in-memory state?**
Pure in-memory meant every page refresh created a brand-new link when you clicked Share, which
was confusing for normal use (e.g. tweaking and reusing the same link within a session).
`localStorage` was tried first and caused the silent-overwrite bug above. `sessionStorage`
is the middle ground: stable across a refresh in the same tab, but gone the moment the tab or
browser closes, so it can't resurface days later.

## Development History

This project was built iteratively through conversation. Two eras:

**Era 1 — single-file Claude Artifact / CDN React (`badminton-planner.jsx`, then `index.html`):**

1. Basic 2v2 scheduler with equal game counts and consecutive play/rest limits
2. Partner and opponent variety tracking with weighted scoring
3. Gender-aware features (mixed-team preference, women inclusion), later relaxed to a soft
   preference to prevent women burnout
4. Controlled randomness (shuffle within tied groups, pairing jitter); reduced mixed-gender
   penalty to let MM vs MM games appear
5. 15-minute default games, two-column layout, per-slot player status tracker
6. Copy-to-clipboard and save-as-image (html2canvas)
7. Multi-court (1–3) and staggered availability (group-based or per-player slot ranges)
8. Mutable share links via a Cloudflare Worker + KV store (short URLs, no account)

**Era 2 — Vite/TypeScript rewrite, current architecture:**

9. Full port to React + TypeScript + Vite; GitHub Actions auto-deploy to GitHub Pages replacing
   the CDN/Babel single-file app
10. Skill-balanced pairing (win-rate based), symmetric-gender-matchup penalty, women's-doubles
    targeting, and group-repeat avoidance added to the algorithm
11. Player Bank (auto-tracked + manual, multi-select bulk add)
12. Confirm + Saved Plans, with auto-archive on overwrite and tag-based update/dedupe
13. Two slot-edit modes — "Apply & regenerate after" vs. "This game only" (`recomputeStats`)
14. Settings changes stopped auto-clearing the generated schedule
15. Firebase Realtime Database sharing with live subscribe/auto-push, then simplified to
    one-time read + Save-to-push after discovering the live model caused silent schedule
    overwrites across stale links and background tabs
16. Firebase App Check (reCAPTCHA v3) + scoped database rules for security hardening
17. `sessionStorage`-based share-link stability across page reloads
18. In-app "How It Works" tab documenting all of the above
