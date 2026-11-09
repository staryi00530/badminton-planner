// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmOverwriteModal } from './PlannerModals';

it('keeps completed history by default and warns that unfinished live games are replaced', async () => {
  const confirm = vi.fn();
  render(<ConfirmOverwriteModal historyCount={3} liveCount={2} isReroll onConfirm={confirm} onCancel={vi.fn()} />);
  expect(screen.getByRole('checkbox', { name: /Reset session history/i })).not.toBeChecked();
  expect(screen.getByRole('dialog')).toHaveTextContent('3 completed games');
  expect(screen.getByRole('dialog')).toHaveTextContent('2 unfinished live games');
  await userEvent.click(screen.getByRole('button', { name: 'Keep history & reroll' }));
  expect(confirm).toHaveBeenCalledExactlyOnceWith(false);
});
it('requires an explicit reset selection and cancellation never confirms', async () => {
  const confirm = vi.fn(), cancel = vi.fn();
  render(<ConfirmOverwriteModal historyCount={3} isReroll onConfirm={confirm} onCancel={cancel} />);
  await userEvent.click(screen.getByRole('checkbox', { name: /Reset session history/i }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Reset history & reroll' }));
  expect(confirm).toHaveBeenCalledExactlyOnceWith(true);
});
it('preserves the legacy confirmed-plan overwrite action', async () => {
  const confirm = vi.fn();
  render(<ConfirmOverwriteModal onConfirm={confirm} onCancel={vi.fn()} />);
  expect(screen.getByText('Overwrite confirmed schedule?')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
  expect(confirm).toHaveBeenCalledExactlyOnceWith();
});
