import { describe, expect, it } from 'vitest';
import { buildImportedPlayers, parseRosterPaste } from './rosterPaste';

describe('parseRosterPaste', () => {
  it('ignores headers and numbering, detects gender markers, and extracts named guests', () => {
    const entries = parseRosterPaste(`Wednesday 10/21 8:30pm–11:30pm
1. Eamon
2. yuta
15. Yiwei 🙆‍♀️
17. Yiwei 🙋‍♂️
23. Yiwei +1 (Siya)
24. Yi Wei +2 (Anthony)
——end`);

    expect(entries).toEqual([
      { name: 'Eamon', genderHint: null, isGuest: false },
      { name: 'Yuta', genderHint: null, isGuest: false },
      { name: 'Yiwei (F)', genderHint: 'F', isGuest: false },
      { name: 'Yiwei (M)', genderHint: 'M', isGuest: false },
      { name: 'Siya', genderHint: null, isGuest: true, fallbackName: 'Yiwei +1' },
      { name: 'Anthony', genderHint: null, isGuest: true, fallbackName: 'Yi Wei +2' },
    ]);
  });

  it('uses the plus-count label when no guest name is provided and ignores duplicate names', () => {
    const entries = parseRosterPaste('1) alex\n2) Alex\n3) Jamie +2');

    expect(entries).toEqual([
      { name: 'Alex', genderHint: null, isGuest: false },
      { name: 'Jamie +2', genderHint: null, isGuest: false },
    ]);
  });

  it('keeps saved player metadata, skips active names, and fills defaults for new players', () => {
    const additions = buildImportedPlayers(
      [{ name: 'Alice', gender: 'F', availFrom: 0, availTo: 8 }],
      [{ name: 'Bank player', gender: 'F', level: 3 }],
      [
        { name: 'alice', gender: 'M' },
        { name: 'Bank player', gender: 'M' },
        { name: 'New player', gender: 'M' },
      ],
      9,
    );

    expect(additions).toEqual([
      { name: 'Bank player', gender: 'F', level: 3, skill: 2, availFrom: 0, availTo: 8, group: 'full', leavesAt: null },
      { name: 'New player', gender: 'M', level: 2, skill: 2, availFrom: 0, availTo: 8, group: 'full', leavesAt: null },
    ]);
  });
});
