import { useCallback, useState } from 'react';
import type { PlannerState } from '../types';
import { plannerStorageKey } from '../utils/plannerStorage';

/** Admin PIN gate: score entry, saving, confirming, and sharing are locked behind it when window.ADMIN_PIN is set. */
export function useAdminAuth({ pinInput, patchState }: {
  pinInput: string;
  patchState: (patch: Partial<Pick<PlannerState, 'showPinPrompt' | 'pinInput' | 'pinError'>>) => void;
}) {
  const [isAdmin, setIsAdmin] = useState(() => !window.ADMIN_PIN || sessionStorage.getItem(plannerStorageKey('bp-admin')) === window.ADMIN_PIN);

  const submitPin = useCallback(() => {
    if (pinInput === window.ADMIN_PIN) {
      sessionStorage.setItem(plannerStorageKey('bp-admin'), pinInput);
      setIsAdmin(true);
      patchState({ showPinPrompt: false, pinInput: '', pinError: false });
    } else {
      patchState({ pinError: true });
    }
  }, [pinInput]);

  const toggleAdminLock = useCallback(() => {
    if (isAdmin) {
      sessionStorage.removeItem(plannerStorageKey('bp-admin'));
      setIsAdmin(false);
    } else {
      patchState({ showPinPrompt: true });
    }
  }, [isAdmin]);

  return { isAdmin, submitPin, toggleAdminLock };
}
