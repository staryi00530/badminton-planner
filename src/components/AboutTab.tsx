import type { ReactNode } from 'react';
import { C } from '../constants';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 16, boxShadow: C.shadow }}>
      <h3 style={{ fontSize: 12, color: C.textDim, textTransform: 'uppercase', fontWeight: 700, margin: '0 0 12px' }}>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, minWidth: 112, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

export default function AboutTab() {
  return (
    <div>
      <Section title="Keep Games Moving">
        <Row label="Start">Generate or Re-roll creates the schedule and starts the first games. The Live session view shows each court's current game and the games waiting next. Setup remains available from the top navigation.</Row>
        <Row label="Finish game">Any player can mark a court's game finished with Finish game. The completed lineup moves to Past games and the queue fills the open court when a playable game is available.</Row>
        <Row label="Blocked queue">If the first queued game includes someone still playing or unavailable, choose to substitute unavailable players into that game or promote the next playable queued game. The app checks only one game ahead, so it will not silently cascade through the queue.</Row>
        <Row label="Availability & courts">Use Here now or Leaving when attendance changes. Add court or Remove court adjusts upcoming capacity. Current and completed games stay as they are; the page identifies where the updated schedule begins.</Row>
        <Row label="Skip next">Suspend a player to leave them out of the next generated game without changing the game already in progress.</Row>
        <Row label="Undo">Undo last action restores the previous session state after an accidental finish, substitution, or session update.</Row>
        <Row label="Past games">Past games records completed lineups and scores. Player stats summarize games played, rotation rests, live games, and recorded wins and losses.</Row>
      </Section>

      <Section title="How Matchups Are Made">
        <p style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, margin: '0 0 12px' }}>
          The scheduler builds the session slot by slot. It uses player availability and rotation history to balance playing time, then groups and pairs players using the session settings and recorded results.
        </p>
        <Row label="Fair rotation">The scheduler tries to spread games and rests evenly and avoid long runs of consecutive games or rests. The roster and court capacity can limit what is possible.</Row>
        <Row label="Pairings">Preferred pairings are favored. The scheduler also tries to vary partners and opponents and balance team strength and gender composition.</Row>
        <Row label="Skill balance">Matchups use recorded results and any private skill settings available to the session organizer.</Row>
        <Row label="Women's doubles">When roster and court availability allow, the schedule aims to include women's doubles games.</Row>
        <p style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5, margin: 0 }}>
          These are scheduling goals, not guarantees. Limited players, attendance changes, and court capacity can require tradeoffs; repeats or level gaps can still happen.
        </p>
      </Section>

      <Section title="Setup & Editing">
        <Row label="Settings">Court count, game and session length, availability mode, and team preferences are set in Setup. Generate or Re-roll applies those settings to the schedule.</Row>
        <Row label="Apply & regenerate">Applies your edited lineup, then refreshes upcoming games from the next safe slot. Current games and completed history stay unchanged.</Row>
        <Row label="This game only">Changes only the selected game's lineup. Other games, scores, and the rest of the schedule are left alone.</Row>
        <Row label="Confirm">Confirm a schedule to mark it as the session plan. Destructive schedule changes ask for confirmation and preserve the prior plan in Saved plans.</Row>
        <Row label="Player Bank">Players you add are remembered for later sessions. Select several bank entries to add them to the current roster together.</Row>
      </Section>

      <Section title="Saved Plans & Sharing">
        <Row label="Saved plans">Saved plans keeps tagged schedules and confirmed versions that were replaced. Load a plan to use it again; save updates the loaded entry or creates a separate copy.</Row>
        <Row label="Share">Share creates a link to a schedule snapshot. Opening a shared link loads its latest saved snapshot; it does not stream changes live.</Row>
        <Row label="Save changes">Changes made after opening a shared schedule stay local until saved back to that link. Anyone opening or refreshing the link afterward sees the saved version.</Row>
      </Section>

      <Section title="About the App">
        <Row label="Storage">Personal schedules are saved in this browser. A shared schedule is kept separate from the browser's personal schedule.</Row>
        <Row label="Hosting">The app is published on GitHub Pages. Main is at /badminton-planner/ and beta is at /badminton-planner/beta/.</Row>
        <Row label="Live sync">Shared schedules are snapshots, not a live multi-device session. Win-loss records may sync through Firebase when configured.</Row>
        <Row label="Admin access">Some organizer actions are protected by the session's admin access settings.</Row>
      </Section>
    </div>
  );
}
