import { describe, it, expect } from 'vitest';
import { computeCourtsPerSlot } from './courtsPerSlot.js';

const OFF = { enabled: false, startMin: 0, durationMin: 0 };

describe('computeCourtsPerSlot', () => {
  it('returns numCourts for every slot when the extra court is disabled', () => {
    const result = computeCourtsPerSlot({ totalSlots: 4, gameMinutes: 15, numCourts: 2, extraCourt: OFF });
    expect(result).toEqual([2, 2, 2, 2]);
  });

  it('adds one court only during slots overlapping the extra-court window', () => {
    // 4 slots of 15min = 0-15, 15-30, 30-45, 45-60. Extra court runs 20-50.
    const result = computeCourtsPerSlot({
      totalSlots: 4,
      gameMinutes: 15,
      numCourts: 1,
      extraCourt: { enabled: true, startMin: 20, durationMin: 30 },
    });
    // slot0 (0-15): no overlap. slot1 (15-30): overlaps 20-30. slot2 (30-45): fully inside.
    // slot3 (45-60): overlaps 45-50.
    expect(result).toEqual([1, 2, 2, 2]);
  });

  it('does not add a court to a slot that ends exactly when the extra window starts', () => {
    const result = computeCourtsPerSlot({
      totalSlots: 2,
      gameMinutes: 15,
      numCourts: 1,
      extraCourt: { enabled: true, startMin: 15, durationMin: 15 },
    });
    // slot0 (0-15) ends exactly at startMin=15 — no overlap (slotEndMin > startMin is false).
    expect(result).toEqual([1, 2]);
  });

  it('caps the total at 5 courts even if numCourts + extra exceeds it', () => {
    const result = computeCourtsPerSlot({
      totalSlots: 1,
      gameMinutes: 15,
      numCourts: 5,
      extraCourt: { enabled: true, startMin: 0, durationMin: 15 },
    });
    expect(result).toEqual([5]);
  });

  it('applies 1-based overrides onwards, superseding base and timed extra courts', () => {
    expect(computeCourtsPerSlot({
      totalSlots: 6, gameMinutes: 15, numCourts: 2,
      extraCourt: { enabled: true, startMin: 30, durationMin: 45 },
      courtOverrides: { 2: 4, 4: 1, 6: 5 },
    })).toEqual([2, 4, 4, 1, 1, 5]);
  });

  it('ignores invalid persisted overrides rather than scheduling invalid capacity', () => {
    expect(computeCourtsPerSlot({
      totalSlots: 4, gameMinutes: 15, numCourts: 2, extraCourt: OFF,
      courtOverrides: { 0: 5, 1.5: 3, 2: 0, 3: 6, 4: 2.5 },
    })).toEqual([2, 2, 2, 2]);
  });
});
