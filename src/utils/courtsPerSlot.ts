/**
 * Per-slot active court count: the base `numCourts`, plus one during any slot whose
 * time window overlaps the configured "extra court" window, capped at the app's max (5).
 */
export function computeCourtsPerSlot({
  totalSlots,
  gameMinutes,
  numCourts,
  extraCourt,
  courtOverrides = {},
}: {
  totalSlots: number;
  gameMinutes: number;
  numCourts: number;
  extraCourt: { enabled: boolean; startMin: number; durationMin: number };
  courtOverrides?: Record<number, number>;
}): number[] {
  const overrides = Object.entries(courtOverrides ?? {})
    .map(([slot, capacity]) => [Number(slot), capacity] as const)
    .filter(([slot, capacity]) => Number.isInteger(slot) && slot >= 1 && Number.isInteger(capacity) && capacity >= 1 && capacity <= 5)
    .sort(([a], [b]) => a - b);
  let overrideIndex = 0;
  let overrideCapacity: number | undefined;
  return Array.from({ length: totalSlots }, (_, slot) => {
    const slotStartMin = slot * gameMinutes;
    const slotEndMin = slotStartMin + gameMinutes;
    let courts = numCourts;
    if (extraCourt.enabled) {
      const extraEnd = extraCourt.startMin + extraCourt.durationMin;
      if (slotStartMin < extraEnd && slotEndMin > extraCourt.startMin) courts++;
    }
    while (overrideIndex < overrides.length && overrides[overrideIndex]![0] <= slot + 1) {
      overrideCapacity = overrides[overrideIndex++]![1];
    }
    return overrideCapacity ?? Math.max(1, Math.min(courts, 5));
  });
}
