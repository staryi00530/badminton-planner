import { useCallback, useEffect, useState } from 'react';
import { isFirebaseConfigured, loadWinLoss, saveWinLoss } from '../firebase';
import { isValidBadmintonScore } from '../utils/scoreValidation';
import { computeSkill as computeSkillUtil } from '../utils/skill';
import type { Player, PlannerState, RuntimePatch, WinLossMap } from '../types';

interface WinLossSyncOptions extends Pick<PlannerState, 'winLoss' | 'scores'> {
  players?: Array<Pick<Player, 'name' | 'statsKey'>>;
  isAdmin: boolean;
  patchState: (patch: RuntimePatch) => void;
}

/**
 * Win/loss records: cloud sync (load-on-mount, push-on-change), skill
 * calculation, applying/reversing a score's win/loss delta, and the reset action.
 */
export function useWinLossSync({ winLoss, scores, isAdmin, patchState, players = [] }: WinLossSyncOptions) {
  const [dbSynced, setDbSynced] = useState<'syncing' | 'synced' | 'error' | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    loadWinLoss()
      .then(remote => {
        patchState({
          winLoss: (() => {
            const merged = { ...winLoss };
            for (const [name, data] of Object.entries(remote)) {
              if (!merged[name]) merged[name] = data;
              else {
                merged[name] = {
                  wins: Math.max(merged[name].wins ?? 0, data.wins ?? 0),
                  losses: Math.max(merged[name].losses ?? 0, data.losses ?? 0),
                };
              }
            }
            return merged;
          })(),
        });
        setDbSynced('synced');
      })
      .catch(() => setDbSynced('error'));
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured() || !isAdmin) return;
    setDbSynced('syncing');
    saveWinLoss(winLoss).then(() => setDbSynced('synced')).catch(() => setDbSynced('error'));
  }, [winLoss, isAdmin]);

  const statsKey = useCallback((name: string) => players.find(player => player.name === name)?.statsKey ?? name, [players]);

  const computeSkill = useCallback((name: string, level?: Player['level']) => computeSkillUtil(statsKey(name), winLoss, level), [winLoss, statsKey]);

  const updateScore = useCallback((slot: number, courtIdx: number, aVal: string, bVal: string, teamA: string[], teamB: string[]) => {
    if (!isAdmin) return;
    const key = `s${slot}c${courtIdx}`;
    const aNum = parseInt(aVal);
    const bNum = parseInt(bVal);
    const valid = !isNaN(aNum) && !isNaN(bNum) && isValidBadmintonScore(aNum, bNum);
    const prevEntry = scores[key];
    const nextWinLoss: WinLossMap = structuredClone(winLoss);
    if (prevEntry?.applied) {
      const pA = parseInt(prevEntry.a);
      const pB = parseInt(prevEntry.b);
      const winners = pA > pB ? prevEntry.teamA : prevEntry.teamB;
      const losers = pA > pB ? prevEntry.teamB : prevEntry.teamA;
      winners.forEach(name => { const record = nextWinLoss[statsKey(name)]; if (record) record.wins = Math.max(0, record.wins - 1); });
      losers.forEach(name => { const record = nextWinLoss[statsKey(name)]; if (record) record.losses = Math.max(0, record.losses - 1); });
    }
    if (valid) {
      const winners = aNum > bNum ? teamA : teamB;
      const losers = aNum > bNum ? teamB : teamA;
      winners.forEach(displayName => { const name = statsKey(displayName); nextWinLoss[name] = { wins: (nextWinLoss[name]?.wins ?? 0) + 1, losses: nextWinLoss[name]?.losses ?? 0 }; });
      losers.forEach(displayName => { const name = statsKey(displayName); nextWinLoss[name] = { wins: nextWinLoss[name]?.wins ?? 0, losses: (nextWinLoss[name]?.losses ?? 0) + 1 }; });
    }
    patchState({
      scores: { ...scores, [key]: { a: aVal, b: bVal, applied: valid, teamA, teamB } },
      winLoss: nextWinLoss,
    });
  }, [isAdmin, scores, winLoss, statsKey, patchState]);

  const clearWinLoss = useCallback(() => {
    patchState({ winLoss: {} });
    if (isFirebaseConfigured() && isAdmin) saveWinLoss({}).catch(() => setDbSynced('error'));
  }, [isAdmin]);

  return { dbSynced, computeSkill, updateScore, clearWinLoss };
}
