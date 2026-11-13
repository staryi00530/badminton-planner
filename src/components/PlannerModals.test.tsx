// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmOverwriteModal, ShareLinkModal } from './PlannerModals';

it('separates the live player link from the organizing iPad link', async () => {
  const copyOrganizerUrl = vi.fn();
  const props = { sharedUrl:"https://example.com/beta/?share=session&view=players", copiedShareUrl:false, shareIsUpdate:false, hasExisting:true, copyShareUrl:vi.fn(), copyOrganizerUrl, newShareLink:vi.fn(), close:vi.fn() };
  const {rerender} = render(<ShareLinkModal {...props} />);
  expect(screen.getByRole('textbox',{name:'Player link'})).toHaveValue('https://example.com/beta/?share=session&view=players');
  expect(screen.getByRole('textbox',{name:'Organizer session link'})).toHaveValue('https://example.com/beta/?share=session');
  expect(screen.getByText(/publish automatically while this device stays/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Copy organizer link'}));
  expect(copyOrganizerUrl).toHaveBeenCalledWith('https://example.com/beta/?share=session');
  rerender(<ShareLinkModal {...props} publicationStatus="paused" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Latest changes are not published');
});

it('labels fallback links as snapshots without claiming live updates', () => {
  render(<ShareLinkModal sharedUrl="https://example.com/beta/#share=encoded" copiedShareUrl={false} shareIsUpdate={false} hasExisting={false} copyShareUrl={vi.fn()} newShareLink={vi.fn()} close={vi.fn()} />);
  expect(screen.getByText('Published snapshot')).toBeInTheDocument();
  expect(screen.getByText(/does not receive live game updates/)).toBeInTheDocument();
  expect(screen.queryByRole('textbox',{name:'Player link'})).not.toBeInTheDocument();
});

it('keeps completed history by default and warns that unfinished live games are replaced', async () => {
  const confirm = vi.fn();
  render(<ConfirmOverwriteModal historyCount={3} liveCount={2} isReroll onConfirm={confirm} onCancel={vi.fn()} />);
  expect(screen.getByRole('checkbox', { name: /Reset session history/i })).not.toBeChecked();
  expect(screen.getByRole('dialog')).toHaveTextContent('3 completed games');
  expect(screen.getByRole('dialog')).toHaveTextContent('2 unfinished live games');
  await userEvent.click(screen.getByRole('button', { name: 'Keep history & reroll' }));
  expect(confirm).toHaveBeenCalledExactlyOnceWith(false);
});
it('previews partial slot budgets when keeping history and full capacity only after an explicit reset',async()=>{
  const confirm=vi.fn();
  render(<ConfirmOverwriteModal historyCount={7} isReroll rerollPreview={{nominal:[5,5,5,5],remaining:[2,3,3,5]}} onConfirm={confirm} onCancel={vi.fn()} />);
  const preview=screen.getByRole('region',{name:'Reroll capacity preview'});
  expect(preview).toHaveTextContent('13 new games');
  expect(screen.getByText(/partly played slot can show fewer new games/i)).toBeInTheDocument();
  const first=within(preview).getAllByRole('row')[1]!;
  expect(within(first).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['1','5','2']);
  await userEvent.click(screen.getByRole('checkbox',{name:/Reset session history/i}));
  expect(preview).toHaveTextContent('20 new games');
  expect(within(preview).getAllByRole('row').slice(1).map(row=>within(row).getAllByRole('cell').map(cell=>cell.textContent))).toEqual([['1','5','5'],['2','5','5'],['3','5','5']]);
  expect(confirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button',{name:'Reset history & reroll'}));
  expect(confirm).toHaveBeenCalledExactlyOnceWith(true);
});
it('previews expanded court overrides for recovery and base capacity after reset',async()=>{
  render(<ConfirmOverwriteModal historyCount={7} isReroll rerollPreview={{nominal:[3,3,4,5],remaining:[0,1,2,5],resetNominal:[3,3,3,3]}} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  const preview=screen.getByRole('region',{name:'Reroll capacity preview'});
  expect(preview).toHaveTextContent('8 new games');
  expect(within(preview).getAllByRole('row').slice(1).map(row=>within(row).getAllByRole('cell').map(cell=>cell.textContent))).toEqual([['1','3','0'],['2','3','1'],['3','4','2']]);
  await userEvent.click(screen.getByRole('checkbox',{name:/Reset session history/i}));
  expect(preview).toHaveTextContent('12 new games');
  expect(within(preview).getAllByRole('row').slice(1).map(row=>within(row).getAllByRole('cell').map(cell=>cell.textContent))).toEqual([['1','3','3'],['2','3','3'],['3','3','3']]);
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
