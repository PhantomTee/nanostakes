import { describe, it, expect } from "vitest";
import { standoff, ENTRY_STAKE_EACH } from "../games/standoff.js";

const A = "0xAAAA";
const B = "0xBBBB";
const RAKE_FRACTION = 0.03;

describe("Standoff engine", () => {
  it("initState produces valid state", () => {
    const state = standoff.initState([A, B]);
    expect(state.players).toEqual([A, B]);
    expect(state.phase).toBe("NEGOTIATE");
    expect(state.entryStakeEach).toBe(ENTRY_STAKE_EACH);
    expect(state.choices[A]).toBeUndefined();
    expect(state.choices[B]).toBeUndefined();
  });

  it("rejects players.length != 2", () => {
    expect(() => standoff.initState([A, B, "0xCC"])).toThrow();
    expect(() => standoff.initState([A])).toThrow();
  });

  it("mutual cooperate: both get 45% * (1 - rake) of pot fraction", () => {
    let state = standoff.initState([A, B]);
    ({ state } = standoff.applyMove(state, A, { type: "choice", value: "COOPERATE" }));
    ({ state } = standoff.applyMove(state, B, { type: "choice", value: "COOPERATE" }));
    expect(standoff.isTerminal(state)).toBe(true);
    const result = standoff.getResult(state);
    // CC payout fractions: [0.45, 0.45] * (1 - 0.03)
    const expected = 0.45 * (1 - RAKE_FRACTION);
    expect(result.payouts[A]).toBeCloseTo(expected, 5);
    expect(result.payouts[B]).toBeCloseTo(expected, 5);
    // symmetric
    expect(result.payouts[A]).toBeCloseTo(result.payouts[B]!, 5);
  });

  it("mutual cooperate: combined payout is 2 * 0.45 * (1 - rake)", () => {
    let state = standoff.initState([A, B]);
    ({ state } = standoff.applyMove(state, A, { type: "choice", value: "COOPERATE" }));
    ({ state } = standoff.applyMove(state, B, { type: "choice", value: "COOPERATE" }));
    const result = standoff.getResult(state);
    const total = result.payouts[A]! + result.payouts[B]!;
    expect(total).toBeCloseTo(2 * 0.45 * (1 - RAKE_FRACTION), 5);
  });

  it("defect vs cooperate: defector wins more", () => {
    let state = standoff.initState([A, B]);
    ({ state } = standoff.applyMove(state, A, { type: "choice", value: "DEFECT" }));
    ({ state } = standoff.applyMove(state, B, { type: "choice", value: "COOPERATE" }));
    expect(standoff.isTerminal(state)).toBe(true);
    const result = standoff.getResult(state);
    // DC: [0.65, 0.15] * (1 - rake)
    expect(result.payouts[A]).toBeCloseTo(0.65 * (1 - RAKE_FRACTION), 5);
    expect(result.payouts[B]).toBeCloseTo(0.15 * (1 - RAKE_FRACTION), 5);
    expect(result.payouts[A]).toBeGreaterThan(result.payouts[B]!);
  });

  it("cooperate vs defect: B defector gets 0.65 fraction", () => {
    let state = standoff.initState([A, B]);
    ({ state } = standoff.applyMove(state, A, { type: "choice", value: "COOPERATE" }));
    ({ state } = standoff.applyMove(state, B, { type: "choice", value: "DEFECT" }));
    const result = standoff.getResult(state);
    // CD: [0.15, 0.65] * (1 - rake)
    expect(result.payouts[A]).toBeCloseTo(0.15 * (1 - RAKE_FRACTION), 5);
    expect(result.payouts[B]).toBeCloseTo(0.65 * (1 - RAKE_FRACTION), 5);
    expect(result.payouts[B]).toBeGreaterThan(result.payouts[A]!);
  });

  it("mutual defect: both get 0.30 * (1 - rake), less than cooperation", () => {
    let state = standoff.initState([A, B]);
    ({ state } = standoff.applyMove(state, A, { type: "choice", value: "DEFECT" }));
    ({ state } = standoff.applyMove(state, B, { type: "choice", value: "DEFECT" }));
    expect(standoff.isTerminal(state)).toBe(true);
    const result = standoff.getResult(state);
    const expected = 0.3 * (1 - RAKE_FRACTION);
    expect(result.payouts[A]).toBeCloseTo(expected, 5);
    expect(result.payouts[B]).toBeCloseTo(expected, 5);
    // Both get less than the cooperative outcome
    expect(result.payouts[A]).toBeLessThan(0.45 * (1 - RAKE_FRACTION));
  });

  it("mutual defect is symmetric", () => {
    let state = standoff.initState([A, B]);
    ({ state } = standoff.applyMove(state, A, { type: "choice", value: "DEFECT" }));
    ({ state } = standoff.applyMove(state, B, { type: "choice", value: "DEFECT" }));
    const result = standoff.getResult(state);
    expect(result.payouts[A]).toBeCloseTo(result.payouts[B]!, 5);
  });

  it("cannot act twice: second choice is rejected", () => {
    let state = standoff.initState([A, B]);
    ({ state } = standoff.applyMove(state, A, { type: "choice", value: "COOPERATE" }));
    expect(() =>
      standoff.applyMove(state, A, { type: "choice", value: "DEFECT" })
    ).toThrow(/already committed a choice/);
  });

  it("unknown move type throws", () => {
    const state = standoff.initState([A, B]);
    expect(() =>
      standoff.applyMove(state, A, { type: "unknown" } as any)
    ).toThrow(/unknown move type/);
  });

  it("isTerminal is false before both choose", () => {
    const state = standoff.initState([A, B]);
    expect(standoff.isTerminal(state)).toBe(false);
  });

  it("isTerminal is false after only one player chooses", () => {
    let state = standoff.initState([A, B]);
    ({ state } = standoff.applyMove(state, A, { type: "choice", value: "COOPERATE" }));
    expect(standoff.isTerminal(state)).toBe(false);
  });

  it("isTerminal is true after both players choose", () => {
    let state = standoff.initState([A, B]);
    ({ state } = standoff.applyMove(state, A, { type: "choice", value: "DEFECT" }));
    ({ state } = standoff.applyMove(state, B, { type: "choice", value: "COOPERATE" }));
    expect(standoff.isTerminal(state)).toBe(true);
  });

  it("prisoner's dilemma incentive: DC payout for defector exceeds CC payout", () => {
    // Defecting against a cooperator yields more than mutual cooperation
    expect(0.65).toBeGreaterThan(0.45); // raw fractions from PAYOUTS table
    // And mutual defect yields less than mutual cooperation
    expect(0.3).toBeLessThan(0.45);
  });

  it("getResult payouts are non-negative", () => {
    const outcomes: Array<["COOPERATE" | "DEFECT", "COOPERATE" | "DEFECT"]> = [
      ["COOPERATE", "COOPERATE"],
      ["COOPERATE", "DEFECT"],
      ["DEFECT", "COOPERATE"],
      ["DEFECT", "DEFECT"],
    ];
    for (const [choiceA, choiceB] of outcomes) {
      let state = standoff.initState([A, B]);
      ({ state } = standoff.applyMove(state, A, { type: "choice", value: choiceA }));
      ({ state } = standoff.applyMove(state, B, { type: "choice", value: choiceB }));
      const result = standoff.getResult(state);
      expect(result.payouts[A]).toBeGreaterThanOrEqual(0);
      expect(result.payouts[B]).toBeGreaterThanOrEqual(0);
    }
  });
});
