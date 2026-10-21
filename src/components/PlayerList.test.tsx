// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerList from './PlayerList';

// Deliberately out of alphabetical/gender order, and with the original array
// index (used by every handler below) different from the eventual display
// position — this is the exact regression the sorted-index refactor risks.
const PLAYERS = [
  { name: 'Zoe', gender: 'F' },   // index 0
  { name: 'Bob', gender: 'M' },   // index 1
  { name: 'Alice', gender: 'F' }, // index 2
  { name: 'Tom', gender: 'M' },   // index 3
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
    await user.click(screen.getByRole('button', { name: 'Add 2 players' }));

    expect(handlers.addImportedPlayers).toHaveBeenCalledWith([
      { name: 'New man', gender: 'M', level: 2 },
      { name: 'Yiwei +1', gender: 'F', level: 2 },
    ]);
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
    const removeBtn = within(zoeRow).getByRole('button', { name: '×' });
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

    expect(handlers.updatePlayer).toHaveBeenCalledWith(3, 'name', expect.any(String));
  });
});
