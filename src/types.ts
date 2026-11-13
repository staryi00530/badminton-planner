import type { WaitingClockState } from './utils/waitingClock';
import type { RefObject } from 'react';
import type { Player, SlotResult } from './algorithm/types';
import type { GameRef } from './utils/liveQueue';
import type { PlayedGame } from './utils/playedHistory';

export type { Player, SlotResult };

export interface ExtraCourt {
  enabled: boolean;
  startMin: number;
  durationMin: number;
}

export type StaggerMode = 'none' | 'group' | 'custom';
export type PreferredPair = [string, string];

export interface PlannerResult {
  planId?: string;
  /** Actual capacity phase retained when recovery repacks logical slots. */
  capacityProgressFloorSlot?: number;
  schedule: SlotResult[];
  gamesPlayed: number[];
  preserveLineups?: boolean;
}

export interface ScoreEntry {
  a: string;
  b: string;
  applied: boolean;
  teamA: string[];
  teamB: string[];
}

export type ScoresMap = Record<string, ScoreEntry>;

export interface WinLossRecord {
  wins: number;
  losses: number;
}

export type WinLossMap = Record<string, WinLossRecord>;

export interface SavedPlan {
  id: number;
  tag: string;
  result: PlannerResult;
  savedAt: string;
  sourceShareId?: string | null;
}

export interface EditLayout {
  courts: string[][];
  sitting: string[];
}

export interface QueueAdjustmentNotice {
  queuedGame: { slot: number; court: number; players: string[] };
  promotedGame: { slot: number; court: number; displayCourt: number; players: string[] };
  unavailablePlayers: string[];
  replacements: Array<{ replacee: string; replacer: string; court: number; gamesWaited?: number }>;
}

export interface QueueRuntimeState {
  sessionChangeNotice: string | null;
  pendingSessionChange: {
    boundarySlot: number;
    targetCapacity: number;
    overridePlayers?: Player[];
    courtOverrides: Record<number, number>;
    description: string;
    archiveOnConfirm?: boolean;
  } | null;
  queueAdjustment: QueueAdjustmentNotice | null;
  queuePromotionPrompt: {
    flowId?: string;
    prompt: {
      completedCourt: number;
      firstGame: { slot: number; court: number; players: string[] };
      blockedPlayers: string[];
      lookaheadGame: { slot: number; court: number; players: string[] } | null;
      replacements: Array<{ replacee: string; replacer: string; gamesWaited?: number }>;
    };
    nextLiveGames: GameRef[];
    nextCompletedGames: GameRef[];
    lookaheadGame: GameRef | null;
    changedSlot: number;
    targetLiveCount: number;
  } | null;
}

export type SharedPlayer = [string, 'M' | 'F' | '?'];

export interface SharePayload {
  v: 1;
  schema?: 2 | 3;
  planId?: string;
  history?: PlayedGame[];
  historyEpoch?: number;
  revision?: number;
  ids?: string[];
  active?: number[];
  p: SharedPlayer[];
  /** Public session availability only; private balancing levels are never shared. */
  q?: number[];
  cfg?: { g?: number; c?: number; capacityProgressFloorSlot?: number; totalMinutes?: number; sessionStart?: string; staggerMode?: StaggerMode; extraCourt?: ExtraCourt; courtOverrides?: Record<number, number> };
  availability?: Array<{ from: number; to: number; group?: string; leavesAt?: number | null }>;
  runtime?: { live?: GameRef[]; completed?: GameRef[]; suspended?: string[]; waitingClock?: WaitingClockState };
  actions?: SharedFinishAction[];
  receipts?: string[];
  scores?: Record<string, { a: string; b: string; applied?: boolean }>;
  slots: Array<{
    s: number;
    c: number[][][];
    sit: number[];
  }>;
  confirmed?: boolean;
}

export interface SharedFinishAction {
  id: string;
  gameId: string;
  game: GameRef;
  promoted?: GameRef[];
  playedGameId?: string;
  waitingClockBefore?: WaitingClockState;
}

export interface PlannerState extends QueueRuntimeState {
  playedGames: PlayedGame[];
  historyEpoch: number;
  waitingClock: WaitingClockState;
  undoSnapshot: UndoSnapshot | null;
  players: Player[];
  playerHistory: Array<Pick<Player, 'id' | 'aliases' | 'statsKey' | 'name' | 'gender' | 'level' | 'quarantined'>>;
  nameInput: string;
  genderInput: 'M' | 'F';
  levelInput: 1 | 2 | 3 | 4 | 5;
  totalMinutes: number;
  gameMinutes: number;
  numCourts: number;
  extraCourt: ExtraCourt;
  courtOverrides: Record<number, number>;
  staggerMode: StaggerMode;
  sessionStart: string;
  result: PlannerResult | null;
  scheduleDirty: boolean;
  scores: ScoresMap;
  winLoss: WinLossMap;
  fromSlot: number;
  fromSlotCourts: number;
  copied: boolean;
  copiedGames: boolean;
  saved: boolean;
  isGenerating: boolean;
  genSlot: number;
  showPinPrompt: boolean;
  pinInput: string;
  pinError: boolean;
  showImport: boolean;
  importText: string;
  importError: string;
  savedPlans: SavedPlan[];
  showSavePlan: boolean;
  saveTag: string;
  activeTab: 'live' | 'setup' | 'past' | 'pairings' | 'archive' | 'about';
  editingSlot: number | null;
  editLayout: EditLayout | null;
  pendingShare: SharePayload | null;
  showShareLoad: boolean;
  showShareModal: boolean;
  sharedUrl: string;
  copiedShareUrl: boolean;
  shareIsUpdate: boolean;
  shareId: string | null;
  shareToken: string | null;
  isSharedSession: boolean;
  preferMixedTeams: boolean;
  preferredPairs: PreferredPair[];
  isConfirmed: boolean;
  pendingOverwrite: 'generate' | 'clear' | 'import' | 'regenerateRemaining' | null;
  shareNotice: 'loading' | 'loaded' | 'saved' | 'expired' | 'not_found' | 'error' | 'save_error' | 'invalid' | null;
  loadedPlanId: number | null;
  liveGames: GameRef[];
  completedGames: GameRef[];
  suspendedPlayerNames: string[];
}

export type UndoSnapshot = Pick<PlannerState,
  'result' | 'scores' | 'winLoss' | 'players' | 'liveGames' | 'completedGames' | 'playedGames' | 'historyEpoch' | 'waitingClock' |
  'suspendedPlayerNames' | 'fromSlot' | 'fromSlotCourts' | 'courtOverrides' |
  'scheduleDirty' | 'copied' | 'isConfirmed' | 'loadedPlanId' | 'savedPlans' |
  'editingSlot' | 'editLayout' | 'pendingOverwrite' | 'isGenerating' | 'genSlot'
> & QueueRuntimeState;

/** State fields that may be changed by a runtime queue transition. */
export type RuntimePatch = Pick<Partial<PlannerState>,
  'result' | 'scores' | 'winLoss' | 'players' | 'liveGames' | 'completedGames' | 'playedGames' | 'historyEpoch' | 'waitingClock' |
  'suspendedPlayerNames' | 'fromSlot' | 'scheduleDirty' | 'copied' | 'isConfirmed' |
  'loadedPlanId' | 'editingSlot' | 'editLayout' | 'isGenerating' | 'genSlot' |
  'pendingOverwrite' | 'fromSlotCourts' | 'activeTab' | 'courtOverrides' | 'undoSnapshot' |
  keyof QueueRuntimeState
>;

export interface PlannerPersistedState {
  playedGames: PlayedGame[];
  historyEpoch: number;
  waitingClock: WaitingClockState;
  activeTab: PlannerState['activeTab'];
  players: Player[];
  playerHistory: Array<Pick<Player, 'id' | 'aliases' | 'statsKey' | 'name' | 'gender' | 'level' | 'quarantined'>>;
  totalMinutes: number;
  gameMinutes: number;
  numCourts: number;
  extraCourt: ExtraCourt;
  courtOverrides: Record<number, number>;
  staggerMode: StaggerMode;
  sessionStart: string;
  result: PlannerResult | null;
  liveGames: GameRef[];
  completedGames: GameRef[];
  suspendedPlayerNames: string[];
  scores: ScoresMap;
  winLoss: WinLossMap;
  savedPlans: SavedPlan[];
  isConfirmed: boolean;
  preferMixedTeams: boolean;
  preferredPairs: PreferredPair[];
  loadedPlanId: number | null;
}

export interface ScheduleGridProps {
  result: PlannerResult;
  players: Player[];
  scores: ScoresMap;
  editingSlot: number | null;
  editLayout: EditLayout | null;
  isAdmin: boolean;
  scheduleRef: RefObject<HTMLDivElement>;
  minGames: number;
  maxGames: number;
  slotTime: (slot: number) => string;
  startSlotEdit: (slot: number) => void;
  applySlotEdit: () => void;
  cancelSlotEdit: () => void;
  assignToPosition: (pos: { type: 'court'; ci: number; idx: number } | { type: 'sit'; idx: number }, newName: string) => void;
  editOptions?: Player[];
  updateScore: (slot: number, courtIdx: number, aVal: string, bVal: string, teamA: string[], teamB: string[]) => void;
  completedGames?: GameRef[];
}

declare global {
  interface Window {
    ADMIN_PIN: string | null;
    DB?: {
      load: () => Promise<WinLossMap>;
      save: (data: WinLossMap) => Promise<void>;
    };
    SHARE_API_BASE: string | null;
    html2canvas?: (node: HTMLElement, options?: unknown) => Promise<HTMLCanvasElement>;
    DEBUG_LIVE_QUEUE?: boolean;
  }
}
