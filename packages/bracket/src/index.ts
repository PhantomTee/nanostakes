import type { GameEngine } from "@nanostakes/shared";
import { brinkmanship } from "./games/brinkmanship.js";
import { standoff } from "./games/standoff.js";

export { brinkmanship, ENTRY_STAKE_EACH } from "./games/brinkmanship.js";
export type { BrinkmanshipState } from "./games/brinkmanship.js";
export { standoff, ENTRY_STAKE_EACH as STANDOFF_ENTRY_STAKE_EACH } from "./games/standoff.js";
export type { StandoffState, Choice } from "./games/standoff.js";

/** Game registry: framework looks games up by id, never special-cases one. Adding a game means adding one entry here. */
export const registry: Record<string, GameEngine<any, any, any>> = {
  [brinkmanship.manifest.id]: brinkmanship,
  [standoff.manifest.id]: standoff,
};

export function getGame(id: string): GameEngine<any, any, any> {
  const game = registry[id];
  if (!game) throw new Error(`unknown game id: ${id}`);
  return game;
}
