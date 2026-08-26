export interface GameRef {
  slot: number;
  court: number;
}

export function gameMatches(game: GameRef, slot: number, court: number) {
  return game.slot === slot && game.court === court;
}

export function hasGame(games: GameRef[], slot: number, court: number) {
  return games.some(game => gameMatches(game, slot, court));
}

export function addUniqueGame(games: GameRef[], game: GameRef) {
  return hasGame(games, game.slot, game.court) ? games : [...games, game];
}

export function keepGamesBeforeSlot(games: GameRef[], slot: number) {
  return games.filter(game => game.slot < slot);
}

export function isSlotCompleted(slot: { slot: number; courts: unknown[] }, games: GameRef[]) {
  return slot.courts.length > 0 && slot.courts.every((_, court) => hasGame(games, slot.slot, court));
}

export function firstIncompleteSlot(
  schedule: Array<{ slot: number; courts: unknown[] }>,
  games: GameRef[],
  finishedSlot: number,
) {
  return schedule.find(slot => !isSlotCompleted(slot, games))?.slot ?? finishedSlot + 1;
}
