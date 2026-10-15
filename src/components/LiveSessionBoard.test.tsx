// @vitest-environment jsdom
import { useState, type ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Court, Player, SlotResult } from '../algorithm/types';
import LiveSessionBoard from './LiveSessionBoard';
import { useLiveQueue } from '../hooks/useLiveQueue';
import type { PlannerResult, RuntimePatch } from '../types';
import type { GameRef } from '../utils/liveQueue';

const players: Player[] = Array.from({ length: 24 }, (_, i) => ({ name: `P${i + 1}`, gender: 'M', availFrom: 0, availTo: 10 }));
const court = (number: number, names: number[]): Court => ({
  court: number,
  teamA: [players[names[0]! - 1]!, players[names[1]! - 1]!],
  teamB: [players[names[2]! - 1]!, players[names[3]! - 1]!],
});
const slot = (number: number, courts: Court[]): SlotResult => ({ slot: number, courts, sitting: [], repeatedCourts: [], playerState: [] });
const schedule = [
  slot(1, Array.from({ length: 5 }, (_, ci) => court(ci + 1, [1, 2, 3, 4].map(n => n + ci * 4)))),
  slot(2, [court(1, [5, 21, 22, 23]), court(2, [1, 2, 3, 4])]),
  slot(3, [court(1, [21, 22, 23, 24])]),
];

function props(overrides: Partial<ComponentProps<typeof LiveSessionBoard>> = {}): ComponentProps<typeof LiveSessionBoard> {
  return {
    result: { schedule, gamesPlayed: players.map(() => 1) }, players, scores: {},
    editingSlot: null, editLayout: null, isAdmin: false, scheduleRef: { current: null },
    minGames: 1, maxGames: 1, slotTime: n => `t${n}`, startSlotEdit: vi.fn(),
    applySlotEdit: vi.fn(), applySlotEditOnly: vi.fn(), cancelSlotEdit: vi.fn(),
    assignToPosition: vi.fn(), updateScore: vi.fn(), onToggleLive: vi.fn(),
    liveGames: [], completedGames: [], fromSlot: 1, liveCapacity: 5, ...overrides,
  };
}

function lane(n: number) { return screen.getByRole('region', { name: `Court ${n}` }); }
function guidance() { return within(screen.getByRole('region', { name: 'What happens now?' })); }

function InteractiveBoard({ result, completedGames }: { result: PlannerResult; completedGames: GameRef[] }) {
  const [state, setState] = useState({ result, completedGames, liveGames: [] as GameRef[], fromSlot: 1 });
  const queue = useLiveQueue({
    ...state, players, suspendedPlayerNames: [], scores: {}, courtOverrides: {}, isConfirmed: false, totalSlots: result.schedule.length,
    canPlayerJoin: true, getCourtsPerSlot: () => result.schedule.map(() => 2),
    regenerate: () => null,
    patchState: (patch: RuntimePatch) => setState(previous => ({ ...previous, ...patch, result: patch.result ?? previous.result })),
  });
  return <LiveSessionBoard {...props({ ...state, liveCapacity: 2, onToggleLive: queue.toggleLiveGame })} />;
}

describe('LiveSessionBoard', () => {
  it('offers bounded court changes from the first mutable slot and delegates the command', async () => {
    const input = props({ liveCapacity: 4, changeSlot: 2, changeCapacity: 4, onAdjustCourts: vi.fn() });
    const { rerender } = render(<LiveSessionBoard {...input} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add court' }));
    expect(input.onAdjustCourts).toHaveBeenCalledWith(2, 1);
    await userEvent.click(screen.getByRole('button', { name: 'Remove court' }));
    expect(input.onAdjustCourts).toHaveBeenCalledWith(2, -1);
    rerender(<LiveSessionBoard {...input} changeCapacity={5} />);
    expect(screen.getByRole('button', { name: 'Add court' })).toBeDisabled();
    rerender(<LiveSessionBoard {...input} changeCapacity={1} />);
    expect(screen.getByRole('button', { name: 'Remove court' })).toBeDisabled();
    rerender(<LiveSessionBoard {...input} changeSlot={4} />);
    expect(screen.getByRole('button', { name: 'Add court' })).toBeDisabled();
    expect(screen.getByText(/no upcoming slot/i)).toBeInTheDocument();
  });

  it('keeps all five physical lanes stable when a promoted game has another schedule court index', () => {
    const initial = props({ liveGames: [0, 1, 2, 3, 4].map(ci => ({ slot: 1, court: ci, displayCourt: ci })) });
    const { rerender } = render(<LiveSessionBoard {...initial} />);
    const unchanged = lane(3);
    rerender(<LiveSessionBoard {...initial} completedGames={[{ slot: 1, court: 1 }]} liveGames={[
      { slot: 1, court: 0, displayCourt: 0 }, { slot: 2, court: 0, displayCourt: 1 },
      ...[2, 3, 4].map(ci => ({ slot: 1, court: ci, displayCourt: ci })),
    ]} />);
    expect(screen.getAllByRole('region', { name: /^Court [1-5]$/ }).map(el => el.getAttribute('aria-label')))
      .toEqual(['Court 1', 'Court 2', 'Court 3', 'Court 4', 'Court 5']);
    expect(lane(3)).toBe(unchanged);
    expect(lane(2)).toHaveTextContent('P21');
    expect(lane(3)).toHaveTextContent('P9');
    expect(within(lane(2)).getByText('Court 2')).toBeInTheDocument();
  });

  it('delegates Finish game to the original game reference without mutating the board', async () => {
    const input = props({ result: { schedule: [schedule[1]!], gamesPlayed: [] }, liveCapacity: 2, completedGames: [{ slot: 2, court: 1 }], liveGames: [{ slot: 2, court: 0, displayCourt: 1 }] });
    render(<LiveSessionBoard {...input} />);
    await userEvent.click(within(lane(2)).getByRole('button', { name: 'Finish game' }));
    expect(input.onToggleLive).toHaveBeenCalledTimes(1);
    expect(input.onToggleLive).toHaveBeenCalledWith(2, 0);
    expect(within(lane(2)).getByRole('button', { name: 'Finish game' })).toBeEnabled();
    expect(guidance().getByText(/Finish game.*when.*over/i)).toBeInTheDocument();
  });

  it('offers Start game and direct instructions when a court is ready', async () => {
    const input = props();
    render(<LiveSessionBoard {...input} />);
    expect(guidance().getByText(/Court 1 is ready.*Send these four players to Court 1/)).toBeInTheDocument();
    await userEvent.click(within(lane(1)).getByRole('button', { name: 'Start game' }));
    expect(input.onToggleLive).toHaveBeenCalledTimes(1);
    expect(input.onToggleLive).toHaveBeenCalledWith(1, 0, 0);
  });

  it('keeps a ready game on its available physical court after an earlier court finishes', () => {
    render(<LiveSessionBoard {...props({
      result: { schedule: [slot(1, schedule[0]!.courts.slice(0, 2))], gamesPlayed: [] },
      liveCapacity: 2, completedGames: [{ slot: 1, court: 0 }],
    })} />);
    expect(within(lane(1)).getByText('Done')).toBeInTheDocument();
    expect(lane(2)).toHaveTextContent('P5');
    expect(within(lane(2)).getByRole('button', { name: 'Start game' })).toBeEnabled();
  });

  it.each([
    {
      name: 'the remaining scheduled Court 2 game',
      schedule: [slot(1, schedule[0]!.courts.slice(0, 2))],
      completedGames: [{ slot: 1, court: 0 }],
    },
    {
      name: 'a pending scheduled Court 1 game reassigned to Court 2',
      schedule: [slot(1, [court(1, [1, 2, 3, 4])]), slot(2, [court(1, [5, 6, 7, 8])])],
      completedGames: [],
    },
  ])('keeps $name on the advertised court after Start and rerender', async fixture => {
    render(<InteractiveBoard result={{ schedule: fixture.schedule, gamesPlayed: [] }} completedGames={fixture.completedGames} />);
    const advertisedLane = lane(2);
    for (const name of ['P5', 'P6', 'P7', 'P8']) expect(advertisedLane).toHaveTextContent(name);
    await userEvent.click(within(advertisedLane).getByRole('button', { name: 'Start game' }));
    expect(lane(2)).toBe(advertisedLane);
    expect(within(lane(2)).getByRole('button', { name: 'Finish game' })).toBeEnabled();
    for (const name of ['P5', 'P6', 'P7', 'P8']) expect(lane(2)).toHaveTextContent(name);
    expect(within(lane(1)).queryByRole('button', { name: 'Finish game' })).not.toBeInTheDocument();
    expect(lane(1)).not.toHaveTextContent('P5');
  });

  it('names every blocked player and their physical live court even beyond fromSlot', () => {
    render(<LiveSessionBoard {...props({
      liveCapacity: 2, fromSlot: 1,
      result: { schedule: [slot(3, [court(1, [5, 6, 21, 22]), court(2, [9, 10, 11, 12])])], gamesPlayed: [] },
      liveGames: [{ slot: 3, court: 1, displayCourt: 1, players: ['P5', 'P6', 'P7', 'P8'] }],
    })} />);
    expect(within(lane(1)).getByRole('button', { name: 'Waiting' })).toBeDisabled();
    expect(lane(1)).toHaveTextContent(/P5 is still playing on Court 2/);
    expect(lane(1)).toHaveTextContent(/P6 is still playing on Court 2/);
    expect(guidance().getByText(/Court 1 is waiting.*P5.*Court 2/)).toBeInTheDocument();
  });

  it('summarizes actual on-court players, available waiting players and completed games', () => {
    render(<LiveSessionBoard {...props({
      players: [...players.slice(0, 9), { ...players[9]!, availFrom: 5 }, { ...players[10]!, leavesAt: 0 }],
      staggerMode: 'custom', fromSlot: 2,
      liveGames: [{ slot: 1, court: 0, players: ['P1', 'P2', 'P3', 'P4'] }], completedGames: [{ slot: 1, court: 1 }],
    })} />);
    const summary = screen.getByRole('region', { name: 'Session summary' });
    expect(summary).toHaveTextContent(/Active courts\s*1/);
    expect(summary).toHaveTextContent(/Players on court\s*4/);
    expect(summary).toHaveTextContent(/Waiting players\s*5/);
    expect(summary).toHaveTextContent(/Completed games\s*1/);
  });

  it('shows Done lanes and no-more-games guidance at the end', () => {
    render(<LiveSessionBoard {...props({ completedGames: schedule.flatMap(s => s.courts.map((_, ci) => ({ slot: s.slot, court: ci }))) })} />);
    expect(guidance().getByText(/No more games.*session is complete/i)).toBeInTheDocument();
    expect(within(lane(5)).getByText('Done')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start game' })).not.toBeInTheDocument();
  });

  it('explains an unfilled planned court without dropping its lane', () => {
    render(<LiveSessionBoard {...props({ result: { schedule: [slot(1, [])], gamesPlayed: [] }, liveCapacity: 2 })} />);
    expect(lane(2)).toHaveTextContent(/fewer than four eligible players/i);
    expect(guidance().getByText(/fewer than four eligible players/i)).toBeInTheDocument();
  });

  it('keeps substitution guidance visible even if no queued games remain', () => {
    render(<LiveSessionBoard {...props({
      result: { schedule: [schedule[0]!], gamesPlayed: [] },
      liveGames: [0, 1, 2, 3, 4].map(ci => ({ slot: 1, court: ci })),
      queueAdjustment: {
        queuedGame: { slot: 1, court: 0, players: ['P5'] },
        promotedGame: { slot: 1, court: 0, displayCourt: 0, players: ['P21'] },
        unavailablePlayers: ['P5'], replacements: [{ court: 1, replacee: 'P5', replacer: 'P21' }],
      },
    })} />);
    expect(screen.getByText(/Court 1 updated: P21 replaced P5 because P5 is still playing/)).toBeInTheDocument();
  });

  it('keeps the physical court label while editing a promoted game', () => {
    render(<LiveSessionBoard {...props({
      liveGames: [{ slot: 2, court: 0, displayCourt: 1 }], editingSlot: 2,
      editLayout: { courts: [['P5', 'P21', 'P22', 'P23'], ['P1', 'P2', 'P3', 'P4']], sitting: [] },
    })} />);
    expect(within(lane(2)).getByText('Court 2')).toBeInTheDocument();
    expect(within(lane(2)).queryByText('Court 1')).not.toBeInTheDocument();
  });

  it('explains a temporarily unfilled court while other courts remain live', () => {
    render(<LiveSessionBoard {...props({
      result: { schedule: [slot(1, [court(1, [1, 2, 3, 4])])], gamesPlayed: [] },
      liveCapacity: 2, liveGames: [{ slot: 1, court: 0 }],
    })} />);
    expect(lane(2)).toHaveTextContent(/Waiting.*fewer than four eligible players/i);
    expect(guidance().getByText(/Court 2 is waiting/)).toBeInTheDocument();
  });

  it('counts only the currently available group as waiting', () => {
    render(<LiveSessionBoard {...props({
      players: [{ ...players[0]!, group: 'early' }, { ...players[1]!, group: 'late' }],
      staggerMode: 'group',
      result: { schedule: Array.from({ length: 10 }, (_, i) => slot(i + 1, [])), gamesPlayed: [] },
    })} />);
    expect(screen.getByRole('region', { name: 'Session summary' })).toHaveTextContent(/Waiting players\s*1/);
  });

  it('does not label a planned future court Done before it becomes available', () => {
    render(<LiveSessionBoard {...props({
      result: { schedule: [slot(1, schedule[0]!.courts.slice(0, 2)), slot(2, schedule[0]!.courts.slice(0, 3))], gamesPlayed: [] },
      liveCapacity: 2, liveGames: [{ slot: 1, court: 0 }, { slot: 1, court: 1 }],
    })} />);
    expect(lane(3)).toHaveTextContent(/Waiting.*not available in the current slot/i);
    expect(guidance().getByText(/Finish game.*when.*over/i)).toBeInTheDocument();
  });
});
