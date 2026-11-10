// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import CourtElapsedTime from './CourtElapsedTime';

describe('CourtElapsedTime', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000_000); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each([[0, '00:00'], [65_000, '01:05'], [3_599_000, '59:59'], [3_661_000, '1:01:01'], [-5000, '00:00']])('formats a %i millisecond duration as %s', (duration, text) => {
    render(<CourtElapsedTime startedAt={Date.now() - duration} />);
    expect(screen.getByText(`Elapsed ${text}`)).toBeInTheDocument();
  });

  it('ticks from wall clock time and catches up when returning to the page', () => {
    render(<CourtElapsedTime startedAt={Date.now()} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('Elapsed 00:02')).toBeInTheDocument();
    vi.setSystemTime(Date.now() + 120_000);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByText('Elapsed 02:02')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Elapsed 02:02').closest('[aria-live]')).toBeNull();
  });

  it('explains unknown starts without starting a timer', () => {
    render(<CourtElapsedTime />);
    expect(screen.getByText('Elapsed —')).toHaveAttribute('title', expect.stringMatching(/start time was not recorded/i));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the timer and visibility listener when unmounted', () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<CourtElapsedTime startedAt={Date.now()} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('updates immediately when a court starts its next game', () => {
    const { rerender } = render(<CourtElapsedTime startedAt={Date.now() - 60_000} />);
    expect(screen.getByText('Elapsed 01:00')).toBeInTheDocument();
    rerender(<CourtElapsedTime startedAt={Date.now()} />);
    expect(screen.getByText('Elapsed 00:00')).toBeInTheDocument();
    rerender(<CourtElapsedTime />);
    expect(screen.getByText('Elapsed —')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});
