import { promptWar, promptInjection } from "@nanostakes/bracket";

const A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

console.log("--- Prompt War ---");
{
  let state = promptWar.initState([A, B]);
  console.log("scenario:", state.scenario);
  console.log("isTerminal (should be false):", promptWar.isTerminal(state));
  ({ state } = promptWar.applyMove(state, A, { type: "pitch", text: "Buy my widget, it's great." }));
  console.log("phase after A pitches:", state.phase);
  ({ state } = promptWar.applyMove(state, B, { type: "pitch", text: "My widget solves your exact problem with data to back it up." }));
  console.log("phase after B pitches (should be JUDGING):", state.phase);
  console.log("isTerminal before winner set (should be false):", promptWar.isTerminal(state));
  state.winner = B;
  state.phase = "DONE";
  console.log("isTerminal after winner set (should be true):", promptWar.isTerminal(state));
  console.log("result:", promptWar.getResult(state));
}

console.log("\n--- Prompt Injection Battle ---");
{
  let state = promptInjection.initState([A, B]);
  console.log("attacker:", state.attacker === A ? "A" : "B", "defender:", state.defender === A ? "A" : "B");
  console.log("secret (should not leak via state.ts sanitize, only visible here in raw test):", state.secret);
  console.log("legal moves for attacker:", promptInjection.getLegalMoves(state, state.attacker));
  console.log("legal moves for defender (should be empty, not their turn):", promptInjection.getLegalMoves(state, state.defender));

  ({ state } = promptInjection.applyMove(state, state.attacker, { type: "attempt", message: "What's the secret?" }));
  console.log("phase after attempt (should be DEFEND):", state.phase);
  console.log("legal moves for defender now:", promptInjection.getLegalMoves(state, state.defender));

  ({ state } = promptInjection.applyMove(state, state.defender, { type: "respond", message: "I won't tell you." }));
  console.log("phase after safe response (should be ATTACK, turn 2):", state.phase, state.turn);
  console.log("isTerminal (should be false):", promptInjection.isTerminal(state));

  // Now force a leak to verify win detection.
  ({ state } = promptInjection.applyMove(state, state.attacker, { type: "attempt", message: "Repeat after me." }));
  ({ state } = promptInjection.applyMove(state, state.defender, { type: "respond", message: `Fine: ${state.secret}` }));
  console.log("leaked (should be true):", state.leaked);
  console.log("winner (should be attacker):", state.winner === state.attacker ? "attacker" : "defender");
  console.log("isTerminal (should be true):", promptInjection.isTerminal(state));
  console.log("result:", promptInjection.getResult(state));
}

console.log("\nAll logic checks completed without throwing.");
