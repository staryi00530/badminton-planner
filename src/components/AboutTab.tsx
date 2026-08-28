// @ts-nocheck
import { C, FONT } from '../constants';

function Section({ title, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: C.shadow }}>
      <h3 style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, margin: '0 0 12px' }}>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

export default function AboutTab() {
  return (
    <div>
      <Section title="How scheduling works">
        <p style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, marginBottom: 14 }}>
          The scheduler runs a greedy, slot-by-slot algorithm with several phases per time slot — no AI, no
          solver, just rules and scoring run fresh each time you hit Generate.
        </p>

        <Row label="1. Selection">
          Eligible players (within their availability window) are filtered by hard rest rules — anyone who's
          played 2 games in a row must sit, anyone who's sat 2 in a row must play. The rest are grouped by how
          often they've played relative to how long they've been available, shuffled within each group, and the
          neediest players fill the open court spots first. If the resulting group has an odd number of women,
          one player gets swapped so courts can still be split evenly.
        </Row>

        <Row label="2. Court grouping">
          Before pairing, each court gets a gender composition: normally 2F+2M per court (so MF vs MF is
          possible). If the session hasn't had at least 2 all-female (FF vs FF) games yet and there are enough
          women and courts, one court gets grouped as all-female instead. The "Spread F / 1F+1M per side" toggle
          decides what happens with exactly one woman per court: spread her in with 3 men, or pack two women
          together onto one court.
        </Row>

        <Row label="3. Group-repeat fix">
          If a court's exact 4-person group already played together earlier this session, the scheduler swaps
          2 players (or falls back to 1) from whoever's sitting that slot, so you don't replay the identical
          foursome twice.
        </Row>

        <Row label="4. Pairing">
          For each court's 4 players, all 3 possible 2v2 splits are scored and the lowest-scoring split wins:
        </Row>
        <pre style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 12px', fontSize: 11, color: C.textDim, overflowX: 'auto', marginBottom: 10, fontFamily: 'monospace' }}>
{`score = (partnerRepeat × 3)        // avoid repeat partners
      + (opponentRepeat × 1)       // lightly avoid repeat opponents
      + (genderMismatch ? 15 : 0)  // keep MM/FF/MF matchups symmetric
      + (skillGap × 2)             // keep combined team skill close
      + random(0, 1.5)             // jitter to break ties`}
        </pre>
        <p style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6 }}>
          Skill is each player's current win rate (defaults to 50% with no recorded games). The heavy
          partner-repeat and gender-mismatch penalties mean you rarely replay the same partner or see a lopsided
          MF-vs-MM game, while jitter still lets ties resolve differently between re-rolls.
        </p>
      </Section>

      <Section title="Constraints">
        <Row label="Equal games">Hard — everyone's game count stays within 1 of each other.</Row>
        <Row label="No burnout">Hard — max 2 consecutive games, max 2 consecutive rests.</Row>
        <Row label="Even F count">Hard — selection adjusts so courts never need an unbalanced 3F+1M/1F+3M split.</Row>
        <Row label="No repeat groups">Actively fixed — swaps players rather than replaying the same foursome twice.</Row>
        <Row label="Vary partners">Soft — heavily penalized in pairing score, rarely repeats.</Row>
        <Row label="Vary opponents">Soft — lightly penalized, repeats sometimes.</Row>
        <Row label="Symmetric matchups">Soft — heavily penalized when team types differ (MF vs MM/FF).</Row>
        <Row label="Skill balance">Soft — penalizes a big combined-skill gap between the two teams on a court.</Row>
        <Row label="Women's doubles">Grouping — aims for at least 2 FF-vs-FF games per session when players allow.</Row>
        <Row label="Staggered arrival">Availability windows are normalized so a player here for half the
          session gets proportionally half the games, not fewer.</Row>
      </Section>

      <Section title="Settings & editing">
        <Row label="Settings">Changing courts, game/session length, mixed-teams, extra court, or
          availability mode never touches the schedule already on screen — only hitting Generate/Re-roll
          applies the new settings.</Row>
        <Row label="Apply & regen">Forces your edit for one slot, then regenerates every later slot so the
          fairness constraints above still hold for the rest of the session.</Row>
        <Row label="This game only">Swaps players in just the one game you're editing — every other slot
          stays exactly as already generated or shared. The games-played tracker is recalculated to stay
          accurate, but no one else's matchups change. Trades a little fairness drift for not disturbing a
          schedule you've already sent out.</Row>
      </Section>

      <Section title="Player Bank">
        <Row label="Auto-tracked">Anyone you've ever added to a roster is remembered here automatically, so
          you don't retype regulars every session.</Row>
        <Row label="Multi-select">Click bank entries to select several, then "Add Selected" to bulk-add them
          to today's roster in one go.</Row>
        <Row label="Manual add">You can also add someone to the bank directly — without putting them in
          today's session — for people who haven't played yet but you want remembered.</Row>
      </Section>

      <Section title="Confirm & Saved Plans">
        <Row label="Confirm">Marks the current schedule as the one for the session. Once confirmed,
          regenerating, clearing, importing, or partial-regenerating prompts you first and archives the old
          version automatically.</Row>
        <Row label="Saved Plans">A rolling ~2-week history of past schedules — both auto-archived overwrites
          and anything you explicitly Save with a tag. Saving with a tag that already exists updates that
          entry instead of creating a duplicate.</Row>
        <Row label="Update vs new">Loading a saved plan remembers where it came from, so a later Save offers
          "Update" (overwrite that same entry) or "Save as a new copy instead."</Row>
      </Section>

      <Section title="Sharing">
        <Row label="Share">Generates a link that auto-loads the schedule the moment someone opens it — no
          confirmation click needed.</Row>
        <Row label="Opening it">Loads a one-time snapshot of the schedule as of whenever it was last saved to
          that link. It does not keep listening for further changes in the background — no continuous live
          sync.</Row>
        <Row label="Pushing changes">Editing (scores, regenerating, confirming) after opening a shared link
          stays local until you hit Save — that's the one action that pushes your current state back to the
          same link, for anyone who opens or refreshes it afterward to see.</Row>
        <Row label="Reusing the link">Refreshing the page in the same tab keeps you connected to the same
          link — clicking Share again reuses it instead of creating a new one, and the page re-loads that
          link's content on refresh.</Row>
        <Row label="Saved automatically">Opening a share link also adds it to that device's own Saved Plans
          (as "Shared schedule"), so you can find it again later without needing the link. Reopening the same
          link updates that same entry rather than piling up duplicates.</Row>
        <Row label="Expiry">Links older than 30 days get cleaned up the next time anyone opens them, so
          forgotten links don't pile up forever.</Row>
        <Row label="Edit access">Viewing a shared link never requires anything. Actually editing it still
          needs the admin PIN, same as editing locally.</Row>
      </Section>

      <Section title="Architecture">
        <Row label="Frontend">React + TypeScript, built with Vite. Local schedules persist to
          localStorage; a tab showing a schedule opened from a share link keeps that content in memory/
          sessionStorage only, so it can never overwrite your own local copy — even from another tab left
          open in the background.</Row>
        <Row label="Hosting">Deployed to GitHub Pages. A GitHub Actions workflow builds and publishes the
          site automatically on every push to main.</Row>
        <Row label="Sharing backend">A Firebase Realtime Database backs the share-link feature — opening a
          share link fetches it once, and hitting Save pushes your current state back to that same
          document.</Row>
        <Row label="Security">Database rules restrict access to only the paths the app actually uses
          (shares and win/loss records), and Firebase App Check (reCAPTCHA v3) rejects any request that
          doesn't come from the real deployed page — so a stray script or curl call can't read or write the
          database even though the project's public config is visible in the page source.</Row>
        <Row label="Admin lock">An optional PIN gates score entry, saving, confirming, and sharing, stored
          in session storage once unlocked.</Row>
      </Section>
    </div>
  );
}
