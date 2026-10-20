// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('promotes the first queued game with a substitution when its player is still live', async () => {
    const user = userEvent.setup();
    render(<BadmintonPlanner />);

    await startNextVisibleGame(user);
    await startNextVisibleGame(user);
    await user.click(within(sectionFor('Current game')).getAllByText('✓ Done')[0]);
    await user.click(screen.getByRole('button', { name: 'Substitute unavailable players' }));

    await waitFor(() => {
      const currentSection = sectionFor('Current game');
      const current = within(currentSection);
      expect(current.getByText(/SLOT 1 .* COURT 2/)).toBeInTheDocument();
      expect(current.getByText(/SLOT 2 .* COURT 1/)).toBeInTheDocument();
      expect(currentSection).toHaveTextContent('P5');
      expect(currentSection).toHaveTextContent('P8');
      expect(currentSection).toHaveTextContent('P1');
      expect(currentSection).toHaveTextContent('P9');
      expect(currentSection).toHaveTextContent('P10');
      expect(currentSection).toHaveTextContent('P3');
      expect(current.getAllByText('● LIVE')).toHaveLength(2);
    });
  });

  it('offers the next playable game as a one-step alternative without cascading further', async () => {
    const user = userEvent.setup();
    const players = Array.from({ length: 12 }, (_, i) => makePlayer(`P${i + 1}`));
    const result = {
      schedule: [
        makeSlot(1, [['P1', 'P2', 'P3', 'P4'], ['P5', 'P6', 'P7', 'P8']], ['P9', 'P10', 'P11', 'P12']),
        makeSlot(2, [['P5', 'P9', 'P10', 'P11'], ['P1', 'P2', 'P3', 'P4']], ['P6', 'P7', 'P8', 'P12']),
      ],
      gamesPlayed: players.map(() => 1),
    };
    localStorage.setItem('bp-players', JSON.stringify(players));
    localStorage.setItem('bp-result', JSON.stringify(result));
    localStorage.setItem('bp-totalMinutes', JSON.stringify(30));
    localStorage.setItem('bp-numCourts', JSON.stringify(2));

    render(<BadmintonPlanner />);

    await startNextVisibleGame(user);
    await startNextVisibleGame(user);
    await user.click(within(sectionFor('Current game')).getAllByText('✓ Done')[0]);

    expect(screen.getByRole('heading', { name: 'Court 1 is ready' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use next playable game' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use next playable game' }));

    await waitFor(() => {
      const current = sectionFor('Current game');
      expect(within(current).getAllByText('● LIVE')).toHaveLength(2);
      expect(current).toHaveTextContent('SLOT 1');
      expect(current).toHaveTextContent('SLOT 2');
      expect(current).toHaveTextContent('P1');
      expect(current).toHaveTextContent('P4');
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
    await user.click(screen.getByRole('button', { name: 'Substitute unavailable players' }));
    await waitFor(() => {
      const current = sectionFor('Current game');
      expect(within(current).getAllByText('● LIVE')).toHaveLength(3);
      const cards = current.querySelectorAll('.schedule-grid > div');
      expect(cards[0]).toHaveTextContent(/SLOT 2/);
      expect(cards[1]).toHaveTextContent(/SLOT 1 .* COURT 2/);
      expect(cards[2]).toHaveTextContent(/SLOT 1 .* COURT 3/);
    });

    // Court 1 is now the promoted game, so finish the unchanged court 2 lane.
    await user.click(within(sectionFor('Current game')).getAllByText('✓ Done')[1]);
    await waitFor(() => {
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(3);
      expect(within(sectionFor('Current game')).getAllByText(/SLOT 2/).length).toBeGreaterThan(0);
    });
  });

  it('does not allow manually starting a third game on two courts', async () => {
    const user = userEvent.setup();
    render(<BadmintonPlanner />);

    await startNextVisibleGame(user);
    await startNextVisibleGame(user);

    await waitFor(() => {
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(2);
    });
    expect(within(sectionFor('Next game')).getAllByRole('button', { name: 'Waiting' }).length).toBeGreaterThan(0);
    expect(within(sectionFor('Next game')).getAllByRole('button', { name: 'Waiting' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
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
    await user.click(screen.getByRole('button', { name: 'Substitute unavailable players' }));

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

  it('keeps both active courts unchanged when a player is marked done for the day', async () => {
    const user = userEvent.setup();
    render(<BadmintonPlanner />);

    await startNextVisibleGame(user);
    await startNextVisibleGame(user);
    const currentBefore = sectionFor('Current game').textContent;

    await user.click(screen.getAllByTitle('Player is done for today')[0]);

    await waitFor(() => {
      const current = sectionFor('Current game');
      expect(current).toHaveTextContent('● LIVE');
      expect(current).toHaveTextContent('P1');
      expect(current).toHaveTextContent('P8');
      expect(current.textContent).toContain(currentBefore!.match(/P1.*P4/)?.[0] ?? 'P1');
    });
  });

  it('keeps an unaffected live court running when another court is edited', async () => {
    const user = userEvent.setup();
    render(<BadmintonPlanner />);

    await startNextVisibleGame(user);
    await startNextVisibleGame(user);
    const current = sectionFor('Current game');
    await user.click(within(current).getAllByTitle('Edit who plays in this slot')[0]);
    const editors = screen.getAllByRole('combobox');
    await user.selectOptions(editors[0]!, 'P9');
    await user.click(within(sectionFor('Current game')).getAllByRole('button', { name: 'Apply & regenerate after' })[0]!);

    await waitFor(() => {
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(2);
      expect(within(sectionFor('Current game')).getByText(/SLOT 1 .* COURT 2/)).toBeInTheDocument();
    });
  });

  it('updates the live player snapshot when a lineup is edited', async () => {
    const user = userEvent.setup();
    render(<BadmintonPlanner />);
    await startNextVisibleGame(user);
    await startNextVisibleGame(user);

    const current = within(sectionFor('Current game'));
    const editButton = current.getAllByTitle('Edit who plays in this slot')[0]!;
    const card = editButton.parentElement!.parentElement!.parentElement!;
    await user.click(editButton);
    await user.selectOptions(within(card).getAllByRole('combobox')[0]!, 'P9');
    await user.click(within(card).getByRole('button', { name: 'This game only' }));

    expect(sectionFor('Next game')).toHaveTextContent('P9 ⏳');
    expect(sectionFor('Next game')).not.toHaveTextContent('P1 ⏳');
  });

  it('keeps This game only edits from regenerating future games or clearing their scores', async () => {
    const user = userEvent.setup();
    const futureScore = { a: '21', b: '18', applied: true, teamA: ['P3', 'P7'], teamB: ['P9', 'P11'] };
    localStorage.setItem('bp-scores', JSON.stringify({ s3c0: futureScore }));
    render(<BadmintonPlanner />);
    await startNextVisibleGame(user);
    await startNextVisibleGame(user);

    const before = JSON.parse(localStorage.getItem('bp-result')!);
    const current = within(sectionFor('Current game'));
    const editButton = current.getAllByTitle('Edit who plays in this slot')[0]!;
    const card = editButton.parentElement!.parentElement!.parentElement!;
    await user.click(editButton);
    await user.selectOptions(within(card).getAllByRole('combobox')[0]!, 'P9');
    await user.click(within(card).getByRole('button', { name: 'This game only' }));

    await waitFor(() => expect(JSON.parse(localStorage.getItem('bp-result')!).schedule[0].courts[0].teamA[0].name).toBe('P9'));
    const after = JSON.parse(localStorage.getItem('bp-result')!);
    expect(after.schedule[0].courts[0].teamA[0].name).toBe('P9');
    expect(after.schedule.slice(1).map((slot: any) => slot.courts)).toEqual(before.schedule.slice(1).map((slot: any) => slot.courts));
    expect(JSON.parse(localStorage.getItem('bp-scores')!)).toEqual({ s3c0: futureScore });
  });

  it('scores a completed court without promoting above the changed future capacity', async () => {
    const user = userEvent.setup();
    localStorage.setItem('bp-extraCourt', JSON.stringify({ enabled: true, startMin: 0, durationMin: 15 }));
    render(<BadmintonPlanner />);
    await user.click(screen.getByRole('button', { name: /Re-roll/ }));
    await waitFor(() => expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(3));

    const scoreInputs = within(sectionFor('Current game')).getAllByRole('spinbutton');
    fireEvent.change(scoreInputs[4]!, { target: { value: '21' } });
    fireEvent.change(scoreInputs[5]!, { target: { value: '10' } });
    await waitFor(() => expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(2));
    expect(Object.values(JSON.parse(localStorage.getItem('bp-scores')!)).some((score: any) => score.applied)).toBe(true);
  });

  it('keeps every other live court running when one current court is regenerated', async () => {
    const user = userEvent.setup();
    const players = Array.from({ length: 13 }, (_, i) => makePlayer(`P${i + 1}`));
    const result = {
      schedule: [
        makeSlot(1, [
          ['P1', 'P2', 'P3', 'P4'],
          ['P5', 'P6', 'P7', 'P8'],
          ['P9', 'P10', 'P11', 'P12'],
        ], ['P13']),
        makeSlot(2, [
          ['P1', 'P5', 'P9', 'P10'],
          ['P2', 'P6', 'P11', 'P12'],
          ['P3', 'P4', 'P7', 'P8'],
        ], ['P13']),
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
    const current = sectionFor('Current game');
    await user.click(within(current).getAllByTitle('Edit who plays in this slot')[0]);
    const editors = screen.getAllByRole('combobox');
    await user.selectOptions(editors[0]!, 'P13');
    await user.click(within(sectionFor('Current game')).getAllByRole('button', { name: 'Apply & regenerate after' })[0]!);

    await waitFor(() => {
      const currentAfter = sectionFor('Current game');
      expect(within(currentAfter).getAllByText('● LIVE')).toHaveLength(3);
      expect(currentAfter).toHaveTextContent('P5');
      expect(currentAfter).toHaveTextContent('P8');
      expect(currentAfter).toHaveTextContent('P9');
      expect(currentAfter).toHaveTextContent('P12');
    });

    // Editing another current court must reconcile the queue again rather than
    // leaving only the edited court visible.
    const currentAfterFirstEdit = sectionFor('Current game');
    await user.click(within(currentAfterFirstEdit).getAllByTitle('Edit who plays in this slot')[2]!);
    const secondEditSelects = within(sectionFor('Current game')).getAllByRole('combobox');
    await user.selectOptions(secondEditSelects[0]!, 'P13');
    await user.click(within(sectionFor('Current game')).getAllByRole('button', { name: 'Apply & regenerate after' })[0]!);

    await waitFor(() => {
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(3);
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
