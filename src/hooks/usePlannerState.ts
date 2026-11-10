import { reconcileWaitingClock, validWaitingClock } from '../utils/waitingClock';
import { useCallback, useEffect, useReducer } from 'react';
import { DEFAULT_GAME_MINUTES, DEFAULT_TOTAL_MINUTES } from '../constants';
import type { PlannerPersistedState, PlannerState } from '../types';
import { captureUndoSnapshot, EMPTY_QUEUE_STATE } from '../utils/undoSnapshot';
import { plannerStorageKey, seedBetaPlannerStorage } from '../utils/plannerStorage';
import { normalizePlayerIdentities } from '../utils/playerIdentity';
import { makePlayedGame, mergePlayedGames, migratePlayedGames } from '../utils/playedHistory';

const STORAGE_KEYS = {
  waitingClock: 'bp-waiting-clock',
  playedGames: 'bp-played-games',
  historyEpoch: 'bp-history-epoch',
  players: 'bp-players',
  playerHistory: 'bp-player-history',
  totalMinutes: 'bp-totalMinutes',
  gameMinutes: 'bp-gameMinutes',
  numCourts: 'bp-numCourts',
  extraCourt: 'bp-extraCourt',
  courtOverrides: 'bp-courtOverrides',
  staggerMode: 'bp-staggerMode',
  sessionStart: 'bp-sessionStart',
  result: 'bp-result',
  liveGames: 'bp-live-games',
  completedGames: 'bp-completed-games',
  suspendedPlayerNames: 'bp-suspended-player-names',
  scores: 'bp-scores',
  winLoss: 'bp-winloss',
  savedPlans: 'bp-saved-plans',
  preferMixedTeams: 'bp-prefer-mixed-teams',
  preferredPairs: 'bp-preferred-pairs',
  isConfirmed: 'bp-is-confirmed',
  loadedPlanId: 'bp-loaded-plan-id',
  activeTab: 'bp-active-tab',
} as const;

function loadState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(plannerStorageKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// shareId/shareToken/isSharedSession use sessionStorage, not localStorage: this keeps a
// share link stable across a page refresh in the SAME tab (so re-clicking Share reuses the
// same link), while clearing automatically when the tab/browser closes — unlike localStorage,
// it can never resurface days later to silently overwrite an unrelated schedule.
function loadSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(plannerStorageKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function createInitialState(): PlannerState {
  seedBetaPlannerStorage([...Object.values(STORAGE_KEYS), 'bp-player-level-scale', 'bp-bank-level-scale']);
  // bp-share-id/bp-share-token used to be persisted across visits, which caused a stale
  // share to silently reconnect (and overwrite local state) on a plain, non-share app open.
  // Clean up any leftovers from before this was fixed.
  try {
    localStorage.removeItem(plannerStorageKey('bp-share-id'));
    localStorage.removeItem(plannerStorageKey('bp-share-token'));
  } catch {}

  const storedPlayers = loadState<PlannerState['players']>(STORAGE_KEYS.players, []);
  const storedHistory = loadState<PlannerState['playerHistory']>(STORAGE_KEYS.playerHistory, []);
  const migrateLevel = (level: PlannerState['levelInput'] | undefined, legacyLevels: boolean): PlannerState['levelInput'] =>
    level == null ? 3 : legacyLevels && level <= 3 ? (2 * level - 1) as PlannerState['levelInput'] : level;
  const result = loadState<PlannerState['result']>(STORAGE_KEYS.result, null);
  const isSharedSession = loadSession('bp-is-shared-session', false);
  const storedTab = loadState<unknown>(STORAGE_KEYS.activeTab, null);
  const activeTab = (['live', 'setup', 'past', 'pairings', 'archive', 'about'] as const).find(tab => tab === storedTab)
    ?? (result ? 'live' : 'setup');
  const identities = normalizePlayerIdentities(storedPlayers, storedHistory);
  const completedGames = result && !isSharedSession ? loadState<PlannerState['completedGames']>(STORAGE_KEYS.completedGames, []) : [];
  const scores = loadState<PlannerState['scores']>(STORAGE_KEYS.scores, {});
  const playedGames = isSharedSession ? [] : loadState<PlannerState['playedGames'] | null>(STORAGE_KEYS.playedGames, null)
    ?? migratePlayedGames(result, identities.players as PlannerState['players'], completedGames, scores);
  return {
    ...EMPTY_QUEUE_STATE,
    undoSnapshot: null,
    waitingClock: !isSharedSession && validWaitingClock(loadState(STORAGE_KEYS.waitingClock, null)) ? loadState(STORAGE_KEYS.waitingClock, { since: {} }) : { since: {} },
    playedGames,
    historyEpoch: isSharedSession ? 0 : loadState(STORAGE_KEYS.historyEpoch, 0),
    // Older rosters and the original defaults did not store a level. Normalize those
    // records so the private setting survives reloads and future persistence writes.
    players: identities.players.map(player => ({ ...player, level: migrateLevel(player.level, loadState<number>('bp-player-level-scale', 3) !== 5) })),
    playerHistory: identities.playerHistory.map(player => ({ ...player, level: migrateLevel(player.level, loadState<number>('bp-bank-level-scale', 3) !== 5) })),
    nameInput: '',
    genderInput: 'M',
    levelInput: 3,
    totalMinutes: loadState(STORAGE_KEYS.totalMinutes, DEFAULT_TOTAL_MINUTES),
    gameMinutes: loadState(STORAGE_KEYS.gameMinutes, DEFAULT_GAME_MINUTES),
    numCourts: loadState(STORAGE_KEYS.numCourts, 1),
    extraCourt: loadState(STORAGE_KEYS.extraCourt, { enabled: false, startMin: 60, durationMin: 90 }),
    courtOverrides: loadState(STORAGE_KEYS.courtOverrides, {}),
    staggerMode: loadState(STORAGE_KEYS.staggerMode, 'none'),
    sessionStart: loadState(STORAGE_KEYS.sessionStart, ''),
    result,
    scheduleDirty: false,
    scores,
    winLoss: loadState(STORAGE_KEYS.winLoss, {}),
    fromSlot: 1,
    fromSlotCourts: 0,
    copied: false,
    copiedGames: false,
    saved: false,
    isGenerating: false,
    genSlot: 0,
    showPinPrompt: false,
    pinInput: '',
    pinError: false,
    showImport: false,
    importText: '',
    importError: '',
    savedPlans: loadState(STORAGE_KEYS.savedPlans, []),
    showSavePlan: false,
    saveTag: '',
    activeTab: activeTab === 'live' && !result ? 'setup' : activeTab,
    editingSlot: null,
    editLayout: null,
    pendingShare: null,
    showShareLoad: false,
    showShareModal: false,
    sharedUrl: '',
    copiedShareUrl: false,
    shareIsUpdate: false,
    shareId: loadSession('bp-share-id', null),
    shareToken: loadSession('bp-share-token', null),
    isSharedSession,
    preferMixedTeams: loadState(STORAGE_KEYS.preferMixedTeams, false),
    preferredPairs: loadState(STORAGE_KEYS.preferredPairs, []),
    isConfirmed: loadState(STORAGE_KEYS.isConfirmed, false),
    pendingOverwrite: null,
    shareNotice: null,
    loadedPlanId: loadState(STORAGE_KEYS.loadedPlanId, null),
    liveGames: result && !isSharedSession ? loadState(STORAGE_KEYS.liveGames, []) : [],
    completedGames,
    suspendedPlayerNames: result && !isSharedSession ? loadState(STORAGE_KEYS.suspendedPlayerNames, []) : [],
  };
}

type PlannerAction =
  | { type: 'recordUndo' }
  | { type: 'restoreUndo' }
  | { type: 'set'; key: keyof PlannerState; value: PlannerState[keyof PlannerState] }
  | { type: 'patch'; value: Partial<PlannerState> };

function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'recordUndo':
      return { ...state, undoSnapshot: captureUndoSnapshot(state) };
    case 'restoreUndo':
      return state.undoSnapshot ? { ...state, ...state.undoSnapshot, undoSnapshot: null } : state;
    case 'set':
      return ['players', 'result', 'liveGames', 'completedGames', 'suspendedPlayerNames', 'staggerMode', 'historyEpoch'].includes(action.key)
        ? plannerReducer(state, { type: 'patch', value: { [action.key]: action.value } })
        : { ...state, [action.key]: action.value };
    case 'patch': {
      const next = { ...state, ...action.value, ...(action.value.result === null ? { ...EMPTY_QUEUE_STATE, undoSnapshot: null } : {}) };
      const finalize = (value: PlannerState) => ({ ...value, waitingClock: action.value.waitingClock !== undefined ? action.value.waitingClock : reconcileWaitingClock(state.waitingClock, state, value, Date.now(), { reset: value.historyEpoch !== state.historyEpoch }) });
      if (action.value.playedGames !== undefined) return finalize(next);
      let history = migratePlayedGames(state.result, state.players, state.completedGames, state.scores, state.playedGames);
      const identity = (record: NonNullable<ReturnType<typeof makePlayedGame>>) => JSON.stringify([record.planId, record.slot, [...record.teamA, ...record.teamB].map(p => p.id).sort()]);
      const oldCompletions = new Set(history.map(identity));
      for (const ref of next.completedGames) {
        const record = makePlayedGame(next.result, next.players, ref, next.scores, state.liveGames);
        if (!record) continue;
        const existing = history.find(game => identity(game) === identity(record));
        if (!oldCompletions.has(identity(record))) history = mergePlayedGames(history, [record]);
        else if (existing && action.value.scores !== undefined) history = history.map(game => game === existing ? { ...game, ...(record.score ? { score: record.score } : {}) } : game);
      }
      return finalize({ ...next, playedGames: history });
    }
    default:
      return state;
  }
}

export function usePlannerState() {
  const [state, dispatch] = useReducer(plannerReducer, undefined, createInitialState);

  useEffect(() => {
    const persisted: PlannerPersistedState = {
      waitingClock: state.waitingClock,
      playedGames: state.playedGames,
      historyEpoch: state.historyEpoch,
      activeTab: state.activeTab,
      players: state.players,
      playerHistory: state.playerHistory,
      totalMinutes: state.totalMinutes,
      gameMinutes: state.gameMinutes,
      numCourts: state.numCourts,
      extraCourt: state.extraCourt,
      courtOverrides: state.courtOverrides,
      staggerMode: state.staggerMode,
      sessionStart: state.sessionStart,
      result: state.result,
      liveGames: state.liveGames,
      completedGames: state.completedGames,
      suspendedPlayerNames: state.suspendedPlayerNames,
      scores: state.scores,
      winLoss: state.winLoss,
      savedPlans: state.savedPlans,
      preferMixedTeams: state.preferMixedTeams,
      preferredPairs: state.preferredPairs,
      isConfirmed: state.isConfirmed,
      loadedPlanId: state.loadedPlanId,
    };

    // While viewing a live shared link, the schedule belongs to that share, not to this
    // device's own local copy — don't let it overwrite the personal schedule other tabs/
    // future visits would otherwise load. Settings unrelated to "whose schedule is this"
    // (player bank, saved plans, win/loss) still persist normally.
    const liveSessionExempt = new Set(['players', 'result', 'scores', 'isConfirmed', 'activeTab', 'courtOverrides', 'liveGames', 'completedGames', 'suspendedPlayerNames', 'totalMinutes', 'gameMinutes', 'numCourts', 'extraCourt', 'staggerMode', 'sessionStart', 'preferMixedTeams', 'preferredPairs', 'playedGames', 'historyEpoch', 'waitingClock']);

    for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
      const openingShare = new URLSearchParams(window.location.search).has('share') || window.location.hash.startsWith('#share=');
      if ((state.isSharedSession || openingShare) && liveSessionExempt.has(key)) continue;
      const value = persisted[key as keyof PlannerPersistedState];
      if (key === 'result' && !value) localStorage.removeItem(plannerStorageKey(storageKey));
      else if (['liveGames', 'completedGames', 'suspendedPlayerNames'].includes(key) && !state.result) localStorage.removeItem(plannerStorageKey(storageKey));
      else localStorage.setItem(plannerStorageKey(storageKey), JSON.stringify(value));
    }
    localStorage.setItem(plannerStorageKey('bp-bank-level-scale'), '5');
    if (!state.isSharedSession && !new URLSearchParams(window.location.search).has('share') && !window.location.hash.startsWith('#share=')) localStorage.setItem(plannerStorageKey('bp-player-level-scale'), '5');
  }, [
    state.players,
    state.waitingClock,
    state.playedGames,
    state.historyEpoch,
    state.playerHistory,
    state.totalMinutes,
    state.gameMinutes,
    state.numCourts,
    state.extraCourt,
    state.courtOverrides,
    state.staggerMode,
    state.sessionStart,
    state.result,
    state.liveGames,
    state.completedGames,
    state.suspendedPlayerNames,
    state.scores,
    state.winLoss,
    state.savedPlans,
    state.preferMixedTeams,
    state.preferredPairs,
    state.isConfirmed,
    state.loadedPlanId,
    state.isSharedSession,
    state.activeTab,
  ]);

  useEffect(() => {
    try {
      if (state.shareId) sessionStorage.setItem(plannerStorageKey('bp-share-id'), JSON.stringify(state.shareId));
      else sessionStorage.removeItem(plannerStorageKey('bp-share-id'));
      if (state.shareToken) sessionStorage.setItem(plannerStorageKey('bp-share-token'), JSON.stringify(state.shareToken));
      else sessionStorage.removeItem(plannerStorageKey('bp-share-token'));
      sessionStorage.setItem(plannerStorageKey('bp-is-shared-session'), JSON.stringify(state.isSharedSession));
    } catch {}
  }, [state.shareId, state.shareToken, state.isSharedSession]);

  const setField = <K extends keyof PlannerState>(key: K, value: PlannerState[K]) =>
    dispatch({ type: 'set', key, value });
  const patchState = useCallback((value: Partial<PlannerState>) => dispatch({ type: 'patch', value }), []);
  const recordUndo = useCallback(() => dispatch({ type: 'recordUndo' }), []);
  const restoreUndo = useCallback(() => dispatch({ type: 'restoreUndo' }), []);

  return { state, setField, patchState, recordUndo, restoreUndo };
}
