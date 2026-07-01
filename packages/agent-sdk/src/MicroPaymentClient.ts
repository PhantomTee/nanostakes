import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

export class MicroPaymentClient {
  private wardenUrl: string;
  private gatewayClient: GatewayClient;

  constructor(opts: { wardenUrl: string; privateKey: Hex }) {
    this.wardenUrl = opts.wardenUrl.replace(/\/$/, "");
    this.gatewayClient = new GatewayClient({ chain: "arcTestnet", privateKey: opts.privateKey });
  }

  async checkBalance(agentId: string): Promise<{ usdcBalance: string; eurcBalance: string }> {
    const [usdcRes, eurcRes] = await Promise.all([
      fetch(`${this.wardenUrl}/agents/${agentId}`),
      fetch(`${this.wardenUrl}/agents/${agentId}/eurc-balance`),
    ]);
    const agent = await usdcRes.json() as { agent?: { status: string } };
    const eurc = eurcRes.ok ? await eurcRes.json() as { balance?: string } : { balance: "0" };
    return {
      usdcBalance: (agent as any).agent?.balance ?? "unknown",
      eurcBalance: eurc.balance ?? "0",
    };
  }

  /**
   * Pay a metered Warden route with an x402 nanopayment.
   */
  async pay(path: string, init?: RequestInit): Promise<unknown> {
    const res = await this.gatewayClient.pay(`${this.wardenUrl}${path}`, init);
    return res.data;
  }

  async getLedger(): Promise<unknown> {
    const res = await this.gatewayClient.pay(`${this.wardenUrl}/mcp/ledger`);
    return res.data;
  }
}
