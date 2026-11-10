import { plannerStorageKey } from './utils/plannerStorage';
import OrganizerHandoff, { type TransferTarget } from './components/OrganizerHandoff';
import { buildOrganizerSetup, organizerSetupPatch, type OrganizerSetup } from './utils/organizerTransfer';
import { createDeviceSessionBackup, persistDeviceSessionCopy, downloadDeviceSessionBackup, hasDeviceSessionBackup } from './utils/deviceSessionBackup';
import QuarantinePanel from './components/QuarantinePanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSharedSessionSync } from './hooks/useSharedSessionSync';
import { loadQualityWeights, saveQualityWeights } from './utils/qualityPreferences';
import { sharedGameId } from './utils/sharedSession';
import { type QualityWeights } from './utils/gameQuality';
import { normalizePlayerIdentities } from './utils/playerIdentity';
import { playerMetadataPatch } from './utils/playerMetadataPatch';
import type { Player, PlayerInGame } from './algorithm/types';
import { extractState, generateSchedule, normalizeUnstartedMixedCourts, recomputeStats } from './algorithm/scheduler';
import { C, DEFAULT_PLAYERS, FONT } from './constants';
import { usePlannerState } from './hooks/usePlannerState';
import { useAdminAuth } from './hooks/useAdminAuth';
import { usePlayerRoster } from './hooks/usePlayerRoster';
import { useWinLossSync } from './hooks/useWinLossSync';
import { pruneExpiredPlans } from './utils/pruneExpiredPlans';
import { cloudDiagnostic, cloudOperation } from './utils/cloudDiagnostics';
import { computeCourtsPerSlot } from './utils/courtsPerSlot';
import { applyAvailability as applyAvailabilityUtil } from './utils/availability';
import { formatSlotTime } from './utils/slotTime';
import { isValidBadmintonScore } from './utils/scoreValidation';
import { exportLiveQueueLogs, startUntimedLiveGames, gameMatches, keepGamesBeforeSlot, liveQueueDebug } from './utils/liveQueue';
import type { GameRef } from './utils/liveQueue';
import { useLiveQueue } from './hooks/useLiveQueue';
import { useScheduleActions, regenerationState, remainingPlanCourts } from './hooks/useScheduleActions';
import { parseScheduleText as parseScheduleTextUtil, buildCopyText as buildCopyTextUtil } from './utils/scheduleText';
import { buildSharePayload as buildSharePayloadUtil, reconstructScheduleFromSharePayload, upsertSavedPlanFromShare } from './utils/sharePayload';
import PastGamesTab from './components/PastGamesTab';
import PairingsTab from './components/PairingsTab';
import PlayerList from './components/PlayerList';
import LiveSessionBoard from './components/LiveSessionBoard';
import PlayerWaitingPanel from './components/PlayerWaitingPanel';
import { waitingPlayerKey, waitingPlayerStatuses } from './utils/waitingClock';
import { historySlotsWaited, historyScheduleState, migratePlayedGames } from './utils/playedHistory';
import SessionSettingsPanel from './components/SessionSettingsPanel';
import SessionStatusPanel from './components/SessionStatusPanel';
import AboutTab from './components/AboutTab';
import {
  ArchiveTab,
  ConfirmOverwriteModal,
  ImportModal,
  LucideIcon,
  PinPromptModal,
  QueuePromotionModal,
  SavePlanModal,
  SessionChangeModal,
  ShareLinkModal,
} from './components/PlannerModals';
import {
  isFirebaseConfigured,
  createShare,
  updateShare,
  fetchShare,
} from './firebase';
import type { EditLayout, PlannerState, PlannerResult, SavedPlan, ScoresMap, SharePayload, WinLossMap } from './types';

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

function playerNamesLineup(names: string[]) {
  return [...names].sort().join('|');
}

function preserveCompletedGameSnapshots(games: GameRef[]) {
  return games.map(game => ({
    ...game,
    ...(game.players ? { players: [...game.players] } : {}),
  }));
}

function preserveLiveGamesAtEditedSlot(games: GameRef[], after: PlannerResult, editedSlot: number) {
  return games.flatMap(game => {
    if (game.slot !== editedSlot) return [game];
    const court = after.schedule.find(slot => slot.slot === game.slot)?.courts[game.court];
    if (!court) return [];
    return [{
      ...game,
      players: [...court.teamA, ...court.teamB].map(player => player.name),
    }];
  });
}

function BadmintonPlanner() {
  const { state, setField, patchState, recordUndo, restoreUndo } = usePlannerState();
  const scheduleRef = useRef<HTMLDivElement | null>(null);
  const [initialShareId, setInitialShareId] = useState(() => new URLSearchParams(window.location.search).get('share'));
  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(() => { const id = new URLSearchParams(window.location.search).get('transfer'); return id ? { id, key: new URLSearchParams(window.location.hash.slice(1)).get('key') ?? '' } : null; });
  const [qualityWeights, setQualityWeights] = useState<QualityWeights>(loadQualityWeights);
  useEffect(() => { saveQualityWeights(qualityWeights); }, [qualityWeights]);
  const [pendingSharedUndo, setPendingSharedUndo] = useState<string | null>(null);
  const hydratedShare = useRef<string | null>(null);

  const {
    players,
    playerHistory,
    nameInput,
    genderInput,
    levelInput,
    totalMinutes,
    gameMinutes,
    numCourts,
    extraCourt,
    courtOverrides,
    staggerMode,
    sessionStart,
    result,
    scheduleDirty,
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
    preferredPairs,
    isConfirmed,
    pendingOverwrite,
    loadedPlanId,
    shareNotice,
    liveGames,
    completedGames,
    playedGames,
    historyEpoch,
    waitingClock,
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
    addImportedPlayers,
    addSelectedFromBank,
    addToBank,
    removeFromHistory,
    removePlayer,
    updatePlayer,
  } = usePlayerRoster({ players, playerHistory, nameInput, genderInput, levelInput, totalSlots, scheduleActive: Boolean(result), patchState,
    onPlayerMetadataChange: (before, after) => playerMetadataPatch(state, before, after),
  });
  const { dbSynced, computeSkill, updateScore: updateScoreBase, clearWinLoss } = useWinLossSync({ winLoss, scores, players, isAdmin, patchState });

  useEffect(() => {
    if (players.length === 0) return;
    const known = new Set(playerHistory.map(p => p.name.toLowerCase()));
    const newOnes = players.filter(p => !known.has(p.name.toLowerCase()));
    if (newOnes.length === 0) return;
    patchState({
      playerHistory: [...playerHistory, ...newOnes.map(p => ({ id: p.id, name: p.name, gender: p.gender, level: p.level, aliases: p.aliases, statsKey: p.statsKey }))],
    });
  }, [players]);

  useEffect(() => {
    const fresh = pruneExpiredPlans(savedPlans, Date.now());
    if (fresh.length !== savedPlans.length) patchState({ savedPlans: fresh, undoSnapshot: null });
  }, [savedPlans]);

  useEffect(() => {
    if (!result || isSharedSession || result.preserveLineups) return;
    const lockedGames = new Set<string>();
    for (const game of [...liveGames, ...completedGames]) {
      lockedGames.add(`${game.slot}:${game.court}`);
    }
    for (const key of Object.keys(scores)) {
      const match = /^s(\d+)c(\d+)$/.exec(key);
      if (match) lockedGames.add(`${Number(match[1])}:${Number(match[2])}`);
    }
    const schedule = normalizeUnstartedMixedCourts(result.schedule, lockedGames);
    if (schedule !== result.schedule) patchState({ result: { ...result, schedule } });
  }, [completedGames, isSharedSession, liveGames, patchState, result, scores]);

  useEffect(() => {
    if (!result) return;
    patchState({ saved: true });
    const t = setTimeout(() => patchState({ saved: false }), 2000);
    return () => clearTimeout(t);
  }, [result]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlShareId = params.get('share');

    if (urlShareId && isFirebaseConfigured()) return;

    const apiBase = normalizeApiBase(window.SHARE_API_BASE);
    if (urlShareId && apiBase) {
      patchState({ shareNotice: 'loading' });
      cloudOperation('share.api.read', () => fetch(`${apiBase}/shares/${encodeURIComponent(urlShareId)}`))
        .then(async response => {
          if (!response.ok) throw new Error(`Share load failed: ${response.status}`);
          return response.json();
        })
        .then(payload => {
          const data = payload?.data;
          if (data?.v === 1 && data.p && data.slots) {
            applySharePayload(data);
            cloudDiagnostic('share.load', 'ok');
            patchState({ shareNotice: 'loaded' });
            window.history.replaceState(null, '', window.location.pathname);
          } else throw Object.assign(new Error('Invalid share payload'), { code: 'share/invalid' });
        })
        .catch(error => {
          cloudDiagnostic('share.load', 'failed', error);
          patchState({ shareNotice: 'error' });
        });
      return;
    }

    const hash = window.location.hash;
    if (hash.startsWith('#share=')) {
      try {
        const data = JSON.parse(atob(hash.slice(7)));
        if (data.v === 1 && data.p && data.slots) {
          applySharePayload(data);
          cloudDiagnostic('share.load', 'ok');
          patchState({ shareNotice: 'loaded' });
          window.history.replaceState(null, '', window.location.pathname);
        } else throw Object.assign(new Error('Invalid share payload'), { code: 'share/invalid' });
      } catch (error) {
        cloudDiagnostic('share.load', 'failed', error);
        patchState({ shareNotice: 'invalid' });
      }
      return;
    }

  }, []);

  const slotTime = useCallback((slotIdx: number) => formatSlotTime(slotIdx, { gameMinutes, sessionStart }), [gameMinutes, sessionStart]);

  const getCourtsPerSlot = useCallback(
    (overrides = courtOverrides) => computeCourtsPerSlot({ totalSlots, gameMinutes, numCourts, extraCourt, courtOverrides: overrides }),
    [courtOverrides, extraCourt, gameMinutes, numCourts, totalSlots]
  );

  const applyAvailability = useCallback(
    (basePlayers: Player[]) => applyAvailabilityUtil(basePlayers, { staggerMode, totalSlots }),
    [staggerMode, totalSlots]
  );

  const getPlayersWithAvailability = useCallback(() => applyAvailability(players), [applyAvailability, players]);
  const getScheduleOptions = useCallback((schedulePlayers: Player[]) => {
    const indexByName = new Map(schedulePlayers.map((player, index) => [player.name, index]));
    return {
      preferMixedTeams,
      qualityWeights,
      preferredPairs: preferredPairs.flatMap(([first, second]) => {
        const firstIndex = indexByName.get(first);
        const secondIndex = indexByName.get(second);
        return firstIndex != null && secondIndex != null ? [[firstIndex, secondIndex] as [number, number]] : [];
      }),
    };
  }, [preferMixedTeams, preferredPairs, qualityWeights]);

  const buildSharePayload = useCallback(
    () => buildSharePayloadUtil({ result: result ?? (isSharedSession ? { schedule: [] } : null), playersWithAvailability: getPlayersWithAvailability(), gameMinutes, numCourts, scores, isConfirmed,
      settings: { totalMinutes, sessionStart, staggerMode, extraCourt, courtOverrides },
      runtime: { live: liveGames, completed: completedGames, suspended: suspendedPlayerNames, waitingClock },
      playedGames, historyEpoch, includeScoreDrafts: true,
    }),
    [gameMinutes, getPlayersWithAvailability, isConfirmed, isSharedSession, numCourts, result, scores, totalMinutes, sessionStart, staggerMode, extraCourt, courtOverrides, liveGames, completedGames, suspendedPlayerNames, playedGames, historyEpoch, waitingClock]
  );

  const parseScheduleText = useCallback((text: string) => parseScheduleTextUtil(text, players), [players]);

  const {
    runGenerate,
    runRegenerateRemaining,
    runClearSchedule,
    clearSchedule,
    confirmSchedule,
    unconfirmSchedule,
    doRegen,
  } = useScheduleActions({
    recordUndo,
    suspendedPlayerNames,
    scheduleDirty,
    loadedPlanId,
    activeTab,
    players,
    result,
    totalSlots,
    isGenerating,
    isConfirmed,
    scores,
    winLoss,
    liveGames,
    completedGames,
    playedGames, historyEpoch,
    fromSlot,
    fromSlotCourts,
    courtOverrides,
    computeSkill,
    getPlayersWithAvailability,
    applyAvailability,
    getCourtsPerSlot,
    getScheduleOptions,
    patchState,
    keepGamesBeforeSlot,
  });

  const generate = useCallback(() => {
    if (players.length < 4 || isGenerating) return;
    if (isConfirmed || playedGames.length || completedGames.length) {
      patchState({ pendingOverwrite: 'generate' });
      return;
    }
    runGenerate();
  }, [isConfirmed, isGenerating, players.length, runGenerate, playedGames.length, completedGames.length]);

  const {
    applyLiveGamesUpdate,
    adjustCourtsAtSlot,
    blockedPlayerNames,
    changeSlot,
    liveCapacity,
    pendingSessionChange,
    sessionChangeNotice,
    confirmSessionChange,
    cancelSessionChange,
    resetSessionChanges,
    regenerateUpcoming,
    queueAdjustment,
    queuePromotionPrompt,
    resolveQueuePromotion,
    prepareQueuePromotionForOpenCourt,
    cancelQueuePromotion,
    setPlayerJoining,
    setPlayerLeaving,
    setPlayerBack,
    toggleLiveGame,
    togglePlayerQuarantined,
  } = useLiveQueue({
    recordUndo,
    sessionChangeNotice: state.sessionChangeNotice,
    pendingSessionChange: state.pendingSessionChange,
    queueAdjustment: state.queueAdjustment,
    queuePromotionPrompt: state.queuePromotionPrompt,
    result,
    players,
    liveGames,
    completedGames,
    suspendedPlayerNames,
    fromSlot,
    totalSlots,
    scores,
    courtOverrides,
    isConfirmed,
    getCourtsPerSlot,
    regenerate: ({ targetFromSlot, overridePlayers, blockedForFirstSlot, overrideWinLoss, overrideScores, baseResult, forcedFirstSlot, courtOverrides: overrides, actualGames }) => doRegen(targetFromSlot, overridePlayers ?? null, blockedForFirstSlot ?? new Set(), overrideWinLoss ?? null, overrideScores ?? null, baseResult, forcedFirstSlot ?? null, overrides, actualGames),
    patchState,
    canPlayerJoin: staggerMode === 'custom',
    onConfirmedScheduleChange: previousResult => patchState({
      savedPlans: [{ id: Date.now(), tag: '', result: previousResult, savedAt: new Date().toISOString() }, ...savedPlans],
    }),
  });

  const runImport = useCallback(() => {
    const parsed = parseScheduleText(importText);
    if (!parsed) {
      patchState({ importError: 'Could not parse schedule — paste the full copied text.' });
      return;
    }
    resetSessionChanges();
    patchState({ result: parsed, scheduleDirty: false, scores: {}, courtOverrides: {}, fromSlot: 1, fromSlotCourts: 0, showImport: false, importText: '', importError: '', isConfirmed: false, loadedPlanId: null, liveGames: [], completedGames: [], suspendedPlayerNames: [] });
  }, [importText, parseScheduleText, resetSessionChanges]);

  const importSchedule = useCallback(() => {
    if (isConfirmed) patchState({ pendingOverwrite: 'import' });
    else runImport();
  }, [isConfirmed, runImport]);

  const executeOverwrite = useCallback((resetHistory = false) => {
    if (result && result.schedule?.length) {
      patchState({ savedPlans: [{ id: Date.now(), tag: '', result, savedAt: new Date().toISOString() }, ...savedPlans] });
    }
    patchState({ pendingOverwrite: null });
    if (pendingOverwrite === 'generate') runGenerate(resetHistory);
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
        sitting: s.sitting.filter(p => !players.some(rosterPlayer => rosterPlayer.name === p.name && rosterPlayer.quarantined)).map(p => p.name),
      },
      editingSlot: slotNum,
    });
  }, [result, players]);

  const assignToPosition = useCallback((pos: { type: 'court'; ci: number; idx: number } | { type: 'sit'; idx: number }, newName: string) => {
    if (!editLayout || players.some(p => p.name === newName && p.quarantined)) return;
    const oldName = pos.type === 'court' ? editLayout.courts[pos.ci]?.[pos.idx] : editLayout.sitting[pos.idx];
    if (players.some(p => p.name === oldName && p.quarantined)) return;
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
  }, [editLayout, players]);

  const applySlotEdit = useCallback(() => {
    if (!editingSlot || !result || !editLayout) return;
    const quarantinedNames = new Set(players.filter(p => p.quarantined).map(p => p.name));
    if (editLayout.courts.some((court, ci) => {
      if (!court.some(name => quarantinedNames.has(name))) return false;
      const protectedGame = [...liveGames, ...completedGames].find(g => g.slot === editingSlot && g.court === ci);
      const original = result.schedule.find(s => s.slot === editingSlot)?.courts[ci];
      const originalNames = protectedGame?.players ?? (original ? [...original.teamA, ...original.teamB].map(p => p.name) : []);
      return !protectedGame || court.some((name, i) => originalNames[i] !== name);
    })) {
      patchState({ sessionChangeNotice: 'Return quarantined players to available before adding them to a game.' });
      return;
    }
    const slotIdx = editingSlot - 1;
    const remainingCourts = remainingPlanCourts(result, playedGames, getCourtsPerSlot());
    const regenerationOptions = { ...getScheduleOptions(getPlayersWithAvailability()), consumedSlots: remainingCourts.flatMap((count, i) => count === 0 ? [i + 1] : []) };
    const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name, p.level) }));
    const stateSnapshot = regenerationState(result, playersWithSkill, completedGames, [...completedGames, ...liveGames], scores, playedGames, editingSlot);
    const nameToIdx = new Map(playersWithSkill.map((p, i) => [p.name, i]));
    const editedSlotBefore = result.schedule[slotIdx];
    const courtsForced = editLayout.courts.map((court, ci) => {
      const liveGameOnCourt = liveGames.find(game => game.slot === editingSlot && game.court === ci);
      const originalCourt = editedSlotBefore?.courts[ci];
      const originalNames = originalCourt
        ? [...originalCourt.teamA, ...originalCourt.teamB].map(player => player.name)
        : [];
      const editedNames = liveGameOnCourt ? court : originalNames;
      const preserveLiveCourt = Boolean(liveGameOnCourt)
        && playerNamesLineup(editedNames) === playerNamesLineup(originalNames);
      const names = preserveLiveCourt ? originalNames : court;
      return names.map(name => nameToIdx.get(name)).filter(i => i !== undefined);
    });
    if (courtsForced.some(c => c.length !== 4)) {
      liveQueueDebug('edit:blocked', { reason: 'roster-lineup-mismatch', editingSlot });
      patchState({ sessionChangeNotice: 'Some players in this game are no longer in the roster. Update the game lineup or return those players before regenerating.' }); return;
    }
    let newResult: PlannerResult | null = generateSchedule(playersWithSkill, totalSlots, remainingCourts, slotIdx, stateSnapshot, { courts: courtsForced }, regenerationOptions);
    if (!newResult) { patchState({ sessionChangeNotice: 'Unable to apply this lineup. Check attendance and court capacity, then retry.' }); return; }
    const runtimeSlots = [...new Set([...liveGames, ...completedGames]
      .map(game => game.slot)
      .filter(slot => slot > editingSlot))].sort((a, b) => a - b);
    for (const slotNum of runtimeSlots) {
      const originalRuntimeSlot = result.schedule.find(slot => slot.slot === slotNum);
      if (!originalRuntimeSlot) continue;
      const prefix = newResult.schedule.filter(slot => slot.slot < slotNum);
      const stateThroughRuntimeSlot = recomputeStats([...prefix, originalRuntimeSlot], playersWithSkill);
      const continuedResult = generateSchedule(
        playersWithSkill,
        totalSlots,
        remainingCourts,
        slotNum,
        regenerationState({ ...result, schedule: stateThroughRuntimeSlot.schedule }, playersWithSkill, completedGames, [...completedGames, ...liveGames], scores, playedGames, slotNum + 1),
        null,
        regenerationOptions,
      );
      if (!continuedResult) { patchState({ sessionChangeNotice: 'Unable to regenerate around current games. Your previous schedule is unchanged.' }); return; }
      newResult = continuedResult;
    }
    newResult = { ...recomputeStats(newResult.schedule, playersWithSkill), gamesPlayed: newResult.gamesPlayed, planId: result.planId };
    const nextScores: ScoresMap = {};
    for (const key in scores) {
      const match = key.match(/^s(\d+)c/);
      if (match && parseInt(match[1]!, 10) < editingSlot && scores[key]) nextScores[key] = scores[key];
    }
    const preservedLiveGames = preserveLiveGamesAtEditedSlot(liveGames, newResult, editingSlot);
    const preservedCompletedGames = preserveCompletedGameSnapshots(completedGames);
    applyLiveGamesUpdate(
      preservedLiveGames,
      editingSlot,
      preservedCompletedGames,
      {
        result: newResult,
        scheduleDirty: false,
        scores: nextScores,
        editingSlot: null,
        editLayout: null,
        copied: false,
      },
      { targetLiveCount: liveGames.length, overrideResult: newResult },
    );
  }, [applyLiveGamesUpdate, completedGames, computeSkill, editLayout, editingSlot, getCourtsPerSlot, getPlayersWithAvailability, getScheduleOptions, liveGames, players, result, scores, totalSlots, playedGames]);

  const applySlotEditOnly = useCallback(() => {
    if (!editingSlot || !result || !editLayout) return;
    const quarantinedNames = new Set(players.filter(p => p.quarantined).map(p => p.name));
    if (editLayout.courts.some((court, ci) => {
      if (!court.some(name => quarantinedNames.has(name))) return false;
      const protectedGame = [...liveGames, ...completedGames].find(g => g.slot === editingSlot && g.court === ci);
      const original = result.schedule.find(s => s.slot === editingSlot)?.courts[ci];
      const originalNames = protectedGame?.players ?? (original ? [...original.teamA, ...original.teamB].map(p => p.name) : []);
      return !protectedGame || court.some((name, i) => originalNames[i] !== name);
    })) {
      patchState({ sessionChangeNotice: 'Return quarantined players to available before adding them to a game.' });
      return;
    }
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
    const newResult = { schedule: newSchedule, gamesPlayed };
    const preservedLiveGames = preserveLiveGamesAtEditedSlot(liveGames, newResult, editingSlot);
    const preservedCompletedGames = preserveCompletedGameSnapshots(completedGames);
    applyLiveGamesUpdate(
      preservedLiveGames,
      editingSlot,
      preservedCompletedGames,
      {
        result: newResult,
        scheduleDirty: false,
        editingSlot: null,
        editLayout: null,
        copied: false,
      },
      { targetLiveCount: liveGames.length, overrideResult: newResult, regenerate: false },
    );
  }, [applyLiveGamesUpdate, completedGames, editingSlot, editLayout, liveGames, players, result]);

  const updateScore = useCallback((slot: number, courtIdx: number, aVal: string, bVal: string, teamA: string[], teamB: string[]) => {
    if (isGenerating) return;
    const key = `s${slot}c${courtIdx}`;
    const aNum = parseInt(aVal);
    const bNum = parseInt(bVal);
    const valid = !isNaN(aNum) && !isNaN(bNum) && isValidBadmintonScore(aNum, bNum);
    const isLive = liveGames.some(lg => lg.slot === slot && lg.court === courtIdx);
    if (isSharedSession || !isAdmin || !valid || !isLive) {
      if (isAdmin) recordUndo();
      updateScoreBase(slot, courtIdx, aVal, bVal, teamA, teamB);
      return;
    }

    const prevEntry = scores[key];
    const nextWinLoss = JSON.parse(JSON.stringify(winLoss));
    const statsKey = (name: string) => players.find(player => player.name === name)?.statsKey ?? name;
    if (prevEntry?.applied) {
      const pA = parseInt(prevEntry.a);
      const pB = parseInt(prevEntry.b);
      const winners = pA > pB ? prevEntry.teamA : prevEntry.teamB;
      const losers = pA > pB ? prevEntry.teamB : prevEntry.teamA;
      winners.map(statsKey).forEach(name => { if (nextWinLoss[name]) nextWinLoss[name].wins = Math.max(0, nextWinLoss[name].wins - 1); });
      losers.map(statsKey).forEach(name => { if (nextWinLoss[name]) nextWinLoss[name].losses = Math.max(0, nextWinLoss[name].losses - 1); });
    }

    const winners = aNum > bNum ? teamA : teamB;
    const losers = aNum > bNum ? teamB : teamA;
    winners.map(statsKey).forEach(name => { nextWinLoss[name] = { wins: (nextWinLoss[name]?.wins ?? 0) + 1, losses: nextWinLoss[name]?.losses ?? 0 }; });
    losers.map(statsKey).forEach(name => { nextWinLoss[name] = { wins: nextWinLoss[name]?.wins ?? 0, losses: (nextWinLoss[name]?.losses ?? 0) + 1 }; });

    const nextScores: ScoresMap = { ...scores, [key]: { a: aVal, b: bVal, applied: true, teamA, teamB } };
    const nextLiveGames = liveGames.filter(lg => !(lg.slot === slot && lg.court === courtIdx));
    const scheduledCourt = result?.schedule.find(item => item.slot === slot)?.courts[courtIdx];
    const completedRef = {
      slot,
      court: courtIdx,
      players: scheduledCourt ? [...scheduledCourt.teamA, ...scheduledCourt.teamB].map(player => player.name) : [...teamA, ...teamB],
    };
    const nextCompletedGames = [
      ...completedGames.filter(game => !gameMatches(game, slot, courtIdx)),
      completedRef,
    ];
    const targetLiveCount = Math.max(nextLiveGames.length, Math.min(liveCapacity, liveGames.length));
    applyLiveGamesUpdate(nextLiveGames, slot, nextCompletedGames, { scores: nextScores, winLoss: nextWinLoss }, { targetLiveCount });
  }, [isGenerating, applyLiveGamesUpdate, completedGames, isAdmin, isSharedSession, liveCapacity, liveGames, players, result, scores, updateScoreBase, winLoss, recordUndo]);

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

  const exportDebugLogs = useCallback(() => {
    const blob = new Blob([exportLiveQueueLogs()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `badminton-live-queue-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
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
        undoSnapshot: null,
      });
    } else {
      const newId = Date.now();
      patchState({
        savedPlans: [{ id: newId, tag: trimmedTag, result, savedAt: new Date().toISOString() }, ...savedPlans],
        showSavePlan: false,
        saveTag: '',
        loadedPlanId: newId,
        undoSnapshot: null,
      });
    }

    if (isSharedSession && shareId && isFirebaseConfigured()) {
      void sharedSync.saveNow();
    }
  }, [buildSharePayload, isSharedSession, loadedPlanId, result, saveTag, savedPlans, shareId]);

  const loadPlan = useCallback((plan: SavedPlan) => {
    setInitialShareId(null);
    window.history.replaceState(null, '', window.location.pathname);
    resetSessionChanges();
    patchState({ result: plan.result, scheduleDirty: false, scores: {}, courtOverrides: {}, fromSlot: 1, fromSlotCourts: 0, activeTab: 'live', isConfirmed: false, loadedPlanId: plan.id, shareId: null, shareToken: null, isSharedSession: false, liveGames: [], completedGames: [], suspendedPlayerNames: [] });
  }, [resetSessionChanges]);

  const deletePlan = useCallback((id: number) => {
    patchState({
      savedPlans: savedPlans.filter(plan => plan.id !== id),
      undoSnapshot: null,
      ...(id === loadedPlanId ? { loadedPlanId: null } : {}),
    });
  }, [loadedPlanId, savedPlans]);

  const shareLink = useCallback(async (forceNew = false) => {
    const data = buildSharePayload();
    if (!data) return;

    if (isFirebaseConfigured()) {
      try {
      const existingId = !forceNew ? shareId : null;
      const id = existingId || await createShare(data);
      if (existingId && !await sharedSync.saveNow()) return;
      if (id) {
        setInitialShareId(id);
        window.history.replaceState(null, '', `${window.location.pathname}?share=${encodeURIComponent(id)}`);
        patchState({ shareId: id, shareToken: null, isSharedSession: true, shareNotice: null });
        const url = `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(id)}`;
        copyText(url, () => {
          patchState({ sharedUrl: url, copiedShareUrl: true, showShareModal: true, shareIsUpdate: !!existingId });
          setTimeout(() => patchState({ copiedShareUrl: false }), 2000);
        });
        return;
      }
      } catch (error) {
        cloudDiagnostic('share.publish', 'failed', error);
        patchState({ shareNotice: 'save_error' });
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
    const decoded = reconstructScheduleFromSharePayload(data, { currentGameMinutes: gameMinutes, currentNumCourts: numCourts });
    const firstLoad = hydratedShare.current !== (sourceShareId ?? 'snapshot');
    hydratedShare.current = sourceShareId ?? 'snapshot';
    const { savedPlans: nextSavedPlans, loadedPlanId: newLoadedPlanId } = upsertSavedPlanFromShare(savedPlans as unknown as { id: number | string; sourceShareId?: string }[], sourceShareId ?? null, decoded.result);

    // Reuse local private metadata by permanent ID. Public shares never contain levels.
    const nextPlayers = normalizePlayerIdentities(decoded.players.map(player => {
      const privateMetadata = firstLoad ? [...playerHistory, ...players] : [...players, ...playerHistory];
      const saved = privateMetadata.find(p => player.id ? p.id === player.id : p.name === player.name);
      return { ...player, gender: player.gender === 'F' ? 'F' as const : 'M' as const, ...(saved?.level ? { level: saved.level } : {}), ...(saved?.statsKey ? { statsKey: saved.statsKey } : {}) } as Player;
    }), playerHistory).players as Player[];
    // Older shares identify players by name; retain their clocks when assigning IDs.
    const nextWaitingClock = { ...decoded.waitingClock, since: Object.fromEntries(nextPlayers.flatMap((player, index) => {
      const since = decoded.waitingClock.since[waitingPlayerKey(decoded.players[index]!)];
      return since === undefined ? [] : [[waitingPlayerKey(player), since]];
    })) };
    patchState({
      players: nextPlayers,
      totalMinutes: decoded.totalMinutes,
      sessionStart: decoded.sessionStart,
      staggerMode: decoded.staggerMode,
      extraCourt: decoded.extraCourt,
      gameMinutes: typeof decoded.gameMinutes === 'number' ? decoded.gameMinutes : gameMinutes,
      numCourts: decoded.numCourts,
      result: decoded.result.schedule.length ? decoded.result as PlannerResult : null,
      courtOverrides: decoded.courtOverrides,
      fromSlot: 1,
      fromSlotCourts: 0,
      ...(firstLoad || !decoded.result.schedule.length ? { activeTab: decoded.result.schedule.length ? 'live' as const : 'setup' as const } : {}),
      isSharedSession: true,
      scores: decoded.scores,
      isConfirmed: decoded.isConfirmed,
      loadedPlanId: typeof newLoadedPlanId === 'number' ? newLoadedPlanId : null,
      savedPlans: nextSavedPlans as SavedPlan[],
      liveGames: decoded.liveGames,
      completedGames: decoded.completedGames,
      playedGames: decoded.playedGames, historyEpoch: decoded.historyEpoch,
      waitingClock: nextWaitingClock,
      suspendedPlayerNames: decoded.suspendedPlayerNames,
      editingSlot: null, editLayout: null, undoSnapshot: null, scheduleDirty: false,
      queuePromotionPrompt: null, queueAdjustment: null, pendingSessionChange: null,
      ...(sourceShareId ? { shareId: sourceShareId, shareNotice: null } : {}),
    });
    return buildSharePayloadUtil({ result: decoded.result as PlannerResult, playersWithAvailability: nextPlayers, gameMinutes: decoded.gameMinutes, numCourts: decoded.numCourts,
      scores: decoded.scores, isConfirmed: decoded.isConfirmed, playedGames: decoded.playedGames, historyEpoch: decoded.historyEpoch,
      settings: { totalMinutes: decoded.totalMinutes, sessionStart: decoded.sessionStart, staggerMode: decoded.staggerMode, extraCourt: decoded.extraCourt, courtOverrides: decoded.courtOverrides },
      runtime: { live: decoded.liveGames, completed: decoded.completedGames, suspended: decoded.suspendedPlayerNames, waitingClock: nextWaitingClock },
      includeScoreDrafts: true,
    })!;
  }, [gameMinutes, numCourts, savedPlans, players, playerHistory, isSharedSession]);

  const sharedTarget = !transferTarget && isFirebaseConfigured() ? (initialShareId ?? (isSharedSession ? shareId : null)) : null;
  const sharedSync = useSharedSessionSync({ shareId: sharedTarget, payload: buildSharePayload(), isAdmin, planEditing: isGenerating,
    applyRemote: data => applySharePayload(data, sharedTarget ?? undefined),
  });
  useEffect(() => {
    if (!sharedTarget || !['not_found', 'expired', 'error'].includes(sharedSync.status)) return;
    if (!initialShareId) setInitialShareId(sharedTarget);
    patchState({ shareId: null, shareToken: null, isSharedSession: false });
    if (!new URLSearchParams(window.location.search).has('share')) window.history.replaceState(null, '', `${window.location.pathname}?share=${encodeURIComponent(sharedTarget)}`);
  }, [sharedTarget, sharedSync.status, initialShareId, patchState]);
  const proposedRevision = useRef<number | null>(null);
  useEffect(() => {
    const revision = sharedSync.latest?.revision ?? 0;
    if (!sharedTarget || !isAdmin || sharedSync.status !== 'saved' || proposedRevision.current === revision || queuePromotionPrompt || liveGames.length >= liveCapacity) return;
    proposedRevision.current = revision;
    prepareQueuePromotionForOpenCourt();
  }, [sharedTarget, sharedSync.status, sharedSync.latest, isAdmin, liveGames.length, liveCapacity, queuePromotionPrompt, prepareQueuePromotionForOpenCourt]);
  const toggleSessionGame = (slot: number, court: number, displayCourt?: number) => {
    if (isGenerating) return;
    if (!sharedTarget) { toggleLiveGame(slot, court, displayCourt); return; }
    const payload = buildSharePayload();
    if (!payload) return;
    const type = liveGames.some(game => gameMatches(game, slot, court)) ? 'finish' : 'start';
    if (sharedSync.status !== 'saved') { patchState({ sessionChangeNotice: 'Wait for the shared session to finish saving, or retry its connection, before changing game progress.' }); return; }
    // Bind the action to the card actually rendered, never a newer buffered lineup.
    const rendered = { ...payload, ...(!sharedSync.latest?.ids ? { ids: undefined } : {}), ...(!sharedSync.latest?.planId ? { planId: undefined } : {}) };
    void sharedSync.performAction({ type, at: Date.now(), id: crypto.randomUUID(), gameId: sharedGameId(rendered, slot, court), ...(displayCourt != null ? { displayCourt } : {}) });
  };
  const startSessionTimers = () => {
    if (!isAdmin || isGenerating || !liveGames.length) return;
    const now = Date.now();
    if (!sharedTarget) {
      recordUndo();
      patchState({ liveGames: startUntimedLiveGames(liveGames, now) });
      return;
    }
    if (sharedSync.status !== 'saved') { patchState({ sessionChangeNotice: 'Wait for the shared session to finish saving before starting its timers.' }); return; }
    const payload = buildSharePayload();
    if (!payload) return;
    const rendered = { ...payload, ...(!sharedSync.latest?.ids ? { ids: undefined } : {}), ...(!sharedSync.latest?.planId ? { planId: undefined } : {}) };
    void sharedSync.performAction({ type: 'start_timers', id: crypto.randomUUID(), at: now,
      gameIds: liveGames.map(game => sharedGameId(rendered, game.slot, game.court)),
    });
  };
  const resolveSessionPromotion = (choice: 'lookahead' | 'substitute') => {
    if (!sharedTarget) { resolveQueuePromotion(choice); return; }
    if (!queuePromotionPrompt || !sharedSync.latest) return;
    const selected = choice === 'lookahead' ? queuePromotionPrompt.lookaheadGame : queuePromotionPrompt.prompt.firstGame;
    if (!selected) return;
    void sharedSync.performAction({ type: 'start', at: Date.now(), id: crypto.randomUUID(), gameId: sharedGameId(sharedSync.latest, selected.slot, selected.court),
      displayCourt: queuePromotionPrompt.prompt.completedCourt - 1,
      ...(choice === 'substitute' ? { replacements: queuePromotionPrompt.prompt.replacements.map(({ replacee, replacer }) => ({ replacee, replacer })) } : {}),
    }).then(saved => { if (saved) patchState({ queuePromotionPrompt: null }); });
  };

  const leaveSharedMode = () => {
    setInitialShareId(null);
    setTransferTarget(null);
    hydratedShare.current = null;
    window.history.replaceState(null, '', window.location.pathname);
  };
  const hasUnresolvedSharedAction = () => [shareId, initialShareId].some(id => id && sessionStorage.getItem(plannerStorageKey(`bp-share-action:${id}`)));
  const useSessionOnThisDevice = () => {
    try {
      if (hasUnresolvedSharedAction()) { patchState({ sessionChangeNotice: 'Confirm the pending Finish action before making a local copy. Retry the shared connection first.' }); return; }
      createDeviceSessionBackup();
      const rollback = persistDeviceSessionCopy(state, qualityWeights, [shareId, initialShareId].filter((id): id is string => Boolean(id)));
      if (!sharedSync.disconnect()) { rollback(); patchState({ sessionChangeNotice: 'Wait for any pending save or Finish action to be confirmed before making a local copy.' }); return; }
      leaveSharedMode();
      patchState({ isSharedSession: false, shareId: null, shareToken: null, shareNotice: null, sharedUrl: '',
        loadedPlanId: null, undoSnapshot: null, editingSlot: null, editLayout: null,
        pendingSessionChange: null, queuePromotionPrompt: null, queueAdjustment: null,
        playedGames, historyEpoch, sessionChangeNotice: 'This session is now saved on this device. Live shared updates are disconnected.' });
    } catch { patchState({ sessionChangeNotice: 'Could not preserve a device backup. Free some browser storage before making a local copy.' }); }
  };
  const importOrganizerSetup = (setup: OrganizerSetup): boolean => {
    try {
      if (hasUnresolvedSharedAction()) return false;
      const incoming = organizerSetupPatch(setup);
      const bank = new Map<string, PlannerState['playerHistory'][number]>();
      for (const p of [...(incoming.players ?? []), ...(incoming.playerHistory ?? []), ...playerHistory]) {
        const key = p.id ?? `legacy:${p.name.trim().toLowerCase()}`;
        if (!bank.has(key)) bank.set(key, { id: p.id, name: p.name, gender: p.gender, level: p.level, aliases: p.aliases, statsKey: p.statsKey, ...(p.quarantined ? { quarantined: true } : {}) });
      }
      const imported: Partial<PlannerState> = { ...incoming, playerHistory: [...bank.values()], isSharedSession: false, shareId: null, shareToken: null,
        shareNotice: null, sharedUrl: '', activeTab: incoming.result ? 'live' : 'setup',
        sessionChangeNotice: 'Organizer setup imported. This independent copy is saved on this device.' };
      createDeviceSessionBackup();
      const rollback = persistDeviceSessionCopy({ ...state, ...imported }, setup.qualityWeights, [shareId, initialShareId].filter((id): id is string => Boolean(id)));
      if (!sharedSync.disconnect()) { rollback(); return false; }
      leaveSharedMode();
      setQualityWeights(setup.qualityWeights);
      patchState(imported);
      return true;
    } catch { return false; }
  };
  const cancelOrganizerTransfer = () => {
    setTransferTarget(null);
    window.history.replaceState(null, '', window.location.pathname);
  };
  const sharedMode = Boolean(sharedTarget || initialShareId || isSharedSession);
  const sharedWritesPaused = ['offline', 'conflict', 'error', 'not_found', 'expired'].includes(sharedSync.status);
  const sessionModeTitle = transferTarget ? 'Organizer setup transfer' : sharedTarget ? 'Shared session'
    : isSharedSession ? 'Shared snapshot'
    : initialShareId ? (shareNotice === 'error' ? 'Shared link unavailable' : 'Opening shared link')
    : 'This device only';
  const sessionModeDetail = transferTarget ? 'Previewing a private handoff. Accept it to create an independent copy on this device.' : sharedTarget
    ? sharedSync.status === 'loading' ? 'Connecting to the shared session. Wait for loading to finish before editing.'
      : sharedWritesPaused ? 'Shared saving is paused. Check the connection status below; keep this tab open to retain your changes.'
      : isAdmin ? 'Organizer edits autosave to this shared session and sync to other devices.'
      : 'Game progress syncs across devices. Organizer edits require admin access.'
    : isSharedSession ? 'Changes stay in this browser until you publish them.'
    : initialShareId ? 'This page was opened with a shared link. Check its loading status below.'
    : 'Schedule edits stay in this browser.';
  const selectedTab = activeTab === 'live' && !result ? 'setup' : activeTab;
  const waitingHistory = isAdmin && result ? migratePlayedGames(result, players, completedGames, scores, playedGames) : [];
  const slotsWaited = historySlotsWaited(waitingHistory, players, liveGames);
  const playedCounts = historyScheduleState(waitingHistory, players).gamesPlayed;
  const playedCountsById = new Map(players.map((player, index) => [waitingPlayerKey(player), playedCounts[index] ?? 0]));
  const waitingRows = isAdmin && result ? waitingPlayerStatuses({ players, result, liveGames, completedGames, staggerMode, suspendedPlayerNames })
    .map(({ player, key, status }) => ({ key, name: player.name, status, since: waitingClock?.since[key],
      slotsWaited: slotsWaited[player.name] ?? 0, gamesPlayed: playedCountsById.get(key) ?? 0 })) : [];
  const liveBoard = result && <LiveSessionBoard
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
    playedGames={playedGames} completedGames={completedGames}
    onToggleLive={toggleSessionGame}
    onAdjustCourts={adjustCourtsAtSlot}
    blockedPlayerNames={blockedPlayerNames}
    fromSlot={changeSlot}
    liveCapacity={liveCapacity}
    changeSlot={changeSlot}
    changeCapacity={liveCapacity}
    queueAdjustment={queueAdjustment}
    staggerMode={staggerMode}
    onStartSessionTimers={startSessionTimers}
    sessionTimersDisabled={isGenerating || Boolean(sharedTarget && sharedSync.status !== 'saved')}
    preferredQualityPairs={preferredPairs}
    qualityWeights={qualityWeights}
    onQualityWeightsChange={setQualityWeights}
    waitingPanel={isAdmin ? <PlayerWaitingPanel rows={waitingRows} trackingStartedAt={waitingClock?.trackingStartedAt} /> : undefined}
  />;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        {showPinPrompt && <PinPromptModal pinInput={pinInput} pinError={pinError} setPinInput={value => patchState({ pinInput: value, pinError: false })} submitPin={submitPin} close={() => patchState({ showPinPrompt: false, pinInput: '', pinError: false })} />}
        {showSavePlan && <SavePlanModal needsPin={Boolean(window.ADMIN_PIN && !isAdmin)} pinInput={pinInput} pinError={pinError} setPinInput={value => patchState({ pinInput: value, pinError: false })} submitPin={submitPin} saveTag={saveTag} setSaveTag={value => patchState({ saveTag: value })} savePlan={savePlan} canUpdate={loadedPlanId != null && savedPlans.some(p => p.id === loadedPlanId)} savedPlans={savedPlans} isSharedSession={isSharedSession} close={() => patchState({ showSavePlan: false, pinInput: '', pinError: false })} />}
        {showShareModal && <ShareLinkModal copiedShareUrl={copiedShareUrl} sharedUrl={sharedUrl} shareIsUpdate={shareIsUpdate} hasExisting={isFirebaseConfigured() ? !!shareId : !!(shareId && shareToken)} copyShareUrl={copyShareUrl} newShareLink={() => shareLink(true)} close={() => patchState({ showShareModal: false })} />}
        {showImport && <ImportModal importText={importText} importError={importError} setImportText={value => patchState({ importText: value, importError: '' })} importSchedule={importSchedule} close={() => patchState({ showImport: false, importText: '', importError: '' })} />}
        {queuePromotionPrompt && <QueuePromotionModal prompt={queuePromotionPrompt.prompt} onUseLookahead={() => resolveSessionPromotion('lookahead')} onSubstitute={() => resolveSessionPromotion('substitute')} onCancel={cancelQueuePromotion} />}
        {pendingSharedUndo && <div role="alertdialog" aria-label="Undo Finish" style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000b', display: 'grid', placeItems: 'center' }}><div style={{ background: C.card, padding: 24, borderRadius: 12, maxWidth: 420 }}>
          <h2>Undo Finish?</h2><p>This also stops the replacement game that was started. Confirm only if that replacement game has not actually begun play. If it has already finished or changed, undo will be blocked.</p>
          <button onClick={() => { void sharedSync.performAction({ type: 'undo', at: Date.now(), id: crypto.randomUUID(), target: pendingSharedUndo, confirmDependents: true }); setPendingSharedUndo(null); }} style={{ minHeight: 48 }}>Undo Finish and stop replacement</button>
          <button onClick={() => setPendingSharedUndo(null)} style={{ minHeight: 48, marginLeft: 8 }}>Cancel</button>
        </div></div>}
        {pendingSessionChange && <SessionChangeModal {...pendingSessionChange} onConfirm={confirmSessionChange} onCancel={cancelSessionChange} />}

        <div style={{ marginBottom: 28, borderBottom: `1px solid ${C.border}`, paddingBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: '1 1 180px', minWidth: 0 }}>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flexShrink: 0, maxWidth: '100%', marginLeft: 'auto', alignItems: 'center' }}>
            <button onClick={exportDebugLogs} title="Download debug logs" aria-label="Download debug logs" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.card, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, width: 30, height: 28, padding: 0 }}><LucideIcon name="download" size={14} /></button>
            {isFirebaseConfigured() && <span title={dbSynced === 'synced' ? 'Win-loss synced to cloud' : dbSynced === 'syncing' ? 'Syncing…' : dbSynced === 'error' ? 'Sync failed' : 'Cloud sync ready'} style={{ fontSize: 13, color: dbSynced === 'synced' ? C.green : dbSynced === 'error' ? '#ef4444' : C.textMuted }}>{dbSynced === 'synced' ? '☁ Synced' : dbSynced === 'syncing' ? '⟳' : dbSynced === 'error' ? '☁ ✗' : '☁'}</span>}
            {window.ADMIN_PIN && (
              <button onClick={toggleAdminLock} title={isAdmin ? 'Click to lock score entry' : 'Click to unlock score entry'} style={{ background: isAdmin ? C.accentDim : C.card, color: isAdmin ? '#fff' : C.textMuted, border: `1px solid ${isAdmin ? 'transparent' : C.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, fontFamily: FONT }}>
                {isAdmin ? '🔓 Admin' : '🔒 Unlock admin'}
              </button>
            )}
          </div>
        </div>

        <section role="region" aria-label="Session mode" style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${sharedMode ? C.accent : C.textMuted}`, borderRadius: 8, padding: '12px 14px', marginBottom: 16, overflowWrap: 'anywhere' }}>
          <strong style={{ display: 'block', color: sharedMode ? C.accent : C.text, fontSize: 15 }}>{sessionModeTitle}</strong>
          <p style={{ margin: '5px 0 0', color: C.textDim, fontSize: 13 }}>{sessionModeDetail}</p>
          <p style={{ margin: '5px 0 0', color: C.textDim, fontSize: 12 }}>
            {isSharedSession ? 'Private levels: Setup → Players with admin unlocked. Level changes stay on this device and are excluded from public links.' : 'Private levels: Setup → Players (admin unlocked).'}
          </p>
        </section>

        {isSharedSession && !transferTarget && <div style={{marginBottom:16}}>
          <button onClick={useSessionOnThisDevice} disabled={isGenerating || sharedSync.status === 'saving' || Boolean(sharedTarget && sharedSync.status === 'loading')} style={{minHeight:44,background:C.accentDim,color:'#fff',border:`1px solid ${C.border}`,borderRadius:6,padding:'10px 14px',fontFamily:FONT}}>Use on this device</button>
          <p style={{fontSize:12,color:C.textDim,marginTop:4}}>Keep this session here and disconnect live updates. A backup of this device’s previous setup is retained.</p>
        </div>}
        <OrganizerHandoff target={transferTarget} canExport={isAdmin && selectedTab === 'setup' && players.length > 0 && !isGenerating}
          createSetup={() => buildOrganizerSetup(state, qualityWeights)} onImport={importOrganizerSetup} onCancel={cancelOrganizerTransfer}
          onCopy={url => copyText(url)} />
        {hasDeviceSessionBackup() && <button onClick={downloadDeviceSessionBackup} style={{minHeight:44,background:C.card,color:C.textDim,border:`1px solid ${C.border}`,borderRadius:6,padding:'8px 12px',marginBottom:16,fontFamily:FONT}}>Download previous device setup</button>}

        {shareNotice && (
          <div role={['loading', 'loaded', 'saved'].includes(shareNotice) ? 'status' : 'alert'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16, background: C.card, border: `1px solid ${C.amber}33`, borderRadius: 8, padding: '10px 14px' }}>
            <span style={{ fontSize: 12, color: C.amber }}>{({
              loading: 'Loading shared schedule…',
              loaded: 'Shared schedule loaded.',
              saved: 'Shared schedule saved to the cloud.',
              expired: 'This share link has expired (older than 30 days). Ask for a new link.',
              not_found: 'This share link was not found. Ask the organizer to share it again.',
              invalid: 'This shared schedule could not be read. Ask for a new share link.',
              error: 'Could not load this shared schedule. Refresh to retry, or download debug logs for details.',
              save_error: 'Could not publish this shared schedule. Your local changes are kept. Try Share or Save again, or download debug logs for details.',
            })[shareNotice]}</span>
            {shareNotice !== 'loading' && <button aria-label="Dismiss share notice" onClick={() => patchState({ shareNotice: null })} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 16, padding: 0 }}>×</button>}
          </div>
        )}

        {sharedTarget && <div role={['conflict', 'error', 'not_found', 'expired'].includes(sharedSync.status) ? 'alert' : 'status'} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <strong>{({ loading: 'Loading shared session…', saving: 'Saving shared session…', saved: 'Shared session saved', offline: 'Offline — changes retained on this device', conflict: 'Session changed on another device — your draft is retained', not_found: 'This share link was not found. Ask the organizer to share it again.', expired: 'This share link has expired. Ask for a new link.', error: 'Could not load this shared schedule. Download debug logs for details.' })[sharedSync.status]}</strong>
          {sharedSync.message && <p>{sharedSync.message}</p>}
          {sharedSync.hasRecovery && sharedSync.status !== 'conflict' && <button onClick={sharedSync.downloadDraft} style={{ marginLeft: 12, minHeight: 44 }}>Download retained draft</button>}
          {['offline', 'error'].includes(sharedSync.status) && <button onClick={sharedSync.retry} style={{ marginLeft: 12, minHeight: 44 }}>Retry connection</button>}
          {sharedSync.status === 'conflict' && <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={sharedSync.downloadDraft} style={{ minHeight: 44 }}>Download my draft</button>
            <button onClick={sharedSync.loadLatest} style={{ minHeight: 44 }}>Load latest session</button>
          </div>}
        </div>}

        <nav aria-label="Session views" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
          {([['live', 'Live session'], ['setup', 'Setup'], ['past', `Past games${playedGames.length ? ` (${playedGames.length})` : ''}`], ['pairings', 'Pairings'], ['archive', `Saved plans${savedPlans.length ? ` (${savedPlans.length})` : ''}`], ['about', 'How it works']] as const).map(([val, label]) => (
            <button key={val} onClick={() => patchState({ activeTab: val })}
              disabled={val === 'live' && !result}
              aria-current={selectedTab === val ? 'page' : undefined}
              style={{
                flex: '1 1 110px', background: selectedTab === val ? C.accentDim : C.card, color: selectedTab === val ? '#fff' : C.textDim,
                border: `1px solid ${selectedTab === val ? C.accentDim : C.border}`, borderRadius: 8, padding: '10px 14px',
                opacity: val === 'live' && !result ? 0.5 : 1,
                fontSize: 13, fontWeight: 700, fontFamily: FONT,
              }}>
              {label}
            </button>
          ))}
        </nav>

        {result && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button onClick={() => {
            if (!sharedTarget) { restoreUndo(); return; }
            const action = sharedSync.latest?.actions?.at(-1);
            if (action?.promoted?.length) setPendingSharedUndo(action.id);
            else if (action) void sharedSync.performAction({ type: 'undo', at: Date.now(), id: crypto.randomUUID(), target: action.id });
          }} disabled={isGenerating || (sharedTarget ? !sharedSync.latest?.actions?.length || sharedSync.status !== 'saved' : !state.undoSnapshot)} title={sharedTarget ? 'Undo last Finish' : 'Undo last action'} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '12px 16px', minHeight: 44, fontSize: 13, fontFamily: FONT }}>
            <LucideIcon name="undo" size={16} /> {sharedTarget ? 'Undo last Finish' : 'Undo last action'}
          </button>
        </div>}

        {activeTab === 'archive' && (
          <ArchiveTab savedPlans={savedPlans} loadPlan={loadPlan} deletePlan={deletePlan} />
        )}

        {activeTab === 'past' && <PastGamesTab playedGames={playedGames} result={result} completedGames={completedGames} liveGames={liveGames} scores={scores} players={players} winLoss={winLoss} />}

        {activeTab === 'pairings' && <PairingsTab players={players} result={result} completedGames={completedGames} scores={scores} />}

        {activeTab === 'about' && <AboutTab />}

        {(selectedTab === 'live' || selectedTab === 'setup') && (
        <>
        {sessionChangeNotice && <p role="status" aria-label="Session change" style={{ color: C.green, fontSize: 13, margin: '0 0 16px', overflowWrap: 'anywhere' }}>{sessionChangeNotice}</p>}
        {selectedTab === 'live' && liveBoard}
        <SessionSettingsPanel
          visible={selectedTab === 'setup'}
          sessionStart={sessionStart}
          totalMinutes={totalMinutes}
          gameMinutes={gameMinutes}
          numCourts={numCourts}
          extraCourt={extraCourt}
          staggerMode={staggerMode}
          preferMixedTeams={preferMixedTeams}
          scheduleActive={Boolean(result)}
          players={players}
          preferredPairs={preferredPairs}
          patchState={patchState}
        />

        <PlayerList
          visible={selectedTab === 'setup'}
          players={players}
          playerHistory={playerHistory}
          winLoss={winLoss}
          staggerMode={staggerMode}
          totalSlots={totalSlots}
          nameInput={nameInput}
          genderInput={genderInput}
          levelInput={levelInput}
          allDefaultsLoaded={allDefaultsLoaded}
          scheduleActive={Boolean(result)}
          showPrivateFields={isAdmin}
          setNameInput={value => setField('nameInput', value)}
          setGenderInput={value => setField('genderInput', value)}
          setLevelInput={value => setField('levelInput', value)}
          addPlayer={addPlayer}
          addImportedPlayers={addImportedPlayers}
          addSelectedFromBank={addSelectedFromBank}
          addToBank={addToBank}
          removeFromHistory={removeFromHistory}
          loadDefaults={loadDefaults}
          resetPlayers={resetPlayers}
          clearPlayers={clearPlayers}
          clearWinLoss={clearWinLoss}
          updatePlayer={updatePlayer}
          removePlayer={removePlayer}
          togglePlayerQuarantined={togglePlayerQuarantined}
        />

        {selectedTab === 'setup' && !result && <QuarantinePanel players={players} togglePlayerQuarantined={togglePlayerQuarantined} />}

        {selectedTab === 'setup' && players.length >= 4 && (
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
            {selectedTab === 'setup' && <button onClick={clearSchedule} title="Clear schedule" style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT }}><LucideIcon name="trash" size={15} /> Clear</button>}
          </div>
        )}

        {pendingOverwrite && (
          <ConfirmOverwriteModal historyCount={playedGames.length} liveCount={liveGames.length} isReroll={pendingOverwrite === 'generate'} onConfirm={executeOverwrite} onCancel={cancelOverwrite} />
        )}

        {selectedTab === 'setup' && <>
        {hasAppliedScores && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, background: C.card, border: `1px solid ${C.amber}33`, borderRadius: 8, padding: '8px 14px' }}><span style={{ fontSize: 12, color: C.amber }}>⚡ Scores recorded — re-roll to use updated skill ratings in the next schedule</span></div>}

        {result && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
            {scheduleDirty && <span style={{ width: '100%', color: C.amber, fontSize: 12 }}>Roster or scheduling preferences changed — choose the first affected slot below, then apply regeneration to update upcoming games.</span>}
            <span style={{ fontSize: 12, color: C.textDim }}>Re-generate from slot</span>
            <input aria-label="Regenerate from slot" type="number" min={changeSlot} max={totalSlots} disabled={changeSlot > totalSlots} value={Math.max(changeSlot, fromSlot)} onChange={e => patchState({ fromSlot: Math.min(totalSlots, Math.max(changeSlot, +e.target.value)) })} style={{ width: 48, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', color: C.text, fontSize: 13, fontFamily: FONT, textAlign: 'center' }} />
            <span style={{ fontSize: 12, color: C.textDim }}>with</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => patchState({ fromSlotCourts: n })} style={{ padding: '4px 8px', fontSize: 12, fontWeight: 600, fontFamily: FONT, borderRadius: 4, border: `1px solid ${fromSlotCourts === n ? C.accent : C.border}`, background: fromSlotCourts === n ? C.accentDim : C.bg, color: fromSlotCourts === n ? '#fff' : C.textDim, cursor: 'pointer' }}>{n === 0 ? 'auto' : `${n}C`}</button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: C.textDim, flex: 1 }}>courts onwards</span>
            <button disabled={changeSlot > totalSlots} onClick={() => regenerateUpcoming(fromSlot, fromSlotCourts)} style={{ background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: FONT }}>Apply</button>
            <span style={{ width: '100%', fontSize: 12, color: C.textDim }}>First changeable slot: {changeSlot <= totalSlots ? changeSlot : 'none'}. Current and completed games stay unchanged.</span>
          </div>
        )}

        {saved && !sharedTarget && <p style={{ fontSize: 12, color: C.green, textAlign: 'center', marginTop: -16, marginBottom: 16 }}>Schedule saved — will persist on refresh</p>}
        </>}

        {result && (
          <SessionStatusPanel
            players={players}
            fromSlot={changeSlot}
            totalSlots={totalSlots}
            liveGames={liveGames}
            completedGames={completedGames}
            staggerMode={staggerMode}
            setPlayerBack={setPlayerBack}
            setPlayerJoining={setPlayerJoining}
            setPlayerLeaving={setPlayerLeaving}
            togglePlayerQuarantined={togglePlayerQuarantined}
          />
        )}

        {selectedTab === 'setup' && liveBoard}
        </>
        )}
      </div>
    </div>
  );
}

export default BadmintonPlanner;
