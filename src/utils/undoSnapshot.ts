import type { PlannerState, UndoSnapshot } from '../types';

export const EMPTY_QUEUE_STATE = {
  sessionChangeNotice: null,
  pendingSessionChange: null,
  queueAdjustment: null,
  queuePromotionPrompt: null,
} as const;

export function captureUndoSnapshot(state: PlannerState): UndoSnapshot {
  const {
    result, scores, winLoss, players, liveGames, completedGames, suspendedPlayerNames,
    fromSlot, fromSlotCourts, courtOverrides, scheduleDirty, copied, isConfirmed,
    loadedPlanId, savedPlans, editingSlot, editLayout, pendingOverwrite, isGenerating,
    genSlot, sessionChangeNotice, pendingSessionChange, queueAdjustment, queuePromotionPrompt,
  } = state;
  return structuredClone({
    result, scores, winLoss, players, liveGames, completedGames, suspendedPlayerNames,
    fromSlot, fromSlotCourts, courtOverrides, scheduleDirty, copied, isConfirmed,
    loadedPlanId, savedPlans, editingSlot, editLayout, pendingOverwrite, isGenerating,
    genSlot, sessionChangeNotice, pendingSessionChange, queueAdjustment, queuePromotionPrompt,
  });
}
