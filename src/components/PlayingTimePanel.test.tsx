// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PlayedGame } from '../utils/playedHistory';
import PlayingTimePanel from './PlayingTimePanel';
import PastGamesTab from './PastGamesTab';

const players=['A','B','C','D'].map(name=>({id:name,name,gender:'M' as const,availFrom:0,availTo:4}));
const game:PlayedGame={id:'one',planId:'p',slot:1,court:0,completedAt:60_000,startedAt:0,durationMs:60_000,teamA:[players[0]!,players[1]!],teamB:[players[2]!,players[3]!],waitingIds:[]};
const result={schedule:[{slot:2,courts:[{court:1,teamA:game.teamA,teamB:game.teamB}],sitting:[],playerState:[],repeatedCourts:[]}],gamesPlayed:[]};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(90_000);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});

it('shows completed coverage and separate live time, catches up and never writes ticks to storage',()=>{
  const write=vi.spyOn(Storage.prototype,'setItem');
  const {unmount}=render(<PlayingTimePanel players={players} games={[game]} liveGames={[{slot:2,court:0,startedAt:60_000}]} result={result} />);
  expect(screen.getAllByText('01:00')).toHaveLength(8);
  expect(screen.getAllByText('00:30')).toHaveLength(4);
  vi.setSystemTime(150_000);
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getAllByText('01:30')).toHaveLength(4);
  expect(write).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
  unmount();expect(vi.getTimerCount()).toBe(0);
});
it('marks untimed games unknown instead of treating them as zero duration',()=>{
  const {startedAt:_,durationMs:__,...unknown}=game;
  render(<PlayingTimePanel players={players} games={[unknown]} liveGames={[]} result={null} />);
  expect(screen.getByText(/Timing recorded for 0 of 1/)).toBeInTheDocument();
  expect(screen.getAllByText('0 / 1 · 1 unknown')).toHaveLength(4);
  expect(screen.queryByText('00:00')).not.toBeInTheDocument();
});
it('makes totals admin-only while preserving duration in exported history',()=>{
  const onDownloadBackup=vi.fn();
  const props={result:null,players,playedGames:[game],completedGames:[],liveGames:[],scores:{},winLoss:{},onDownloadBackup};
  const {rerender}=render(<PastGamesTab {...props} />);
  expect(screen.queryByRole('region',{name:'Playing time statistics'})).not.toBeInTheDocument();
  expect(screen.getByText('Played 01:00')).toBeInTheDocument();
  rerender(<PastGamesTab {...props} isAdmin />);
  expect(screen.getByRole('region',{name:'Playing time statistics'})).toBeInTheDocument();
  screen.getByRole('button',{name:'Download history backup'}).click();
  expect(JSON.parse(onDownloadBackup.mock.calls[0]![0]).playedGames[0]).toMatchObject({startedAt:0,completedAt:60_000,durationMs:60_000});
});
