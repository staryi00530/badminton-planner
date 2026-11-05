import { newPlayerId, resolvePlayerIdentity } from './playerIdentity';
import type { Gender, Player } from '../algorithm/types';

export interface ParsedRosterEntry {
  name: string;
  genderHint: Gender | null;
  isGuest: boolean;
  fallbackName?: string;
  fallbackGenderHint?: Gender | null;
}

export type ImportedPlayer = Pick<Player, 'id' | 'aliases' | 'statsKey' | 'name' | 'gender'> & { level?: Player['level'] };

export function buildImportedPlayers(
  currentPlayers: Player[],
  playerHistory: Array<Pick<Player, 'name' | 'gender' | 'level' | 'quarantined' | 'id' | 'aliases' | 'statsKey'>>,
  entries: ImportedPlayer[],
  totalSlots: number,
): Player[] {
  const currentNames = new Set(currentPlayers.flatMap(player => [nameKey(player.name), ...(player.id ? [player.id] : [])]));
  const addedNames = new Set<string>();
  return entries.flatMap(entry => {
    if (!entry.name.trim()) return [];
    const saved = resolvePlayerIdentity(entry.name, playerHistory, entry.id);
    const key = saved?.id ?? entry.id ?? nameKey(entry.name);
    if (!key || currentNames.has(key) || addedNames.has(key)) return [];
    addedNames.add(key);

    return [{
      id: saved?.id ?? entry.id ?? newPlayerId(),
      statsKey: saved?.statsKey ?? saved?.name ?? entry.statsKey ?? entry.name.trim(),
      aliases: [...new Set([...(saved?.aliases ?? []), ...(entry.aliases ?? []), ...(saved && nameKey(saved.name) !== nameKey(entry.name) ? [entry.name.trim()] : [])])],
      name: saved?.name ?? entry.name.trim(),
      gender: saved?.gender ?? entry.gender,
      level: saved?.level ?? entry.level ?? 3,
      ...(saved?.quarantined ? { quarantined: true } : {}),
      skill: 2,
      availFrom: 0,
      availTo: totalSlots - 1,
      group: 'full',
      leavesAt: null,
    }];
  });
}

function cleanName(value: string) {
  return value.replace(/\s+/g, ' ').trim().replace(/^\p{L}/u, first => first.toLocaleUpperCase());
}

function stripGenderMarker(value: string): { name: string; gender: Gender | null } {
  const female = value.includes('🙆‍♀️');
  const male = value.includes('🙋‍♂️');
  return {
    name: cleanName(value.replaceAll('🙆‍♀️', '').replaceAll('🙋‍♂️', '')),
    gender: female === male ? null : female ? 'F' : 'M',
  };
}

function nameKey(name: string) {
  return name.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseRosterPaste(text: string): ParsedRosterEntry[] {
  const parsed: Array<ParsedRosterEntry & { baseName: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || /^[-—–\s]*end\s*$/i.test(line) || /^[-—–\s]+$/.test(line)) continue;
    const isListItem = /^(?:\d+\s*[.)]|[-*•])\s*/.test(line);
    if (isListItem) line = line.replace(/^(?:\d+\s*[.)]\s*|[-*•]\s*)/, '');
    else if (/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b.*\b\d{1,2}\/\d{1,2}\b/i.test(line)) continue;
    if (!line || isRosterInstruction(line)) continue;

    const guestMatch = /^(.*?)\s*\+\s*(\d+)\s*\(([^()]*)\)\s*$/.exec(line);
    if (guestMatch && guestMatch[3]!.trim()) {
      const host = stripGenderMarker(guestMatch[1]!);
      const guest = stripGenderMarker(guestMatch[3]!);
      if (!guest.name) continue;
      parsed.push({
        name: guest.name,
        genderHint: guest.gender,
        isGuest: true,
        fallbackName: `${host.name} +${guestMatch[2]}`,
        ...(host.gender ? { fallbackGenderHint: host.gender } : {}),
        baseName: guest.name,
      });
      continue;
    }

    const person = stripGenderMarker(line);
    if (!person.name) continue;
    parsed.push({ name: person.name, genderHint: person.gender, isGuest: false, baseName: person.name });
  }

  const gendersByName = new Map<string, Set<Gender>>();
  for (const entry of parsed) {
    if (entry.genderHint == null) continue;
    const key = nameKey(entry.baseName);
    const genders = gendersByName.get(key) ?? new Set<Gender>();
    genders.add(entry.genderHint);
    gendersByName.set(key, genders);
  }

  const seen = new Set<string>();
  return parsed.flatMap(({ baseName, ...entry }) => {
    const hasGenderCollision = (gendersByName.get(nameKey(baseName))?.size ?? 0) > 1;
    const name = hasGenderCollision && entry.genderHint ? `${baseName} (${entry.genderHint})` : baseName;
    const key = nameKey(name);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...entry, name }];
  });
}

/** Kept separately for the review UI, so exclusions can be corrected. */
export function isRosterInstruction(line:string):boolean {
 return /\b(?:court|courts)\b.*(?:\b(?:at|from|until|starts?)\b|\d{1,2}:\d{2})/i.test(line) || /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b.*\d/i.test(line);
}
export function ignoredRosterLines(text:string):string[] { return text.split(/\r?\n/).map(s=>s.trim()).filter(isRosterInstruction); }
