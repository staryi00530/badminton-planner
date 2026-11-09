/** Pack the maximum number of entirely waiting courts, subject to matching formats.
 * Inputs are ordered by rotation priority. An odd complete pool may require one compromise. */
export function matchingWaitingGroups(available: number[], waiting: Set<number>, female: (id: number) => boolean, courts: number): number[][] | null {
  const wf = available.filter(i => waiting.has(i) && female(i));
  const wm = available.filter(i => waiting.has(i) && !female(i));
  const pack = (pool: number[]): number[][] => {
    const f = pool.filter(female), m = pool.filter(i => !female(i));
    const groups: number[][] = [];
    while (f.length + m.length >= 4) {
      if (f.length >= 2 && m.length >= 2) groups.push([...f.splice(0, 2), ...m.splice(0, 2)]);
      else if (f.length >= 4) groups.push(f.splice(0, 4));
      else groups.push(m.splice(0, 4));
    }
    return groups;
  };
  for (let ready = Math.min(courts, Math.floor((wf.length + wm.length) / 4)); ready >= 0; ready--) {
    let best: { groups: number[][]; cost: number } | null = null;
    for (let readyF = 0; readyF <= ready * 4; readyF += 2) {
      if (readyF > wf.length || ready * 4 - readyF > wm.length) continue;
      const first = [...wf.slice(0, readyF), ...wm.slice(0, ready * 4 - readyF)];
      const used = new Set(first), rest = available.filter(i => !used.has(i));
      const f = rest.filter(female), m = rest.filter(i => !female(i));
      const needed = (courts - ready) * 4;
      for (let countF = 0; countF <= needed; countF += 2) {
        if (countF > f.length || needed - countF > m.length) continue;
        const second = [...f.slice(0, countF), ...m.slice(0, needed - countF)];
        const cost = [...first, ...second].reduce((sum, i) => sum + available.indexOf(i), 0);
        if (!best || cost < best.cost) best = { groups: [...pack(first), ...pack(second)], cost };
      }
    }
    if (best) return best.groups;
  }
  return null;
}
