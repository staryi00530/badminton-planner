export type Gender = 'M' | 'F';

export interface Player {
  id?: string;
  aliases?: string[];
  statsKey?: string;
  name: string;
  gender: Gender;
  /** Private 1-5 starting level; omitted from share payloads and public schedule text. */
  level?: 1 | 2 | 3 | 4 | 5;
  /** Excluded from future games until explicitly returned to availability. */
  quarantined?: boolean;
  skill?: number;
  availFrom: number;
  availTo: number;
  group?: string;
  leavesAt?: number | null;
}

export type PlayerInGame = {
  id?: string;
  aliases?: string[];
  statsKey?: string;
  name: string;
  gender: Gender;
};

export interface Court {
  court: number;
  teamA: [PlayerInGame, PlayerInGame];
  teamB: [PlayerInGame, PlayerInGame];
}

export interface PlayerState {
  name: string;
  gender: Gender;
  total: number;
  conPlayed: number;
  conRested: number;
  playing: boolean;
  available: boolean;
}

export interface SlotResult {
  slot: number; // 1-based
  courts: Court[];
  sitting: PlayerInGame[];
  playerState: PlayerState[];
  repeatedCourts: number[]; // 0-based court indices
}

export interface ScheduleState {
  keptSlots: SlotResult[];
  gamesPlayed: number[];
  consecutivePlayed: number[];
  consecutiveRested: number[];
  partnerCount: number[][];
  opponentCount: number[][];
  courtGroupHistory: Set<string>;
  womenDoublesCount: number; // bug fix: track WD courts across regen
}

export interface GeneratorYield {
  schedule: SlotResult[];
  gamesPlayed: number[];
}

export type ForcedFirstSlot = number[] | { courts: number[][]; targetCourts?: number };
