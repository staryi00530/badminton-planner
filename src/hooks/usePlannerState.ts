import { useEffect, useReducer } from 'react';
import { DEFAULT_GAME_MINUTES, DEFAULT_TOTAL_MINUTES } from '../constants';
import type { PlannerPersistedState, PlannerState } from '../types';

const STORAGE_KEYS = {
  players: 'bp-players',
  playerHistory: 'bp-player-history',
  totalMinutes: 'bp-totalMinutes',
  gameMinutes: 'bp-gameMinutes',
  numCourts: 'bp-numCourts',
  extraCourt: 'bp-extraCourt',
  staggerMode: 'bp-staggerMode',
  sessionStart: 'bp-sessionStart',
  result: 'bp-result',
  scores: 'bp-scores',
  winLoss: 'bp-winloss',
  savedPlans: 'bp-saved-plans',
  preferMixedTeams: 'bp-prefer-mixed-teams',
  isConfirmed: 'bp-is-confirmed',
  loadedPlanId: 'bp-loaded-plan-id',
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

  return {
    players: loadState(STORAGE_KEYS.players, []),
    playerHistory: loadState(STORAGE_KEYS.playerHistory, []),
    nameInput: '',
    genderInput: 'M',
    totalMinutes: loadState(STORAGE_KEYS.totalMinutes, DEFAULT_TOTAL_MINUTES),
    gameMinutes: loadState(STORAGE_KEYS.gameMinutes, DEFAULT_GAME_MINUTES),
    numCourts: loadState(STORAGE_KEYS.numCourts, 1),
    extraCourt: loadState(STORAGE_KEYS.extraCourt, { enabled: false, startMin: 60, durationMin: 90 }),
    staggerMode: loadState(STORAGE_KEYS.staggerMode, 'none'),
    sessionStart: loadState(STORAGE_KEYS.sessionStart, ''),
    result: loadState(STORAGE_KEYS.result, null),
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
    activeTab: 'schedule',
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
    isSharedSession: loadSession('bp-is-shared-session', false),
    preferMixedTeams: loadState(STORAGE_KEYS.preferMixedTeams, false),
    isConfirmed: loadState(STORAGE_KEYS.isConfirmed, false),
    pendingOverwrite: null,
    shareNotice: null,
    loadedPlanId: loadState(STORAGE_KEYS.loadedPlanId, null),
    liveGames: [],
    completedGames: [],
  };
}

type PlannerAction =
  | { type: 'set'; key: keyof PlannerState; value: PlannerState[keyof PlannerState] }
  | { type: 'patch'; value: Partial<PlannerState> };

function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'set':
      return { ...state, [action.key]: action.value };
    case 'patch':
      return { ...state, ...action.value };
    default:
      return state;
  }
}

export function usePlannerState() {
  const [state, dispatch] = useReducer(plannerReducer, undefined, createInitialState);

  useEffect(() => {
    const persisted: PlannerPersistedState = {
      players: state.players,
      playerHistory: state.playerHistory,
      totalMinutes: state.totalMinutes,
      gameMinutes: state.gameMinutes,
      numCourts: state.numCourts,
      extraCourt: state.extraCourt,
      staggerMode: state.staggerMode,
      sessionStart: state.sessionStart,
      result: state.result,
      scores: state.scores,
      winLoss: state.winLoss,
      savedPlans: state.savedPlans,
      preferMixedTeams: state.preferMixedTeams,
      isConfirmed: state.isConfirmed,
      loadedPlanId: state.loadedPlanId,
    };

    // While viewing a live shared link, the schedule belongs to that share, not to this
    // device's own local copy — don't let it overwrite the personal schedule other tabs/
    // future visits would otherwise load. Settings unrelated to "whose schedule is this"
    // (player bank, saved plans, win/loss) still persist normally.
    const liveSessionExempt = new Set(['players', 'result', 'scores', 'isConfirmed']);

    for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
      if (state.isSharedSession && liveSessionExempt.has(key)) continue;
      const value = persisted[key as keyof PlannerPersistedState];
      if (key === 'result' && !value) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(value));
    }
  }, [
    state.players,
    state.playerHistory,
    state.totalMinutes,
    state.gameMinutes,
    state.numCourts,
    state.extraCourt,
    state.staggerMode,
    state.sessionStart,
    state.result,
    state.scores,
    state.winLoss,
    state.savedPlans,
    state.preferMixedTeams,
    state.isConfirmed,
    state.loadedPlanId,
    state.isSharedSession,
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
  const patchState = (value: Partial<PlannerState>) => dispatch({ type: 'patch', value });

  return { state, setField, patchState };
}
