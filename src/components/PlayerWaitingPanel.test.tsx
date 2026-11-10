// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerWaitingPanel from './PlayerWaitingPanel';

describe('PlayerWaitingPanel', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const rows = [
    { key: 'a', name: 'Alice', status: 'waiting' as const, since: 940_000, gamesWaited: 2, gamesPlayed: 1 },
    { key: 'b', name: 'Ben', status: 'waiting' as const, since: 880_000, gamesWaited: 3, gamesPlayed: 0 },
    { key: 'c', name: 'Chris', status: 'playing' as const, gamesWaited: 0, gamesPlayed: 2 },
    { key: 'd', name: 'Dani', status: 'unavailable' as const, gamesWaited: 4, gamesPlayed: 1 },
  ];
  it('sorts the longest recorded wait first and shows completed counts separately', () => {
    render(<PlayerWaitingPanel rows={rows} trackingStartedAt={880_000} />);
    expect(screen.getByText(/2 waiting.*longest 02:00/)).toBeInTheDocument();
    const tableRows = screen.getAllByRole('row', { hidden: true });
    expect(within(tableRows[1]!).getByText('Ben')).toBeInTheDocument();
    expect(within(tableRows[1]!).getByText('02:00')).toBeInTheDocument();
    expect(within(tableRows[1]!).getByText('3')).toBeInTheDocument();
    expect(within(tableRows[1]!).getByText('0')).toBeInTheDocument();
    expect(within(tableRows[3]!).getByText('Playing')).toBeInTheDocument();
    expect(within(tableRows[4]!).getByText('Unavailable')).toBeInTheDocument();
  });
  it('does not invent elapsed time before tracking or for legacy unknown waits', () => {
    const { rerender } = render(<PlayerWaitingPanel rows={rows} />);
    expect(screen.getAllByText('Not started').length).toBe(2);
    expect(screen.getByText(/Press Start session timers/)).toBeInTheDocument();
    rerender(<PlayerWaitingPanel rows={[{ ...rows[0]!, since: undefined }]} trackingStartedAt={900_000} />);
    expect(screen.getByText('Time not recorded')).toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });
  it('ticks only its own display, catches up on return, and cleans up', () => {
    const { unmount } = render(<PlayerWaitingPanel rows={rows} trackingStartedAt={880_000} />);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('02:01')).toBeInTheDocument();
    vi.setSystemTime(1_120_000);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByText('04:00')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
