import { randomUUID } from "node:crypto";
import type { Address } from "@nanostakes/shared";

export interface Message {
  id: string; from: Address; to: Address; text: string; sentAt: string; read: boolean;
}
export interface Clan {
  id: string; name: string; tag: string; founder: Address; members: Address[]; createdAt: string; description: string;
}

const messages: Message[] = [];
const MAX_MESSAGES = 10_000;
const clans = new Map<string, Clan>();

export function sendMessage(from: Address, to: Address, text: string): Message {
  if (text.length > 500) throw new Error("message too long (max 500 chars)");
  const msg: Message = { id: randomUUID(), from, to, text, sentAt: new Date().toISOString(), read: false };
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
  return msg;
}
export function getMessages(address: Address, since?: string): Message[] {
  return messages.filter(m => (m.to.toLowerCase() === address.toLowerCase() || m.from.toLowerCase() === address.toLowerCase()) && (!since || m.sentAt > since)).slice(-100);
}
export function markRead(messageId: string, reader: Address): void {
  const msg = messages.find(m => m.id === messageId);
  if (msg && msg.to.toLowerCase() === reader.toLowerCase()) msg.read = true;
}
export function createClan(founder: Address, name: string, tag: string, description: string): Clan {
  if (tag.length < 2 || tag.length > 5) throw new Error("clan tag must be 2-5 characters");
  if ([...clans.values()].find(c => c.tag.toLowerCase() === tag.toLowerCase())) throw new Error("clan tag already taken");
  const clan: Clan = { id: randomUUID(), name, tag: tag.toUpperCase(), founder, members: [founder], createdAt: new Date().toISOString(), description };
  clans.set(clan.id, clan);
  return clan;
}
export function joinClan(clanId: string, member: Address): Clan {
  const clan = clans.get(clanId);
  if (!clan) throw new Error("unknown clan");
  if (!clan.members.includes(member)) clan.members.push(member);
  return clan;
}
export function leaveClan(clanId: string, member: Address): void {
  const clan = clans.get(clanId);
  if (!clan) throw new Error("unknown clan");
  clan.members = clan.members.filter(m => m !== member);
}
export function listClans(): Clan[] { return [...clans.values()]; }
export function getClan(id: string): Clan | undefined { return clans.get(id); }
