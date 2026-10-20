// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ScheduleGrid from './ScheduleGrid';
import LiveSessionBoard from './LiveSessionBoard';

function makeSlot(slotNum: number) {
  return {
    slot: slotNum,
    courts: [0, 1].map(ci => ({
      court: ci + 1,
      teamA: [{ name: `A${slotNum}${ci}1`, gender: 'M' }, { name: `A${slotNum}${ci}2`, gender: 'M' }],
      teamB: [{ name: `B${slotNum}${ci}1`, gender: 'M' }, { name: `B${slotNum}${ci}2`, gender: 'M' }],
    })),
    sitting: [],
    repeatedCourts: [],
    playerState: [],
  };
}

function renderGrid(overrides = {}, Component = LiveSessionBoard) {
  const players = [{ name: 'A11', gender: 'M' }, { name: 'A12', gender: 'M' }];
  render(
    <Component
      result={{ schedule: [1, 2, 3, 4].map(makeSlot), gamesPlayed: [1, 1] }}
      players={players}
      scores={{}}
      editingSlot={null}
      editLayout={null}
      isAdmin={true}
      scheduleRef={{ current: null }}
      minGames={1}
      maxGames={1}
      slotTime={slot => `t${slot}`}
      startSlotEdit={vi.fn()}
      applySlotEdit={vi.fn()}
      applySlotEditOnly={vi.fn()}
      cancelSlotEdit={vi.fn()}
      assignToPosition={vi.fn()}
      updateScore={vi.fn()}
      liveGames={[]}
      completedGames={[]}
      onToggleLive={vi.fn()}
      onAdjustCourts={vi.fn()}
      blockedPlayerNames={new Set()}
      fromSlot={2}
      {...overrides}
    />
  );
}

function sectionFor(title: string) {
  return screen.getByRole('heading', { name: title }).closest('section');
}

function expectInSection(title: string, pattern: RegExp) {
  expect(within(sectionFor(title)).getByText(pattern)).toBeInTheDocument();
}

describe('ScheduleGrid integration with live presentation', () => {
  it('shows current, one next game, and folds past/future slots', () => {
    renderGrid({ fromSlot: 2, completedGames: [{ slot: 1, court: 0 }, { slot: 1, court: 1 }] });

    expectInSection('Current game', /SLOT 2 .* COURT 1/);
    expectInSection('Current game', /SLOT 2 .* COURT 2/);
    expectInSection('Next game', /SLOT 3 .* COURT 1/);
    expectInSection('Next game', /SLOT 3 .* COURT 2/);

    const past = screen.getByText('Past games played (2)').closest('details');
    expect(past).not.toHaveAttribute('open');
    expect(within(past).getAllByText(/SLOT 1/)).toHaveLength(2);

    const future = screen.getByText('Future games (2)').closest('details');
    expect(future).not.toHaveAttribute('open');
    expect(within(future).getByText(/SLOT 4 .* COURT 2/)).toBeInTheDocument();
  });

  it('keeps a live earlier slot in Current game until the slot is done', () => {
    renderGrid({ liveGames: [{ slot: 1, court: 0 }] });

    expectInSection('Current game', /SLOT 1 .* COURT 1/);
    expect(screen.queryByText(/Past games played/)).not.toBeInTheDocument();
    expectInSection('Current game', /SLOT 1 .* COURT 2/);
    expectInSection('Next game', /SLOT 2 .* COURT 1/);
    expect(screen.getByText('Future games (4)')).toBeInTheDocument();
  });

  it('keeps a partially completed slot in Current game instead of folding it into past', () => {
    renderGrid({ fromSlot: 1, completedGames: [{ slot: 1, court: 0 }] });

    expectInSection('Current game', /SLOT 1 .* COURT 2/);
    expectInSection('Current game', /SLOT 2 .* COURT 1/);
    expectInSection('Next game', /SLOT 2 .* COURT 2/);
    expect(screen.getByText('Past games played (1)')).toBeInTheDocument();
  });

  it('does not show a completed out-of-order game as Next', () => {
    renderGrid({
      liveGames: [{ slot: 1, court: 1 }, { slot: 3, court: 0 }],
      completedGames: [{ slot: 1, court: 0 }, { slot: 2, court: 0 }],
      fromSlot: 1,
    });

    expectInSection('Next game', /SLOT 2 .* COURT 2/);
    expect(within(sectionFor('Next game')!).queryByText(/SLOT 2 .* COURT 1/)).not.toBeInTheDocument();
  });

  it('shows live and waiting actions on the physical court lanes', () => {
    renderGrid({ liveGames: [{ slot: 1, court: 0 }], blockedPlayerNames: new Set(['A112']) });

    const live = within(screen.getByRole('region', { name: 'Court 1' }));
    const waiting = within(screen.getByRole('region', { name: 'Court 2' }));
    expect(live.getByRole('button', { name: 'Finish game' })).toBeEnabled();
    expect(waiting.getByRole('button', { name: 'Waiting' })).toBeDisabled();
    expect(waiting.getByText(/A112 is unavailable/)).toBeInTheDocument();
  });

  it('fills the next queue to the planned court count across future slots', () => {
    renderGrid({ liveCapacity: 3 });

    const current = sectionFor('Current game');
    expect(within(current).getByText(/SLOT 2 .* COURT 1/)).toBeInTheDocument();
    expect(within(current).getByText(/SLOT 2 .* COURT 2/)).toBeInTheDocument();
    expect(within(current).getByText(/SLOT 3 .* COURT 1/)).toBeInTheDocument();
    const next = sectionFor('Next game');
    expect(within(next).getAllByRole('button', { name: 'Start game' })).toHaveLength(3);
    expect(within(next).getByText(/SLOT 3 .* COURT 2/)).toBeInTheDocument();
    expect(within(next).getByText(/SLOT 4 .* COURT 1/)).toBeInTheDocument();
    expect(within(next).getByText(/SLOT 4 .* COURT 2/)).toBeInTheDocument();
  });

  it('renders the full schedule and history without owning the live layout', () => {
    renderGrid({ completedGames: [{ slot: 1, court: 0 }] }, ScheduleGrid);
    expect(screen.queryByRole('heading', { name: 'Current game' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Session summary' })).not.toBeInTheDocument();
    const past = screen.getByText('Past games played (1)').closest('details')!;
    const future = screen.getByText('Future games (7)').closest('details')!;
    expect(past).not.toHaveAttribute('open');
    expect(future).not.toHaveAttribute('open');
    expect(within(past).getByText(/SLOT 1 .* COURT 1/)).toBeInTheDocument();
    expect(within(future).getByText(/SLOT 4 .* COURT 2/)).toBeInTheDocument();
  });

});
