import { wireMessage } from "./messages.js";
import type { WireMessage } from "./messages.js";

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly line?: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

/** Encode one message as a single JSONL line. */
export function encodeMessage(m: WireMessage): string {
  return JSON.stringify(m) + "\n";
}

/** Parse one JSONL line. Throws ProtocolError on invalid JSON or schema mismatch. */
export function decodeLine(line: string): WireMessage {
  const trimmed = line.trim();
  if (!trimmed) throw new ProtocolError("empty line");
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new ProtocolError("invalid JSON", trimmed);
  }
  const parsed = wireMessage.safeParse(json);
  if (!parsed.success) {
    throw new ProtocolError(`schema mismatch: ${parsed.error.issues[0]?.message ?? "unknown"}`, trimmed);
  }
  return parsed.data;
}

/**
 * Decode a stream of JSONL into messages (works on any async iterable of
 * strings/Buffer — a socket, a stdio pipe, an in-memory channel).
 */
export async function* decodeStream(
  source: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<WireMessage, void, void> {
  let buf = "";
  for await (const chunk of source) {
    buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) yield decodeLine(line);
    }
  }
  if (buf.trim()) yield decodeLine(buf); // final line without trailing newline
}
