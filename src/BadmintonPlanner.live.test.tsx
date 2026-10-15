// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BadmintonPlanner from './BadmintonPlanner';
import { fetchShare, isFirebaseConfigured } from './firebase';
import type { SharePayload } from './types';

vi.mock('./firebase', () => ({
  isFirebaseConfigured: vi.fn(() => false),
  createShare: vi.fn(),
  updateShare: vi.fn(),
  fetchShare: vi.fn(),
  loadWinLoss: vi.fn(async () => ({})),
  saveWinLoss: vi.fn(async () => {}),
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
  const currentStarts = within(sectionFor('Current game')).queryAllByText('Start game');
  if (currentStarts.length > 0) {
    await user.click(currentStarts[0]);
    return;
  }
  await user.click(within(sectionFor('Next game')).getAllByText('Start game')[0]);
}

describe('BadmintonPlanner live game flow', () => {
  beforeEach(() => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(false);
    window.history.replaceState(null, '', '/');
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(['firebase', 'api', 'hash'] as const)('opening a %s share', source => {
    it.each(['about', 'archive'] as const)('selects Live session without replacing the personal %s selection', async activeTab => {
      const payload: SharePayload = {
        v: 1,
        p: [['Shared A', 'M'], ['Shared B', 'M'], ['Shared C', 'F'], ['Shared D', 'F']],
        cfg: { g: 15, c: 1 },
        slots: [{ s: 1, c: [[[0, 1], [2, 3]]], sit: [] }],
      };
      localStorage.setItem('bp-active-tab', JSON.stringify(activeTab));
      localStorage.setItem('bp-players', JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ ...makePlayer(`P${i + 1}`), level: 2 }))));
      const personalResult = localStorage.getItem('bp-result');
      const personalPlayers = localStorage.getItem('bp-players');
      if (source === 'firebase') {
        vi.mocked(isFirebaseConfigured).mockReturnValue(true);
        vi.mocked(fetchShare).mockResolvedValue({ status: 'ok', data: payload });
        window.history.replaceState(null, '', '/?share=explicit-session');
      } else if (source === 'api') {
        window.SHARE_API_BASE = 'https://share.example.test';
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: payload }), { status: 200 }));
        window.history.replaceState(null, '', '/?share=explicit-session');
      } else {
        window.history.replaceState(null, '', `/#share=${btoa(JSON.stringify(payload))}`);
      }

      const { unmount } = render(<BadmintonPlanner />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Live session' })).toHaveAttribute('aria-current', 'page');
        expect(sectionFor('Current game')).toHaveTextContent('Shared A');
        expect(sectionFor('Current game')).toHaveTextContent('Shared D');
      });
      expect(JSON.parse(localStorage.getItem('bp-active-tab')!)).toBe(activeTab);
      expect(localStorage.getItem('bp-result')).toBe(personalResult);
      expect(localStorage.getItem('bp-players')).toBe(personalPlayers);

      unmount();
      sessionStorage.clear();
      window.history.replaceState(null, '', '/');
      render(<BadmintonPlanner />);
      expect(screen.getByRole('button', { name: activeTab === 'about' ? 'How it works' : /^Saved plans/ })).toHaveAttribute('aria-current', 'page');
    });
  });

  it('generates a schedule into Live session with all initial courts live', async () => {
    const user = userEvent.setup();
    localStorage.removeItem('bp-result');
    render(<BadmintonPlanner />);

    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Live session' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Generate \(3 slots\)/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Live session' })).toHaveAttribute('aria-current', 'page');
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(2);
    });
    expect(screen.getByRole('region', { name: 'Live session board' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-roll' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Player name')).not.toBeInTheDocument();
  });

  it('re-rolls from Setup into Live session with all initial courts live', async () => {
    const user = userEvent.setup();
    render(<BadmintonPlanner />);
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: 'Re-roll' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Live session' })).toHaveAttribute('aria-current', 'page');
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(2);
    });
  });

  it('retains Setup on refresh and can return to Live session', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<BadmintonPlanner />);
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    unmount();
    render(<BadmintonPlanner />);

    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Live session' }));
    expect(screen.getByRole('button', { name: 'Live session' })).toHaveAttribute('aria-current', 'page');
    expect(sectionFor('Current game')).toBeInTheDocument();
  });

  it('returns to Setup when the active schedule is cleared', async () => {
    const user = userEvent.setup();
    render(<BadmintonPlanner />);
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Generate \(3 slots\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Live session' })).toBeDisabled();
  });

  it('keeps setup and admin controls off Live and one navigation action away', async () => {
    const user = userEvent.setup();
    localStorage.setItem('bp-debug-live-queue', 'true');
    render(<BadmintonPlanner />);

    expect(screen.queryByText('Session settings')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Player name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preferred pairing first player')).not.toBeInTheDocument();
    for (const name of ['Re-roll', 'Import', 'Clear', 'Admin view', 'Export debug logs']) {
      expect(screen.queryByRole('button', { name, exact: true })).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Re-generate from slot')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Player is done for today').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['Re-roll', 'Import', 'Clear', 'Admin view', 'Export debug logs']) {
      expect(screen.getByRole('button', { name, exact: true })).toBeVisible();
    }
    expect(screen.getByText('Re-generate from slot')).toBeVisible();
    await user.click(screen.getByText('Session settings'));
    expect(screen.getByLabelText('Preferred pairing first player')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Preferred pairing first player'), 'P1');
    await user.selectOptions(screen.getByLabelText('Preferred pairing second player'), 'P2');
    await user.click(screen.getByRole('button', { name: 'Add', exact: true }));
    await user.click(screen.getByText('Players (12)'));
    expect(screen.getByPlaceholderText('Player name')).toBeVisible();
    expect(screen.queryByTitle('Private level used for balancing')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Admin view', exact: true }));
    expect(screen.getByTitle('Private level used for balancing')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Live session' }));
    expect(screen.queryByPlaceholderText('Player name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exit admin view' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByText('Session settings'));
    expect(screen.getByRole('button', { name: 'Remove preferred pairing P1 and P2' })).toBeVisible();
  });

  it.each(['Past games', 'Saved plans', 'How it works'])('does not expose setup controls on %s', async name => {
    const user = userEvent.setup();
    localStorage.setItem('bp-debug-live-queue', 'true');
    render(<BadmintonPlanner />);
    await user.click(screen.getByRole('button', { name, exact: true }));
    expect(screen.queryByPlaceholderText('Player name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-roll' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Admin view', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export debug logs' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.getByRole('button', { name: 'Re-roll' })).toBeVisible();
  });

  it('promotes the first queued game with a substitution when its player is still live', async () => {
    const user = userEvent.setup();
    render(<BadmintonPlanner />);

    await startNextVisibleGame(user);
    await startNextVisibleGame(user);
    await user.click(within(sectionFor('Current game')).getAllByText('Finish game')[0]);
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
    await user.click(within(sectionFor('Current game')).getAllByText('Finish game')[0]);

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
    await user.click(within(sectionFor('Current game')).getAllByText('Finish game')[0]);
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
    await user.click(within(sectionFor('Current game')).getAllByText('Finish game')[1]);
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
    await user.click(within(sectionFor('Current game')).getAllByText('Finish game')[1]);
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
