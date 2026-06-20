import { EventEmitter } from "node:events";

export interface ConcourseEvent {
  type: "match.created" | "match.staked" | "match.move" | "match.settled";
  matchId: string;
  gameId: string;
  at: number;
  data: Record<string, unknown>;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitConcourseEvent(event: ConcourseEvent): void {
  bus.emit("event", event);
}

export function subscribeConcourse(listener: (event: ConcourseEvent) => void): () => void {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}
