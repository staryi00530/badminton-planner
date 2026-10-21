import { useCallback, useEffect, useReducer } from 'react';
import { DEFAULT_GAME_MINUTES, DEFAULT_TOTAL_MINUTES } from '../constants';
import type { PlannerPersistedState, PlannerState } from '../types';
import { captureUndoSnapshot, EMPTY_QUEUE_STATE } from '../utils/undoSnapshot';

const STORAGE_KEYS = {
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
    const raw = localStorage.getItem(key);
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
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function createInitialState(): PlannerState {
  // bp-share-id/bp-share-token used to be persisted across visits, which caused a stale
  // share to silently reconnect (and overwrite local state) on a plain, non-share app open.
  // Clean up any leftovers from before this was fixed.
  try {
    localStorage.removeItem('bp-share-id');
    localStorage.removeItem('bp-share-token');
  } catch {}

  const storedPlayers = loadState<PlannerState['players']>(STORAGE_KEYS.players, []);
  const storedHistory = loadState<PlannerState['playerHistory']>(STORAGE_KEYS.playerHistory, []);
  const result = loadState<PlannerState['result']>(STORAGE_KEYS.result, null);
  const isSharedSession = loadSession('bp-is-shared-session', false);
  const storedTab = loadState<unknown>(STORAGE_KEYS.activeTab, null);
  const activeTab = (['live', 'setup', 'past', 'archive', 'about'] as const).find(tab => tab === storedTab)
    ?? (result ? 'live' : 'setup');
  return {
    ...EMPTY_QUEUE_STATE,
    undoSnapshot: null,
    // Older rosters and the original defaults did not store a level. Normalize those
    // records so the private setting survives reloads and future persistence writes.
    players: storedPlayers.map(player => ({ ...player, level: player.level ?? 2 })),
    playerHistory: storedHistory.map(player => ({ ...player, level: player.level ?? 2 })),
    nameInput: '',
    genderInput: 'M',
    levelInput: 2,
    totalMinutes: loadState(STORAGE_KEYS.totalMinutes, DEFAULT_TOTAL_MINUTES),
    gameMinutes: loadState(STORAGE_KEYS.gameMinutes, DEFAULT_GAME_MINUTES),
    numCourts: loadState(STORAGE_KEYS.numCourts, 1),
    extraCourt: loadState(STORAGE_KEYS.extraCourt, { enabled: false, startMin: 60, durationMin: 90 }),
    courtOverrides: loadState(STORAGE_KEYS.courtOverrides, {}),
    staggerMode: loadState(STORAGE_KEYS.staggerMode, 'none'),
    sessionStart: loadState(STORAGE_KEYS.sessionStart, ''),
    result,
    scheduleDirty: false,
    scores: loadState(STORAGE_KEYS.scores, {}),
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
    completedGames: result && !isSharedSession ? loadState(STORAGE_KEYS.completedGames, []) : [],
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
      return { ...state, [action.key]: action.value };
    case 'patch':
      return { ...state, ...action.value, ...(action.value.result === null ? { ...EMPTY_QUEUE_STATE, undoSnapshot: null } : {}) };
    default:
      return state;
  }
}

export function usePlannerState() {
  const [state, dispatch] = useReducer(plannerReducer, undefined, createInitialState);

  useEffect(() => {
    const persisted: PlannerPersistedState = {
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
    const liveSessionExempt = new Set(['players', 'result', 'scores', 'isConfirmed', 'activeTab', 'courtOverrides', 'liveGames', 'completedGames', 'suspendedPlayerNames']);

    for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
      if (state.isSharedSession && liveSessionExempt.has(key)) continue;
      const value = persisted[key as keyof PlannerPersistedState];
      if (key === 'result' && !value) localStorage.removeItem(storageKey);
      else if (['liveGames', 'completedGames', 'suspendedPlayerNames'].includes(key) && !state.result) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(value));
    }
  }, [
    state.players,
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
      if (state.shareId) sessionStorage.setItem('bp-share-id', JSON.stringify(state.shareId));
      else sessionStorage.removeItem('bp-share-id');
      if (state.shareToken) sessionStorage.setItem('bp-share-token', JSON.stringify(state.shareToken));
      else sessionStorage.removeItem('bp-share-token');
      sessionStorage.setItem('bp-is-shared-session', JSON.stringify(state.isSharedSession));
    } catch {}
  }, [state.shareId, state.shareToken, state.isSharedSession]);

  const setField = <K extends keyof PlannerState>(key: K, value: PlannerState[K]) =>
    dispatch({ type: 'set', key, value });
  const patchState = useCallback((value: Partial<PlannerState>) => dispatch({ type: 'patch', value }), []);
  const recordUndo = useCallback(() => dispatch({ type: 'recordUndo' }), []);
  const restoreUndo = useCallback(() => dispatch({ type: 'restoreUndo' }), []);

  return { state, setField, patchState, recordUndo, restoreUndo };
}
