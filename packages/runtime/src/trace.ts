import type { Writable } from "node:stream";
import type { TraceEntry } from "./types.js";

export type TraceSink = (entry: TraceEntry) => void;

/** In-memory trace, inspectable in tests and tooling. */
export class ChainTrace {
  readonly entries: TraceEntry[] = [];
  write: TraceSink = (e) => {
    this.entries.push({ ...e, ts: e.ts || Date.now() });
  };
  toJsonl(): string {
    return this.entries.map((e) => JSON.stringify(e)).join("\n") + (this.entries.length ? "\n" : "");
  }
}

/** Stream a chain trace to a file/stdout as JSONL (--plugin-trace). */
export function jsonlTraceSink(stream: Writable): TraceSink {
  return (e) => {
    if (!stream.destroyed) stream.write(JSON.stringify({ ts: Date.now(), ...e }) + "\n");
  };
}
