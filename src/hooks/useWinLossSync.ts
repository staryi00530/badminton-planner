import { useCallback, useEffect, useState } from 'react';
import { isFirebaseConfigured, loadWinLoss, saveWinLoss } from '../firebase';
import { isValidBadmintonScore } from '../utils/scoreValidation';
import { computeSkill as computeSkillUtil } from '../utils/skill';

/**
 * Win/loss records: cloud sync (load-on-mount, push-on-change), skill
 * calculation, applying/reversing a score's win/loss delta, and the reset action.
 */
export function useWinLossSync({ winLoss, scores, isAdmin, patchState }) {
  const [dbSynced, setDbSynced] = useState(null);

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

  const computeSkill = useCallback((name, level) => computeSkillUtil(name, winLoss, level), [winLoss]);

  const updateScore = useCallback((slot, courtIdx, aVal, bVal, teamA, teamB) => {
    if (!isAdmin) return;
    const key = `s${slot}c${courtIdx}`;
    const aNum = parseInt(aVal);
    const bNum = parseInt(bVal);
    const valid = !isNaN(aNum) && !isNaN(bNum) && isValidBadmintonScore(aNum, bNum);
    const prevEntry = scores[key];
    const nextWinLoss = JSON.parse(JSON.stringify(winLoss));
    if (prevEntry?.applied) {
      const pA = parseInt(prevEntry.a);
      const pB = parseInt(prevEntry.b);
      const winners = pA > pB ? prevEntry.teamA : prevEntry.teamB;
      const losers = pA > pB ? prevEntry.teamB : prevEntry.teamA;
      winners.forEach(name => { if (nextWinLoss[name]) nextWinLoss[name].wins = Math.max(0, nextWinLoss[name].wins - 1); });
      losers.forEach(name => { if (nextWinLoss[name]) nextWinLoss[name].losses = Math.max(0, nextWinLoss[name].losses - 1); });
    }
    if (valid) {
      const winners = aNum > bNum ? teamA : teamB;
      const losers = aNum > bNum ? teamB : teamA;
      winners.forEach(name => { nextWinLoss[name] = { wins: (nextWinLoss[name]?.wins ?? 0) + 1, losses: nextWinLoss[name]?.losses ?? 0 }; });
      losers.forEach(name => { nextWinLoss[name] = { wins: nextWinLoss[name]?.wins ?? 0, losses: (nextWinLoss[name]?.losses ?? 0) + 1 }; });
    }
    patchState({
      scores: { ...scores, [key]: { a: aVal, b: bVal, applied: valid, teamA, teamB } },
      winLoss: nextWinLoss,
    });
  }, [isAdmin, scores, winLoss]);

  const clearWinLoss = useCallback(() => {
    patchState({ winLoss: {} });
    if (isFirebaseConfigured() && isAdmin) saveWinLoss({});
  }, [isAdmin]);

  return { dbSynced, computeSkill, updateScore, clearWinLoss };
}
