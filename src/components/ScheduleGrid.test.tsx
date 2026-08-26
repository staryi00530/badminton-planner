// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ScheduleGrid from './ScheduleGrid';

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

function renderGrid(overrides = {}) {
  const players = [{ name: 'A11', gender: 'M' }, { name: 'A12', gender: 'M' }];
  render(
    <ScheduleGrid
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

describe('ScheduleGrid grouping', () => {
  it('shows current, one next game, and folds past/future slots', () => {
    renderGrid({ fromSlot: 2, completedGames: [{ slot: 1, court: 0 }, { slot: 1, court: 1 }] });

    expectInSection('Current game', /SLOT 2 .* COURT 1/);
    expectInSection('Current game', /SLOT 2 .* COURT 2/);
    expectInSection('Next game', /SLOT 3 .* COURT 1/);
    expectInSection('Next game', /SLOT 3 .* COURT 2/);

    const past = screen.getByText('Past games (1)').closest('details');
    expect(past).not.toHaveAttribute('open');
    expect(within(past).getByText('SLOT 1')).toBeInTheDocument();

    const future = screen.getByText('Future games (2)').closest('details');
    expect(future).not.toHaveAttribute('open');
    expect(within(future).getByText(/SLOT 4 .* COURT 2/)).toBeInTheDocument();
  });

  it('keeps a live earlier slot in Current game until the slot is done', () => {
    renderGrid({ liveGames: [{ slot: 1, court: 0 }] });

    expectInSection('Current game', /SLOT 1 .* COURT 1/);
    expect(screen.queryByText('Past games (1)')).not.toBeInTheDocument();
    expectInSection('Next game', /SLOT 1 .* COURT 2/);
    expect(screen.getByText('Future games (6)')).toBeInTheDocument();
  });

  it('keeps a partially completed slot in Current game instead of folding it into past', () => {
    renderGrid({ fromSlot: 1, completedGames: [{ slot: 1, court: 0 }] });

    expectInSection('Current game', /SLOT 1 .* COURT 2/);
    expectInSection('Next game', /SLOT 2 .* COURT 1/);
    expectInSection('Next game', /SLOT 2 .* COURT 2/);
    expect(screen.queryByText(/Past games/)).not.toBeInTheDocument();
  });

  it('shows compact court statuses for live and waiting courts', () => {
    renderGrid({ liveGames: [{ slot: 1, court: 0 }], blockedPlayerNames: new Set(['A112']) });

    const status = within(screen.getByRole('region', { name: 'Court status' }));
    expect(status.getByText('Court 1')).toBeInTheDocument();
    expect(status.getByText('Live')).toBeInTheDocument();
    expect(status.getAllByText('Slot 1').length).toBeGreaterThan(0);
    expect(status.getByText('Court 2')).toBeInTheDocument();
    expect(status.getByText('Waiting')).toBeInTheDocument();
  });
});
