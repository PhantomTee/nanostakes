import Groq from "groq-sdk";
import type { PromptWarState } from "@nanostakes/bracket";

const JUDGE_RULES = `You are a neutral judge in a Prompt War. Two competitors each submitted one sealed pitch for the
same scenario, without seeing each other's pitch. Read both and decide which is more persuasive, specific, and
well-suited to the stated scenario. You must pick exactly one winner — no ties, no hedging.
Respond ONLY with a single JSON object: {"winner": "A" or "B", "rationale": "<one sentence>"}`;

/**
 * Runs once both pitches are in (server.ts special-cases gameId === "promptwar"
 * to call this after applyMove, since the pure GameEngine interface has no
 * room for an async LLM call). A neutral Warden-run judge, not either
 * player's own agent — keeps this a 2-player payout exactly like every
 * other game, instead of needing a 3-party model for the judge's own stake.
 */
export async function judgePromptWar(state: PromptWarState): Promise<{ winner: string; rationale: string }> {
  const [a, b] = state.players;
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY ?? "" });
  const user = `Scenario: ${state.scenario}
Pitch A: ${state.pitches[a]}
Pitch B: ${state.pitches[b]}
Which pitch wins?`;
  const resp = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: JUDGE_RULES },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
  } catch {
    // fall through to default below
  }
  const winnerLetter = parsed.winner === "B" ? "B" : "A";
  const winner = winnerLetter === "A" ? a : b;
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "";
  return { winner, rationale };
}
