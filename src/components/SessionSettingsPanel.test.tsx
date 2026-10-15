// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SessionSettingsPanel from './SessionSettingsPanel';

function renderPanel(overrides = {}) {
  const patchState = vi.fn();
  render(
    <SessionSettingsPanel
      sessionStart=""
      totalMinutes={180}
      gameMinutes={15}
      numCourts={1}
      extraCourt={{ enabled: false, startMin: 60, durationMin: 90 }}
      staggerMode="none"
      preferMixedTeams={false}
      patchState={patchState}
      {...overrides}
    />
  );
  return patchState;
}

describe('SessionSettingsPanel', () => {
  it('shows the current session/game length', () => {
    renderPanel({ totalMinutes: 180, gameMinutes: 15 });
    expect(screen.getByText('3h')).toBeInTheDocument();
    expect(screen.getByText('15m')).toBeInTheDocument();
  });

  it('clicking a court count patches numCourts', async () => {
    const user = userEvent.setup();
    const patchState = renderPanel({ numCourts: 1 });
    await user.click(screen.getByRole('button', { name: '3' }));
    expect(patchState).toHaveBeenCalledWith({ numCourts: 3 });
  });

  it('hides the "Extra court" section once at the 5-court max', () => {
    renderPanel({ numCourts: 5 });
    expect(screen.queryByText('Extra court')).not.toBeInTheDocument();
  });

  it('toggles the extra-court enabled flag, preserving other fields', async () => {
    const user = userEvent.setup();
    const extraCourt = { enabled: false, startMin: 60, durationMin: 90 };
    const patchState = renderPanel({ numCourts: 2, extraCourt });
    await user.click(screen.getByRole('button', { name: 'OFF' }));
    expect(patchState).toHaveBeenCalledWith({ extraCourt: { enabled: true, startMin: 60, durationMin: 90 } });
  });

  it('only shows the start/duration inputs once the extra court is enabled', () => {
    const { rerender } = render(
      <SessionSettingsPanel sessionStart="" totalMinutes={180} gameMinutes={15} numCourts={2} staggerMode="none" preferMixedTeams={false} patchState={vi.fn()}
        extraCourt={{ enabled: false, startMin: 60, durationMin: 90 }} />
    );
    expect(screen.queryByText('m for')).not.toBeInTheDocument();

    rerender(
      <SessionSettingsPanel sessionStart="" totalMinutes={180} gameMinutes={15} numCourts={2} staggerMode="none" preferMixedTeams={false} patchState={vi.fn()}
        extraCourt={{ enabled: true, startMin: 60, durationMin: 90 }} />
    );
    expect(screen.getByText('m for')).toBeInTheDocument();
  });

  it('clicking an availability mode patches staggerMode', async () => {
    const user = userEvent.setup();
    const patchState = renderPanel({ staggerMode: 'none' });
    await user.click(screen.getByRole('button', { name: 'Early / Late' }));
    expect(patchState).toHaveBeenCalledWith({ staggerMode: 'group' });
  });

  it('toggles preferMixedTeams and reflects the label', async () => {
    const user = userEvent.setup();
    const patchState = renderPanel({ preferMixedTeams: false });
    expect(screen.getByText('Spread F')).toBeInTheDocument();
    await user.click(screen.getByText('Spread F'));
    expect(patchState).toHaveBeenCalledWith({ preferMixedTeams: true });
  });

  it('adds a preferred pairing from the player selectors', async () => {
    const user = userEvent.setup();
    const patchState = renderPanel({ players: [{ name: 'Alice', gender: 'F' }, { name: 'Bob', gender: 'M' }], preferredPairs: [] });
    await user.selectOptions(screen.getByLabelText('Preferred pairing first player'), 'Alice');
    await user.selectOptions(screen.getByLabelText('Preferred pairing second player'), 'Bob');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(patchState).toHaveBeenCalledWith({ preferredPairs: [['Alice', 'Bob']] });
  });

  it('marks an existing schedule dirty when a preferred pairing changes', async () => {
    const user = userEvent.setup();
    const patchState = renderPanel({
      scheduleActive: true,
      players: [{ name: 'Alice', gender: 'F' }, { name: 'Bob', gender: 'M' }],
      preferredPairs: [],
    });
    await user.selectOptions(screen.getByLabelText('Preferred pairing first player'), 'Alice');
    await user.selectOptions(screen.getByLabelText('Preferred pairing second player'), 'Bob');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(patchState).toHaveBeenCalledWith({ preferredPairs: [['Alice', 'Bob']], scheduleDirty: true });
  });

  it('shows a clear button for sessionStart only when set, and clears it on click', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SessionSettingsPanel sessionStart="" totalMinutes={180} gameMinutes={15} numCourts={1} staggerMode="none" preferMixedTeams={false} patchState={vi.fn()}
        extraCourt={{ enabled: false, startMin: 60, durationMin: 90 }} />
    );
    expect(screen.queryByText('×')).not.toBeInTheDocument();

    const patchState = vi.fn();
    rerender(
      <SessionSettingsPanel sessionStart="09:00" totalMinutes={180} gameMinutes={15} numCourts={1} staggerMode="none" preferMixedTeams={false} patchState={patchState}
        extraCourt={{ enabled: false, startMin: 60, durationMin: 90 }} />
    );
    await user.click(screen.getByText('×'));
    expect(patchState).toHaveBeenCalledWith({ sessionStart: '' });
  });
});
