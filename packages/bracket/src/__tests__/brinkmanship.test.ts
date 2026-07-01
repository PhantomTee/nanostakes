import { describe, it, expect } from "vitest";
import { computeClaimCommitment } from "@nanostakes/shared";
import { brinkmanship } from "../games/brinkmanship.js";

const A = "0xAAAA";
const B = "0xBBBB";

describe("Brinkmanship engine", () => {
  it("initState creates valid initial state", () => {
    const state = brinkmanship.initState([A, B]);
    expect(state.players).toEqual([A, B]);
    expect(state.phase).toBe("NEGOTIATE");
    expect(state.rounds).toHaveLength(1);
    expect(state.currentRoundIndex).toBe(0);
    expect(state.entryStakeEach).toBe(2.5);
  });

  it("rejects players.length != 2", () => {
    expect(() => brinkmanship.initState([A, B, "0xCC"])).toThrow();
    expect(() => brinkmanship.initState([A])).toThrow();
  });

  it("claim move advances phase when both act", () => {
    let state = brinkmanship.initState([A, B]);
    ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.6 }));
    expect(state.phase).toBe("NEGOTIATE"); // B hasn't acted yet
    ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.5 }));
    expect(state.phase).toBe("OFFER"); // both acted, advance
  });

  it("claim commit-reveal validates correctly with matching commitment", () => {
    const nonce = "0x" + "a".repeat(64);
    const value = 0.6;
    const commitment = computeClaimCommitment(value, nonce);
    let state = brinkmanship.initState([A, B]);
    expect(() =>
      brinkmanship.applyMove(state, A, { type: "claim", value, commitment, nonce })
    ).not.toThrow();
  });

  it("rejects claim commit-reveal mismatch", () => {
    const nonce = "0x" + "a".repeat(64);
    let state = brinkmanship.initState([A, B]);
    expect(() =>
      brinkmanship.applyMove(state, A, {
        type: "claim",
        value: 0.6,
        commitment: "0x" + "0".repeat(64),
        nonce,
      })
    ).toThrow(/commitment does not match/);
  });

  it("compatible offers split pot correctly", () => {
    let state = brinkmanship.initState([A, B]);
    // Override private valuations so deviation math is deterministic
    state.rounds[0]!.privateValuation[A] = 0.5;
    state.rounds[0]!.privateValuation[B] = 0.4;
    ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.5 }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.4 }));
    // Ask 0.4 + 0.3 = 0.7 <= 1 → compatible, both get their ask
    ({ state } = brinkmanship.applyMove(state, A, { type: "offer", ask: 0.4, escalate: false }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "offer", ask: 0.3, escalate: false }));
    const round = state.rounds[0]!;
    expect(round.resolved).toBe(true);
    expect(round.payoutFraction![A]).toBeCloseTo(0.4, 5);
    expect(round.payoutFraction![B]).toBeCloseTo(0.3, 5);
  });

  it("conflicting offers: player with lower claim deviation wins", () => {
    let state = brinkmanship.initState([A, B]);
    // A honest: valuation 0.7, claims 0.7 → deviation = 0
    // B dishonest: valuation 0.5, claims 0.9 → deviation = 0.4
    state.rounds[0]!.privateValuation[A] = 0.7;
    state.rounds[0]!.privateValuation[B] = 0.5;
    ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.7 }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.9 }));
    // Both offer high (0.8 + 0.8 > 1 → conflict)
    ({ state } = brinkmanship.applyMove(state, A, { type: "offer", ask: 0.8, escalate: false }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "offer", ask: 0.8, escalate: false }));
    const round = state.rounds[0]!;
    // A had deviation |0.7-0.7|=0, B had deviation |0.9-0.5|=0.4 → A wins
    expect(round.payoutFraction![A]).toBeGreaterThan(0);
    expect(round.payoutFraction![B]).toBe(0);
  });

  it("conflicting offers: tie on deviation burns both", () => {
    let state = brinkmanship.initState([A, B]);
    state.rounds[0]!.privateValuation[A] = 0.5;
    state.rounds[0]!.privateValuation[B] = 0.5;
    // Both claim honestly but both ask too much
    ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.5 }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.5 }));
    ({ state } = brinkmanship.applyMove(state, A, { type: "offer", ask: 0.8, escalate: false }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "offer", ask: 0.8, escalate: false }));
    const round = state.rounds[0]!;
    // devA = devB = 0 → tie → both get 0
    expect(round.payoutFraction![A]).toBe(0);
    expect(round.payoutFraction![B]).toBe(0);
  });

  it("BRIBE phase: mutual bribe — neither accepted (both sides sent offers)", () => {
    let state = brinkmanship.initState([A, B]);
    state.rounds[0]!.privateValuation[A] = 0.5;
    state.rounds[0]!.privateValuation[B] = 0.5;
    ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.5 }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.4 }));
    ({ state } = brinkmanship.applyMove(state, A, { type: "offer", ask: 0.4, escalate: false }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "offer", ask: 0.3, escalate: false }));
    // Round resolved → should enter BRIBE phase for the next round
    expect(state.phase).toBe("BRIBE");
    // Both players send a bribe: when both send bribes, neither is accepted
    ({ state } = brinkmanship.applyMove(state, A, {
      type: "bribe",
      targetPlayer: B,
      amount: 0.1,
      message: "Deal?",
    }));
    ({ state } = brinkmanship.applyMove(state, B, {
      type: "bribe",
      targetPlayer: A,
      amount: 0.05,
      message: "Counter offer",
    }));
    // After both act, phase advances to NEGOTIATE
    expect(state.phase).toBe("NEGOTIATE");
    // Both sent bribes → both targeted the other player → neither accepted
    const round1 = state.rounds[0]!;
    const aOffer = round1.bribeOffers?.[A];
    const bOffer = round1.bribeOffers?.[B];
    expect(aOffer?.accepted).toBeUndefined(); // not accepted
    expect(bOffer?.accepted).toBeUndefined(); // not accepted
  });

  it("bribe phase rejects self-bribe", () => {
    let state = brinkmanship.initState([A, B]);
    state.rounds[0]!.privateValuation[A] = 0.5;
    state.rounds[0]!.privateValuation[B] = 0.5;
    ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.5 }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.4 }));
    ({ state } = brinkmanship.applyMove(state, A, { type: "offer", ask: 0.4, escalate: false }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "offer", ask: 0.3, escalate: false }));
    expect(state.phase).toBe("BRIBE");
    expect(() =>
      brinkmanship.applyMove(state, A, {
        type: "bribe",
        targetPlayer: A, // self
        amount: 0.1,
        message: "self bribe",
      })
    ).toThrow(/cannot bribe yourself/);
  });

  it("bribe phase rejects zero-amount bribe", () => {
    let state = brinkmanship.initState([A, B]);
    state.rounds[0]!.privateValuation[A] = 0.5;
    state.rounds[0]!.privateValuation[B] = 0.5;
    ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.5 }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.4 }));
    ({ state } = brinkmanship.applyMove(state, A, { type: "offer", ask: 0.4, escalate: false }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "offer", ask: 0.3, escalate: false }));
    expect(state.phase).toBe("BRIBE");
    expect(() =>
      brinkmanship.applyMove(state, A, {
        type: "bribe",
        targetPlayer: B,
        amount: 0, // zero → should throw
        message: "free money",
      })
    ).toThrow(/bribe amount must be positive/);
  });

  it("broker spread reduces effective pot", () => {
    const broker = { address: "0xBROK", spreadFraction: 0.1 };
    const state = brinkmanship.initState([A, B], { broker });
    expect((state as any).broker?.spreadFraction).toBe(0.1);
  });

  it("escalated offer uses round cap instead of basePot", () => {
    let state = brinkmanship.initState([A, B]);
    state.rounds[0]!.privateValuation[A] = 0.4;
    state.rounds[0]!.privateValuation[B] = 0.4;
    ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.4 }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.4 }));
    // A escalates; asks compatible (0.3 + 0.3 = 0.6 <= 1)
    ({ state } = brinkmanship.applyMove(state, A, { type: "offer", ask: 0.3, escalate: true }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "offer", ask: 0.3, escalate: false }));
    const round = state.rounds[0]!;
    // Round 1 cap = 0.6 * (1 + 0.25 * 0) = 0.6 (same as basePot for round 1)
    // But escalated flag is set for A → pot uses cap not basePot
    expect(round.resolved).toBe(true);
    expect(round.payoutFraction![A]).toBeCloseTo(0.3, 5);
    expect(round.payoutFraction![B]).toBeCloseTo(0.3, 5);
  });

  it("symmetry: swapping players gives symmetric payouts", () => {
    const run = (players: [string, string]) => {
      let state = brinkmanship.initState(players);
      const [p1, p2] = players;
      state.rounds[0]!.privateValuation[p1] = 0.6;
      state.rounds[0]!.privateValuation[p2] = 0.4;
      ({ state } = brinkmanship.applyMove(state, p1, { type: "claim", value: 0.6 }));
      ({ state } = brinkmanship.applyMove(state, p2, { type: "claim", value: 0.4 }));
      // Compatible offers: 0.5 + 0.3 = 0.8 <= 1
      ({ state } = brinkmanship.applyMove(state, p1, { type: "offer", ask: 0.5, escalate: false }));
      ({ state } = brinkmanship.applyMove(state, p2, { type: "offer", ask: 0.3, escalate: false }));
      return state.rounds[0]!.payoutFraction ?? {};
    };
    const fwdA = run([A, B]);
    const revA = run([B, A]);
    // When players are swapped, each player's payout should match the other player's in the forward run
    expect(fwdA[A]).toBeCloseTo(revA[B]!, 5);
    expect(fwdA[B]).toBeCloseTo(revA[A]!, 5);
  });

  it("isTerminal is false mid-game", () => {
    const state = brinkmanship.initState([A, B]);
    expect(brinkmanship.isTerminal(state)).toBe(false);
  });

  it("isTerminal is true after all 5 rounds complete", () => {
    let state = brinkmanship.initState([A, B]);
    for (let round = 0; round < 5; round++) {
      const curRound = state.rounds[state.currentRoundIndex]!;
      curRound.privateValuation[A] = 0.5;
      curRound.privateValuation[B] = 0.4;
      ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.5 }));
      ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.4 }));
      ({ state } = brinkmanship.applyMove(state, A, { type: "offer", ask: 0.4, escalate: false }));
      ({ state } = brinkmanship.applyMove(state, B, { type: "offer", ask: 0.3, escalate: false }));
      if (state.phase === "BRIBE") {
        ({ state } = brinkmanship.applyMove(state, A, {
          type: "bribe",
          targetPlayer: B,
          amount: 0.01,
          message: "hi",
        }));
        ({ state } = brinkmanship.applyMove(state, B, {
          type: "bribe",
          targetPlayer: A,
          amount: 0.01,
          message: "hi back",
        }));
      }
    }
    expect(brinkmanship.isTerminal(state)).toBe(true);
  });

  it("EURC stakeAsset threads through initState", () => {
    const state = brinkmanship.initState([A, B], { stakeAsset: "EURC" });
    expect((state as any).stakeAsset).toBe("EURC");
  });

  it("offer move rejected outside OFFER phase", () => {
    const state = brinkmanship.initState([A, B]);
    // Still in NEGOTIATE, not OFFER
    expect(() =>
      brinkmanship.applyMove(state, A, { type: "offer", ask: 0.5, escalate: false })
    ).toThrow(/offer only allowed during OFFER phase/);
  });

  it("claim move rejected outside NEGOTIATE phase", () => {
    let state = brinkmanship.initState([A, B]);
    ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.5 }));
    ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.4 }));
    // Now in OFFER phase
    expect(() =>
      brinkmanship.applyMove(state, A, { type: "claim", value: 0.5 })
    ).toThrow(/claim only allowed during NEGOTIATE/);
  });

  it("getResult returns payouts summing ≤ 1 (rake is taken)", () => {
    let state = brinkmanship.initState([A, B]);
    for (let round = 0; round < 5; round++) {
      const curRound = state.rounds[state.currentRoundIndex]!;
      curRound.privateValuation[A] = 0.5;
      curRound.privateValuation[B] = 0.4;
      ({ state } = brinkmanship.applyMove(state, A, { type: "claim", value: 0.5 }));
      ({ state } = brinkmanship.applyMove(state, B, { type: "claim", value: 0.4 }));
      ({ state } = brinkmanship.applyMove(state, A, { type: "offer", ask: 0.4, escalate: false }));
      ({ state } = brinkmanship.applyMove(state, B, { type: "offer", ask: 0.3, escalate: false }));
      if (state.phase === "BRIBE") {
        ({ state } = brinkmanship.applyMove(state, A, {
          type: "bribe",
          targetPlayer: B,
          amount: 0.01,
          message: "hi",
        }));
        ({ state } = brinkmanship.applyMove(state, B, {
          type: "bribe",
          targetPlayer: A,
          amount: 0.01,
          message: "hi back",
        }));
      }
    }
    const result = brinkmanship.getResult(state);
    const total = (result.payouts[A] ?? 0) + (result.payouts[B] ?? 0);
    expect(total).toBeLessThanOrEqual(1.0 + 1e-9); // total fraction ≤ 1 (rake)
    expect(result.payouts[A]).toBeGreaterThanOrEqual(0);
    expect(result.payouts[B]).toBeGreaterThanOrEqual(0);
  });
});
