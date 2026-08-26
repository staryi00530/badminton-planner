import type { Player } from './algorithm/types';

export const DEFAULT_TOTAL_MINUTES = 180;
export const DEFAULT_GAME_MINUTES = 15;
export const ARCHIVE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const DEFAULT_PLAYERS: Player[] = [
  { name: 'Player 01', gender: 'M', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 02', gender: 'F', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 03', gender: 'F', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 04', gender: 'M', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 05', gender: 'M', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 06', gender: 'F', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 07', gender: 'M', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 08', gender: 'M', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 09', gender: 'F', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 10', gender: 'M', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 11', gender: 'M', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
  { name: 'Player 12', gender: 'M', skill: 2, availFrom: 0, availTo: 0, group: 'full', leavesAt: null },
];

export const C = {
  bg: '#0b0e14',
  card: '#12161f',
  border: '#222836',
  accent: '#7dd3fc',
  accentDim: '#0369a1',
  pink: '#fda4af',
  pinkDim: '#9f1239',
  text: '#e5e7eb',
  textDim: '#8b95a7',
  textMuted: '#5b6577',
  green: '#34d399',
  amber: '#fbbf24',
  shadow: '0 1px 3px rgba(0,0,0,0.55)',
};

export const COURT_COLORS = ['#7dd3fc', '#a78bfa', '#fb923c', '#4ade80'];
export const COURT_BG = ['rgba(125,211,252,0.07)', 'rgba(167,139,250,0.07)', 'rgba(251,146,60,0.07)', 'rgba(74,222,128,0.07)'];
export const FONT = "'Inter', system-ui, sans-serif";

export const ICONS: Record<string, string[]> = {
  shuffle: ['M16 3h5v5', 'M4 20 21 3', 'M21 16v5h-5', 'M15 15l6 6', 'M4 4l5 5'],
  copy: ['M9 9h13v13H9z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
  check: ['M20 6 9 17l-5-5'],
  bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
  'chevron-up': ['M18 15l-6-6-6 6'],
  'chevron-down': ['M6 9l6 6 6-6'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  link: [
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ],
};
