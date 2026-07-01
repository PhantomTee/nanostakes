import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

export class TournamentClient {
  private wardenUrl: string;
  private gatewayClient: GatewayClient;

  constructor(opts: { wardenUrl: string; privateKey: Hex }) {
    this.wardenUrl = opts.wardenUrl.replace(/\/$/, "");
    this.gatewayClient = new GatewayClient({ chain: "arcTestnet", privateKey: opts.privateKey });
  }

  async listTournaments() {
    const res = await fetch(`${this.wardenUrl}/tournaments`);
    return (await res.json()) as { tournaments: unknown[] };
  }

  async joinTournament(tournamentId: string, player: string) {
    const res = await fetch(`${this.wardenUrl}/tournaments/${tournamentId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player }),
    });
    if (!res.ok) throw new Error(`join failed: ${await res.text()}`);
    return res.json();
  }

  async getStandings(tournamentId: string) {
    const res = await fetch(`${this.wardenUrl}/tournaments/${tournamentId}/standings`);
    if (!res.ok) throw new Error(`standings fetch failed: ${res.status}`);
    return res.json();
  }

  async getTournament(tournamentId: string) {
    const res = await fetch(`${this.wardenUrl}/tournaments/${tournamentId}`);
    if (!res.ok) throw new Error(`tournament fetch failed: ${res.status}`);
    return res.json();
  }
}
