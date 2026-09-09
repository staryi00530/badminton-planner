// @ts-nocheck
import { Fragment, useState } from 'react';
import { C, DEFAULT_PLAYERS, FONT } from '../constants';
import { sortPlayerIndicesForDisplay } from '../utils/sortPlayers';

function SkillDot({ name, winLoss }) {
  const wl = winLoss[name];
  const total = wl ? (wl.wins ?? 0) + (wl.losses ?? 0) : 0;
  if (total < 3) return null;
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

export default function PlayerList({
  players,
  playerHistory,
  winLoss,
  staggerMode,
  totalSlots,
  nameInput,
  genderInput,
  allDefaultsLoaded,
  setNameInput,
  setGenderInput,
  addPlayer,
  addSelectedFromBank,
  addToBank,
  removeFromHistory,
  loadDefaults,
  resetPlayers,
  clearPlayers,
  clearWinLoss,
  updatePlayer,
  removePlayer,
}) {
  const [editingNameIdx, setEditingNameIdx] = useState(null);
  const [selectedBank, setSelectedBank] = useState(() => new Set());
  const [bankNameInput, setBankNameInput] = useState('');
  const [bankGenderInput, setBankGenderInput] = useState('M');
  const currentNames = new Set(players.map(p => p.name.toLowerCase()));
  const bankPlayers = (playerHistory || []).filter(p => !currentNames.has(p.name.toLowerCase()));
  const sortedIndices = sortPlayerIndicesForDisplay(players);

  const toggleSelected = (name) => {
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
  return (
    <>
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

      {players.length > 0 && (
        <p style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>
          {players.length} player{players.length === 1 ? '' : 's'}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addPlayer()}
          placeholder="Player name"
          style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', color: C.text, fontSize: 14, fontFamily: FONT, outline: 'none' }}
        />
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.border}`, flexShrink: 0 }}>
          {['M', 'F'].map(g => (
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
        <button onClick={addPlayer} style={{ background: C.accent, color: C.bg, border: 'none', borderRadius: 6, padding: '10px 18px', fontSize: 13, fontWeight: 700, fontFamily: FONT }}>
          ADD
        </button>
      </div>

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
              {['M', 'F'].map(g => (
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
            const prevGender = idx > 0 ? players[sortedIndices[idx - 1]].gender : null;
            return (
            <Fragment key={`${p.name}-${i}`}>
              {p.gender !== prevGender && (
                <p style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px', margin: idx === 0 ? '0 0 -2px' : '10px 0 -2px' }}>
                  {p.gender === 'F' ? 'F' : 'M'}
                </p>
              )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', boxShadow: C.shadow }}>
              {editingNameIdx === i ? (
                <input autoFocus value={p.name}
                  onChange={e => updatePlayer(i, 'name', e.target.value)}
                  onBlur={() => setEditingNameIdx(null)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingNameIdx(null); }}
                  style={{ color: p.gender === 'F' ? C.pink : C.accent, fontWeight: 700, fontSize: 14, width: 90, background: C.bg, border: `1px solid ${p.gender === 'F' ? C.pinkDim : C.accentDim}`, borderRadius: 4, padding: '2px 6px', fontFamily: FONT, outline: 'none' }} />
              ) : (
                <span onClick={() => setEditingNameIdx(i)} title="Click to edit name"
                  style={{ color: p.gender === 'F' ? C.pink : C.accent, fontWeight: 700, fontSize: 14, minWidth: 70, cursor: 'text' }}>{p.name}</span>
              )}
              <span style={{ fontSize: 11, color: C.textDim }}>{p.gender === 'F' ? '♀' : '♂'}</span>
              {winLoss[p.name] && winLoss[p.name].wins + winLoss[p.name].losses > 0 && (
                <span style={{ fontSize: 11, color: C.textMuted }}>
                  {winLoss[p.name].wins}W–{winLoss[p.name].losses}L
                </span>
              )}
              <SkillDot name={p.name} winLoss={winLoss} />

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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: staggerMode === 'group' ? 0 : 'auto' }}>
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
    </>
  );
}
