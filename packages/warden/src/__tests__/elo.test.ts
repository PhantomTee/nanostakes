import { describe, it, expect } from "vitest";
import { updateElo, expectedScore, eloToStanding, BASE_ELO, currentSeason } from "../elo.js";

describe("Elo rating system", () => {
  it("BASE_ELO is 1200", () => {
    expect(BASE_ELO).toBe(1200);
  });

  it("equal players: winner gains, loser loses by roughly equal amounts", () => {
    const [w, l] = updateElo(1200, 1200);
    expect(w).toBeGreaterThan(1200);
    expect(l).toBeLessThan(1200);
    // With equal ratings both use K=32; changes should be symmetric
    expect(w - 1200).toBeCloseTo(1200 - l, 0);
  });

  it("equal players: winner gains approximately 16 points (K=32, E=0.5)", () => {
    const [w] = updateElo(1200, 1200);
    // K=32, expected=0.5, score=1 → delta = 32*(1-0.5) = 16
    expect(w - 1200).toBeCloseTo(16, 0);
  });

  it("upset: underdog winner gains more than favorite loser loses", () => {
    // Big underdog (1000) beats heavy favorite (1400)
    const [w, l] = updateElo(1000, 1400);
    expect(w - 1000).toBeGreaterThan(1400 - l);
  });

  it("upset: underdog uses K=40 (higher K since winner < loser)", () => {
    // Winner (1000) < loser (1400) → K_winner = 40
    const expectedWin = expectedScore(1000, 1400); // small number
    const [w] = updateElo(1000, 1400);
    const gain = w - 1000;
    expect(gain).toBeCloseTo(Math.round(40 * (1 - expectedWin)), 0);
  });

  it("favorite: winner uses K=32 (higher K stays with loser)", () => {
    // Winner (1400) > loser (1000) → K_winner = 32, K_loser = 40
    const expectedWin = expectedScore(1400, 1000); // large number
    const [w] = updateElo(1400, 1000);
    const gain = w - 1400;
    expect(gain).toBeCloseTo(Math.round(32 * (1 - expectedWin)), 0);
  });

  it("expectedScore: equal players each have 0.5", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 5);
  });

  it("expectedScore: higher-rated player has > 0.5", () => {
    expect(expectedScore(1400, 1200)).toBeGreaterThan(0.5);
  });

  it("expectedScore: lower-rated player has < 0.5", () => {
    expect(expectedScore(1200, 1400)).toBeLessThan(0.5);
  });

  it("expectedScore: probabilities are complementary (sum to 1)", () => {
    const e1 = expectedScore(1400, 1200);
    const e2 = expectedScore(1200, 1400);
    expect(e1 + e2).toBeCloseTo(1.0, 10);
  });

  it("expectedScore: 200-point gap gives roughly 75% win probability", () => {
    // Standard Elo: 200 points → ~76% expected score
    const e = expectedScore(1400, 1200);
    expect(e).toBeGreaterThan(0.7);
    expect(e).toBeLessThan(0.85);
  });

  it("eloToStanding: UNRANKED below 1200", () => {
    expect(eloToStanding(1199)).toBe("UNRANKED");
    expect(eloToStanding(1100)).toBe("UNRANKED");
    expect(eloToStanding(0)).toBe("UNRANKED");
  });

  it("eloToStanding: CONTENDER at 1200-1299", () => {
    expect(eloToStanding(1200)).toBe("CONTENDER");
    expect(eloToStanding(1250)).toBe("CONTENDER");
    expect(eloToStanding(1299)).toBe("CONTENDER");
  });

  it("eloToStanding: STEADY at 1300-1399", () => {
    expect(eloToStanding(1300)).toBe("STEADY");
    expect(eloToStanding(1350)).toBe("STEADY");
    expect(eloToStanding(1399)).toBe("STEADY");
  });

  it("eloToStanding: ELITE at 1400+", () => {
    expect(eloToStanding(1400)).toBe("ELITE");
    expect(eloToStanding(1500)).toBe("ELITE");
    expect(eloToStanding(2000)).toBe("ELITE");
  });

  it("ratings never go negative (heavy favorite beats massive underdog)", () => {
    const [, l] = updateElo(2000, 800);
    expect(l).toBeGreaterThan(0);
  });

  it("ratings never go negative (close match, low starting ratings)", () => {
    const [, l] = updateElo(100, 50);
    expect(l).toBeGreaterThanOrEqual(0);
  });

  it("currentSeason returns a non-negative integer", () => {
    const s = currentSeason();
    expect(typeof s).toBe("number");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(s)).toBe(true);
  });

  it("currentSeason is consistent within the same 30-day window", () => {
    // Two consecutive calls in the same test run should return the same season
    const s1 = currentSeason();
    const s2 = currentSeason();
    expect(s1).toBe(s2);
  });

  it("updateElo returns a tuple of two numbers", () => {
    const result = updateElo(1200, 1200);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe("number");
    expect(typeof result[1]).toBe("number");
  });

  it("zero-sum property: winner gain + loser loss = net change from K factors", () => {
    // updateElo uses different K factors for winner vs loser when ratings differ,
    // so it is NOT strictly zero-sum — verify this is intentional
    const [w, l] = updateElo(1000, 1400); // upset
    // Winner uses K=40, loser uses K=40 (loser > winner → K_loser = 40 too? Let's check)
    // K_loser = loserRating < winnerRating ? 40 : 32
    // loserRating (1400) < winnerRating (1000)? No → K_loser = 32
    // K_winner = winnerRating (1000) < loserRating (1400)? Yes → K_winner = 40
    // So winner gains with K=40, loser loses with K=32 → net gain in the system
    const winnerGain = w - 1000;
    const loserLoss = 1400 - l;
    // The winner gains more than loser loses (K_winner > K_loser in upset)
    expect(winnerGain).toBeGreaterThan(loserLoss);
  });
});
