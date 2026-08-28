import { useCallback, useEffect, useRef } from 'react';
import type { ForcedFirstSlot, GeneratorYield, Player, PlayerInGame } from './algorithm/types';
import { generateSchedule, generateScheduleGen, extractState, recomputeStats } from './algorithm/scheduler';
import { C, DEFAULT_PLAYERS, FONT } from './constants';
import { usePlannerState } from './hooks/usePlannerState';
import { useAdminAuth } from './hooks/useAdminAuth';
import { usePlayerRoster } from './hooks/usePlayerRoster';
import { useWinLossSync } from './hooks/useWinLossSync';
import { pruneExpiredPlans } from './utils/pruneExpiredPlans';
import { computeCourtsPerSlot } from './utils/courtsPerSlot';
import { applyAvailability as applyAvailabilityUtil } from './utils/availability';
import { formatSlotTime } from './utils/slotTime';
import { isValidBadmintonScore } from './utils/scoreValidation';
import { gameMatches, keepGamesBeforeSlot } from './utils/liveQueue';
import { useLiveQueue } from './hooks/useLiveQueue';
import { parseScheduleText as parseScheduleTextUtil, buildCopyText as buildCopyTextUtil } from './utils/scheduleText';
import { buildSharePayload as buildSharePayloadUtil, reconstructScheduleFromSharePayload, upsertSavedPlanFromShare } from './utils/sharePayload';
import PlayerList from './components/PlayerList';
import ScheduleGrid from './components/ScheduleGrid';
import SessionSettingsPanel from './components/SessionSettingsPanel';
import SessionStatusPanel from './components/SessionStatusPanel';
import AboutTab from './components/AboutTab';
import {
  ArchiveTab,
  ConfirmOverwriteModal,
  ImportModal,
  LucideIcon,
  PinPromptModal,
  SavePlanModal,
  ShareLinkModal,
} from './components/PlannerModals';
import {
  isFirebaseConfigured,
  createShare,
  updateShare,
  fetchShare,
} from './firebase';
import type { EditLayout, PlannerResult, SavedPlan, ScoresMap, SharePayload, WinLossMap } from './types';

function normalizeApiBase(base: string | null | undefined) {
  return base ? base.replace(/\/+$/, '') : null;
}

function copyText(text: string, onCopied?: () => void) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    onCopied?.();
  } catch {}
  document.body.removeChild(ta);
}

function BadmintonPlanner() {
  const { state, setField, patchState } = usePlannerState();
  const scheduleRef = useRef<HTMLDivElement | null>(null);

  const {
    players,
    playerHistory,
    nameInput,
    genderInput,
    totalMinutes,
    gameMinutes,
    numCourts,
    extraCourt,
    staggerMode,
    sessionStart,
    result,
    scores,
    winLoss,
    fromSlot,
    fromSlotCourts,
    copied,
    copiedGames,
    saved,
    isGenerating,
    genSlot,
    showPinPrompt,
    pinInput,
    pinError,
    showImport,
    importText,
    importError,
    savedPlans,
    showSavePlan,
    saveTag,
    activeTab,
    editingSlot,
    editLayout,
    pendingShare,
    showShareLoad,
    showShareModal,
    sharedUrl,
    copiedShareUrl,
    shareIsUpdate,
    shareId,
    shareToken,
    isSharedSession,
    preferMixedTeams,
    isConfirmed,
    pendingOverwrite,
    loadedPlanId,
    shareNotice,
    liveGames,
    completedGames,
    suspendedPlayerNames,
  } = state;

  const totalSlots = Math.floor(totalMinutes / gameMinutes);
  const minGames = result ? Math.min(...result.gamesPlayed) : 0;
  const maxGames = result ? Math.max(...result.gamesPlayed) : 0;
  const hasAppliedScores = result && Object.values(scores).some(s => s.applied);
  const allDefaultsLoaded = DEFAULT_PLAYERS.every(dp => players.some(p => p.name.toLowerCase() === dp.name.toLowerCase()));

  const { isAdmin, submitPin, toggleAdminLock } = useAdminAuth({ pinInput, patchState });
  const {
    loadDefaults,
    resetPlayers,
    clearPlayers,
    addPlayer,
    addSelectedFromBank,
    addToBank,
    removeFromHistory,
    removePlayer,
    updatePlayer,
  } = usePlayerRoster({ players, playerHistory, nameInput, genderInput, totalSlots, patchState });
  const { dbSynced, computeSkill, updateScore: updateScoreBase, clearWinLoss } = useWinLossSync({ winLoss, scores, isAdmin, patchState });

  useEffect(() => {
    if (players.length === 0) return;
    const known = new Set(playerHistory.map(p => p.name.toLowerCase()));
    const newOnes = players.filter(p => !known.has(p.name.toLowerCase()));
    if (newOnes.length === 0) return;
    patchState({
      playerHistory: [...playerHistory, ...newOnes.map(p => ({ name: p.name, gender: p.gender }))],
    });
  }, [players]);

  useEffect(() => {
    const fresh = pruneExpiredPlans(savedPlans, Date.now());
    if (fresh.length !== savedPlans.length) patchState({ savedPlans: fresh });
  }, [savedPlans]);

  useEffect(() => {
    if (!result) return;
    patchState({ saved: true });
    const t = setTimeout(() => patchState({ saved: false }), 2000);
    return () => clearTimeout(t);
  }, [result]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlShareId = params.get('share');

    if (urlShareId && isFirebaseConfigured()) {
      fetchShare(urlShareId)
        .then(result => {
          if (result.status === 'ok' && result.data?.v === 1 && result.data.p && result.data.slots) {
            applySharePayload(result.data, urlShareId);
            patchState({ shareId: urlShareId, isSharedSession: true });
          } else if (result.status === 'expired') {
            patchState({ shareNotice: 'expired' });
          }
        })
        .catch(() => {})
        .finally(() => window.history.replaceState(null, '', window.location.pathname));
      return;
    }

    const apiBase = normalizeApiBase(window.SHARE_API_BASE);
    if (urlShareId && apiBase) {
      fetch(`${apiBase}/shares/${encodeURIComponent(urlShareId)}`)
        .then(async response => {
          if (!response.ok) throw new Error(`Share load failed: ${response.status}`);
          return response.json();
        })
        .then(payload => {
          const data = payload?.data;
          if (data?.v === 1 && data.p && data.slots) {
            applySharePayload(data);
            window.history.replaceState(null, '', window.location.pathname);
          }
        })
        .catch(() => {});
      return;
    }

    const hash = window.location.hash;
    if (hash.startsWith('#share=')) {
      try {
        const data = JSON.parse(atob(hash.slice(7)));
        if (data.v === 1 && data.p && data.slots) {
          applySharePayload(data);
          window.history.replaceState(null, '', window.location.pathname);
        }
      } catch {}
      return;
    }

    // No ?share= in the URL this load, but sessionStorage remembers this tab was already
    // viewing/editing a share (e.g. a page refresh) — re-fetch its content, since that
    // content is deliberately excluded from localStorage.
    if (isSharedSession && shareId && isFirebaseConfigured()) {
      fetchShare(shareId)
        .then(result => {
          if (result.status === 'ok' && result.data?.v === 1 && result.data.p && result.data.slots) {
            applySharePayload(result.data, shareId);
          } else if (result.status === 'expired') {
            patchState({ shareNotice: 'expired', shareId: null, isSharedSession: false });
          }
        })
        .catch(() => {});
    }
  }, []);

  const slotTime = useCallback((slotIdx: number) => formatSlotTime(slotIdx, { gameMinutes, sessionStart }), [gameMinutes, sessionStart]);

  const getCourtsPerSlot = useCallback(
    () => computeCourtsPerSlot({ totalSlots, gameMinutes, numCourts, extraCourt }),
    [extraCourt, gameMinutes, numCourts, totalSlots]
  );

  const applyAvailability = useCallback(
    (basePlayers: Player[]) => applyAvailabilityUtil(basePlayers, { staggerMode, totalSlots }),
    [staggerMode, totalSlots]
  );

  const getPlayersWithAvailability = useCallback(() => applyAvailability(players), [applyAvailability, players]);

  const buildSharePayload = useCallback(
    () => buildSharePayloadUtil({ result, playersWithAvailability: getPlayersWithAvailability(), gameMinutes, numCourts, scores, isConfirmed }),
    [gameMinutes, getPlayersWithAvailability, isConfirmed, numCourts, result, scores]
  );

  const parseScheduleText = useCallback((text: string) => parseScheduleTextUtil(text, players), [players]);

  const runImport = useCallback(() => {
    const parsed = parseScheduleText(importText);
    if (!parsed) {
      patchState({ importError: 'Could not parse schedule — paste the full copied text.' });
      return;
    }
    patchState({ result: parsed, scores: {}, showImport: false, importText: '', importError: '', isConfirmed: false, loadedPlanId: null, liveGames: [], completedGames: [], suspendedPlayerNames: [] });
  }, [importText, parseScheduleText]);

  const importSchedule = useCallback(() => {
    if (isConfirmed) {
      patchState({ pendingOverwrite: 'import' });
      return;
    }
    runImport();
  }, [isConfirmed, runImport]);

  const runGenerate = useCallback(() => {
    if (players.length < 4 || isGenerating) return;
    patchState({ isGenerating: true, result: null, scores: {}, copied: false, genSlot: 0, isConfirmed: false, loadedPlanId: null, liveGames: [], completedGames: [], suspendedPlayerNames: [], fromSlot: 1 });
    const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name) }));
    const gen = generateScheduleGen(playersWithSkill, totalSlots, getCourtsPerSlot(), 0, null, null, { preferMixedTeams });
    let lastValue: GeneratorYield | null = null;
    function step() {
      const { value, done } = gen.next();
      if (value) {
        lastValue = value;
        patchState({ genSlot: value.schedule.length });
      }
      if (done) patchState({ result: lastValue, isGenerating: false });
      else requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, [computeSkill, getCourtsPerSlot, getPlayersWithAvailability, isGenerating, players.length, preferMixedTeams, totalSlots]);

  const generate = useCallback(() => {
    if (players.length < 4 || isGenerating) return;
    if (isConfirmed) {
      patchState({ pendingOverwrite: 'generate' });
      return;
    }
    runGenerate();
  }, [isConfirmed, isGenerating, players.length, runGenerate]);

  const runRegenerateFromSlotWithCourts = useCallback((targetFromSlot: number, targetCourts: number) => {
    if (players.length < 4 || !result) return;
    const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name) }));
    const keptSlots = result.schedule.slice(0, targetFromSlot - 1);
    const stateSnapshot = extractState(keptSlots, playersWithSkill);
    const courtsArr = getCourtsPerSlot();
    if (targetCourts > 0) {
      for (let i = targetFromSlot - 1; i < totalSlots; i++) courtsArr[i] = targetCourts;
    }
    const newResult = generateSchedule(playersWithSkill, totalSlots, courtsArr, targetFromSlot - 1, stateSnapshot, null, { preferMixedTeams });
    if (!newResult) return;
    const nextScores: ScoresMap = {};
    for (const key in scores) {
      const match = key.match(/^s(\d+)c/);
      if (match && parseInt(match[1]!, 10) < targetFromSlot && scores[key]) nextScores[key] = scores[key];
    }
    patchState({
      result: newResult,
      scores: nextScores,
      copied: false,
      isConfirmed: false,
      loadedPlanId: null,
      liveGames: keepGamesBeforeSlot(liveGames, targetFromSlot),
      completedGames: keepGamesBeforeSlot(completedGames, targetFromSlot),
      suspendedPlayerNames: [],
      fromSlot: targetFromSlot,
      fromSlotCourts: targetCourts,
    });
  }, [completedGames, computeSkill, getCourtsPerSlot, getPlayersWithAvailability, liveGames, players.length, preferMixedTeams, result, scores, totalSlots]);

  const runRegenerateRemaining = useCallback(() => {
    runRegenerateFromSlotWithCourts(fromSlot, fromSlotCourts);
  }, [fromSlot, fromSlotCourts, runRegenerateFromSlotWithCourts]);

  const regenerateRemaining = useCallback(() => {
    if (players.length < 4 || !result) return;
    if (isConfirmed) {
      patchState({ pendingOverwrite: 'regenerateRemaining' });
      return;
    }
    runRegenerateRemaining();
  }, [isConfirmed, players.length, result, runRegenerateRemaining]);

  // Inline "+/-" court stepper on a SlotCard: adds/removes a court starting at that
  // slot and cascading to the end of the session (same semantics as the "Re-generate
  // from slot" bar), without needing to scroll to that bar and type the slot number.
  const adjustCourtsAtSlot = useCallback((slotNum: number, delta: number) => {
    if (!result) return;
    const slotData = result.schedule.find(s => s.slot === slotNum);
    const current = slotData ? slotData.courts.length : 0;
    // Never land on 0: fromSlotCourts===0 means "auto" (fall back to the settings-based
    // count), a different concept from "no courts" — keep the stepper's floor at 1.
    const next = Math.max(1, Math.min(4, current + delta));
    if (next === current) return;
    if (isConfirmed) {
      patchState({ fromSlot: slotNum, fromSlotCourts: next, pendingOverwrite: 'regenerateRemaining' });
      return;
    }
    runRegenerateFromSlotWithCourts(slotNum, next);
  }, [isConfirmed, result, runRegenerateFromSlotWithCourts]);

  const runClearSchedule = useCallback(() => {
    patchState({ result: null, scores: {}, fromSlot: 1, isConfirmed: false, loadedPlanId: null, liveGames: [], completedGames: [], suspendedPlayerNames: [] });
  }, []);

  const clearSchedule = useCallback(() => {
    if (isConfirmed) {
      patchState({ pendingOverwrite: 'clear' });
      return;
    }
    runClearSchedule();
  }, [isConfirmed, runClearSchedule]);

  const confirmSchedule = useCallback(() => patchState({ isConfirmed: true }), []);
  const unconfirmSchedule = useCallback(() => patchState({ isConfirmed: false }), []);

  // Regen helper for session-status handlers (late arrivals / early departures).
  // overridePlayers lets the caller pass a pre-modified player list so the new
  // availability takes effect without waiting for a state round-trip.
  const doRegen = useCallback((targetFromSlot: number, overridePlayers: Player[] | null, blockedForFirstSlot: Set<string> = new Set(), overrideWinLoss: WinLossMap | null = null, overrideScores: ScoresMap | null = null, baseResult: PlannerResult | null = result, forcedFirstSlot: ForcedFirstSlot | null = null) => {
    if (!baseResult) return null;
    const basePlayers = overridePlayers ?? players;
    const targetSlotIdx = targetFromSlot - 1;
    const sourceWinLoss = overrideWinLoss ?? winLoss;
    const skillFor = (name: string) => {
      const wl = sourceWinLoss[name];
      if (!wl || wl.wins + wl.losses === 0) return 0.5;
      return wl.wins / (wl.wins + wl.losses);
    };
    const playersWithSkill = applyAvailability(basePlayers).map(p => {
      const shouldBlock =
        blockedForFirstSlot.has(p.name) &&
        targetSlotIdx >= p.availFrom &&
        targetSlotIdx <= p.availTo;
      return {
        ...p,
        skill: skillFor(p.name),
        ...(shouldBlock ? { availFrom: Math.max(p.availFrom, targetSlotIdx + 1) } : {}),
      };
    });
    const keptSlots = baseResult.schedule.slice(0, targetFromSlot - 1);
    const stateSnapshot = extractState(keptSlots, playersWithSkill);
    const courtsArr = getCourtsPerSlot();
    const newResult = generateSchedule(playersWithSkill, totalSlots, courtsArr, targetFromSlot - 1, stateSnapshot, forcedFirstSlot, { preferMixedTeams });
    if (!newResult) return null;
    const nextScores: ScoresMap = {};
    const sourceScores = overrideScores ?? scores;
    for (const key in sourceScores) {
      const m = key.match(/^s(\d+)c/);
      if (m && parseInt(m[1]!, 10) < targetFromSlot && sourceScores[key]) nextScores[key] = sourceScores[key];
    }
    return { newResult, nextScores };
  }, [applyAvailability, getCourtsPerSlot, players, preferMixedTeams, result, scores, totalSlots, winLoss]);

  const setPlayerBack = useCallback((idx: number) => {
    patchState({ players: players.map((p, i) => i === idx ? { ...p, leavesAt: null } : p) });
  }, [players]);

  const {
    applyLiveGamesUpdate,
    blockedPlayerNames,
    setPlayerJoining,
    setPlayerLeaving,
    toggleLiveGame,
    togglePlayerSuspended,
  } = useLiveQueue({
    result,
    players,
    liveGames,
    completedGames,
    suspendedPlayerNames,
    fromSlot,
    totalSlots,
    getCourtsPerSlot,
    regenerate: ({ targetFromSlot, overridePlayers, blockedForFirstSlot, overrideWinLoss, overrideScores, baseResult, forcedFirstSlot }) => doRegen(targetFromSlot, overridePlayers ?? null, blockedForFirstSlot ?? new Set(), overrideWinLoss ?? null, overrideScores ?? null, baseResult, forcedFirstSlot ?? null),
    patchState,
    canPlayerJoin: staggerMode === 'custom',
  });

  const executeOverwrite = useCallback(() => {
    if (result && result.schedule?.length) {
      patchState({ savedPlans: [{ id: Date.now(), tag: '', result, savedAt: new Date().toISOString() }, ...savedPlans] });
    }
    patchState({ pendingOverwrite: null });
    if (pendingOverwrite === 'generate') runGenerate();
    else if (pendingOverwrite === 'clear') runClearSchedule();
    else if (pendingOverwrite === 'import') runImport();
    else if (pendingOverwrite === 'regenerateRemaining') runRegenerateRemaining();
  }, [pendingOverwrite, result, savedPlans, runGenerate, runClearSchedule, runImport, runRegenerateRemaining]);

  const cancelOverwrite = useCallback(() => patchState({ pendingOverwrite: null }), []);

  const startSlotEdit = useCallback((slotNum: number) => {
    const s = result?.schedule.find(slot => slot.slot === slotNum);
    if (!s) return;
    patchState({
      editLayout: {
        courts: s.courts.map(c => [...c.teamA.map(p => p.name), ...c.teamB.map(p => p.name)]),
        sitting: s.sitting.map(p => p.name),
      },
      editingSlot: slotNum,
    });
  }, [result]);

  const assignToPosition = useCallback((pos: { type: 'court'; ci: number; idx: number } | { type: 'sit'; idx: number }, newName: string) => {
    if (!editLayout) return;
    type Position = { type: 'court'; ci: number; idx: number } | { type: 'sit'; idx: number };
    const findPos = (name: string): Position | null => {
      for (let ci = 0; ci < editLayout.courts.length; ci++) {
        const court = editLayout.courts[ci];
        if (!court) continue;
        const idx = court.indexOf(name);
        if (idx >= 0) return { type: 'court', ci, idx };
      }
      const idx = editLayout.sitting.indexOf(name);
      return idx >= 0 ? { type: 'sit', idx } : null;
    };
    const other = findPos(newName);
    const courts = editLayout.courts.map(c => [...c]);
    const sitting = [...editLayout.sitting];
    const get = (p: Position): string | undefined => p.type === 'court' ? courts[p.ci]?.[p.idx] : sitting[p.idx];
    const set = (p: Position, value: string) => {
      if (p.type === 'court') {
        const court = courts[p.ci];
        if (court) court[p.idx] = value;
      } else {
        sitting[p.idx] = value;
      }
    };
    const av = get(pos);
    if (!av) return;
    if (!other) {
      set(pos, newName);
      if (pos.type === 'court' && av && !sitting.includes(av)) sitting.push(av);
      patchState({ editLayout: { courts, sitting } });
      return;
    }
    const bv = get(other);
    if (!bv) return;
    set(pos, bv);
    set(other, av);
    patchState({ editLayout: { courts, sitting } });
  }, [editLayout]);

  const applySlotEdit = useCallback(() => {
    if (!editingSlot || !result || !editLayout) return;
    const slotIdx = editingSlot - 1;
    const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name) }));
    const keptSlots = result.schedule.slice(0, slotIdx);
    const stateSnapshot = extractState(keptSlots, playersWithSkill);
    const nameToIdx = new Map(playersWithSkill.map((p, i) => [p.name, i]));
    const courtsForced = editLayout.courts.map(court => court.map(name => nameToIdx.get(name)).filter(i => i !== undefined));
    if (courtsForced.some(c => c.length !== 4)) return;
    const newResult = generateSchedule(playersWithSkill, totalSlots, getCourtsPerSlot(), slotIdx, stateSnapshot, { courts: courtsForced }, { preferMixedTeams });
    if (!newResult) return;
    const nextScores: ScoresMap = {};
    for (const key in scores) {
      const match = key.match(/^s(\d+)c/);
      if (match && parseInt(match[1]!, 10) < editingSlot && scores[key]) nextScores[key] = scores[key];
    }
    patchState({
      result: newResult,
      scores: nextScores,
      liveGames: keepGamesBeforeSlot(liveGames, editingSlot),
      completedGames: keepGamesBeforeSlot(completedGames, editingSlot),
      editingSlot: null,
      editLayout: null,
      copied: false,
    });
  }, [completedGames, computeSkill, editLayout, editingSlot, getCourtsPerSlot, getPlayersWithAvailability, liveGames, result, scores, totalSlots]);

  const applySlotEditOnly = useCallback(() => {
    if (!editingSlot || !result || !editLayout) return;
    const slotIdx = editingSlot - 1;
    const origSlot = result.schedule[slotIdx];
    if (!origSlot) return;
    const playerFor = (name: string): PlayerInGame => ({ name, gender: players.find(p => p.name === name)?.gender ?? 'M' });
    const newCourts = editLayout.courts.map((court, ci) => ({
      court: origSlot.courts[ci]?.court ?? ci + 1,
      teamA: [playerFor(court[0] ?? ''), playerFor(court[1] ?? '')] as [PlayerInGame, PlayerInGame],
      teamB: [playerFor(court[2] ?? ''), playerFor(court[3] ?? '')] as [PlayerInGame, PlayerInGame],
    }));
    const newSitting = editLayout.sitting.map(playerFor);
    const newScheduleRaw = result.schedule.map((slot, i) =>
      i === slotIdx ? { ...slot, courts: newCourts, sitting: newSitting } : slot
    );
    const { schedule: newSchedule, gamesPlayed } = recomputeStats(newScheduleRaw, players);
    patchState({
      result: { schedule: newSchedule, gamesPlayed },
      liveGames: keepGamesBeforeSlot(liveGames, editingSlot),
      completedGames: keepGamesBeforeSlot(completedGames, editingSlot),
      editingSlot: null,
      editLayout: null,
      copied: false,
    });
  }, [completedGames, editingSlot, editLayout, liveGames, players, result]);

  const updateScore = useCallback((slot: number, courtIdx: number, aVal: string, bVal: string, teamA: string[], teamB: string[]) => {
    const key = `s${slot}c${courtIdx}`;
    const aNum = parseInt(aVal);
    const bNum = parseInt(bVal);
    const valid = !isNaN(aNum) && !isNaN(bNum) && isValidBadmintonScore(aNum, bNum);
    const isLive = liveGames.some(lg => lg.slot === slot && lg.court === courtIdx);
    if (!isAdmin || !valid || !isLive) {
      updateScoreBase(slot, courtIdx, aVal, bVal, teamA, teamB);
      return;
    }

    const prevEntry = scores[key];
    const nextWinLoss = JSON.parse(JSON.stringify(winLoss));
    if (prevEntry?.applied) {
      const pA = parseInt(prevEntry.a);
      const pB = parseInt(prevEntry.b);
      const winners = pA > pB ? prevEntry.teamA : prevEntry.teamB;
      const losers = pA > pB ? prevEntry.teamB : prevEntry.teamA;
      winners.forEach(name => { if (nextWinLoss[name]) nextWinLoss[name].wins = Math.max(0, nextWinLoss[name].wins - 1); });
      losers.forEach(name => { if (nextWinLoss[name]) nextWinLoss[name].losses = Math.max(0, nextWinLoss[name].losses - 1); });
    }

    const winners = aNum > bNum ? teamA : teamB;
    const losers = aNum > bNum ? teamB : teamA;
    winners.forEach(name => { nextWinLoss[name] = { wins: (nextWinLoss[name]?.wins ?? 0) + 1, losses: nextWinLoss[name]?.losses ?? 0 }; });
    losers.forEach(name => { nextWinLoss[name] = { wins: nextWinLoss[name]?.wins ?? 0, losses: (nextWinLoss[name]?.losses ?? 0) + 1 }; });

    const nextScores: ScoresMap = { ...scores, [key]: { a: aVal, b: bVal, applied: true, teamA, teamB } };
    const nextLiveGames = liveGames.filter(lg => !(lg.slot === slot && lg.court === courtIdx));
    const nextCompletedGames = [
      ...completedGames.filter(game => !gameMatches(game, slot, courtIdx)),
      { slot, court: courtIdx },
    ];
    applyLiveGamesUpdate(nextLiveGames, slot, nextCompletedGames, { scores: nextScores, winLoss: nextWinLoss }, { targetLiveCount: liveGames.length });
  }, [applyLiveGamesUpdate, completedGames, isAdmin, liveGames, scores, updateScoreBase, winLoss]);

  const buildCopyText = useCallback(
    (mode: 'full' | 'games') => buildCopyTextUtil(result, { mode, extraCourt, numCourts, gameMinutes, sessionStart, totalSlots, players, scores }),
    [extraCourt, gameMinutes, numCourts, players, result, scores, sessionStart, totalSlots]
  );

  const copySchedule = useCallback(() => {
    copyText(buildCopyText('full'), () => {
      patchState({ copied: true });
      setTimeout(() => patchState({ copied: false }), 2000);
    });
  }, [buildCopyText]);

  const copyGames = useCallback(() => {
    copyText(buildCopyText('games'), () => {
      patchState({ copiedGames: true });
      setTimeout(() => patchState({ copiedGames: false }), 2000);
    });
  }, [buildCopyText]);

  const saveAsImage = useCallback(async () => {
    if (!scheduleRef.current) return;
    if (!window.html2canvas) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    const renderCanvas = window.html2canvas;
    if (!renderCanvas) return;
    const canvas = await renderCanvas(scheduleRef.current, { backgroundColor: C.bg, scale: 2 });
    const link = document.createElement('a');
    link.download = 'badminton-schedule.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  const savePlan = useCallback((mode?: 'update' | 'new') => {
    if (!result || !saveTag.trim()) return;
    const trimmedTag = saveTag.trim();
    const targetId = mode === 'new'
      ? null
      : mode === 'update' && loadedPlanId != null && savedPlans.some(p => p.id === loadedPlanId)
      ? loadedPlanId
      : savedPlans.find(p => p.tag.trim().toLowerCase() === trimmedTag.toLowerCase())?.id ?? null;

    if (targetId != null) {
      patchState({
        savedPlans: savedPlans.map(p => p.id === targetId ? { ...p, tag: trimmedTag, result, savedAt: new Date().toISOString() } : p),
        showSavePlan: false,
        saveTag: '',
        loadedPlanId: targetId,
      });
    } else {
      const newId = Date.now();
      patchState({
        savedPlans: [{ id: newId, tag: trimmedTag, result, savedAt: new Date().toISOString() }, ...savedPlans],
        showSavePlan: false,
        saveTag: '',
        loadedPlanId: newId,
      });
    }

    if (isSharedSession && shareId && isFirebaseConfigured()) {
      const payload = buildSharePayload();
      if (payload) updateShare(shareId, payload);
    }
  }, [buildSharePayload, isSharedSession, loadedPlanId, result, saveTag, savedPlans, shareId]);

  const loadPlan = useCallback((plan: SavedPlan) => {
    patchState({ result: plan.result, scores: {}, activeTab: 'schedule', isConfirmed: false, loadedPlanId: plan.id, shareId: null, shareToken: null, isSharedSession: false, liveGames: [], completedGames: [], suspendedPlayerNames: [] });
  }, []);

  const deletePlan = useCallback((id: number) => {
    patchState({
      savedPlans: savedPlans.filter(plan => plan.id !== id),
      ...(id === loadedPlanId ? { loadedPlanId: null } : {}),
    });
  }, [loadedPlanId, savedPlans]);

  const shareLink = useCallback(async (forceNew = false) => {
    const data = buildSharePayload();
    if (!data) return;

    if (isFirebaseConfigured()) {
      const existingId = !forceNew ? shareId : null;
      const id = existingId || createShare(data);
      if (existingId) updateShare(existingId, data);
      if (id) {
        patchState({ shareId: id, shareToken: null, isSharedSession: true });
        const url = `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(id)}`;
        copyText(url, () => {
          patchState({ sharedUrl: url, copiedShareUrl: true, showShareModal: true, shareIsUpdate: !!existingId });
          setTimeout(() => patchState({ copiedShareUrl: false }), 2000);
        });
        return;
      }
    }

    const apiBase = normalizeApiBase(window.SHARE_API_BASE);
    if (apiBase) {
      try {
        const existingId = !forceNew ? shareId : null;
        const existingToken = !forceNew ? shareToken : null;
        const isUpdate = !!(existingId && existingToken);

        const response = await fetch(
          isUpdate ? `${apiBase}/shares/${encodeURIComponent(existingId!)}` : `${apiBase}/shares`,
          {
            method: isUpdate ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(isUpdate ? { data, token: existingToken } : { data }),
          },
        );
        if (!response.ok) throw new Error(`Share ${isUpdate ? 'update' : 'save'} failed: ${response.status}`);
        const payload = await response.json();
        const id = isUpdate ? existingId! : payload?.id;
        const token = isUpdate ? existingToken! : payload?.token;
        if (id) {
          const url = `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(id)}`;
          copyText(url, () => {
            patchState({ sharedUrl: url, copiedShareUrl: true, showShareModal: true, shareIsUpdate: isUpdate, shareId: id, shareToken: token });
            setTimeout(() => patchState({ copiedShareUrl: false }), 2000);
          });
          return;
        }
      } catch {}
    }

    // Fallback: encode full schedule in URL hash (no token, always new)
    const fallbackUrl = `${window.location.origin}${window.location.pathname}#share=${btoa(JSON.stringify(data))}`;
    copyText(fallbackUrl, () => {
      patchState({ sharedUrl: fallbackUrl, copiedShareUrl: true, showShareModal: true, shareIsUpdate: false });
      setTimeout(() => patchState({ copiedShareUrl: false }), 2000);
    });
  }, [buildSharePayload, shareId, shareToken]);

  const copyShareUrl = useCallback(() => {
    copyText(sharedUrl, () => {
      patchState({ copiedShareUrl: true });
      setTimeout(() => patchState({ copiedShareUrl: false }), 2000);
    });
  }, [sharedUrl]);

  const applySharePayload = useCallback((data: SharePayload, sourceShareId?: string) => {
    const decoded = reconstructScheduleFromSharePayload(data as unknown as { p: [string, string][]; cfg?: { g?: number; c?: number }; slots: any[]; scores?: Record<string, any>; confirmed?: boolean }, { currentGameMinutes: gameMinutes, currentNumCourts: numCourts });
    const { savedPlans: nextSavedPlans, loadedPlanId: newLoadedPlanId } = upsertSavedPlanFromShare(savedPlans as unknown as { id: number | string; sourceShareId?: string }[], sourceShareId ?? null, decoded.result);

    patchState({
      players: decoded.players as unknown as Player[],
      gameMinutes: typeof decoded.gameMinutes === 'number' ? decoded.gameMinutes : gameMinutes,
      numCourts: decoded.numCourts,
      result: decoded.result as PlannerResult,
      scores: decoded.scores,
      isConfirmed: decoded.isConfirmed,
      loadedPlanId: typeof newLoadedPlanId === 'number' ? newLoadedPlanId : null,
      savedPlans: nextSavedPlans as SavedPlan[],
      liveGames: [],
      completedGames: [],
      suspendedPlayerNames: [],
    });
  }, [gameMinutes, numCourts, savedPlans]);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        {showPinPrompt && <PinPromptModal pinInput={pinInput} pinError={pinError} setPinInput={value => patchState({ pinInput: value, pinError: false })} submitPin={submitPin} close={() => patchState({ showPinPrompt: false, pinInput: '', pinError: false })} />}
        {showSavePlan && <SavePlanModal needsPin={Boolean(window.ADMIN_PIN && !isAdmin)} pinInput={pinInput} pinError={pinError} setPinInput={value => patchState({ pinInput: value, pinError: false })} submitPin={submitPin} saveTag={saveTag} setSaveTag={value => patchState({ saveTag: value })} savePlan={savePlan} canUpdate={loadedPlanId != null && savedPlans.some(p => p.id === loadedPlanId)} savedPlans={savedPlans} isSharedSession={isSharedSession} close={() => patchState({ showSavePlan: false, pinInput: '', pinError: false })} />}
        {showShareModal && <ShareLinkModal copiedShareUrl={copiedShareUrl} sharedUrl={sharedUrl} shareIsUpdate={shareIsUpdate} hasExisting={isFirebaseConfigured() ? !!shareId : !!(shareId && shareToken)} copyShareUrl={copyShareUrl} newShareLink={() => shareLink(true)} close={() => patchState({ showShareModal: false })} />}
        {showImport && <ImportModal importText={importText} importError={importError} setImportText={value => patchState({ importText: value, importError: '' })} importSchedule={importSchedule} close={() => patchState({ showImport: false, importText: '', importError: '' })} />}

        <div style={{ marginBottom: 28, borderBottom: `1px solid ${C.border}`, paddingBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              Match Planner
              {import.meta.env.VITE_BETA === 'true' && (
                <span title="This is the beta test site — separate from the live site, but shares its data" style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 4, padding: '2px 6px', verticalAlign: 'middle' }}>
                  BETA
                </span>
              )}
            </h1>
            <p style={{ color: C.textDim, fontSize: 13, margin: '6px 0 0' }}>
              {Math.floor(totalMinutes / 60)}h{totalMinutes % 60 ? `${totalMinutes % 60}m` : ''} · {totalSlots} slots × {gameMinutes} min · {numCourts} court{numCourts > 1 ? 's' : ''}{extraCourt.enabled ? ` +1 extra (${extraCourt.startMin}–${extraCourt.startMin + extraCourt.durationMin}m)` : ''}
            </p>
            <p title={new Date(__BUILD_TIME__).toString()} style={{ color: C.textMuted, fontSize: 11, margin: '4px 0 0' }}>
              Updated {new Date(__BUILD_TIME__).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            {isFirebaseConfigured() && <span title={dbSynced === 'synced' ? 'Win-loss synced to cloud' : dbSynced === 'syncing' ? 'Syncing…' : dbSynced === 'error' ? 'Sync failed' : 'Cloud sync ready'} style={{ fontSize: 13, color: dbSynced === 'synced' ? C.green : dbSynced === 'error' ? '#ef4444' : C.textMuted }}>{dbSynced === 'synced' ? '☁ Synced' : dbSynced === 'syncing' ? '⟳' : dbSynced === 'error' ? '☁ ✗' : '☁'}</span>}
            {window.ADMIN_PIN && (
              <button onClick={toggleAdminLock} title={isAdmin ? 'Click to lock score entry' : 'Click to unlock score entry'} style={{ background: isAdmin ? C.accentDim : C.card, color: isAdmin ? '#fff' : C.textMuted, border: `1px solid ${isAdmin ? 'transparent' : C.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, fontFamily: FONT }}>
                {isAdmin ? '🔓 Admin' : '🔒 Lock'}
              </button>
            )}
          </div>
        </div>

        {shareNotice === 'expired' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16, background: C.card, border: `1px solid ${C.amber}33`, borderRadius: 8, padding: '10px 14px' }}>
            <span style={{ fontSize: 12, color: C.amber }}>⚡ This share link has expired (older than 30 days) and was removed.</span>
            <button onClick={() => patchState({ shareNotice: null })} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 16, padding: 0 }}>×</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {([['schedule', 'Schedule'], ['archive', `Saved Plans${savedPlans.length ? ` (${savedPlans.length})` : ''}`], ['about', 'How It Works']] as const).map(([val, label]) => (
            <button key={val} onClick={() => patchState({ activeTab: val })}
              style={{
                flex: 1, background: activeTab === val ? C.accentDim : C.card, color: activeTab === val ? '#fff' : C.textDim,
                border: `1px solid ${activeTab === val ? C.accentDim : C.border}`, borderRadius: 8, padding: '10px 14px',
                fontSize: 13, fontWeight: 700, fontFamily: FONT,
              }}>
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'archive' && (
          <ArchiveTab savedPlans={savedPlans} loadPlan={loadPlan} deletePlan={deletePlan} />
        )}

        {activeTab === 'about' && <AboutTab />}

        {activeTab === 'schedule' && (
        <>
        <SessionSettingsPanel
          sessionStart={sessionStart}
          totalMinutes={totalMinutes}
          gameMinutes={gameMinutes}
          numCourts={numCourts}
          extraCourt={extraCourt}
          staggerMode={staggerMode}
          preferMixedTeams={preferMixedTeams}
          patchState={patchState}
        />

        <PlayerList
          players={players}
          playerHistory={playerHistory}
          winLoss={winLoss}
          staggerMode={staggerMode}
          totalSlots={totalSlots}
          nameInput={nameInput}
          genderInput={genderInput}
          allDefaultsLoaded={allDefaultsLoaded}
          setNameInput={value => setField('nameInput', value)}
          setGenderInput={value => setField('genderInput', value)}
          addPlayer={addPlayer}
          addSelectedFromBank={addSelectedFromBank}
          addToBank={addToBank}
          removeFromHistory={removeFromHistory}
          loadDefaults={loadDefaults}
          resetPlayers={resetPlayers}
          clearPlayers={clearPlayers}
          clearWinLoss={clearWinLoss}
          updatePlayer={updatePlayer}
          removePlayer={removePlayer}
        />

        {players.length >= 4 && (
          <div className="action-buttons" style={{ marginBottom: result ? 8 : 24 }}>
            <button onClick={() => patchState({ showImport: true })} style={{ background: 'transparent', color: C.textDim, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 13, fontFamily: FONT }}>Import</button>
            <button className="generate-btn" onClick={generate} disabled={isGenerating} style={{ flex: 1, background: C.accentDim, color: '#fff', border: 'none', borderRadius: 8, padding: '14px', fontSize: 14, fontWeight: 700, fontFamily: FONT, letterSpacing: '1px', textTransform: 'uppercase', opacity: isGenerating ? 0.6 : 1, boxShadow: C.shadow }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                <LucideIcon name="shuffle" size={15} />
                {isGenerating ? `Slot ${genSlot} / ${totalSlots}…` : result ? 'Re-roll' : `Generate (${totalSlots} slots)`}
              </span>
            </button>
            {result && (
              isConfirmed ? (
                <button onClick={unconfirmSchedule} title="Click to unlock for editing" style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.green, color: C.bg, border: 'none', borderRadius: 8, padding: '14px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT }}>
                  <LucideIcon name="check" size={15} /> Confirmed
                </button>
              ) : (
                <button onClick={confirmSchedule} title="Lock this as the schedule for the session" style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT }}>
                  <LucideIcon name="check" size={15} /> Confirm
                </button>
              )
            )}
          </div>
        )}

        {result && (
          <div className="action-buttons" style={{ marginBottom: 24, flexWrap: 'wrap' }}>
            <button onClick={copySchedule} title="Copy full schedule (with sit list & game counts)" style={{ display: 'flex', alignItems: 'center', gap: 6, background: copied ? C.green : C.card, color: copied ? C.bg : C.text, border: `1px solid ${copied ? C.green : C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT, transition: 'all 0.2s' }}><LucideIcon name={copied ? 'check' : 'copy'} size={15} /> Copy</button>
            <button onClick={copyGames} title="Copy games only (matchups, no sit list or stats)" style={{ display: 'flex', alignItems: 'center', gap: 6, background: copiedGames ? C.green : C.card, color: copiedGames ? C.bg : C.textDim, border: `1px solid ${copiedGames ? C.green : C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 12, fontWeight: 700, fontFamily: FONT, transition: 'all 0.2s' }}>{copiedGames ? <LucideIcon name="check" size={15} /> : '⚡'} Quick Copy</button>
            <button onClick={saveAsImage} title="Save schedule as an image" style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT }}><LucideIcon name="download" size={15} /> Image</button>
            <button onClick={() => { const loaded = savedPlans.find(p => p.id === loadedPlanId); patchState({ saveTag: loaded ? loaded.tag : '', showSavePlan: true }); }} title="Save plan with tag" style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT }}><LucideIcon name="bookmark" size={15} /> Save</button>
            <button onClick={() => shareLink()} title="Share schedule via link" style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT }}><LucideIcon name="link" size={15} /> Share</button>
            <button onClick={clearSchedule} title="Clear schedule" style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT }}><LucideIcon name="trash" size={15} /> Clear</button>
          </div>
        )}

        {pendingOverwrite && (
          <ConfirmOverwriteModal onConfirm={executeOverwrite} onCancel={cancelOverwrite} />
        )}

        {hasAppliedScores && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, background: C.card, border: `1px solid ${C.amber}33`, borderRadius: 8, padding: '8px 14px' }}><span style={{ fontSize: 12, color: C.amber }}>⚡ Scores recorded — re-roll to use updated skill ratings in the next schedule</span></div>}

        {result && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
            <span style={{ fontSize: 12, color: C.textDim }}>Re-generate from slot</span>
            <input type="number" min={1} max={totalSlots} value={fromSlot} onChange={e => patchState({ fromSlot: Math.min(totalSlots, Math.max(1, +e.target.value)) })} style={{ width: 48, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', color: C.text, fontSize: 13, fontFamily: FONT, textAlign: 'center' }} />
            <span style={{ fontSize: 12, color: C.textDim }}>with</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2, 3, 4].map(n => (
                <button key={n} onClick={() => patchState({ fromSlotCourts: n })} style={{ padding: '4px 8px', fontSize: 12, fontWeight: 600, fontFamily: FONT, borderRadius: 4, border: `1px solid ${fromSlotCourts === n ? C.accent : C.border}`, background: fromSlotCourts === n ? C.accentDim : C.bg, color: fromSlotCourts === n ? '#fff' : C.textDim, cursor: 'pointer' }}>{n === 0 ? 'auto' : `${n}C`}</button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: C.textDim, flex: 1 }}>courts onwards</span>
            <button onClick={regenerateRemaining} style={{ background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: FONT }}>Apply</button>
          </div>
        )}

        {saved && <p style={{ fontSize: 12, color: C.green, textAlign: 'center', marginTop: -16, marginBottom: 16 }}>Schedule saved — will persist on refresh</p>}

        {result && (
          <SessionStatusPanel
            players={players}
            fromSlot={fromSlot}
            totalSlots={totalSlots}
            liveGames={liveGames}
            suspendedPlayerNames={suspendedPlayerNames}
            staggerMode={staggerMode}
            setPlayerBack={setPlayerBack}
            setPlayerJoining={setPlayerJoining}
            setPlayerLeaving={setPlayerLeaving}
            togglePlayerSuspended={togglePlayerSuspended}
          />
        )}

        {result && (
          <ScheduleGrid
            result={result}
            players={players}
            scores={scores}
            editingSlot={editingSlot}
            editLayout={editLayout}
            isAdmin={isAdmin}
            scheduleRef={scheduleRef}
            minGames={minGames}
            maxGames={maxGames}
            slotTime={slotTime}
            startSlotEdit={startSlotEdit}
            applySlotEdit={applySlotEdit}
            applySlotEditOnly={applySlotEditOnly}
            cancelSlotEdit={() => patchState({ editingSlot: null, editLayout: null })}
            assignToPosition={assignToPosition}
            updateScore={updateScore}
            liveGames={liveGames}
            completedGames={completedGames}
            onToggleLive={toggleLiveGame}
            onAdjustCourts={adjustCourtsAtSlot}
            blockedPlayerNames={blockedPlayerNames}
            fromSlot={fromSlot}
            liveCapacity={getCourtsPerSlot()[Math.max(0, fromSlot - 1)] ?? numCourts}
          />
        )}
        </>
        )}
      </div>
    </div>
  );
}

export default BadmintonPlanner;
