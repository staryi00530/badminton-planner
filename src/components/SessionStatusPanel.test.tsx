// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SessionStatusPanel from './SessionStatusPanel';

// fromSlot=3 -> nextSlotIdx = 2
const PLAYERS = [
  { name: 'Here', gender: 'M', availFrom: 0, leavesAt: null },        // currently playing, no plans to leave
  { name: 'Leaving', gender: 'M', availFrom: 0, leavesAt: 5 },        // scheduled to leave later (5 >= nextSlotIdx)
  { name: 'Departed', gender: 'F', availFrom: 0, leavesAt: 1 },       // already left (1 < nextSlotIdx)
  { name: 'NotYet', gender: 'F', availFrom: 5, leavesAt: null },      // hasn't arrived yet (5 > nextSlotIdx, custom mode)
];

function renderPanel(overrides = {}) {
  const handlers = { setPlayerBack: vi.fn(), setPlayerJoining: vi.fn(), setPlayerLeaving: vi.fn(), togglePlayerSuspended: vi.fn() };
  render(
    <SessionStatusPanel players={PLAYERS} fromSlot={3} totalSlots={12} staggerMode="custom" {...handlers} {...overrides} />
  );
  return handlers;
}

function rowFor(name: string) {
  return screen.getByText(name).closest('div');
}

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
});
