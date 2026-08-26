// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BadmintonPlanner from './BadmintonPlanner';

vi.mock('./firebase', () => ({
  isFirebaseConfigured: () => false,
  createShare: vi.fn(),
  updateShare: vi.fn(),
  fetchShare: vi.fn(),
}));

function makePlayer(name: string) {
  return { name, gender: 'M' };
}

function makeCourt(courtNum: number, names: string[]) {
  return {
    court: courtNum,
    teamA: names.slice(0, 2).map(makePlayer),
    teamB: names.slice(2, 4).map(makePlayer),
  };
}

function makeSlot(slotNum: number, courts: string[][], sitting: string[] = []) {
  return {
    slot: slotNum,
    courts: courts.map((names, ci) => makeCourt(ci + 1, names)),
    sitting: sitting.map(makePlayer),
    repeatedCourts: [],
    playerState: [],
  };
}

function sectionFor(title: string) {
  return screen.getByRole('heading', { name: title }).closest('section')!;
}

async function startNextVisibleGame(user: ReturnType<typeof userEvent.setup>) {
  const currentStarts = within(sectionFor('Current game')).queryAllByText('Start');
  if (currentStarts.length > 0) {
    await user.click(currentStarts[0]);
    return;
  }
  await user.click(within(sectionFor('Next game')).getAllByText('Start')[0]);
}

describe('BadmintonPlanner live game flow', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.FIREBASE_CONFIG = null;
    window.RECAPTCHA_SITE_KEY = null;
    window.ADMIN_PIN = null;
    window.SHARE_API_BASE = null;

    const players = Array.from({ length: 12 }, (_, i) => makePlayer(`P${i + 1}`));
    const result = {
      schedule: [
        makeSlot(1, [['P1', 'P2', 'P3', 'P4'], ['P5', 'P6', 'P7', 'P8']], ['P9', 'P10', 'P11', 'P12']),
        makeSlot(2, [['P1', 'P5', 'P9', 'P10'], ['P2', 'P6', 'P11', 'P12']], ['P3', 'P4', 'P7', 'P8']),
        makeSlot(3, [['P3', 'P7', 'P9', 'P11'], ['P4', 'P8', 'P10', 'P12']], ['P1', 'P2', 'P5', 'P6']),
      ],
      gamesPlayed: players.map(() => 1),
    };

    localStorage.setItem('bp-players', JSON.stringify(players));
    localStorage.setItem('bp-result', JSON.stringify(result));
    localStorage.setItem('bp-totalMinutes', JSON.stringify(45));
    localStorage.setItem('bp-gameMinutes', JSON.stringify(15));
    localStorage.setItem('bp-numCourts', JSON.stringify(2));
  });

  it('auto-marks the next same-court game live when a live game is done', async () => {
    const user = userEvent.setup();
    render(<BadmintonPlanner />);

    await startNextVisibleGame(user);
    await startNextVisibleGame(user);
    await user.click(within(sectionFor('Current game')).getAllByText('✓ Done')[0]);

    await waitFor(() => {
      const currentSection = sectionFor('Current game');
      const current = within(currentSection);
      expect(current.getByText(/SLOT 1 .* COURT 2/)).toBeInTheDocument();
      expect(current.getByText(/SLOT 2 .* COURT 1/)).toBeInTheDocument();
      expect(currentSection).toHaveTextContent('P5');
      expect(currentSection).toHaveTextContent('P8');
      expect(current.getAllByText('● LIVE')).toHaveLength(2);
    });
  });

  it('keeps live game count at court capacity as a pulled-up slot expands', async () => {
    const user = userEvent.setup();
    const players = Array.from({ length: 12 }, (_, i) => makePlayer(`P${i + 1}`));
    const result = {
      schedule: [
        makeSlot(1, [['P1', 'P2', 'P3', 'P4'], ['P5', 'P6', 'P7', 'P8'], ['P9', 'P10', 'P11', 'P12']]),
        makeSlot(2, [['P1', 'P5', 'P9', 'P10'], ['P2', 'P6', 'P11', 'P12'], ['P3', 'P4', 'P7', 'P8']]),
        makeSlot(3, [['P1', 'P6', 'P7', 'P12'], ['P2', 'P5', 'P8', 'P9'], ['P3', 'P4', 'P10', 'P11']]),
      ],
      gamesPlayed: players.map(() => 1),
    };
    localStorage.setItem('bp-players', JSON.stringify(players));
    localStorage.setItem('bp-result', JSON.stringify(result));
    localStorage.setItem('bp-numCourts', JSON.stringify(3));

    render(<BadmintonPlanner />);

    await startNextVisibleGame(user);
    await startNextVisibleGame(user);
    await startNextVisibleGame(user);
    await user.click(within(sectionFor('Current game')).getAllByText('✓ Done')[0]);
    await waitFor(() => {
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(3);
    });

    await user.click(within(sectionFor('Current game')).getAllByText('✓ Done')[0]);
    await waitFor(() => {
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(3);
      expect(within(sectionFor('Current game')).getAllByText(/SLOT 2/).length).toBeGreaterThan(0);
    });
  });

  it('fills a freed court from the next playable queued game even when the same court index disappears', async () => {
    const user = userEvent.setup();
    const players = Array.from({ length: 10 }, (_, i) => makePlayer(`P${i + 1}`));
    const result = {
      schedule: [
        makeSlot(1, [['P1', 'P2', 'P3', 'P4'], ['P5', 'P6', 'P7', 'P8']], ['P9', 'P10']),
        makeSlot(2, [['P1', 'P5', 'P9', 'P10'], ['P2', 'P6', 'P7', 'P8']], ['P3', 'P4']),
        makeSlot(3, [['P3', 'P4', 'P5', 'P6'], ['P1', 'P2', 'P7', 'P8']], ['P9', 'P10']),
      ],
      gamesPlayed: players.map(() => 1),
    };
    localStorage.setItem('bp-players', JSON.stringify(players));
    localStorage.setItem('bp-result', JSON.stringify(result));
    localStorage.setItem('bp-numCourts', JSON.stringify(2));

    render(<BadmintonPlanner />);

    await startNextVisibleGame(user);
    await startNextVisibleGame(user);
    await user.click(within(sectionFor('Current game')).getAllByText('✓ Done')[1]);

    await waitFor(() => {
      const currentSection = sectionFor('Current game');
      const current = within(currentSection);
      expect(current.getAllByText('● LIVE')).toHaveLength(2);
      expect(current.getByText(/SLOT 1 .* COURT 1/)).toBeInTheDocument();
      expect(current.getByText(/SLOT 2 .* COURT 1/)).toBeInTheDocument();
      expect(currentSection).toHaveTextContent('P1');
      expect(currentSection).toHaveTextContent('P4');
    });
  });

  it('skips a player from the immediate next selection and clears the skip after regeneration', async () => {
    const user = userEvent.setup();
    const players = ['SkipMe', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12'].map(makePlayer);
    const result = {
      schedule: [
        makeSlot(1, [['SkipMe', 'P2', 'P3', 'P4'], ['P5', 'P6', 'P7', 'P8']], ['P9', 'P10', 'P11', 'P12']),
        makeSlot(2, [['SkipMe', 'P5', 'P9', 'P10'], ['P2', 'P6', 'P11', 'P12']], ['P3', 'P4', 'P7', 'P8']),
        makeSlot(3, [['P3', 'P7', 'P9', 'P11'], ['P4', 'P8', 'P10', 'P12']], ['SkipMe', 'P2', 'P5', 'P6']),
      ],
      gamesPlayed: players.map(() => 1),
    };
    localStorage.setItem('bp-players', JSON.stringify(players));
    localStorage.setItem('bp-result', JSON.stringify(result));

    render(<BadmintonPlanner />);

    expect(sectionFor('Current game')).toHaveTextContent('SkipMe');
    await user.click(screen.getAllByTitle('Skip this player for the next generated game only')[0]);

    await waitFor(() => {
      expect(sectionFor('Current game')).not.toHaveTextContent('SkipMe');
      expect(screen.queryByText('Skipping next')).not.toBeInTheDocument();
    });
  });
});
