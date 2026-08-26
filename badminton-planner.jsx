import { useState, useCallback, useRef } from "react";

const TOTAL_MINUTES = 180;
const DEFAULT_GAME_MINUTES = 15;

// ─── Utilities ───────────────────────────────────────────────────────────────

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ─── Algorithm ───────────────────────────────────────────────────────────────

function generateSchedule(players, totalSlots, courtsPerSlot) {
  const n = players.length;
  if (n < 4) return null;

  const schedule = [];
  const gamesPlayed = new Array(n).fill(0);
  const consecutivePlayed = new Array(n).fill(0);
  const consecutiveRested = new Array(n).fill(0);
  const partnerCount = Array.from({ length: n }, () => new Array(n).fill(0));
  const opponentCount = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let slot = 0; slot < totalSlots; slot++) {
    const available = [];
    for (let i = 0; i < n; i++) {
      if (slot >= players[i].availFrom && slot <= players[i].availTo) available.push(i);
    }

    const courtsThisSlot = Math.min(courtsPerSlot[slot], Math.floor(available.length / 4));
    if (courtsThisSlot === 0) {
      schedule.push({ slot: slot + 1, courts: [], sitting: available.map((i) => players[i]),
        playerState: players.map((p, i) => ({
          name: p.name, gender: p.gender, total: gamesPlayed[i],
          conPlayed: consecutivePlayed[i], conRested: consecutiveRested[i],
          playing: false, available: available.includes(i),
        }))});
      for (const i of available) { consecutiveRested[i]++; consecutivePlayed[i] = 0; }
      continue;
    }

    const playersNeeded = courtsThisSlot * 4;
    const mustPlay = [], mustRest = [], canPlay = [];

    for (const i of available) {
      if (consecutivePlayed[i] >= 2) mustRest.push(i);
      else if (consecutiveRested[i] >= 2) mustPlay.push(i);
      else canPlay.push(i);
    }

    const canPlayGrouped = {};
    for (const p of canPlay) {
      const avail = players[p].availTo - players[p].availFrom + 1;
      const rate = avail > 0 ? gamesPlayed[p] / avail : 0;
      const key = Math.round(rate * 100);
      if (!canPlayGrouped[key]) canPlayGrouped[key] = [];
      canPlayGrouped[key].push(p);
    }
    const canPlayShuffled = Object.keys(canPlayGrouped)
      .sort((a, b) => +a - +b)
      .flatMap((g) => shuffle(canPlayGrouped[g]));

    const pool = [...shuffle(mustPlay), ...canPlayShuffled];
    let selected = [];
    for (const p of mustPlay) { if (selected.length < playersNeeded) selected.push(p); }
    const remaining = pool.filter((p) => !selected.includes(p) && !mustRest.includes(p));
    for (const p of remaining) { if (selected.length >= playersNeeded) break; if (!selected.includes(p)) selected.push(p); }

    const actualCourts = Math.min(courtsThisSlot, Math.floor(selected.length / 4));
    selected = selected.slice(0, actualCourts * 4);

    const courts = [];
    let unassigned = [...selected];

    for (let c = 0; c < actualCourts; c++) {
      const courtPlayers = unassigned.slice(0, 4);
      unassigned = unassigned.slice(4);

      const pairings = [
        [[courtPlayers[0], courtPlayers[1]], [courtPlayers[2], courtPlayers[3]]],
        [[courtPlayers[0], courtPlayers[2]], [courtPlayers[1], courtPlayers[3]]],
        [[courtPlayers[0], courtPlayers[3]], [courtPlayers[1], courtPlayers[2]]],
      ];

      let bestPairing = pairings[0], bestScore = Infinity;
      for (const pairing of pairings) {
        const [tA, tB] = pairing;
        let score = 0;
        score += partnerCount[tA[0]][tA[1]] * 3;
        score += partnerCount[tB[0]][tB[1]] * 3;
        score += opponentCount[tA[0]][tB[0]] + opponentCount[tA[0]][tB[1]];
        score += opponentCount[tA[1]][tB[0]] + opponentCount[tA[1]][tB[1]];
        if (players[tA[0]].gender === players[tA[1]].gender) score += 1;
        if (players[tB[0]].gender === players[tB[1]].gender) score += 1;
        score += Math.random() * 1.5;
        if (score < bestScore) { bestScore = score; bestPairing = pairing; }
      }

      const [teamA, teamB] = bestPairing;
      courts.push({ court: c + 1, teamA: teamA.map((i) => players[i]), teamB: teamB.map((i) => players[i]) });

      partnerCount[teamA[0]][teamA[1]]++; partnerCount[teamA[1]][teamA[0]]++;
      partnerCount[teamB[0]][teamB[1]]++; partnerCount[teamB[1]][teamB[0]]++;
      for (const a of teamA) { for (const b of teamB) { opponentCount[a][b]++; opponentCount[b][a]++; } }
    }

    const playingSet = new Set(selected);
    for (let i = 0; i < n; i++) {
      const isAvail = available.includes(i);
      if (playingSet.has(i)) { gamesPlayed[i]++; consecutivePlayed[i]++; consecutiveRested[i] = 0; }
      else if (isAvail) { consecutiveRested[i]++; consecutivePlayed[i] = 0; }
    }

    const sitting = available.filter((i) => !playingSet.has(i)).map((i) => players[i]);
    const playerState = players.map((p, i) => ({
      name: p.name, gender: p.gender, total: gamesPlayed[i],
      conPlayed: consecutivePlayed[i], conRested: consecutiveRested[i],
      playing: playingSet.has(i), available: available.includes(i),
    }));

    schedule.push({ slot: slot + 1, courts, sitting, playerState });
  }

  return { schedule, gamesPlayed };
}

// ─── Colors ──────────────────────────────────────────────────────────────────

const C = {
  bg: "#0a0f1a", card: "#111827", border: "#1e293b",
  accent: "#22d3ee", accentDim: "#0e7490",
  pink: "#f472b6", pinkDim: "#9d174d",
  text: "#e2e8f0", textDim: "#64748b", textMuted: "#475569",
  green: "#34d399", amber: "#fbbf24",
};

const COURT_COLORS = ["#22d3ee", "#a78bfa", "#fb923c"];
const COURT_BG = ["rgba(34,211,238,0.08)", "rgba(167,139,250,0.08)", "rgba(251,146,60,0.08)"];

const DEFAULT_PLAYERS = [
  { name: "Player 01", gender: "M" }, { name: "Player 02", gender: "F" },
  { name: "Player 03", gender: "F" }, { name: "Player 04", gender: "M" },
  { name: "Player 05", gender: "M" }, { name: "Player 06", gender: "F" },
  { name: "Player 07", gender: "M" }, { name: "Player 08", gender: "M" },
  { name: "Player 09", gender: "F" }, { name: "Player 10", gender: "M" },
  { name: "Player 11", gender: "M" }, { name: "Player 12", gender: "M" },
];

const font = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";

// ─── Component ───────────────────────────────────────────────────────────────

export default function BadmintonPlanner() {
  const [players, setPlayers] = useState(
    DEFAULT_PLAYERS.map((p) => ({ ...p, availFrom: 0, availTo: 11, group: "full" }))
  );
  const [nameInput, setNameInput] = useState("");
  const [genderInput, setGenderInput] = useState("M");
  const [gameMinutes, setGameMinutes] = useState(DEFAULT_GAME_MINUTES);
  const [numCourts, setNumCourts] = useState(1);
  const [extraCourt, setExtraCourt] = useState({ enabled: false, startMin: 60, durationMin: 90 });
  const [staggerMode, setStaggerMode] = useState("none");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const scheduleRef = useRef(null);

  const totalSlots = Math.floor(TOTAL_MINUTES / gameMinutes);

  const getCourtsPerSlot = useCallback(() => {
    return Array.from({ length: totalSlots }, (_, slot) => {
      const slotStartMin = slot * gameMinutes;
      const slotEndMin = slotStartMin + gameMinutes;
      let courts = numCourts;
      if (extraCourt.enabled) {
        const extraEnd = extraCourt.startMin + extraCourt.durationMin;
        if (slotStartMin < extraEnd && slotEndMin > extraCourt.startMin) courts++;
      }
      return Math.min(courts, 3);
    });
  }, [totalSlots, gameMinutes, numCourts, extraCourt]);

  const getPlayersWithAvailability = useCallback(() => {
    const midSlot = Math.floor(totalSlots / 2);
    const overlap = Math.max(1, Math.floor(totalSlots * 0.2));
    return players.map((p) => {
      if (staggerMode === "none") return { ...p, availFrom: 0, availTo: totalSlots - 1 };
      if (staggerMode === "group") {
        if (p.group === "early") return { ...p, availFrom: 0, availTo: midSlot + overlap - 1 };
        if (p.group === "late") return { ...p, availFrom: midSlot - overlap, availTo: totalSlots - 1 };
        return { ...p, availFrom: 0, availTo: totalSlots - 1 };
      }
      return p;
    });
  }, [players, staggerMode, totalSlots]);

  const resetPlayers = useCallback(() => {
    setPlayers(DEFAULT_PLAYERS.map((p) => ({ ...p, availFrom: 0, availTo: totalSlots - 1, group: "full" })));
    setResult(null);
  }, [totalSlots]);

  const clearPlayers = useCallback(() => {
    setPlayers([]); setResult(null);
  }, []);

  const addPlayer = useCallback(() => {
    const name = nameInput.trim();
    if (!name || players.find((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    setPlayers((prev) => [...prev, { name, gender: genderInput, availFrom: 0, availTo: totalSlots - 1, group: "full" }]);
    setNameInput(""); setResult(null);
  }, [nameInput, genderInput, players, totalSlots]);

  const removePlayer = useCallback((idx) => {
    setPlayers((prev) => prev.filter((_, i) => i !== idx)); setResult(null);
  }, []);

  const updatePlayer = useCallback((idx, field, value) => {
    setPlayers((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p)); setResult(null);
  }, []);

  const generate = useCallback(() => {
    if (players.length < 4) return;
    setResult(generateSchedule(getPlayersWithAvailability(), totalSlots, getCourtsPerSlot()));
    setCopied(false);
  }, [players, totalSlots, numCourts, extraCourt, getPlayersWithAvailability, getCourtsPerSlot]);

  const copySchedule = useCallback(() => {
    if (!result) return;
    const hasMultiCourts = result.schedule.some(s => s.courts.length > 1);
    const courtDesc = extraCourt.enabled
      ? ` · ${numCourts} court${numCourts > 1 ? "s" : ""} +1 extra (${extraCourt.startMin}–${extraCourt.startMin + extraCourt.durationMin}m)`
      : numCourts > 1 ? ` × ${numCourts} courts` : "";
    const lines = [`🏸 Badminton Schedule — ${totalSlots} slots × ${gameMinutes} min${courtDesc}\n`];
    result.schedule.forEach((s) => {
      lines.push(`--- Slot ${s.slot} (~${(s.slot - 1) * gameMinutes}-${s.slot * gameMinutes}m) ---`);
      s.courts.forEach((c) => {
        const tA = c.teamA.map((p) => p.name).join(" & ");
        const tB = c.teamB.map((p) => p.name).join(" & ");
        lines.push(`  ${hasMultiCourts ? `Court ${c.court}: ` : ""}${tA}  vs  ${tB}`);
      });
      if (s.sitting && s.sitting.length > 0) lines.push(`  Sit: ${s.sitting.map((p) => p.name).join(", ")}`);
    });
    lines.push(`\nGames per player:`);
    players.forEach((p, i) => lines.push(`  ${p.name}: ${result.gamesPlayed[i]}`));
    const text = lines.join("\n");
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) {}
    document.body.removeChild(ta);
  }, [result, players, gameMinutes, totalSlots, numCourts, extraCourt]);

  const saveAsImage = useCallback(async () => {
    if (!scheduleRef.current) return;
    if (!window.html2canvas) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    const canvas = await window.html2canvas(scheduleRef.current, { backgroundColor: C.bg, scale: 2 });
    const link = document.createElement("a"); link.download = "badminton-schedule.png"; link.href = canvas.toDataURL("image/png"); link.click();
  }, []);

  const minGames = result ? Math.min(...result.gamesPlayed) : 0;
  const maxGames = result ? Math.max(...result.gamesPlayed) : 0;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: font, padding: "24px 16px" }}>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28, borderBottom: `1px solid ${C.border}`, paddingBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>🏸</span> Match Planner
          </h1>
          <p style={{ color: C.textDim, fontSize: 13, margin: "6px 0 0" }}>
            3 hrs · {totalSlots} slots × {gameMinutes} min · {numCourts} court{numCourts > 1 ? "s" : ""}{extraCourt.enabled ? ` +1 extra (${extraCourt.startMin}–${extraCourt.startMin + extraCourt.durationMin}m)` : ""}
          </p>
        </div>

        {/* Settings */}
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px" }}>
            <label style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Game length</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <input type="range" min={8} max={20} value={gameMinutes}
                onChange={(e) => { setGameMinutes(+e.target.value); setResult(null); }}
                style={{ flex: 1, accentColor: C.accent }} />
              <span style={{ fontSize: 14, color: C.accent, fontWeight: 600, minWidth: 48, textAlign: "right" }}>{gameMinutes}m</span>
            </div>
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <label style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Courts</label>
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              {[1, 2, 3].map((nc) => (
                <button key={nc} onClick={() => { setNumCourts(nc); setResult(null); }}
                  style={{
                    background: numCourts === nc ? C.accentDim : C.card,
                    color: numCourts === nc ? "#fff" : C.textDim,
                    border: `1px solid ${numCourts === nc ? C.accentDim : C.border}`,
                    borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: font,
                  }}>{nc}</button>
              ))}
            </div>
          </div>
          {numCourts < 3 && (
            <div style={{ flex: "0 0 auto" }}>
              <label style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Extra court</label>
              <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
                <button onClick={() => { setExtraCourt(ec => ({ ...ec, enabled: !ec.enabled })); setResult(null); }}
                  style={{
                    background: extraCourt.enabled ? C.accentDim : C.card,
                    color: extraCourt.enabled ? "#fff" : C.textDim,
                    border: `1px solid ${extraCourt.enabled ? C.accentDim : C.border}`,
                    borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: font,
                  }}>{extraCourt.enabled ? "ON" : "OFF"}</button>
                {extraCourt.enabled && (<>
                  <span style={{ fontSize: 11, color: C.textDim }}>@</span>
                  <input type="number" min={0} max={TOTAL_MINUTES - gameMinutes} step={gameMinutes} value={extraCourt.startMin}
                    onChange={e => { setExtraCourt(ec => ({ ...ec, startMin: +e.target.value })); setResult(null); }}
                    style={{ width: 44, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 6px", color: C.text, fontSize: 12, fontFamily: font, textAlign: "center" }} />
                  <span style={{ fontSize: 11, color: C.textDim }}>m for</span>
                  <input type="number" min={gameMinutes} max={TOTAL_MINUTES} step={gameMinutes} value={extraCourt.durationMin}
                    onChange={e => { setExtraCourt(ec => ({ ...ec, durationMin: +e.target.value })); setResult(null); }}
                    style={{ width: 44, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 6px", color: C.text, fontSize: 12, fontFamily: font, textAlign: "center" }} />
                  <span style={{ fontSize: 11, color: C.textDim }}>m</span>
                </>)}
              </div>
            </div>
          )}
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>Availability</label>
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              {[["none", "All here"], ["group", "Early / Late"], ["custom", "Per player"]].map(([val, label]) => (
                <button key={val} onClick={() => { setStaggerMode(val); setResult(null); }}
                  style={{
                    background: staggerMode === val ? C.accentDim : C.card,
                    color: staggerMode === val ? "#fff" : C.textDim,
                    border: `1px solid ${staggerMode === val ? C.accentDim : C.border}`,
                    borderRadius: 6, padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: font, flex: 1,
                  }}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Player Input */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input value={nameInput} onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPlayer()} placeholder="Player name"
            style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 14px", color: C.text, fontSize: 14, fontFamily: font, outline: "none" }} />
          <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}` }}>
            {["M", "F"].map((g) => (
              <button key={g} onClick={() => setGenderInput(g)}
                style={{
                  background: genderInput === g ? (g === "M" ? C.accentDim : C.pinkDim) : C.card,
                  color: genderInput === g ? "#fff" : C.textDim,
                  border: "none", padding: "10px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: font,
                }}>{g === "M" ? "♂" : "♀"}</button>
            ))}
          </div>
          <button onClick={addPlayer}
            style={{ background: C.accent, color: C.bg, border: "none", borderRadius: 6, padding: "10px 18px", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: font }}>
            ADD
          </button>
          <button onClick={resetPlayers}
            style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: font }}>
            RESET
          </button>
          <button onClick={clearPlayers}
            style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: font }}>
            CLEAR
          </button>
        </div>

        {/* Player List */}
        {players.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
            {players.map((p, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px",
              }}>
                <span style={{ color: p.gender === "F" ? C.pink : C.accent, fontWeight: 700, fontSize: 14, minWidth: 70 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: C.textDim }}>{p.gender === "F" ? "♀" : "♂"}</span>

                {staggerMode === "group" && (
                  <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>
                    {[["early", "Early"], ["full", "Full"], ["late", "Late"]].map(([val, label]) => (
                      <button key={val} onClick={() => updatePlayer(i, "group", val)}
                        style={{
                          background: p.group === val ? (val === "early" ? "#065f46" : val === "late" ? "#7c2d12" : C.accentDim) : "transparent",
                          color: p.group === val ? "#fff" : C.textMuted,
                          border: `1px solid ${p.group === val ? "transparent" : C.border}`,
                          borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: font,
                        }}>{label}</button>
                    ))}
                  </div>
                )}

                {staggerMode === "custom" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                    <span style={{ fontSize: 11, color: C.textDim }}>Slots</span>
                    <input type="number" min={1} max={totalSlots} value={p.availFrom + 1}
                      onChange={(e) => updatePlayer(i, "availFrom", Math.max(0, Math.min(+e.target.value - 1, p.availTo)))}
                      style={{ width: 42, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 6px", color: C.text, fontSize: 12, fontFamily: font, textAlign: "center" }} />
                    <span style={{ color: C.textMuted, fontSize: 11 }}>to</span>
                    <input type="number" min={1} max={totalSlots} value={p.availTo + 1}
                      onChange={(e) => updatePlayer(i, "availTo", Math.max(p.availFrom, Math.min(+e.target.value - 1, totalSlots - 1)))}
                      style={{ width: 42, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 6px", color: C.text, fontSize: 12, fontFamily: font, textAlign: "center" }} />
                  </div>
                )}

                <button onClick={() => removePlayer(i)}
                  style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 16, padding: 0, marginLeft: staggerMode === "none" ? "auto" : 0 }}>×</button>
              </div>
            ))}
          </div>
        )}

        {players.length > 0 && players.length < 4 && (
          <p style={{ color: C.amber, fontSize: 12, marginBottom: 20, textAlign: "center" }}>Need at least 4 players</p>
        )}

        {/* Action Buttons */}
        {players.length >= 4 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            <button onClick={generate}
              style={{
                flex: 1, background: `linear-gradient(135deg, ${C.accentDim}, ${C.pinkDim})`,
                color: "#fff", border: "none", borderRadius: 8, padding: "14px",
                fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: font, letterSpacing: "1px", textTransform: "uppercase",
              }}>{result ? "🎲 RE-ROLL" : `GENERATE (${totalSlots} slots)`}</button>
            {result && (
              <button onClick={copySchedule}
                style={{
                  background: copied ? C.green : C.card, color: copied ? C.bg : C.text,
                  border: `1px solid ${copied ? C.green : C.border}`,
                  borderRadius: 8, padding: "14px 16px", fontSize: 14, fontWeight: 700,
                  cursor: "pointer", fontFamily: font, transition: "all 0.2s",
                }}>{copied ? "✓" : "📋"}</button>
            )}
            {result && (
              <button onClick={saveAsImage}
                style={{
                  background: C.card, color: C.text, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: "14px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: font,
                }}>📸</button>
            )}
          </div>
        )}

        {/* Results */}
        {result && (
          <div ref={scheduleRef} style={{ background: C.bg, padding: 16, borderRadius: 12 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 18, fontWeight: 700 }}>🏸 Badminton Schedule</span>
              <p style={{ fontSize: 12, color: C.textDim, margin: "4px 0 0" }}>
                {totalSlots} slots × {gameMinutes} min · {numCourts} court{numCourts > 1 ? "s" : ""}{extraCourt.enabled ? " +1 extra" : ""} · {players.length} players
              </p>
            </div>

            {/* Stats */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, color: C.textDim, textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 12px" }}>Games per Player</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {players.map((p, i) => {
                  const g = result.gamesPlayed[i];
                  const pct = maxGames > 0 ? (g / maxGames) * 100 : 0;
                  return (
                    <div key={i} style={{ flex: "1 1 calc(50% - 8px)", minWidth: 140 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 14, color: p.gender === "F" ? C.pink : C.accent }}>{p.name}</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{g}</span>
                      </div>
                      <div style={{ height: 5, background: C.border, borderRadius: 2 }}>
                        <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`, background: p.gender === "F" ? C.pink : C.accent }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 13, color: C.textDim, margin: "12px 0 0", textAlign: "center" }}>
                Spread: {minGames}–{maxGames} (diff: {maxGames - minGames})
                {maxGames - minGames <= 1 && <span style={{ color: C.green, marginLeft: 8 }}>✓ balanced</span>}
              </p>
            </div>

            {/* Schedule Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {result.schedule.map((s, idx) => (
                <div key={idx} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 13, color: C.textDim, fontWeight: 600 }}>SLOT {s.slot}</span>
                    <span style={{ fontSize: 12, color: C.textMuted }}>~{(s.slot - 1) * gameMinutes}–{s.slot * gameMinutes}m</span>
                  </div>

                  {s.courts.map((court, ci) => (
                    <div key={ci} style={{
                      background: COURT_BG[ci], borderLeft: `3px solid ${COURT_COLORS[ci]}`,
                      borderRadius: 6, padding: "8px 10px", marginBottom: ci < s.courts.length - 1 ? 6 : 0,
                    }}>
                      {s.courts.length > 1 && (
                        <div style={{ fontSize: 10, color: COURT_COLORS[ci], fontWeight: 700, marginBottom: 4, textTransform: "uppercase" }}>
                          Court {court.court}
                        </div>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                        <div style={{ textAlign: "center" }}>
                          {court.teamA.map((p, pi) => (
                            <span key={pi} style={{ color: p.gender === "F" ? C.pink : C.accent, fontSize: 15, fontWeight: 600 }}>
                              {p.name}{pi === 0 ? " · " : ""}
                            </span>
                          ))}
                        </div>
                        <span style={{ color: C.textMuted, fontSize: 11, fontWeight: 700 }}>VS</span>
                        <div style={{ textAlign: "center" }}>
                          {court.teamB.map((p, pi) => (
                            <span key={pi} style={{ color: p.gender === "F" ? C.pink : C.accent, fontSize: 15, fontWeight: 600 }}>
                              {p.name}{pi === 0 ? " · " : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}

                  {s.courts.length === 0 && (
                    <div style={{ textAlign: "center", padding: 10, color: C.textMuted, fontSize: 12 }}>Not enough players</div>
                  )}

                  {s.sitting && s.sitting.length > 0 && (
                    <div style={{ marginTop: 8, textAlign: "center" }}>
                      <span style={{ fontSize: 12, color: C.textMuted }}>Sit: {s.sitting.map((p) => p.name).join(", ")}</span>
                    </div>
                  )}

                  {/* Player tracker */}
                  <div style={{
                    marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`,
                    display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 8,
                  }}>
                    {s.playerState.filter((ps) => ps.available).map((ps, pi) => (
                      <div key={pi} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <span style={{
                          fontSize: 12, fontWeight: 700,
                          color: ps.playing ? (ps.gender === "F" ? C.pink : C.accent) : C.textMuted,
                        }}>{ps.name}</span>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <span style={{
                            fontSize: 11, fontWeight: 600,
                            background: ps.playing ? "rgba(34,211,238,0.15)" : "rgba(100,116,139,0.15)",
                            color: ps.playing ? C.green : C.textMuted,
                            padding: "2px 6px", borderRadius: 4,
                          }}>{ps.playing ? `ON ${ps.conPlayed}` : `OFF ${ps.conRested}`}</span>
                          <span style={{
                            fontSize: 11, fontWeight: 600, color: C.text,
                            background: "rgba(226,232,240,0.1)", padding: "2px 6px", borderRadius: 4,
                          }}>{ps.total}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
