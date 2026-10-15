// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BadmintonPlanner from './BadmintonPlanner';
import { fetchShare, isFirebaseConfigured } from './firebase';
import type { SharePayload } from './types';
import { generateSchedule } from './algorithm/scheduler';
import * as scheduler from './algorithm/scheduler';
import type { Player } from './algorithm/types';

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

  describe('atomic undo', () => {
    const stored = (key: string) => JSON.parse(localStorage.getItem(key)!);
    const undo = () => screen.getByRole('button', { name: 'Undo last action' });

    it.each(['new', 'update'])('invalidates undo after Start then manual Save (%s)', async mode => {
      const user = userEvent.setup();
      if (mode === 'update') {
        localStorage.setItem('bp-saved-plans', JSON.stringify([{ id: 7, tag: 'Existing', result: stored('bp-result'), savedAt: new Date().toISOString() }]));
        localStorage.setItem('bp-loaded-plan-id', '7');
      }
      render(<BadmintonPlanner />);
      await startNextVisibleGame(user);
      expect(undo()).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Setup' }));
      await user.click(screen.getByTitle('Save plan with tag'));
      const tag = screen.getByPlaceholderText(/e.g. Wed/);
      await user.clear(tag);
      await user.type(tag, 'Keep this plan');
      await user.click(within(tag.parentElement!).getByRole('button', { name: mode === 'update' ? 'Update' : 'Save', exact: true }));
      const saved = stored('bp-saved-plans');
      const loadedId = stored('bp-loaded-plan-id');
      expect(saved).toHaveLength(1);
      expect(saved[0].tag).toBe('Keep this plan');
      expect(undo()).toBeDisabled();
      await user.click(undo());
      expect(stored('bp-saved-plans')).toEqual(saved);
      expect(stored('bp-loaded-plan-id')).toBe(loadedId);
    });

    it('invalidates undo after Start then Delete without resurrecting the loaded plan', async () => {
      const user = userEvent.setup();
      localStorage.setItem('bp-saved-plans', JSON.stringify([{ id: 7, tag: 'Delete me', result: stored('bp-result'), savedAt: new Date().toISOString() }]));
      localStorage.setItem('bp-loaded-plan-id', '7');
      render(<BadmintonPlanner />);
      await startNextVisibleGame(user);
      expect(undo()).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Saved plans (1)' }));
      const archive = screen.getByText('Delete me').parentElement!;
      await user.click(within(archive).getAllByRole('button')[1]!);
      expect(stored('bp-saved-plans')).toEqual([]);
      expect(undo()).toBeDisabled();
      await user.click(undo());
      expect(stored('bp-saved-plans')).toEqual([]);
      expect(stored('bp-loaded-plan-id')).toBeNull();
    });

    it('invalidates undo after Start then a setup roster addition', async () => {
      const user = userEvent.setup();
      render(<BadmintonPlanner />);
      await startNextVisibleGame(user);
      expect(undo()).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Setup' }));
      await user.click(screen.getByText('Players (12)'));
      await user.type(screen.getByPlaceholderText('Player name'), 'Keep guest');
      await user.click(screen.getByRole('button', { name: 'ADD', exact: true }));
      expect(stored('bp-players')).toHaveLength(13);
      expect(undo()).toBeDisabled();
      await user.click(undo());
      expect(stored('bp-players')).toHaveLength(13);
      expect(stored('bp-players')[12].name).toBe('Keep guest');
      await user.click(screen.getByRole('button', { name: 'Live session' }));
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(1);
    });

    it('retains the last Start undo when a blocked finish decision is opened and canceled', async () => {
      const user = userEvent.setup();
      render(<BadmintonPlanner />);
      await startNextVisibleGame(user);
      await startNextVisibleGame(user);
      await user.click(within(sectionFor('Current game')).getAllByText('Finish game')[0]!);
      expect(screen.getByRole('heading', { name: 'Court 1 is ready' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await user.click(undo());
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(1);
      expect(screen.queryByRole('heading', { name: 'Court 1 is ready' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Past games' })).toBeInTheDocument();
      expect(undo()).toBeDisabled();
    });

    it('offers one-step undo during session and across navigation without needing admin', async () => {
      const user = userEvent.setup();
      window.ADMIN_PIN = '1234';
      render(<BadmintonPlanner />);
      expect(undo()).toBeDisabled();
      await startNextVisibleGame(user);
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Past games' }));
      await user.click(undo());
      expect(undo()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Past games' })).toHaveAttribute('aria-current', 'page');
      await user.click(screen.getByRole('button', { name: 'Live session' }));
      expect(screen.queryByText('● LIVE')).not.toBeInTheDocument();
    });

    it.each(['Substitute unavailable players', 'Use next playable game'])('undoes %s and restores the pending decision without creating another undo', async choice => {
      const user = userEvent.setup();
      if (choice === 'Use next playable game') {
        const plan = stored('bp-result');
        plan.schedule[1] = makeSlot(2, [['P5', 'P9', 'P10', 'P11'], ['P1', 'P2', 'P3', 'P4']], ['P6', 'P7', 'P8', 'P12']);
        localStorage.setItem('bp-result', JSON.stringify(plan));
      }
      render(<BadmintonPlanner />);
      await startNextVisibleGame(user);
      await startNextVisibleGame(user);
      const before = stored('bp-result');
      await user.click(within(sectionFor('Current game')).getAllByText('Finish game')[0]!);
      await user.click(screen.getByRole('button', { name: choice }));
      expect(screen.queryByRole('heading', { name: 'Court 1 is ready' })).not.toBeInTheDocument();
      await user.click(undo());
      expect(stored('bp-result')).toEqual(before);
      expect(screen.getByRole('heading', { name: 'Court 1 is ready' })).toBeInTheDocument();
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(2);
      expect(undo()).toBeDisabled();
    });

    it.each(['This game only', 'Apply & regenerate after'])('restores roster, scores and live snapshots after %s', async command => {
      const user = userEvent.setup();
      const score = { a: '21', b: '19', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] };
      localStorage.setItem('bp-scores', JSON.stringify({ s1c0: score }));
      render(<BadmintonPlanner />);
      await startNextVisibleGame(user);
      await startNextVisibleGame(user);
      const before = stored('bp-result');
      await user.click(within(sectionFor('Current game')).getAllByTitle('Edit who plays in this slot')[0]!);
      await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'P9');
      await user.click(screen.getAllByRole('button', { name: command })[0]!);
      expect(stored('bp-result')).not.toEqual(before);
      await user.click(undo());
      expect(stored('bp-result')).toEqual(before);
      expect(stored('bp-scores')).toEqual({ s1c0: score });
      await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(2);
      expect(sectionFor('Current game')).toHaveTextContent('P1');
      expect(undo()).toBeDisabled();
    });

    it('undoes a scored finish together with win/loss and automatic promotion', async () => {
      const user = userEvent.setup();
      localStorage.setItem('bp-scores', JSON.stringify({ s1c0: { a: '21', b: '', applied: false, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] } }));
      render(<BadmintonPlanner />);
      await startNextVisibleGame(user);
      const before = stored('bp-result');
      const scores = stored('bp-scores');
      fireEvent.change(within(sectionFor('Current game')).getAllByRole('spinbutton')[1]!, { target: { value: '19' } });
      expect(stored('bp-winloss').P1.wins).toBe(1);
      await user.click(undo());
      expect(stored('bp-result')).toEqual(before);
      expect(stored('bp-scores')).toEqual(scores);
      expect(stored('bp-winloss')).toEqual({});
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(1);
      expect(undo()).toBeDisabled();
    });
  });

  describe('mid-session changes', () => {
    function seed(courts = 2, roster?: Player[]) {
      const players: Player[] = roster ?? Array.from({ length: 24 }, (_, i) => ({ name: `P${i + 1}`, gender: 'M', availFrom: 0, availTo: 5 }));
      const plan = generateSchedule(players, 6, Array(6).fill(courts), 0, null, null, {}, () => 0.5)!;
      localStorage.setItem('bp-players', JSON.stringify(players));
      localStorage.setItem('bp-result', JSON.stringify(plan));
      localStorage.setItem('bp-totalMinutes', '90');
      localStorage.setItem('bp-numCourts', JSON.stringify(courts));
      localStorage.setItem('bp-staggerMode', JSON.stringify('custom'));
      return plan;
    }
    const stored = (key: string) => JSON.parse(localStorage.getItem(key)!);
    const lane = (n: number) => screen.getByRole('region', { name: `Court ${n}` });
    const availability = (name: string) => within(screen.getByRole('group', { name: `Availability for ${name}` }));
    async function start(user: ReturnType<typeof userEvent.setup>, count: number) {
      for (let i = 0; i < count; i++) await startNextVisibleGame(user);
    }

    it.each(['Here now', 'Leaving', 'Add court', 'Remove court', 'Setup Apply'])(
      'undo restores schedule, availability, scores, notice and confirmation archive after %s', async command => {
        const user = userEvent.setup();
        seed(2, Array.from({ length: 24 }, (_, i) => ({ name: `P${i + 1}`, gender: 'M', availFrom: i === 23 ? 4 : 0, availTo: 5 })));
        localStorage.setItem('bp-is-confirmed', 'true');
        localStorage.setItem('bp-scores', JSON.stringify({ s1c0: { a: '21', b: '18', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] } }));
        render(<BadmintonPlanner />);
        await start(user, 2);
        const keys = ['bp-result', 'bp-players', 'bp-courtOverrides', 'bp-scores', 'bp-saved-plans', 'bp-is-confirmed'];
        const before = keys.map(stored);
        const lanes = [lane(1).textContent, lane(2).textContent];
        if (command === 'Setup Apply') {
          await user.click(screen.getByRole('button', { name: 'Setup' }));
          await user.click(screen.getByRole('button', { name: '3C' }));
          await user.click(screen.getByRole('button', { name: 'Apply' }));
        } else if (command === 'Here now' || command === 'Leaving') {
          await user.click(availability(command === 'Here now' ? 'P24' : 'P1').getByRole('button', { name: command }));
        } else await user.click(screen.getByRole('button', { name: command }));
        await user.click(screen.getByRole('button', { name: 'Update upcoming games' }));
        expect(stored('bp-result')).not.toEqual(before[0]);
        await user.click(screen.getByRole('button', { name: 'Undo last action' }));
        expect(keys.map(stored)).toEqual(before);
        expect(screen.queryByRole('status', { name: 'Session change' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Undo last action' })).toBeDisabled();
        // Undo restores the pending confirmation as well as the session data.
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await user.click(screen.getByRole('button', { name: 'Live session' }));
        expect([lane(1).textContent, lane(2).textContent]).toEqual(lanes);
      },
    );

    it.each([2, 3, 4, 5])('changes %i courts future-only from Live and Setup, retaining scores and next-game capacity', async courts => {
      const user = userEvent.setup();
      const original = seed(courts);
      const score = { a: '21', b: '18', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] };
      localStorage.setItem('bp-scores', JSON.stringify({ s1c0: score }));
      render(<BadmintonPlanner />);
      await start(user, courts);
      const lineups = Array.from({ length: courts }, (_, i) => lane(i + 1).textContent);
      const target = courts === 5 ? 4 : courts + 1;
      await user.click(screen.getByRole('button', { name: courts === 5 ? 'Remove court' : 'Add court' }));
      expect(stored('bp-courtOverrides')).toEqual({ 2: target });
      expect(stored('bp-numCourts')).toBe(courts);
      expect(stored('bp-result').schedule[0]).toEqual(original.schedule[0]);
      expect(stored('bp-scores')).toEqual({ s1c0: score });
      for (let i = 0; i < courts; i++) expect(lane(i + 1).textContent).toBe(lineups[i]);
      expect(sectionFor('Next game').querySelectorAll('.schedule-grid > div')).toHaveLength(target);
      expect(screen.getByRole('status', { name: 'Session change' })).toHaveTextContent(`slot 2. ${target} courts`);
      await user.click(screen.getByRole('button', { name: 'Setup' }));
      await user.click(screen.getByRole('button', { name: 'Remove court' }));
      expect(stored('bp-courtOverrides')).toEqual({ 2: target - 1 });
      expect(stored('bp-result').schedule[0]).toEqual(original.schedule[0]);
      expect(stored('bp-scores')).toEqual({ s1c0: score });
    });

    it('applies Here now, Leaving and return to upcoming games without changing current lineups', async () => {
      const user = userEvent.setup();
      seed(3, Array.from({ length: 12 }, (_, i) => ({ name: `P${i + 1}`, gender: 'M', availFrom: i === 11 ? 4 : 0, availTo: 5 })));
      const score = { a: '21', b: '17', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] };
      localStorage.setItem('bp-scores', JSON.stringify({ s1c0: score }));
      render(<BadmintonPlanner />);
      await start(user, 2);
      const before = stored('bp-result').schedule[0];
      const current = [lane(1).textContent, lane(2).textContent];
      await user.click(availability('P12').getByRole('button', { name: 'Here now' }));
      expect(stored('bp-result').schedule[0]).toEqual(before);
      expect(stored('bp-result').schedule[1].courts).toHaveLength(3);
      expect(stored('bp-result').schedule[1].courts.flatMap((c: any) => [...c.teamA, ...c.teamB]).map((p: any) => p.name)).toContain('P12');
      await user.click(availability('P1').getByRole('button', { name: 'Leaving' }));
      expect(stored('bp-result').schedule.slice(1).flatMap((s: any) => s.courts.flatMap((c: any) => [...c.teamA, ...c.teamB])).some((p: any) => p.name === 'P1')).toBe(false);
      expect(lane(1).textContent).toBe(current[0]);
      expect(lane(2).textContent).toBe(current[1]);
      expect(stored('bp-scores')).toEqual({ s1c0: score });
      expect(screen.getByRole('status', { name: 'Session change' })).toHaveTextContent(/P1 leaving from slot 2/);
      await user.click(availability('P1').getByTitle('Restore player to session'));
      expect(stored('bp-players').find((p: any) => p.name === 'P1').leavesAt).toBeNull();
      expect(stored('bp-result').schedule[1].courts).toHaveLength(3);
    });

    it('preserves completed and pulled-up games and their scores during a later capacity change', async () => {
      const user = userEvent.setup();
      seed();
      const score = { a: '21', b: '17', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] };
      localStorage.setItem('bp-scores', JSON.stringify({ s1c0: score }));
      render(<BadmintonPlanner />);
      await start(user, 2);
      await user.click(within(lane(1)).getByRole('button', { name: 'Finish game' }));
      const substitute = screen.queryByRole('button', { name: 'Substitute unavailable players' });
      if (substitute) await user.click(substitute);
      expect(screen.getByRole('button', { name: 'Past games (1)' })).toBeInTheDocument();
      const before = stored('bp-result');
      const lineups = [lane(1).textContent, lane(2).textContent];
      await user.click(screen.getByRole('button', { name: 'Add court' }));
      expect(stored('bp-courtOverrides')).toEqual({ 3: 3 });
      expect(stored('bp-result').schedule.slice(0, 2)).toEqual(before.schedule.slice(0, 2));
      expect(lane(1).textContent).toBe(lineups[0]);
      expect(lane(2).textContent).toBe(lineups[1]);
      expect(stored('bp-scores')).toEqual({ s1c0: score });
      expect(sectionFor('Next game').querySelectorAll('.schedule-grid > div')).toHaveLength(3);
      await user.click(screen.getByRole('button', { name: 'Past games (1)' }));
      expect(screen.getByText(/Game 1.*Slot 1.*Court 1/)).toBeInTheDocument();
      expect(screen.getByText('21–17')).toBeInTheDocument();
    });

    describe.each(['Setup Apply', 'Add court', 'Remove court'] as const)('confirmed %s auto-archive', command => {
      it.each(['success', 'cancel', 'failure'] as const)('archives only a successful confirmation: %s', async outcome => {
        const user = userEvent.setup();
        const original = seed();
        const existing = [{ id: 7, tag: 'Existing plan', result: original, savedAt: new Date().toISOString() }];
        localStorage.setItem('bp-saved-plans', JSON.stringify(existing));
        localStorage.setItem('bp-is-confirmed', 'true');
        render(<BadmintonPlanner />);
        await start(user, 2);
        const liveBefore = [lane(1).textContent, lane(2).textContent];
        const request = async () => {
          if (command === 'Setup Apply') {
            await user.click(screen.getByRole('button', { name: 'Setup' }));
            await user.click(screen.getByRole('button', { name: '3C' }));
            await user.click(screen.getByRole('button', { name: 'Apply' }));
          } else await user.click(screen.getByRole('button', { name: command }));
        };
        await request();
        expect(stored('bp-saved-plans')).toEqual(existing);
        if (outcome === 'cancel') {
          await user.click(screen.getByRole('button', { name: 'Cancel' }));
        } else {
          // Simulate the scheduler's null failure contract, not the archive callback.
          if (outcome === 'failure') vi.spyOn(scheduler, 'generateSchedule').mockReturnValueOnce(null);
          await user.click(screen.getByRole('button', { name: 'Update upcoming games' }));
        }
        if (outcome !== 'success') {
          expect(stored('bp-saved-plans')).toEqual(existing);
          expect(stored('bp-result')).toEqual(original);
          expect(stored('bp-is-confirmed')).toBe(true);
          if (outcome === 'failure') expect(screen.getByRole('status', { name: 'Session change' })).toHaveTextContent('Unable to update');
          // A retry archives once, not once for the failed/cancelled attempt too.
          await request();
          await user.click(screen.getByRole('button', { name: 'Update upcoming games' }));
        }
        const saved = stored('bp-saved-plans');
        expect(saved).toHaveLength(2);
        expect(saved[0]).toMatchObject({ tag: '', result: original });
        expect(saved.slice(1)).toEqual(existing);
        expect(stored('bp-is-confirmed')).toBe(false);
        expect(stored('bp-result').schedule[0]).toEqual(original.schedule[0]);
        expect(stored('bp-courtOverrides')).toEqual({ 2: command === 'Remove court' ? 1 : 3 });
        expect(lane(1).textContent).toBe(liveBefore[0]);
        expect(lane(2).textContent).toBe(liveBefore[1]);
        expect(screen.getByRole('button', { name: 'Saved plans (2)' })).toBeInTheDocument();
        // Subsequent unconfirmed updates must not archive again.
        await request();
        expect(stored('bp-saved-plans')).toEqual(saved);
      });
    });

    it('cancels a confirmed change without mutation and confirms only future games', async () => {
      const user = userEvent.setup();
      seed();
      localStorage.setItem('bp-is-confirmed', 'true');
      render(<BadmintonPlanner />);
      await start(user, 2);
      const before = localStorage.getItem('bp-result');
      await user.click(screen.getByRole('button', { name: 'Add court' }));
      const dialog = screen.getByRole('dialog', { name: 'Update upcoming games?' });
      expect(dialog).toHaveTextContent(/slot 2.*3 courts/);
      expect(localStorage.getItem('bp-result')).toBe(before);
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(localStorage.getItem('bp-result')).toBe(before);
      expect(stored('bp-is-confirmed')).toBe(true);
      await user.click(screen.getByRole('button', { name: 'Add court' }));
      await user.click(screen.getByRole('button', { name: 'Update upcoming games' }));
      expect(stored('bp-is-confirmed')).toBe(false);
      expect(stored('bp-courtOverrides')).toEqual({ 2: 3 });
      expect(stored('bp-result').schedule[0]).toEqual(JSON.parse(before!).schedule[0]);
    });

    it('cancels a confirmed departure with Escape before applying it to future games', async () => {
      const user = userEvent.setup();
      seed();
      localStorage.setItem('bp-is-confirmed', 'true');
      render(<BadmintonPlanner />);
      await start(user, 2);
      const rosterBefore = stored('bp-players');
      const scheduleBefore = stored('bp-result');
      await user.click(availability('P1').getByRole('button', { name: 'Leaving' }));
      expect(screen.getByRole('dialog', { name: 'Update upcoming games?' })).toHaveTextContent('P1 leaving from slot 2');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(stored('bp-players')).toEqual(rosterBefore);
      expect(stored('bp-result')).toEqual(scheduleBefore);
      expect(stored('bp-is-confirmed')).toBe(true);
      await user.click(availability('P1').getByRole('button', { name: 'Leaving' }));
      await user.click(screen.getByRole('button', { name: 'Update upcoming games' }));
      expect(stored('bp-is-confirmed')).toBe(false);
      expect(stored('bp-players')[0].leavesAt).toBe(0);
      expect(stored('bp-result').schedule[0]).toEqual(scheduleBefore.schedule[0]);
    });

    it('applies selected Setup capacity through the same confirmation and future-only boundary', async () => {
      const user = userEvent.setup();
      seed();
      localStorage.setItem('bp-is-confirmed', 'true');
      render(<BadmintonPlanner />);
      await start(user, 2);
      const before = stored('bp-result').schedule.slice(0, 3);
      await user.click(screen.getByRole('button', { name: 'Setup' }));
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Regenerate from slot' }), { target: { value: '4' } });
      await user.click(screen.getByRole('button', { name: '4C' }));
      await user.click(screen.getByRole('button', { name: 'Apply' }));
      const dialog = screen.getByRole('dialog', { name: 'Update upcoming games?' });
      expect(dialog).toHaveTextContent(/slot 4.*4 courts/);
      await user.click(within(dialog).getByRole('button', { name: 'Update upcoming games' }));
      expect(stored('bp-result').schedule.slice(0, 3)).toEqual(before);
      expect(stored('bp-courtOverrides')).toEqual({ 4: 4 });
    });

    it('explains unfilled future courts without dropping the current game', async () => {
      const user = userEvent.setup();
      seed(1, Array.from({ length: 4 }, (_, i) => ({ name: `P${i + 1}`, gender: 'M', availFrom: 0, availTo: 5 })));
      render(<BadmintonPlanner />);
      await start(user, 1);
      await user.click(availability('P1').getByRole('button', { name: 'Leaving' }));
      expect(within(sectionFor('Next game')).getByText(/fewer than four eligible players/i)).toBeInTheDocument();
      expect(within(lane(1)).getByRole('button', { name: 'Finish game' })).toBeEnabled();
    });

    it('disables future changes while the final slot stays live', async () => {
      const user = userEvent.setup();
      const plan = seed(1);
      localStorage.setItem('bp-result', JSON.stringify({ ...plan, schedule: plan.schedule.slice(0, 1) }));
      localStorage.setItem('bp-totalMinutes', '15');
      render(<BadmintonPlanner />);
      await start(user, 1);
      expect(screen.getByRole('button', { name: 'Add court' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Remove court' })).toBeDisabled();
      expect(availability('P1').getByRole('button', { name: 'Leaving' })).toBeDisabled();
      expect(within(lane(1)).getByRole('button', { name: 'Finish game' })).toBeEnabled();
    });

    it.each(['import', 'saved'] as const)('clears previous session overrides on %s load', async source => {
      const user = userEvent.setup();
      const plan = seed();
      localStorage.setItem('bp-courtOverrides', JSON.stringify({ 1: 5 }));
      localStorage.setItem('bp-saved-plans', JSON.stringify([{ id: 7, tag: 'Replacement', result: plan, savedAt: new Date().toISOString() }]));
      render(<BadmintonPlanner />);
      await user.click(screen.getByRole('button', { name: 'Remove court' }));
      expect(screen.getByRole('status', { name: 'Session change' })).toBeInTheDocument();
      if (source === 'saved') {
        await user.click(screen.getByRole('button', { name: 'Saved plans (1)' }));
        await user.click(screen.getByRole('button', { name: 'Load' }));
      } else {
        await user.click(screen.getByRole('button', { name: 'Setup' }));
        await user.click(screen.getByRole('button', { name: 'Import' }));
        await user.type(screen.getByPlaceholderText(/Badminton Schedule/), '--- Slot 1 (~0-15m) ---\n  P1 & P2  vs  P3 & P4');
        await user.click(within(screen.getByText('Import schedule from text').parentElement!).getByRole('button', { name: 'Import' }));
      }
      expect(stored('bp-courtOverrides')).toEqual({});
      expect(screen.queryByRole('status', { name: 'Session change' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add court' })).toBeEnabled();
    });
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
      localStorage.setItem('bp-courtOverrides', JSON.stringify({ 1: 5 }));
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
      expect(JSON.parse(localStorage.getItem('bp-courtOverrides')!)).toEqual({ 1: 5 });
      expect(screen.getByRole('button', { name: 'Remove court' })).toBeDisabled();

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
    localStorage.setItem('bp-courtOverrides', JSON.stringify({ 1: 5 }));
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
    expect(JSON.parse(localStorage.getItem('bp-courtOverrides')!)).toEqual({});
  });

  it('re-rolls from Setup into Live session with all initial courts live', async () => {
    const user = userEvent.setup();
    localStorage.setItem('bp-courtOverrides', JSON.stringify({ 1: 5 }));
    render(<BadmintonPlanner />);
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: 'Re-roll' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Live session' })).toHaveAttribute('aria-current', 'page');
      expect(within(sectionFor('Current game')).getAllByText('● LIVE')).toHaveLength(2);
    });
    expect(JSON.parse(localStorage.getItem('bp-courtOverrides')!)).toEqual({});
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
    localStorage.setItem('bp-courtOverrides', JSON.stringify({ 1: 5 }));
    render(<BadmintonPlanner />);
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Generate \(3 slots\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Live session' })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem('bp-courtOverrides')!)).toEqual({});
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

  it('preserves unsaved setup selections and bank drafts across a visit to Live', async () => {
    const user = userEvent.setup();
    localStorage.setItem('bp-player-history', JSON.stringify([{ name: 'Bank guest', gender: 'M', level: 2 }]));
    render(<BadmintonPlanner />);
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByText('Session settings'));
    await user.selectOptions(screen.getByLabelText('Preferred pairing first player'), 'P1');
    await user.selectOptions(screen.getByLabelText('Preferred pairing second player'), 'P2');
    await user.click(screen.getByText('Players (12)'));
    await user.click(screen.getByTitle('Select Bank guest'));
    const bankDraft = screen.getByPlaceholderText("Add to bank (not today's roster)");
    await user.type(bankDraft, 'Draft guest');
    await user.click(within(bankDraft.parentElement!).getByRole('button', { name: '♀' }));

    await user.click(screen.getByRole('button', { name: 'Live session' }));
    expect(screen.getByRole('button', { name: 'Live session' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Live session board' })).toBeVisible();
    expect(screen.queryByPlaceholderText("Add to bank (not today's roster)")).not.toBeInTheDocument();
    expect(screen.queryByTitle('Deselect Bank guest')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preferred pairing first player')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-roll' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByText('Session settings'));
    await user.click(screen.getByText('Players (12)'));
    expect.soft(screen.getByLabelText('Preferred pairing first player')).toHaveValue('P1');
    expect.soft(screen.getByLabelText('Preferred pairing second player')).toHaveValue('P2');
    expect.soft(screen.getByPlaceholderText("Add to bank (not today's roster)")).toHaveValue('Draft guest');
    expect.soft(screen.queryByTitle('Deselect Bank guest')).toBeInTheDocument();
    expect.soft(screen.queryByRole('button', { name: 'Add Selected (1)' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('bp-preferred-pairs')!)).toEqual([]);
    await user.click(screen.getByRole('button', { name: '+ Bank' }));
    expect(JSON.parse(localStorage.getItem('bp-player-history')!)).toContainEqual(expect.objectContaining({ name: 'Draft guest', gender: 'F' }));
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
