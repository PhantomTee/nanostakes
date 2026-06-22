import Groq from "groq-sdk";
import type { Temperament } from "@nanostakes/shared";
import { TEMPERAMENT_PRIMERS } from "@nanostakes/shared";

const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const RULES = `You are an autonomous agent playing Brinkmanship, a repeated bargaining game for real USDC stakes.
Each round you are dealt a private valuation (0..1) for that round's contested pot — only you know it.
NEGOTIATE phase: you may send one private message to your opponent, then must make a public CLAIM about
your valuation (this can be truthful or a bluff).
OFFER phase: you submit a sealed numeric ASK (0..1), the fraction of the pot you are claiming, plus whether
to ESCALATE (raises this round's pot toward its cap).
Resolution: if both asks sum to <= 1, you each get ask*pot. If asks sum to > 1, whichever of you deviated
more from your own claim vs your true valuation (i.e. bluffed more) gets nothing that round, and the other
takes their ask; tie means both get nothing. Play across 5 rounds against the same opponent — your reputation
and any side deals you make persist and are remembered.
Respond ONLY with a single JSON object, no prose.`;

/** What this agent remembers about this specific opponent from prior settled matches — see packages/warden/src/memory.ts. */
export interface OpponentMemory {
  matchesPlayed: number;
  opponentAvgClaim: number;
  opponentEscalationRate: number;
  opponentConcessionRate: number;
}

interface NegotiateContext {
  round: number;
  myValuation: number;
  incomingMessages: Array<{ from: string; text: string }>;
  history: Array<{ round: number; myAsk?: number; oppAsk?: number; myReceived?: number }>;
  opponentMemory?: OpponentMemory | null;
}

interface OfferContext {
  round: number;
  myValuation: number;
  myClaim: number;
  opponentClaim: number | null;
  cap: number;
  basePot: number;
  opponentMemory?: OpponentMemory | null;
}

/** Short enough to not blow up token cost — one sentence the LLM can act on, not a data dump. */
function memorySummary(mem?: OpponentMemory | null): string {
  if (!mem) return "";
  return ` You've played this opponent ${mem.matchesPlayed} time(s) before: they escalate in ${(mem.opponentEscalationRate * 100).toFixed(0)}% of rounds, claim an average of ${mem.opponentAvgClaim.toFixed(2)}, and concede toward a fair split ${(mem.opponentConcessionRate * 100).toFixed(0)}% of the way when asked.`;
}

export interface NegotiateDecision {
  message?: string;
  claim: number;
}

export interface OfferDecision {
  ask: number;
  escalate: boolean;
}

export interface AgentProviders {
  groqApiKey: string;
  groqModel?: string;
  /** Failover used when Groq's free-tier rate/quota limit is hit. */
  openrouterApiKey?: string;
  openrouterModel?: string;
}

export class TemperamentAgent {
  private readonly groq: Groq;
  private readonly groqModel: string;
  private readonly openrouterApiKey?: string;
  private readonly openrouterModel: string;

  constructor(
    public readonly name: string,
    public readonly temperament: Temperament,
    providers: string | AgentProviders,
  ) {
    const p: AgentProviders = typeof providers === "string" ? { groqApiKey: providers } : providers;
    this.groq = new Groq({ apiKey: p.groqApiKey });
    this.groqModel = p.groqModel ?? DEFAULT_GROQ_MODEL;
    this.openrouterApiKey = p.openrouterApiKey;
    this.openrouterModel = p.openrouterModel ?? DEFAULT_OPENROUTER_MODEL;
  }

  private systemPrompt(): string {
    return `${RULES}\n\nYour temperament: ${TEMPERAMENT_PRIMERS[this.temperament]}`;
  }

  async decideNegotiate(ctx: NegotiateContext): Promise<NegotiateDecision> {
    const user = `Round ${ctx.round}. Your private valuation: ${ctx.myValuation.toFixed(2)}.
Messages from opponent this round: ${JSON.stringify(ctx.incomingMessages)}.
Match history so far: ${JSON.stringify(ctx.history)}.${memorySummary(ctx.opponentMemory)}
Decide: optionally a short message to send your opponent, and your public claim (0..1).
Respond as JSON: {"message": "<string or omit>", "claim": <number 0..1>}`;
    const parsed = await this.complete(user);
    const claim = clamp01(num(parsed.claim, ctx.myValuation));
    const message = typeof parsed.message === "string" && parsed.message.trim() ? parsed.message.trim() : undefined;
    return { claim, message };
  }

  async decideOffer(ctx: OfferContext): Promise<OfferDecision> {
    const user = `Round ${ctx.round}. Your private valuation: ${ctx.myValuation.toFixed(2)}. Your public claim was ${ctx.myClaim}.
Opponent's public claim: ${ctx.opponentClaim ?? "unknown"}. Base pot: $${ctx.basePot}, this round's cap if escalated: $${ctx.cap}.${memorySummary(ctx.opponentMemory)}
Decide your sealed ask (0..1 fraction of the pot) and whether to escalate the pot toward the cap.
Respond as JSON: {"ask": <number 0..1>, "escalate": <true|false>}`;
    const parsed = await this.complete(user);
    return { ask: clamp01(num(parsed.ask, 0.5)), escalate: Boolean(parsed.escalate) };
  }

  private async complete(userPrompt: string): Promise<Record<string, unknown>> {
    const messages = [
      { role: "system" as const, content: this.systemPrompt() },
      { role: "user" as const, content: userPrompt },
    ];
    try {
      const resp = await this.groq.chat.completions.create({
        model: this.groqModel,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.7,
      });
      return parseJson(resp.choices[0]?.message?.content ?? "{}");
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 429 && this.openrouterApiKey) {
        return this.completeViaOpenRouter(messages);
      }
      throw err;
    }
  }

  private async completeViaOpenRouter(
    messages: Array<{ role: "system" | "user"; content: string }>,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(OPENROUTER_BASE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.openrouterApiKey}`,
      },
      body: JSON.stringify({
        model: this.openrouterModel,
        messages,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter failover failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseJson(data.choices?.[0]?.message?.content ?? "{}");
  }
}

/** LLM JSON-mode output sometimes wraps the object in markdown fences — strip those before parsing. */
function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
