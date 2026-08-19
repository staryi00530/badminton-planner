// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SlotCard from './SlotCard';

function makeSlot(courtCount, overrides = {}) {
  const courts = Array.from({ length: courtCount }, (_, ci) => ({
    court: ci + 1,
    teamA: [{ name: `A${ci}1`, gender: 'M' }, { name: `A${ci}2`, gender: 'M' }],
    teamB: [{ name: `B${ci}1`, gender: 'M' }, { name: `B${ci}2`, gender: 'M' }],
  }));
  return {
    slot: 1,
    courts,
    sitting: [],
    repeatedCourts: [],
    playerState: [],
    ...overrides,
  };
}

function renderSlotCard(slot, overrides = {}) {
  const handlers = {
    startSlotEdit: vi.fn(),
    applySlotEdit: vi.fn(),
    applySlotEditOnly: vi.fn(),
    cancelSlotEdit: vi.fn(),
    assignToPosition: vi.fn(),
    updateScore: vi.fn(),
    onToggleLive: vi.fn(),
    onAdjustCourts: vi.fn(),
  };
  render(
    <SlotCard
      slot={slot}
      scores={{}}
      editing={false}
      editLayout={null}
      isAdmin={true}
      slotTime={n => `t${n}`}
      liveGames={[]}
      completedGames={[]}
      blockedPlayerNames={undefined}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

describe('SlotCard — per-slot court stepper', () => {
  it('shows the current court count', () => {
    renderSlotCard(makeSlot(2));
    expect(screen.getByText('2C')).toBeInTheDocument();
  });

  it('clicking + calls onAdjustCourts(slotNum, +1)', async () => {
    const user = userEvent.setup();
    const slot = makeSlot(2);
    const handlers = renderSlotCard(slot);
    await user.click(screen.getByTitle(/Add a court/));
    expect(handlers.onAdjustCourts).toHaveBeenCalledWith(1, 1);
  });

  it('clicking − calls onAdjustCourts(slotNum, -1)', async () => {
    const user = userEvent.setup();
    const slot = makeSlot(2);
    const handlers = renderSlotCard(slot);
    await user.click(screen.getByTitle(/Remove a court/));
    expect(handlers.onAdjustCourts).toHaveBeenCalledWith(1, -1);
  });

  it('disables + at 4 courts (the app max)', () => {
    renderSlotCard(makeSlot(4));
    expect(screen.getByTitle(/Add a court/)).toBeDisabled();
  });

  it('disables − at 1 court (never auto-drops to "auto" via the stepper)', () => {
    renderSlotCard(makeSlot(1));
    expect(screen.getByTitle(/Remove a court/)).toBeDisabled();
  });

  it('does not render the stepper while editing', () => {
    renderSlotCard(makeSlot(2), { editing: true, editLayout: { courts: [['A01', 'A02', 'B01', 'B02'], ['A11', 'A12', 'B11', 'B12']], sitting: [] } });
    expect(screen.queryByText('2C')).not.toBeInTheDocument();
  });

  it('does not render the stepper when onAdjustCourts is not provided', () => {
    renderSlotCard(makeSlot(2), { onAdjustCourts: undefined });
    expect(screen.queryByText('2C')).not.toBeInTheDocument();
  });
});

describe('SlotCard — Live/Done toggle', () => {
  it('clicking Start on a court calls onToggleLive(slotNum, courtIndex)', async () => {
    const user = userEvent.setup();
    const slot = makeSlot(2);
    const handlers = renderSlotCard(slot);
    const startButtons = screen.getAllByText('Start');
    await user.click(startButtons[1]); // second court, index 1
    expect(handlers.onToggleLive).toHaveBeenCalledWith(1, 1);
  });

  it('shows "✓ Done" and a LIVE badge for a court already marked live', () => {
    const slot = makeSlot(2);
    renderSlotCard(slot, { liveGames: [{ slot: 1, court: 0 }] });
    expect(screen.getByText('✓ Done')).toBeInTheDocument();
    expect(screen.getByText('● LIVE')).toBeInTheDocument();
    // The other court is untouched.
    expect(screen.getByText('Start')).toBeInTheDocument();
  });

  it('shows a done badge for a completed court without marking the whole slot live', () => {
    const slot = makeSlot(2);
    renderSlotCard(slot, { completedGames: [{ slot: 1, court: 0 }] });
    expect(screen.getByText('✓ DONE')).toBeInTheDocument();
    expect(screen.queryByText('● LIVE')).not.toBeInTheDocument();
    expect(screen.getByText('Restart')).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();
  });

  it('shows and disables Waiting when a court has a blocked player', () => {
    const slot = makeSlot(1);
    renderSlotCard(slot, { blockedPlayerNames: new Set(['A01']), canShowReady: true });
    expect(screen.getByText('⏳ WAITING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waiting' })).toBeDisabled();
    expect(screen.getByText(/A01/)).toHaveTextContent('A01 ⏳');
  });
});

describe('SlotCard — Ready indicator', () => {
  it('shows "✓ Ready" for a court whose players are all free while something else is blocked', () => {
    const slot = makeSlot(2);
    // Court 1 (A1x/B1x) is fully free; someone unrelated ("Other") is the one blocked.
    renderSlotCard(slot, { blockedPlayerNames: new Set(['Other']), canShowReady: true });
    expect(screen.getAllByText('✓ Ready')).toHaveLength(2);
  });

  it('does not show "✓ Ready" when a player on that court is blocked', () => {
    const slot = makeSlot(1);
    renderSlotCard(slot, { blockedPlayerNames: new Set(['A01']), canShowReady: true });
    expect(screen.queryByText('✓ Ready')).not.toBeInTheDocument();
  });

  it('does not show "✓ Ready" when nothing is blocked at all (empty set)', () => {
    const slot = makeSlot(1);
    renderSlotCard(slot, { blockedPlayerNames: new Set(), canShowReady: true });
    expect(screen.queryByText('✓ Ready')).not.toBeInTheDocument();
  });

  it('does not show "✓ Ready" when blockedPlayerNames is not provided (slot outside the fromSlot/fromSlot+1 window)', () => {
    const slot = makeSlot(1);
    renderSlotCard(slot, { blockedPlayerNames: undefined, canShowReady: true });
    expect(screen.queryByText('✓ Ready')).not.toBeInTheDocument();
  });

  it('does not show "✓ Ready" on a court that is itself already live', () => {
    const slot = makeSlot(1);
    renderSlotCard(slot, { blockedPlayerNames: new Set(['Other']), liveGames: [{ slot: 1, court: 0 }], canShowReady: true });
    expect(screen.queryByText('✓ Ready')).not.toBeInTheDocument();
  });

  it('does not show "✓ Ready" on fromSlot itself, even if all players are free (avoids flagging an already-finished court)', () => {
    const slot = makeSlot(1);
    renderSlotCard(slot, { blockedPlayerNames: new Set(['Other']), canShowReady: false });
    expect(screen.queryByText('✓ Ready')).not.toBeInTheDocument();
  });
});

describe('SlotCard — empty slot', () => {
  it('shows "Not enough players" when there are no courts', () => {
    renderSlotCard(makeSlot(0));
    expect(screen.getByText('Not enough players')).toBeInTheDocument();
  });
});
