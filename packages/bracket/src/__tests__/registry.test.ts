import { describe, it, expect } from "vitest";
import { registry, getGame } from "../index.js";

const A = "0xAAAA";
const B = "0xBBBB";

describe("Game registry", () => {
  it("has all 6 games registered", () => {
    expect(Object.keys(registry)).toHaveLength(6);
    expect(registry["brinkmanship"]).toBeDefined();
    expect(registry["standoff"]).toBeDefined();
    expect(registry["promptwar"]).toBeDefined();
    expect(registry["promptinjection"]).toBeDefined();
    expect(registry["poker"]).toBeDefined();
    expect(registry["dicepoker"]).toBeDefined();
  });

  it("getGame returns the correct engine for brinkmanship", () => {
    const engine = getGame("brinkmanship");
    expect(engine.manifest.id).toBe("brinkmanship");
    expect(engine.manifest.name).toBe("Brinkmanship");
  });

  it("getGame returns the correct engine for standoff", () => {
    const engine = getGame("standoff");
    expect(engine.manifest.id).toBe("standoff");
  });

  it("getGame returns the correct engine for poker", () => {
    const engine = getGame("poker");
    expect(engine.manifest.id).toBe("poker");
    expect(engine.manifest.minPlayers).toBe(2);
    expect(engine.manifest.maxPlayers).toBe(3);
  });

  it("getGame returns the correct engine for dicepoker", () => {
    const engine = getGame("dicepoker");
    expect(engine.manifest.id).toBe("dicepoker");
  });

  it("getGame throws for unknown id", () => {
    expect(() => getGame("fakegame")).toThrow("unknown game id");
    expect(() => getGame("")).toThrow("unknown game id");
    expect(() => getGame("BRINKMANSHIP")).toThrow("unknown game id"); // case-sensitive
  });

  it("all games have required methods", () => {
    for (const game of Object.values(registry)) {
      expect(typeof game.initState).toBe("function");
      expect(typeof game.applyMove).toBe("function");
      expect(typeof game.isTerminal).toBe("function");
      expect(typeof game.getResult).toBe("function");
      expect(game.manifest.id).toBeTruthy();
      expect(game.manifest.minPlayers).toBeGreaterThanOrEqual(2);
    }
  });

  it("all games have valid manifest fields", () => {
    for (const game of Object.values(registry)) {
      expect(typeof game.manifest.id).toBe("string");
      expect(game.manifest.id.length).toBeGreaterThan(0);
      expect(typeof game.manifest.name).toBe("string");
      expect(game.manifest.name.length).toBeGreaterThan(0);
      expect(typeof game.manifest.minPlayers).toBe("number");
      expect(typeof game.manifest.maxPlayers).toBe("number");
      expect(game.manifest.maxPlayers).toBeGreaterThanOrEqual(game.manifest.minPlayers);
    }
  });

  it("all 2-player games: initState with 2 players produces valid state", () => {
    const twoPlayerGames = ["brinkmanship", "standoff", "promptwar", "promptinjection", "dicepoker"];
    for (const id of twoPlayerGames) {
      const game = getGame(id);
      const state = game.initState([A, B]);
      expect(state.players).toContain(A);
      expect(state.players).toContain(B);
    }
  });

  it("poker initState works with 2 players", () => {
    const game = getGame("poker");
    const state = game.initState([A, B]);
    expect(state.players).toContain(A);
    expect(state.players).toContain(B);
  });

  it("poker initState works with 3 players", () => {
    const C = "0xCCCC";
    const game = getGame("poker");
    const state = game.initState([A, B, C]);
    expect(state.players).toHaveLength(3);
  });

  it("registry keys match manifest ids", () => {
    for (const [key, game] of Object.entries(registry)) {
      expect(key).toBe(game.manifest.id);
    }
  });

  it("all games: isTerminal returns false on freshly initiated state", () => {
    const twoPlayerGames = ["brinkmanship", "standoff", "promptwar", "promptinjection", "dicepoker", "poker"];
    for (const id of twoPlayerGames) {
      const game = getGame(id);
      const state = game.initState([A, B]);
      expect(game.isTerminal(state)).toBe(false);
    }
  });

  it("brinkmanship minPlayers === maxPlayers === 2 (v1)", () => {
    const engine = getGame("brinkmanship");
    expect(engine.manifest.minPlayers).toBe(2);
    expect(engine.manifest.maxPlayers).toBe(2);
  });
});
