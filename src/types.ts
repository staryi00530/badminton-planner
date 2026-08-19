import type { RefObject } from 'react';
import type { Player, SlotResult } from './algorithm/types';

export type { Player, SlotResult };

export interface ExtraCourt {
  enabled: boolean;
  startMin: number;
  durationMin: number;
}

export type StaggerMode = 'none' | 'group' | 'custom';

export interface PlannerResult {
  schedule: SlotResult[];
  gamesPlayed: number[];
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

export interface SharedPlayer {
  0: string;
  1: 'M' | 'F' | '?';
}

export interface SharePayload {
  v: 1;
  p: SharedPlayer[];
  cfg?: { g?: number; c?: number };
  scores?: Record<string, { a: string; b: string }>;
  slots: Array<{
    s: number;
    c: number[][][];
    sit: number[];
  }>;
  confirmed?: boolean;
}

export interface PlannerState {
  players: Player[];
  playerHistory: Player[];
  nameInput: string;
  genderInput: 'M' | 'F';
  totalMinutes: number;
  gameMinutes: number;
  numCourts: number;
  extraCourt: ExtraCourt;
  staggerMode: StaggerMode;
  sessionStart: string;
  result: PlannerResult | null;
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
  activeTab: 'schedule' | 'archive' | 'about';
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
  isConfirmed: boolean;
  pendingOverwrite: 'generate' | 'clear' | 'import' | 'regenerateRemaining' | null;
  shareNotice: 'expired' | null;
  loadedPlanId: number | null;
  liveGames: Array<{ slot: number; court: number }>;
  completedGames: Array<{ slot: number; court: number }>;
}

export interface PlannerPersistedState {
  players: Player[];
  playerHistory: Player[];
  totalMinutes: number;
  gameMinutes: number;
  numCourts: number;
  extraCourt: ExtraCourt;
  staggerMode: StaggerMode;
  sessionStart: string;
  result: PlannerResult | null;
  scores: ScoresMap;
  winLoss: WinLossMap;
  savedPlans: SavedPlan[];
  isConfirmed: boolean;
  preferMixedTeams: boolean;
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
  updateScore: (slot: number, courtIdx: number, aVal: string, bVal: string, teamA: string[], teamB: string[]) => void;
  completedGames?: Array<{ slot: number; court: number }>;
}

declare global {
  interface Window {
    ADMIN_PIN?: string;
    DB?: {
      load: () => Promise<WinLossMap>;
      save: (data: WinLossMap) => Promise<void>;
    };
    SHARE_API_BASE?: string | null;
    html2canvas?: (node: HTMLElement, options?: unknown) => Promise<HTMLCanvasElement>;
  }
}
