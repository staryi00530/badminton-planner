import { usePlayerRoster } from '../hooks/usePlayerRoster';
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Player } from '../algorithm/types';
import PlayerList from './PlayerList';

// Deliberately out of alphabetical/gender order, and with the original array
// index (used by every handler below) different from the eventual display
// position — this is the exact regression the sorted-index refactor risks.
const PLAYERS: Player[] = [
  { name: 'Zoe', gender: 'F', availFrom: 0, availTo: 12 },   // index 0
  { name: 'Bob', gender: 'M', availFrom: 0, availTo: 12 },   // index 1
  { name: 'Alice', gender: 'F', availFrom: 0, availTo: 12 }, // index 2
  { name: 'Tom', gender: 'M', availFrom: 0, availTo: 12 },   // index 3
];

function renderPlayerList(overrides = {}) {
  const handlers = {
    setNameInput: vi.fn(),
    setGenderInput: vi.fn(),
    addPlayer: vi.fn(),
    addImportedPlayers: vi.fn(),
    addSelectedFromBank: vi.fn(),
    addToBank: vi.fn(),
    removeFromHistory: vi.fn(),
    loadDefaults: vi.fn(),
    resetPlayers: vi.fn(),
    clearPlayers: vi.fn(),
    clearWinLoss: vi.fn(),
    updatePlayer: vi.fn(),
    removePlayer: vi.fn(),
  };
  render(
    <PlayerList
      players={PLAYERS}
      playerHistory={[]}
      winLoss={{}}
      staggerMode="none"
      totalSlots={12}
      nameInput=""
      genderInput="M"
      allDefaultsLoaded={true}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

describe('PlayerList — gender-grouped alphabetical display', () => {
  it('previews pasted names, detects gender markers, and switches an unavailable guest to its fallback', async () => {
    const user = userEvent.setup();
    const handlers = renderPlayerList();
    await user.click(screen.getByText('Paste roster'));
    await user.type(screen.getByLabelText('Paste attendee list'), 'Wednesday 10/21 8:30pm–11:30pm\n1. New man 🙋‍♂️\n2. Alice\n3. Yiwei +1 (Siya)');
    await user.selectOptions(screen.getByLabelText('Default gender for unmarked names'), 'F');
    await user.click(screen.getByRole('button', { name: 'Preview names' }));

    expect(screen.getByLabelText('Gender for New man')).toHaveValue('M');
    expect(screen.getByText('Already on roster')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Guest named; uncheck to use Yiwei +1'));
    expect(screen.getByText('Yiwei +1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replace roster with 3 players' }));

    expect(handlers.addImportedPlayers).toHaveBeenCalledWith([
      { name: 'New man', gender: 'M', level: 3 },
      { name: 'Alice', gender: 'F', level: 3 },
      { name: 'Yiwei +1', gender: 'F', level: 3 },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Roster replaced with 3 players.');
  });

  it('allows replacing a roster with a subset of players already present', async () => {
    const user = userEvent.setup();
    const handlers = renderPlayerList();
    await user.click(screen.getByText('Paste roster'));
    await user.type(screen.getByLabelText('Paste attendee list'), '1. Alice');
    await user.click(screen.getByRole('button', { name: 'Preview names' }));
    await user.click(screen.getByRole('button', { name: /^Replace roster with 1 player$/ }));
    expect(handlers.addImportedPlayers).toHaveBeenCalledWith([{ name: 'Alice', gender: 'F', level: 3 }]);
  });

  it('keeps an active roster compact while preserving bank and original-index actions', async () => {
    const user = userEvent.setup();
    const handlers = renderPlayerList({
      scheduleActive: true,
      showPrivateFields: false,
      playerHistory: [{ name: 'Bank player', gender: 'M', level: 2 }],
    });
    const summary = screen.getByText('Players (4)');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByPlaceholderText('Player name')).not.toBeVisible();
    await user.click(summary);
    expect(screen.getByPlaceholderText('Player name')).toBeVisible();
    expect(screen.queryByTitle('Private level used for balancing')).not.toBeInTheDocument();
    await user.click(screen.getByTitle('Select Bank player'));
    await user.click(summary);
    await user.click(summary);
    await user.click(screen.getByRole('button', { name: 'Add Selected (1)' }));
    expect(handlers.addSelectedFromBank).toHaveBeenCalledWith([{ name: 'Bank player', gender: 'M', level: 2 }]);
    await user.click(within(screen.getByText('Zoe').closest('div')!).getByRole('button', { name: '×' }));
    expect(handlers.removePlayer).toHaveBeenCalledWith(0);
  });

  it('renders players grouped M then F, alphabetical within each group', () => {
    renderPlayerList();
    expect(screen.getByText('Players (4)').closest('details')).toHaveAttribute('open');
    const names = screen.getAllByText(/^(Zoe|Bob|Alice|Tom)$/).map(el => el.textContent);
    expect(names).toEqual(['Bob', 'Tom', 'Alice', 'Zoe']);
  });

  it('shows an M group header before an F group header', () => {
    renderPlayerList();
    const mHeader = screen.getAllByText('M').find(element => element.tagName === 'P')!;
    const fHeader = screen.getAllByText('F').find(element => element.tagName === 'P')!;
    expect(mHeader.compareDocumentPosition(fHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('orders the player bank by gender and then alphabetically', () => {
    renderPlayerList({
      playerHistory: [
        { name: 'Zed', gender: 'F', level: 2 },
        { name: 'Maya', gender: 'F', level: 2 },
        { name: 'Zack', gender: 'M' , level: 2 },
        { name: 'Aaron', gender: 'M', level: 2 },
      ],
    });

    const bank = screen.getByText('Player bank').parentElement!;
    const names = ['Aaron', 'Zack', 'Maya', 'Zed'];
    const positions = names.map(name => within(bank).getByRole('button', { name: new RegExp(`\\+ ${name}`) }));
    expect(positions[0]!.compareDocumentPosition(positions[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(positions[1]!.compareDocumentPosition(positions[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(positions[2]!.compareDocumentPosition(positions[3]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('removing a player by its displayed row calls removePlayer with the ORIGINAL array index, not the display position', async () => {
    const user = userEvent.setup();
    const handlers = renderPlayerList();

    // "Zoe" displays last (position 3) but is players[0] — the classic
    // index-mismatch bug this component's sort refactor could reintroduce.
    const zoeRow = screen.getByText('Zoe').closest('div');
    const removeBtn = within(required(zoeRow)).getByRole('button', { name: '×' });
    await user.click(removeBtn);

    expect(handlers.removePlayer).toHaveBeenCalledWith(0);
  });

  it('editing a player name targets the original array index', async () => {
    const user = userEvent.setup();
    const handlers = renderPlayerList();

    // "Alice" displays 3rd (position 2) but is players[2] in this fixture —
    // pick "Tom" instead, which displays 2nd (position 1) but is players[3].
    const tomSpan = screen.getByText('Tom');
    await user.click(tomSpan);
    const input = screen.getByDisplayValue('Tom');
    await user.type(input, '!');

    expect(handlers.updatePlayer).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(handlers.updatePlayer).toHaveBeenCalledTimes(1);
    expect(handlers.updatePlayer).toHaveBeenCalledWith(3, 'name', 'Tom!');
  });
});

it('offers five private levels and moves a roster player to quarantine by original index', async () => {
  const user = userEvent.setup();
  const togglePlayerQuarantined = vi.fn();
  renderPlayerList({ showPrivateFields: true, togglePlayerQuarantined });
  const row = screen.getByText('Zoe').closest('div')!;
  expect(within(row).getByRole('button', { name: '5' })).toBeInTheDocument();
  await user.click(within(row).getByRole('button', { name: 'Quarantine Zoe' }));
  expect(togglePlayerQuarantined).toHaveBeenCalledWith(0);
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected test element to exist');
  return value;
}

it('reviews ignored scheduling notes and supports explicit identity mapping', async () => {
 const user=userEvent.setup(); const h=renderPlayerList({playerHistory:[{id:'alice',name:'Alice',gender:'F',aliases:['Al']}]});
 await user.click(screen.getByText('Paste roster'));
 await user.type(screen.getByLabelText('Paste attendee list'),'Al\n4th court at 9:30');
 await user.click(screen.getByRole('button',{name:'Preview names'}));
 expect(screen.getByLabelText('Map Al')).toBeInTheDocument();
 expect(screen.getByLabelText('Map 4th court at 9:30')).toHaveValue('ignore');
 await user.click(screen.getByRole('button',{name:'Replace roster with 1 player'}));
 expect(h.addImportedPlayers.mock.calls[0]![0][0]).toMatchObject({id:'alice',name:'Alice',aliases:['Al']});
});

it('keeps the existing roster when every preview line is ignored',async()=>{
 const user=userEvent.setup();const h=renderPlayerList();
 await user.click(screen.getByText('Paste roster'));await user.type(screen.getByLabelText('Paste attendee list'),'4th court at 9:30');
 await user.click(screen.getByRole('button',{name:'Preview names'}));
 expect(screen.getByRole('button',{name:'Replace roster with 0 players'})).toBeDisabled();
 expect(screen.getByText('No players selected. The existing roster will be kept.')).toBeInTheDocument();
 expect(h.addImportedPlayers).not.toHaveBeenCalled();
});
it('requires an explicit choice for an ambiguous alias',async()=>{
 const user=userEvent.setup();const h=renderPlayerList({players:[],playerHistory:[{id:'a',name:'Alice',gender:'F',aliases:['Al']},{id:'b',name:'Alan',gender:'M',aliases:['Al']}]});
 await user.click(screen.getByText('Paste roster'));await user.type(screen.getByLabelText('Paste attendee list'),'Al');await user.click(screen.getByRole('button',{name:'Preview names'}));
 expect(screen.getByLabelText('Map Al')).toHaveValue('unresolved');
 expect(screen.getByText(/Multiple saved players match/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Replace roster with 1 player'})).toBeDisabled();
 await user.selectOptions(screen.getByLabelText('Map Al'),'new');
 expect(screen.getByRole('button',{name:'Replace roster with 1 player'})).toBeEnabled();
 await user.click(screen.getByRole('button',{name:'Replace roster with 1 player'}));
 expect(h.addImportedPlayers.mock.calls[0]![0][0]).toMatchObject({name:'Al',id:expect.any(String)});
});

it('cancels name edits with Escape and validates empty or duplicate names before committing',async()=>{
 const user=userEvent.setup();const h=renderPlayerList();
 await user.click(screen.getByText('Alice'));let input=screen.getByDisplayValue('Alice');
 await user.clear(input);await user.type(input,'Alicia');await user.keyboard('{Escape}');
 expect(h.updatePlayer).not.toHaveBeenCalled();expect(screen.getByText('Alice')).toBeInTheDocument();
 await user.click(screen.getByText('Alice'));input=screen.getByDisplayValue('Alice');await user.clear(input);await user.keyboard('{Enter}');
 expect(screen.getByRole('alert')).toHaveTextContent('Enter a player name.');expect(h.updatePlayer).not.toHaveBeenCalled();
 await user.type(input,'Bob');await user.keyboard('{Enter}');
 expect(screen.getByRole('alert')).toHaveTextContent('A player with this name is already on the roster.');expect(h.updatePlayer).not.toHaveBeenCalled();
 await user.clear(input);await user.type(input,' Alicia ');await user.tab();
 expect(h.updatePlayer).toHaveBeenCalledTimes(1);expect(h.updatePlayer).toHaveBeenCalledWith(2,'name','Alicia');
});

it('sends only the final rename through the roster metadata callback',async()=>{
 const user=userEvent.setup();const onPlayerMetadataChange=vi.fn(()=>({}));const patchState=vi.fn();
 const {result}=renderHook(()=>usePlayerRoster({players:PLAYERS,playerHistory:[],nameInput:'',genderInput:'M',totalSlots:12,patchState,onPlayerMetadataChange}));
 renderPlayerList({updatePlayer:result.current.updatePlayer});
 await user.click(screen.getByText('Alice'));const input=screen.getByDisplayValue('Alice');
 await user.clear(input);await user.type(input,'Alicia');expect(onPlayerMetadataChange).not.toHaveBeenCalled();
 await user.keyboard('{Enter}');expect(onPlayerMetadataChange).toHaveBeenCalledTimes(1);
 expect(onPlayerMetadataChange.mock.calls[0]).toEqual([PLAYERS[2],expect.objectContaining({name:'Alicia',aliases:['Alice'],statsKey:'Alice'})]);
});
