/**
 * Per-slot active court count: the base `numCourts`, plus one during any slot whose
 * time window overlaps the configured "extra court" window, capped at the app's max (5).
 */
export function computeCourtsPerSlot({
  totalSlots,
  gameMinutes,
  numCourts,
  extraCourt,
}: {
  totalSlots: number;
  gameMinutes: number;
  numCourts: number;
  extraCourt: { enabled: boolean; startMin: number; durationMin: number };
}): number[] {
  return Array.from({ length: totalSlots }, (_, slot) => {
    const slotStartMin = slot * gameMinutes;
    const slotEndMin = slotStartMin + gameMinutes;
    let courts = numCourts;
    if (extraCourt.enabled) {
      const extraEnd = extraCourt.startMin + extraCourt.durationMin;
      if (slotStartMin < extraEnd && slotEndMin > extraCourt.startMin) courts++;
    }
    return Math.min(courts, 5);
  });
}
