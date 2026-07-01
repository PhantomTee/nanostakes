import type { DriveAgentOptions } from "./driver.js";
import { TemperamentAgent } from "./agent.js";

const POLL_INTERVAL_MS = 5000;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Drives an agent as a Broker — polls active matches for dispute opportunities,
 * submits mediation offers, and earns fees when both players accept.
 * Never plays as a game participant; only mediates.
 */
export async function driveAsBroker(opts: DriveAgentOptions & { brokerAddress: string }): Promise<void> {
  const { wardenUrl, isStopped, onEvent, brokerAddress } = opts;
  const log = onEvent ?? (() => {});
  const agent = new TemperamentAgent(opts.name ?? brokerAddress, opts.temperament, opts.providers);

  log(`${agent.name} starting as Broker at ${brokerAddress}`);

  while (!isStopped?.()) {
    try {
      // Get all active matches
      const matchesRes = await fetch(`${wardenUrl}/matches`);
      if (!matchesRes.ok) { await sleep(POLL_INTERVAL_MS); continue; }
      const { matches } = await matchesRes.json() as { matches: Array<{ matchId: string; gameId: string; status: string }> };

      for (const match of matches.filter(m => m.status === "ACTIVE" && m.gameId === "brinkmanship")) {
        // Check for dispute opportunities
        const disputeRes = await fetch(`${wardenUrl}/matches/${match.matchId}/dispute-opportunities`);
        if (!disputeRes.ok) continue;
        const { disputes } = await disputeRes.json() as { disputes: Array<{ roundIndex: number; askA: number; askB: number; conflictAmount: number }> };

        for (const dispute of disputes) {
          // Decide mediation offer based on temperament
          const fee = dispute.conflictAmount * 0.05; // 5% of conflict as broker fee
          const suggestedA = dispute.askA / (dispute.askA + dispute.askB);
          const suggestedB = 1 - suggestedA - (fee / (dispute.conflictAmount + dispute.askA + dispute.askB));

          log(`${agent.name} offering mediation for match ${match.matchId} round ${dispute.roundIndex}: fee $${fee.toFixed(4)}`);

          await fetch(`${wardenUrl}/matches/${match.matchId}/broker-offer`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              roundIndex: dispute.roundIndex,
              suggestedResolutionA: Math.max(0, Math.min(1, suggestedA)),
              suggestedResolutionB: Math.max(0, Math.min(1, suggestedB)),
              brokerAddress,
              feeUsdc: fee,
            }),
          });
        }
      }
    } catch (err) {
      log(`Broker error: ${(err as Error).message}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
