// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueuePromotionModal } from './PlannerModals';

const prompt = {
  completedCourt: 1,
  firstGame: { slot: 2, court: 0, players: ['E', 'F', 'G', 'H'] },
  blockedPlayers: ['E'],
  lookaheadGame: { slot: 2, court: 1, players: ['I', 'J', 'K', 'L'] },
  replacements: [{ replacee: 'E', replacer: 'Mindy' }],
};

describe('QueuePromotionModal', () => {
  it('offers one-lookahead promotion or substitution when the next game is blocked', async () => {
    const user = userEvent.setup();
    const onUseLookahead = vi.fn();
    const onSubstitute = vi.fn();
    render(<QueuePromotionModal prompt={prompt} onUseLookahead={onUseLookahead} onSubstitute={onSubstitute} onCancel={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Court 1 is ready' })).toBeInTheDocument();
    expect(screen.getByText(/still playing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use next playable game' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Substitute unavailable players' })).toBeInTheDocument();
    expect(screen.getByText(/Mindy/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use next playable game' }));
    expect(onUseLookahead).toHaveBeenCalledOnce();
  });

  it('only offers substitution when there is no playable one-game lookahead', () => {
    render(<QueuePromotionModal prompt={{ ...prompt, lookaheadGame: null }} onUseLookahead={vi.fn()} onSubstitute={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Use next playable game' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Substitute unavailable players' })).toBeInTheDocument();
  });
});
