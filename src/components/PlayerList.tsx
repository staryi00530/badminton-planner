import { newPlayerId, resolvePlayerIdentity } from '../utils/playerIdentity';
import { Fragment, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { C, DEFAULT_PLAYERS, FONT } from '../constants';
import type { Player, StaggerMode, WinLossMap } from '../types';
import type { Gender } from '../algorithm/types';
import { sortPlayerIndicesForDisplay } from '../utils/sortPlayers';
import { ignoredRosterLines, parseRosterPaste, type ParsedRosterEntry } from '../utils/rosterPaste';

type PlayerField = 'name' | 'gender' | 'level' | 'group' | 'availFrom' | 'availTo' | 'leavesAt';
type PlayerFieldValue = string | number | null;

const rosterSelectStyle: CSSProperties = {
  background: C.card,
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '7px 10px',
  minHeight: 36,
  maxWidth: '100%',
  fontSize: 12,
  fontFamily: FONT,
  colorScheme: 'dark',
  cursor: 'pointer',
};

interface PlayerListProps {
  visible?: boolean;
  players: Player[];
  playerHistory: Array<Pick<Player, 'id' | 'aliases' | 'statsKey' | 'name' | 'gender' | 'level'>>;
  winLoss: WinLossMap;
  staggerMode: StaggerMode;
  totalSlots: number;
  nameInput: string;
  genderInput: 'M' | 'F';
  levelInput?: 1 | 2 | 3 | 4 | 5;
  allDefaultsLoaded: boolean;
  scheduleActive?: boolean;
  showPrivateFields?: boolean;
  setNameInput: (value: string) => void;
  setGenderInput: (value: 'M' | 'F') => void;
  setLevelInput?: (value: 1 | 2 | 3 | 4 | 5) => void;
  addPlayer: () => void;
  addImportedPlayers: (entries: Array<Pick<Player, 'id' | 'aliases' | 'statsKey' | 'name' | 'gender' | 'level'>>) => void;
  addSelectedFromBank: (entries: Array<Pick<Player, 'id' | 'aliases' | 'statsKey' | 'name' | 'gender' | 'level'>>) => void;
  addToBank: (name: string, gender: 'M' | 'F') => void;
  removeFromHistory: (name: string) => void;
  loadDefaults: () => void;
  resetPlayers: () => void;
  clearPlayers: () => void;
  clearWinLoss: () => void;
  updatePlayer: (index: number, field: PlayerField, value: PlayerFieldValue) => void;
  removePlayer: (index: number) => void;
  togglePlayerQuarantined?: (index: number) => void;
}

function SkillDot({ name, winLoss }: { name: string; winLoss: WinLossMap }) {
  const wl = winLoss[name];
  const total = wl ? (wl.wins ?? 0) + (wl.losses ?? 0) : 0;
  if (!wl || total < 3) return null;
  const rate = wl.wins / total;
  const color = rate > 0.6 ? C.green : rate < 0.4 ? '#ef4444' : C.amber;
  const pct = Math.round(rate * 100);
  return (
    <span
      title={`${pct}% win rate (${total} games)`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {pct}%
    </span>
  );
}

interface ImportPreviewRow {
  id: number;
  mapping: string;
  newId?: string;
  parsed: ParsedRosterEntry;
  name: string;
  gender: Gender;
  level: NonNullable<Player['level']>;
  knownPlayer: boolean;
  alreadyActive: boolean;
  useNamedGuest: boolean;
}

function rosterNameKey(name: string) {
  return name.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

export default function PlayerList({
  visible = true,
  players,
  playerHistory,
  winLoss,
  staggerMode,
  totalSlots,
  nameInput,
  genderInput,
  levelInput = 3,
  allDefaultsLoaded,
  scheduleActive = false,
  showPrivateFields = true,
  setNameInput,
  setGenderInput,
  setLevelInput = () => {},
  addPlayer,
  addImportedPlayers,
  addSelectedFromBank,
  addToBank,
  removeFromHistory,
  loadDefaults,
  resetPlayers,
  clearPlayers,
  clearWinLoss,
  updatePlayer,
  removePlayer,
  togglePlayerQuarantined,
}: PlayerListProps) {
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const [nameDraft,setNameDraft]=useState('');
  const [nameError,setNameError]=useState('');
  const nameEditFinished=useRef(false);
  const commitNameEdit=(index:number)=>{
    if(nameEditFinished.current) return;
    const name=nameDraft.trim();
    if(!name){setNameError('Enter a player name.');return;}
    if(players.some((player,i)=>i!==index&&rosterNameKey(player.name)===rosterNameKey(name))){setNameError('A player with this name is already on the roster.');return;}
    nameEditFinished.current=true;
    if(name!==players[index]?.name)updatePlayer(index,'name',name);
    setNameError('');setEditingNameIdx(null);
  };
  const [selectedBank, setSelectedBank] = useState<Set<string>>(() => new Set());
  const [bankNameInput, setBankNameInput] = useState('');
  const [bankGenderInput, setBankGenderInput] = useState<'M' | 'F'>('M');
  const [rosterPaste, setRosterPaste] = useState('');
  const [defaultImportGender, setDefaultImportGender] = useState<Gender>(genderInput);
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([]);
  const [importMessage, setImportMessage] = useState('');
  if (!visible) return null;
  const currentNames = new Set(players.map(p => p.name.toLowerCase()));
  const bankUnsorted = (playerHistory || []).filter(p => !currentNames.has(p.name.toLowerCase()));
  const bankPlayers = sortPlayerIndicesForDisplay(bankUnsorted).map(index => bankUnsorted[index]!);
  const sortedIndices = sortPlayerIndicesForDisplay(players).filter(i => !players[i]!.quarantined);

  const toggleSelected = (name: string) => {
    setSelectedBank(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addSelected = () => {
    addSelectedFromBank(bankPlayers.filter(p => selectedBank.has(p.name)));
    setSelectedBank(new Set());
  };

  const addToBankFromForm = () => {
    if (!bankNameInput.trim()) return;
    addToBank(bankNameInput, bankGenderInput);
    setBankNameInput('');
  };

  const findKnownPlayer = (name: string, genderHint: Gender | null) => {
    const candidates=[...players,...playerHistory].filter(p=>!genderHint||p.gender===genderHint);
    // Prefer bank records carrying persistent identity over unmigrated UI inputs.
    return resolvePlayerIdentity(name, [...new Map(candidates.map(p=>[p.id??p.name,p])).values()]);
  };

  const makePreviewRow = (parsed: ParsedRosterEntry, id: number, useNamedGuest = true): ImportPreviewRow => {
    const rawName = useNamedGuest ? parsed.name : parsed.fallbackName ?? parsed.name;
    const genderHint = useNamedGuest ? parsed.genderHint : parsed.fallbackGenderHint ?? null;
    const known = findKnownPlayer(rawName, genderHint);
    const name = known?.name ?? rawName;
    const matches=[...players,...playerHistory].filter(player=>
      (!genderHint || player.gender===genderHint) && [player.name,...(player.aliases??[])].some(alias=>rosterNameKey(alias)===rosterNameKey(rawName)));
    const ambiguous=new Set(matches.map(player=>player.id??`${rosterNameKey(player.name)}:${player.gender}`)).size>1;
    return {
      id,
      mapping: ambiguous ? 'unresolved' : known ? `existing:${known.id ?? known.name}` : 'new',
      parsed,
      name,
      gender: known?.gender ?? genderHint ?? defaultImportGender,
      level: known?.level ?? 3,
      knownPlayer: Boolean(known),
      alreadyActive: players.some(player => rosterNameKey(player.name) === rosterNameKey(name)),
      useNamedGuest,
    };
  };

  const previewRosterPaste = () => {
    const parsed = parseRosterPaste(rosterPaste);
    setImportMessage(parsed.length ? '' : 'No player names found.');
    setImportPreview([...parsed.map((entry,index)=>makePreviewRow(entry,index)), ...ignoredRosterLines(rosterPaste).map((name,index)=>({...makePreviewRow({name,genderHint:null,isGuest:false},parsed.length+index),mapping:'ignore'}))]);
  };

  const applyRosterPaste = () => {
    if (!importPreview.some(row=>row.mapping!=='ignore') || importPreview.some(row=>row.mapping==='unresolved')) return;
    const entries = importPreview
      .filter(row=>row.mapping!=='ignore')
      .map(row => {
        const {name,gender,level,mapping}=row;
        const saved=mapping.startsWith('existing:') ? [...playerHistory,...players].find(p=>(p.id??p.name)===mapping.slice(9)) : undefined;
        return saved ? { ...(saved.id?{id:saved.id}:{}), ...(saved.statsKey?{statsKey:saved.statsKey}:{}), ...(saved.aliases?{aliases:saved.aliases}:{}), name:saved.name, gender:saved.gender, level:saved.level??3, ...(row.parsed.name!==saved.name?{aliases:[...new Set([...(saved.aliases??[]),row.parsed.name])]}:{}) } : {name,gender,level,...(row.newId?{id:row.newId}:{})};
      });
    const uniqueEntries=[...new Map(entries.map(entry=>[entry.id??rosterNameKey(entry.name),entry])).values()];
    addImportedPlayers(uniqueEntries);
    setImportMessage(`Roster replaced with ${uniqueEntries.length} player${uniqueEntries.length === 1 ? '' : 's'}.`);
    setImportPreview([]);
    setRosterPaste('');
  };

  const updatePreviewRow = (id: number, update: Partial<ImportPreviewRow>) => {
    setImportPreview(rows => rows.map(row => row.id === id ? { ...row, ...update } : row));
  };
  const importCount=new Set(importPreview.filter(row=>row.mapping!=='ignore').map(row=>row.mapping.startsWith('existing:')?row.mapping:rosterNameKey(row.name))).size;
  const mappingOptions=[...new Map([...playerHistory,...players].map(p=>[p.id??p.name,p])).values()];
  return (
    <details open={!scheduleActive} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 16, marginBottom: 20 }}>
      <summary style={{ fontSize: 14, color: C.text, fontWeight: 700, cursor: 'pointer', marginBottom: 12 }}>Players ({players.length})</summary>
      {players.length === 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '24px 20px', marginBottom: 20, boxShadow: C.shadow }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>How it works</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              ['1', 'Add your players', 'Type names below, or load the default roster to get started quickly.'],
              ['2', 'Configure the session', 'Set game length, number of courts, and whether anyone is arriving late or leaving early.'],
              ['3', 'Generate & share', "Hit Generate to get a balanced schedule. Re-roll until you're happy, then copy it to your group chat."],
            ].map(([num, title, desc]) => (
              <div key={num} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, background: 'rgba(125,211,252,0.1)', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{num}</span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{title}</p>
                  <p style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <input
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addPlayer()}
          placeholder="Player name"
          style={{ flex: '1 1 140px', minWidth: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', color: C.text, fontSize: 14, fontFamily: FONT, outline: 'none' }}
        />
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.border}`, flexShrink: 0 }}>
          {(['M', 'F'] as const).map(g => (
            <button
              key={g}
              onClick={() => setGenderInput(g)}
              style={{
                background: genderInput === g ? (g === 'M' ? C.accentDim : C.pinkDim) : C.card,
                color: genderInput === g ? '#fff' : g === 'M' ? C.accent : C.pink,
                border: 'none',
                padding: '10px 0',
                minWidth: 48,
                fontSize: 18,
                fontWeight: 700,
                fontFamily: FONT,
                opacity: genderInput === g ? 1 : 0.6,
              }}
            >
              {g === 'M' ? '♂' : '♀'}
            </button>
          ))}
        </div>
        {showPrivateFields && <div title="Private level used for balancing" style={{ display: 'flex', alignItems: 'center', gap: 3, border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 4px' }}>
          <span style={{ fontSize: 10, color: C.textMuted, padding: '0 3px' }}>Level</span>
          {([1, 2, 3, 4, 5] as const).map(level => (
            <button key={level} onClick={() => setLevelInput(level)} style={{ background: levelInput === level ? C.accentDim : 'transparent', color: levelInput === level ? '#fff' : C.textMuted, border: 'none', borderRadius: 4, padding: '5px 7px', fontSize: 12, fontWeight: 700, fontFamily: FONT }}>{level}</button>
          ))}
        </div>}
        <button onClick={addPlayer} style={{ background: C.accent, color: C.bg, border: 'none', borderRadius: 6, padding: '10px 18px', fontSize: 13, fontWeight: 700, fontFamily: FONT }}>
          ADD
        </button>
      </div>

      <details style={{ margin: '0 0 14px', borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
        <summary style={{ cursor: 'pointer', color: C.text, fontSize: 13, fontWeight: 700 }}>Paste roster</summary>
        <p style={{ margin: '8px 0', color: C.textDim, fontSize: 12, lineHeight: 1.5 }}>
          Paste an attendee list, then review names and genders. Applying it replaces the current roster with this list.
        </p>
        <textarea
          aria-label="Paste attendee list"
          value={rosterPaste}
          onChange={event => setRosterPaste(event.target.value)}
          placeholder={'Wednesday 8:30pm–11:30pm\n1. Eamon\n2. Jialin'}
          rows={5}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', resize: 'vertical', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, font: `13px ${FONT}` }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <label style={{ color: C.textDim, fontSize: 12 }}>
            Default gender for unmarked names{' '}
            <select aria-label="Default gender for unmarked names" value={defaultImportGender} onChange={event => setDefaultImportGender(event.target.value as Gender)} style={rosterSelectStyle}>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </label>
          <button onClick={previewRosterPaste} disabled={!rosterPaste.trim()} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 11px', fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            Preview names
          </button>
          {importMessage && <span role="status" style={{ color: C.textDim, fontSize: 12 }}>{importMessage}</span>}
        </div>
        {importPreview.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: '0 0 8px', color: C.textDim, fontSize: 12 }}>
              {importPreview.length} names found. Players not in this list will be removed from the roster; known player details are retained.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '0 20px', maxHeight: 320, overflowY: 'auto', padding: '0 8px 0 0' }}>
              {importPreview.map(row => (
                <div key={row.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderTop: `1px solid ${C.border}`, padding: '8px 0' }}>
                  <label style={{fontSize:11,flex:'1 1 180px',minWidth:0,overflowWrap:'anywhere'}}>Original: {row.parsed.name}
                    <select aria-label={`Map ${row.parsed.name}`} value={row.mapping} style={{ ...rosterSelectStyle, display: 'block', width: '100%', marginTop: 4 }} onChange={event=>{
                      const mapping=event.target.value;
                      const saved=mappingOptions.find(p=>(p.id??p.name)===mapping.slice(9));
                      updatePreviewRow(row.id,{mapping,...(mapping==='new'?{newId:newPlayerId()}:{}),...(saved?{name:saved.name,gender:saved.gender,level:saved.level??3,knownPlayer:true}:{name:row.parsed.name,knownPlayer:false})});
                    }}>
                      {row.mapping==='unresolved' && <option value="unresolved" disabled>Choose a player or New</option>}
                      <option value="new">New player</option><option value="ignore">Ignore</option>
                      {mappingOptions.map(p=><option key={p.id??p.name} value={`existing:${p.id??p.name}`}>Existing: {p.name} ({p.gender})</option>)}
                    </select>
                    {row.mapping==='unresolved' && <span role="alert" style={{display:'block',color:C.amber}}>Multiple saved players match. Choose Existing, New player, or Ignore.</span>}
                  </label>
                  <div style={{ minWidth: 0, flex: '1 1 130px' }}>
                    <div style={{ color: row.gender === 'F' ? C.pink : C.text, fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{row.name}</div>
                    {row.parsed.isGuest && row.parsed.fallbackName && (
                      <label style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 4, color: C.textMuted, fontSize: 11 }}>
                        <input
                          type="checkbox"
                          checked={row.useNamedGuest}
                          onChange={event => updatePreviewRow(row.id, makePreviewRow(row.parsed, row.id, event.target.checked))}
                        />
                        Guest named; uncheck to use {row.parsed.fallbackName}
                      </label>
                    )}
                  </div>
                  {row.alreadyActive ? (
                    <span style={{ color: C.textMuted, fontSize: 11 }}>Already on roster</span>
                  ) : row.knownPlayer ? (
                    <span style={{ color: C.textDim, fontSize: 11 }}>Saved · {row.gender} · Level {row.level}</span>
                  ) : (
                    <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: C.textDim, fontSize: 11 }}>
                      Gender
                      <select aria-label={`Gender for ${row.name}`} value={row.gender} onChange={event => updatePreviewRow(row.id, { gender: event.target.value as Gender })} style={{ ...rosterSelectStyle, color: row.gender === 'F' ? C.pink : C.accent }}>
                        <option value="M">M</option>
                        <option value="F">F</option>
                      </select>
                    </label>
                  )}
                </div>
              ))}
            </div>
            {importCount===0 && <p role="status" style={{fontSize:12,color:C.textDim}}>No players selected. The existing roster will be kept.</p>}
            <button disabled={importCount===0 || importPreview.some(row=>row.mapping==='unresolved')} onClick={applyRosterPaste} style={{ marginTop: 10, background: C.accent, color: C.bg, border: 'none', borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 700, fontFamily: FONT }}>
              Replace roster with {importCount} player{importCount === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </details>

      <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Player bank</p>

          {bankPlayers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {bankPlayers.map(p => {
                const isSelected = selectedBank.has(p.name);
                return (
                  <button
                    key={p.name}
                    onClick={() => toggleSelected(p.name)}
                    title={isSelected ? `Deselect ${p.name}` : `Select ${p.name}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: isSelected ? (p.gender === 'F' ? C.pinkDim : C.accentDim) : C.card,
                      color: isSelected ? '#fff' : p.gender === 'F' ? C.pink : C.accent,
                      border: `1px ${isSelected ? 'solid' : 'dashed'} ${isSelected ? 'transparent' : C.border}`,
                      borderRadius: 14, padding: '4px 10px', fontSize: 12, fontWeight: 600, fontFamily: FONT,
                    }}
                  >
                    {isSelected ? '✓' : '+'} {p.name}
                    <span
                      onClick={e => { e.stopPropagation(); removeFromHistory(p.name); setSelectedBank(prev => { const n = new Set(prev); n.delete(p.name); return n; }); }}
                      title="Remove from bank"
                      style={{ color: isSelected ? 'rgba(255,255,255,0.7)' : C.textMuted, fontSize: 13, lineHeight: 1 }}
                    >
                      ×
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={bankNameInput}
              onChange={e => setBankNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addToBankFromForm()}
              placeholder="Add to bank (not today's roster)"
              style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', color: C.text, fontSize: 12, fontFamily: FONT, outline: 'none' }}
            />
            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.border}`, flexShrink: 0 }}>
              {(['M', 'F'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setBankGenderInput(g)}
                  style={{
                    background: bankGenderInput === g ? (g === 'M' ? C.accentDim : C.pinkDim) : C.card,
                    color: bankGenderInput === g ? '#fff' : g === 'M' ? C.accent : C.pink,
                    border: 'none', padding: '6px 10px', fontSize: 13, fontWeight: 700, fontFamily: FONT,
                    opacity: bankGenderInput === g ? 1 : 0.6,
                  }}
                >
                  {g === 'M' ? '♂' : '♀'}
                </button>
              ))}
            </div>
            <button onClick={addToBankFromForm} style={{ background: C.card, color: C.textDim, border: `1px dashed ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
              + Bank
            </button>
            {selectedBank.size > 0 && (
              <button onClick={addSelected} style={{ background: C.accent, color: C.bg, border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, fontFamily: FONT }}>
                Add Selected ({selectedBank.size})
              </button>
            )}
          </div>
        </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {!allDefaultsLoaded && (
          <button onClick={loadDefaults} style={{ flex: 1, background: 'transparent', color: C.textDim, border: `1px dashed ${C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, fontFamily: FONT }}>
            + Load defaults {players.length > 0 ? '(merge)' : ''}
          </button>
        )}
        {players.length > 0 && (
          <button onClick={resetPlayers} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            RESET
          </button>
        )}
        {players.length > 0 && (
          <button onClick={clearPlayers} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            CLEAR
          </button>
        )}
        {Object.keys(winLoss).length > 0 && (
          <button onClick={clearWinLoss} title="Clear all win-loss records and skill ratings" style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            RESET W/L
          </button>
        )}
      </div>

      {players.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {sortedIndices.map((i, idx) => {
            const p = players[i];
            const previousIndex = idx > 0 ? sortedIndices[idx - 1] : undefined;
            const previous = previousIndex == null ? undefined : players[previousIndex];
            const prevGender = previous?.gender ?? null;
            if (!p) return null;
            return (
            <Fragment key={p.id ?? `${p.name}-${i}`}>
              {p.gender !== prevGender && (
                <p style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px', margin: idx === 0 ? '0 0 -2px' : '10px 0 -2px' }}>
                  {p.gender === 'F' ? 'F' : 'M'}
                </p>
              )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', boxShadow: C.shadow }}>
              {editingNameIdx === i ? (
                <input autoFocus aria-label={`Edit name for ${p.name}`} value={nameDraft}
                  onChange={e => {setNameDraft(e.target.value);setNameError('');}}
                  onBlur={() => commitNameEdit(i)}
                  onKeyDown={e => { if(e.key==='Enter'){e.preventDefault();commitNameEdit(i);}else if(e.key==='Escape'){nameEditFinished.current=true;setNameError('');setEditingNameIdx(null);} }}
                  style={{ color: p.gender === 'F' ? C.pink : C.accent, fontWeight: 700, fontSize: 14, width: 90, background: C.bg, border: `1px solid ${p.gender === 'F' ? C.pinkDim : C.accentDim}`, borderRadius: 4, padding: '2px 6px', fontFamily: FONT, outline: 'none' }} />
              ) : (
                <span onClick={() => {nameEditFinished.current=false;setNameDraft(p.name);setNameError('');setEditingNameIdx(i);}} title="Click to edit name"
                  style={{ color: p.gender === 'F' ? C.pink : C.accent, fontWeight: 700, fontSize: 14, minWidth: 70, cursor: 'text' }}>{p.name}</span>
              )}
              {editingNameIdx===i && nameError && <span role="alert" style={{fontSize:12,color:C.amber}}>{nameError}</span>}
              <select aria-label={`Gender for roster ${p.name}`} value={p.gender} onChange={e=>updatePlayer(i,'gender',e.target.value)} style={{ ...rosterSelectStyle, color: p.gender === 'F' ? C.pink : C.accent }}><option value="M">♂</option><option value="F">♀</option></select>
              {showPrivateFields && <div title="Private balancing level" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 10, color: C.textMuted }}>L</span>
                {([1, 2, 3, 4, 5] as const).map(level => (
                  <button key={level} onClick={() => updatePlayer(i, 'level', level)} style={{ background: (p.level ?? 3) === level ? C.accentDim : 'transparent', color: (p.level ?? 3) === level ? '#fff' : C.textMuted, border: 'none', borderRadius: 3, padding: '2px 4px', fontSize: 10, fontWeight: 700, fontFamily: FONT }}>{level}</button>
                ))}
              </div>}
              {winLoss[p.statsKey ?? p.name] && (() => {
                const record = winLoss[p.statsKey ?? p.name];
                return !!record && record.wins + record.losses > 0;
              })() && (
                <span style={{ fontSize: 11, color: C.textMuted }}>
                  {winLoss[p.statsKey ?? p.name]?.wins}W–{winLoss[p.statsKey ?? p.name]?.losses}L
                </span>
              )}
              <SkillDot name={p.statsKey ?? p.name} winLoss={winLoss} />

              {staggerMode === 'group' && (
                <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
                  {['early', 'full', 'late'].map(val => (
                    <button
                      key={val}
                      onClick={() => updatePlayer(i, 'group', val)}
                      style={{
                        background: p.group === val ? (val === 'early' ? '#065f46' : val === 'late' ? '#7c2d12' : C.accentDim) : 'transparent',
                        color: p.group === val ? '#fff' : C.textMuted,
                        border: `1px solid ${p.group === val ? 'transparent' : C.border}`,
                        borderRadius: 4,
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: FONT,
                      }}
                    >
                      {val === 'full' ? 'Full' : val === 'early' ? 'Early' : 'Late'}
                    </button>
                  ))}
                </div>
              )}

              {staggerMode === 'custom' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                  <span style={{ fontSize: 11, color: C.textDim }}>Slots</span>
                  <input
                    type="number"
                    min={1}
                    max={totalSlots}
                    value={p.availFrom + 1}
                    onChange={e => updatePlayer(i, 'availFrom', Math.max(0, Math.min(+e.target.value - 1, p.availTo)))}
                    style={{ width: 42, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 6px', color: C.text, fontSize: 12, fontFamily: FONT, textAlign: 'center' }}
                  />
                  <span style={{ color: C.textMuted, fontSize: 11 }}>to</span>
                  <input
                    type="number"
                    min={1}
                    max={totalSlots}
                    value={p.availTo + 1}
                    onChange={e => updatePlayer(i, 'availTo', Math.max(p.availFrom, Math.min(+e.target.value - 1, totalSlots - 1)))}
                    style={{ width: 42, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 6px', color: C.text, fontSize: 12, fontFamily: FONT, textAlign: 'center' }}
                  />
                </div>
              )}

              {staggerMode !== 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: staggerMode === 'none' ? 'auto' : 0 }}>
                  {p.leavesAt != null ? (
                    <>
                      <span style={{ fontSize: 10, color: C.textMuted }}>↓</span>
                      <input
                        type="number"
                        min={1}
                        max={totalSlots}
                        value={p.leavesAt + 1}
                        onChange={e => updatePlayer(i, 'leavesAt', Math.max(0, Math.min(+e.target.value - 1, totalSlots - 1)))}
                        style={{ width: 38, background: C.bg, border: `1px solid ${C.amber}`, borderRadius: 4, padding: '3px 6px', color: C.amber, fontSize: 12, fontFamily: FONT, textAlign: 'center' }}
                      />
                      <button onClick={() => updatePlayer(i, 'leavesAt', null)} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                    </>
                  ) : (
                    <button onClick={() => updatePlayer(i, 'leavesAt', Math.max(0, totalSlots - 2))} style={{ background: 'none', border: `1px dashed ${C.border}`, borderRadius: 4, color: C.textMuted, fontSize: 11, padding: '2px 6px', fontFamily: FONT, whiteSpace: 'nowrap' }}>
                      ↓ leaves
                    </button>
                  )}
                </div>
              )}

              {togglePlayerQuarantined && <button aria-label={`Quarantine ${p.name}`} onClick={() => togglePlayerQuarantined(i)} style={{ background: 'none', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', fontSize: 11, fontFamily: FONT }}>Quarantine</button>}
              <button onClick={() => removePlayer(i)} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 16, padding: 0 }}>×</button>
            </div>
            </Fragment>
            );
          })}
        </div>
      )}

      {players.length > 0 && players.length < 4 && (
        <p style={{ color: C.amber, fontSize: 12, marginBottom: 20, textAlign: 'center' }}>Need at least 4 players</p>
      )}
    </details>
  );
}
