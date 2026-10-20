// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SessionStatusPanel, { SessionSummary } from './SessionStatusPanel';
import type { Player, SlotResult } from '../algorithm/types';
import type { StaggerMode } from '../types';

// fromSlot=3 -> nextSlotIdx = 2
const PLAYERS: Player[] = [
  { name: 'Here', gender: 'M', availFrom: 0, availTo: 11, leavesAt: null },
  { name: 'Leaving', gender: 'M', availFrom: 0, availTo: 11, leavesAt: 5 },
  { name: 'Departed', gender: 'F', availFrom: 0, availTo: 11, leavesAt: 1 },
  { name: 'NotYet', gender: 'F', availFrom: 5, availTo: 11, leavesAt: null },
];

function renderPanel(overrides = {}) {
  const handlers = { setPlayerBack: vi.fn(), setPlayerJoining: vi.fn(), setPlayerLeaving: vi.fn(), togglePlayerSuspended: vi.fn() };
  render(
    <SessionStatusPanel players={PLAYERS} fromSlot={3} totalSlots={12} staggerMode="custom" {...handlers} {...overrides} />
  );
  return handlers;
}

function rowFor(name: string) {
  return screen.getByRole('group', { name: `Availability for ${name}` });
}

const groupPlayers: Player[] = [
  { name: 'Early', gender: 'M', group: 'early', availFrom: 0, availTo: 9 },
  { name: 'Late', gender: 'F', group: 'late', availFrom: 0, availTo: 9 },
];
const customPlayers: Player[] = [{ name: 'Window', gender: 'F', availFrom: 2, availTo: 4 }];

describe('SessionStatusPanel', () => {
  it('shows the round header derived from fromSlot/totalSlots', () => {
    renderPanel();
    expect(screen.getByText('Session Status · next: 3 · 2 done')).toBeInTheDocument();
  });

  it('shows live game count in the round header', () => {
    renderPanel({ liveGames: [{ slot: 2, court: 0 }] });
    expect(screen.getByText('Session Status · next: 3 · 1 live')).toBeInTheDocument();
  });

  it('shows a completed status after the final slot is done', () => {
    renderPanel({ fromSlot: 13, totalSlots: 12 });
    expect(screen.getByText('Session Status · complete · 12 done')).toBeInTheDocument();
  });

  it('names Leaving explicitly and disables availability actions when no future slot remains', () => {
    const handlers = renderPanel({ fromSlot: 13, liveGames: [{ slot: 12, court: 0 }] });
    expect(within(rowFor('Here')).getByRole('button', { name: 'Leaving' })).toBeDisabled();
    expect(screen.getByText(/no upcoming slot/i)).toBeInTheDocument();
    expect(handlers.setPlayerLeaving).not.toHaveBeenCalled();
  });

  it('a currently-available player shows skip-next and leaving controls', async () => {
    renderPanel();
    const row = rowFor('Here');
    expect(within(row).getByTitle('Player is done for today')).toBeInTheDocument();
    expect(within(row).getByTitle('Skip this player for the next generated game only')).toBeInTheDocument();
    expect(within(row).queryByTitle('Restore player to session')).not.toBeInTheDocument();
    expect(within(row).queryByTitle(/here — add to upcoming round/)).not.toBeInTheDocument();
  });

  it('a player scheduled to leave later shows only the restore control', () => {
    renderPanel();
    const row = rowFor('Leaving');
    expect(within(row).getByTitle('Restore player to session')).toBeInTheDocument();
    expect(within(row).queryByTitle('Player is done for today')).not.toBeInTheDocument();
  });

  it('an already-departed player shows only the restore control', () => {
    renderPanel();
    const row = rowFor('Departed');
    expect(within(row).getByTitle('Restore player to session')).toBeInTheDocument();
    expect(within(row).queryByTitle('Player is done for today')).not.toBeInTheDocument();
  });

  it('a not-yet-arrived player (custom mode) shows only the "here now" control', () => {
    renderPanel();
    const row = rowFor('NotYet');
    expect(within(row).getByTitle(/here — add to upcoming round/)).toBeInTheDocument();
    expect(within(row).queryByTitle('Restore player to session')).not.toBeInTheDocument();
    expect(within(row).queryByTitle('Player is done for today')).not.toBeInTheDocument();
  });

  it('does not flag anyone as not-arrived outside custom stagger mode', () => {
    renderPanel({ staggerMode: 'none' });
    const row = rowFor('NotYet');
    expect(within(row).queryByTitle(/here — add to upcoming round/)).not.toBeInTheDocument();
  });

  it('wires each control to the right handler with the right player index', async () => {
    const user = userEvent.setup();
    const handlers = renderPanel();

    await user.click(within(rowFor('Here')).getByTitle('Skip this player for the next generated game only'));
    expect(handlers.togglePlayerSuspended).toHaveBeenCalledWith(0);

    await user.click(within(rowFor('Here')).getByTitle('Player is done for today'));
    expect(handlers.setPlayerLeaving).toHaveBeenCalledWith(0);

    await user.click(within(rowFor('Departed')).getByTitle('Restore player to session'));
    expect(handlers.setPlayerBack).toHaveBeenCalledWith(2);

    await user.click(within(rowFor('NotYet')).getByTitle(/here — add to upcoming round/));
    expect(handlers.setPlayerJoining).toHaveBeenCalledWith(3);
  });

  it('shows an undo state for a player already skipping next', async () => {
    const user = userEvent.setup();
    const handlers = renderPanel({ suspendedPlayerNames: ['Here'] });
    const row = rowFor('Here');
    expect(within(row).getByText('Skipping next')).toBeInTheDocument();
    await user.click(within(row).getByTitle('Undo skip-next for this player'));
    expect(handlers.togglePlayerSuspended).toHaveBeenCalledWith(0);
  });

  it('labels player availability directly', () => {
    renderPanel();
    expect(rowFor('Here')).toHaveTextContent('Available');
    expect(rowFor('Leaving')).toHaveTextContent('Leaving after slot 6');
    expect(rowFor('Departed')).toHaveTextContent('Left');
    expect(rowFor('NotYet')).toHaveTextContent('Arrives slot 6');
  });

  it.each<{
    mode: StaggerMode; fromSlot: number; players: Player[]; available: number; labels: Record<string, string>;
  }>([
    { mode: 'group', fromSlot: 1, players: groupPlayers, available: 1, labels: { Early: 'Available', Late: 'Arrives slot 4' } },
    { mode: 'group', fromSlot: 4, players: groupPlayers, available: 2, labels: { Early: 'Available', Late: 'Available' } },
    { mode: 'group', fromSlot: 7, players: groupPlayers, available: 2, labels: { Early: 'Available', Late: 'Available' } },
    { mode: 'group', fromSlot: 8, players: groupPlayers, available: 1, labels: { Early: 'Left', Late: 'Available' } },
    { mode: 'custom', fromSlot: 2, players: customPlayers, available: 0, labels: { Window: 'Arrives slot 3' } },
    { mode: 'custom', fromSlot: 3, players: customPlayers, available: 1, labels: { Window: 'Available' } },
    { mode: 'custom', fromSlot: 5, players: customPlayers, available: 1, labels: { Window: 'Available' } },
    { mode: 'custom', fromSlot: 6, players: customPlayers, available: 0, labels: { Window: 'Left' } },
    { mode: 'custom', fromSlot: 3, players: [{ ...customPlayers[0]!, leavesAt: 2 }], available: 1, labels: { Window: 'Leaving after slot 3' } },
    { mode: 'custom', fromSlot: 4, players: [{ ...customPlayers[0]!, leavesAt: 2 }], available: 0, labels: { Window: 'Left' } },
  ])('matches resolved $mode windows at slot $fromSlot in labels, counts and summary', fixture => {
    const result = { schedule: Array.from({ length: 10 }, (_, i): SlotResult => ({ slot: i + 1, courts: [], sitting: [], playerState: [], repeatedCourts: [] })), gamesPlayed: [] };
    renderPanel({ players: fixture.players, fromSlot: fixture.fromSlot, totalSlots: 10, staggerMode: fixture.mode });
    render(<SessionSummary players={fixture.players} result={result} fromSlot={fixture.fromSlot} staggerMode={fixture.mode} liveGames={[]} completedGames={[]} />);
    for (const [name, label] of Object.entries(fixture.labels)) expect(within(rowFor(name)).getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`Available: ${fixture.available} · Unavailable: ${fixture.players.length - fixture.available}`);
    expect(screen.getByRole('region', { name: 'Session summary' })).toHaveTextContent(`Waiting players${fixture.available}`);
  });

  it('does not add a custom-only Here now action for a late group player', () => {
    renderPanel({ players: groupPlayers, fromSlot: 1, totalSlots: 10, staggerMode: 'group' });
    expect(within(rowFor('Late')).queryByRole('button', { name: 'Here now' })).not.toBeInTheDocument();
  });
});
