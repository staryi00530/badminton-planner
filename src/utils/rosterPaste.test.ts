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

    expect(additions).toMatchObject([
      { name: 'Bank player', gender: 'F', level: 3, skill: 2, availFrom: 0, availTo: 8, group: 'full', leavesAt: null },
      { name: 'New player', gender: 'M', level: 3, skill: 2, availFrom: 0, availTo: 8, group: 'full', leavesAt: null },
    ]);
  });
});

describe('identity-aware import', () => {
 it('ignores scheduling instructions as players', () => { expect(parseRosterPaste('Alice\n4th court at 9:30').map(p=>p.name)).toEqual(['Alice']); });
 it('deduplicates aliases mapped to one saved identity', () => {
 const result=buildImportedPlayers([], [{id:'a',name:'Alice',gender:'F',aliases:['Al'],level:5,quarantined:true}], [{name:'Al',gender:'M'},{id:'a',name:'Alice',gender:'M'}],8);
 expect(result).toHaveLength(1); expect(result[0]).toMatchObject({id:'a',name:'Alice',level:5,quarantined:true,aliases:['Al']});
 });
});

it('does not add an alias for an identity already active',()=>{
 expect(buildImportedPlayers([{id:'a',name:'Alice',gender:'F',availFrom:0,availTo:8}],[{id:'a',name:'Alice',gender:'F',aliases:['Al']}],[{name:'Al',gender:'F'}],8)).toEqual([]);
});

it('retains explicitly confirmed new aliases on an existing identity',()=>{
 expect(buildImportedPlayers([],[{id:'a',name:'Alice',gender:'F'}],[{id:'a',name:'Alice',gender:'F',aliases:['Ally']}],8)[0]?.aliases).toContain('Ally');
});

it('keeps active quarantine and private level when a stale bank copy shares the same ID',()=>{
 const result=buildImportedPlayers([],[{id:'a',name:'Alice',gender:'F',quarantined:true,level:5},{id:'a',name:'Alice',gender:'F',level:3}],[{name:'Alice',gender:'F'}],8);
 expect(result[0]).toMatchObject({id:'a',quarantined:true,level:5});
});
