import type { MessageLike } from "./budget.js";

/**
 * Compaction: when the live transcript outgrows the budget, replace the
 * old middle with a summary while preserving the head (system prompt)
 * and the tail (recent working context).
 *
 * The summarizer itself is just an async function (a model call, a
 * heuristic, a test script) — this package owns the DECISION and the
 * SHAPE of what survives, mirroring the harvested pattern that
 * compaction must keep: system + recent messages verbatim, everything
 * older folded into one summary message.
 */
export interface CompactionResult {
  messages: MessageLike[];
  summary: string;
  /** how many original messages were folded into the summary */
  foldedCount: number;
  tokensBefore: number;
  tokensAfter: number;
}

export type Summarizer = (messages: MessageLike[], ctx: { signal: AbortSignal }) => Promise<string>;

export interface CompactionOptions {
  /** always keep the system prompt plus this many trailing messages verbatim */
  keepTail?: number;
  /** if the summarizer fails, fall back to a truncation marker instead of dying */
  fallbackSummary?: string;
  signal?: AbortSignal;
}

/**
 * Compact a transcript: keep [0, headCount) verbatim (system prompt),
 * keep the last keepTail messages verbatim, summarize the middle.
 * If there is no middle, the transcript is returned untouched.
 */
export async function compactTranscript(
  messages: MessageLike[],
  summarize: Summarizer,
  opts: CompactionOptions = {},
): Promise<CompactionResult> {
  const keepTail = opts.keepTail ?? 6;
  const fallback = opts.fallbackSummary ?? "[earlier conversation compacted]";
  const signal = opts.signal ?? new AbortController().signal;

  const headCount = messages.length > 0 && messages[0].role === "system" ? 1 : 0;
  const tailStart = Math.max(headCount, messages.length - keepTail);

  // nothing worth compacting: head + tail already covers everything
  if (tailStart - headCount < 2) {
    return {
      messages,
      summary: "",
      foldedCount: 0,
      tokensBefore: countAll(messages),
      tokensAfter: countAll(messages),
    };
  }

  const head = messages.slice(0, headCount);
  const middle = messages.slice(headCount, tailStart);
  const tail = messages.slice(tailStart);

  let summary: string;
  try {
    summary = await summarize(middle, { signal });
    if (!summary) summary = fallback;
  } catch {
    summary = fallback;
  }

  const compacted: MessageLike[] = [
    ...head,
    { role: "system", content: `Summary of earlier conversation:\n${summary}` },
    ...tail,
  ];

  return {
    messages: compacted,
    summary,
    foldedCount: middle.length,
    tokensBefore: countAll(messages),
    tokensAfter: countAll(compacted),
  };
}

function countAll(messages: MessageLike[]): number {
  let total = 0;
  for (const m of messages) {
    total += Math.ceil(m.content.length / 4) + 4;
    for (const c of m.toolCalls ?? []) total += 8 + Math.ceil((c.name.length + JSON.stringify(c.args ?? {}).length) / 4);
  }
  return total;
}
