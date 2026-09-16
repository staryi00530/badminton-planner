/** A player's rating: a private 1-3 level is used as a prior, then results refine it. */
export function computeSkill(name: string, winLoss: Record<string, { wins: number; losses: number }>, level?: 1 | 2 | 3): number {
  const wl = winLoss[name];
  const games = (wl?.wins ?? 0) + (wl?.losses ?? 0);
  if (level == null) return games === 0 ? 0.5 : wl!.wins / games;
  const prior = (level - 1) / 2;
  if (games === 0) return prior;
  return (prior * 3 + (wl!.wins / games) * games) / (3 + games);
}
