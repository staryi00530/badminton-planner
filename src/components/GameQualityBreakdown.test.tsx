// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { scoreGameQuality } from '../utils/gameQuality';
import type { Court } from '../algorithm/types';
import GameQualityBreakdown from './GameQualityBreakdown';

it('expands signed component points whose sum matches the actual assessment', () => {
  const players = ['A', 'B', 'C', 'D'].map((name, i) => ({ name, gender: 'M' as const, level: i === 0 ? 4 as const : 3 as const, availFrom: 0, availTo: 2 }));
  const court: Court = { court: 1, teamA: [players[0]!, players[1]!], teamB: [players[2]!, players[3]!] };
  const quality = scoreGameQuality(court, { players, slot: 1, history: [court], preferredPairs: [['A', 'B']] });
  render(<GameQualityBreakdown quality={quality} />);
  expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
  const details = screen.getByLabelText('Game quality breakdown') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByText('+15')).toBeInTheDocument();
  expect(screen.getAllByText('-4')).toHaveLength(2);
  expect(screen.getByText('-6')).toBeInTheDocument();
  expect(screen.getByText('+12')).toBeInTheDocument();
  expect(screen.getByText(`Total: ${quality.score} points`)).toBeInTheDocument();
  expect(screen.getByText(/Waiting priority is separate/)).toBeInTheDocument();
});
