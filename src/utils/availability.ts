/**
 * Resolves each player's availFrom/availTo window for the session, based on the
 * stagger mode ('none' | 'group' | 'custom') and any per-player `leavesAt` cutoff.
 * In 'custom' mode a player's own availFrom/availTo are used as-is.
 */
export function applyAvailability<T extends { name: string; quarantined?: boolean; group?: string; leavesAt?: number | null; availFrom?: number; availTo?: number }>(
  basePlayers: T[],
  { staggerMode, totalSlots }: { staggerMode: string; totalSlots: number }
): Array<T & { availFrom?: number; availTo?: number }> {
  const midSlot = Math.floor(totalSlots / 2);
  const overlap = Math.max(1, Math.floor(totalSlots * 0.2));
  return basePlayers.map(p => {
    let next: T;
    if (staggerMode === 'none') next = { ...p, availFrom: 0, availTo: totalSlots - 1 };
    else if (staggerMode === 'group') {
      if (p.group === 'early') next = { ...p, availFrom: 0, availTo: midSlot + overlap - 1 };
      else if (p.group === 'late') next = { ...p, availFrom: midSlot - overlap, availTo: totalSlots - 1 };
      else next = { ...p, availFrom: 0, availTo: totalSlots - 1 };
    } else {
      next = p;
    }
    if (p.leavesAt != null) next = { ...next, availTo: Math.min(next.availTo!, p.leavesAt) };
    if (p.quarantined) next = { ...next, availTo: -1 };
    return next;
  });
}
