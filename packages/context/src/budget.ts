/**
 * Token accounting. Cheap estimation is a FEATURE: exact counts are
 * tokenizer-specific, and the budget manager only needs a stable,
 * monotonic approximation to decide when to compact.
 *
 * ASCII uses a four-character heuristic. Non-ASCII is weighted by UTF-8
 * bytes so CJK/emoji do not receive the severe discount of char counting.
 * This is explicitly an estimate; provider usage supplies actual billing.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  let units = 0;
  for (const character of text)
    units +=
      character.codePointAt(0)! < 128
        ? 0.25
        : Buffer.byteLength(character, "utf8") * 0.5;
  return Math.ceil(units);
}

export interface MessageLike {
  images?: { data: string }[];
  role: string;
  content: string;
  toolCalls?: { name: string; args: unknown }[];
}

export function estimateMessageTokens(message: MessageLike): number {
  // ~4 tokens of framing overhead per message (role tags, separators)
  let total = 4;
  total += estimateTokens(message.content);
  for (const image of message.images ?? [])
    total += Math.max(1024, Math.ceil(image.data.length / 1000));
  for (const call of message.toolCalls ?? []) {
    total += 8; // call framing
    total += estimateTokens(call.name);
    total += estimateTokens(JSON.stringify(call.args ?? {}));
  }
  return total;
}

export interface BudgetBreakdown {
  /** tokens used by the live transcript */
  used: number;
  /** budget carved out for the next model response */
  reserve: number;
  /** tokens the live transcript is allowed to occupy */
  usable: number;
  /** usable - used; compaction triggers when <= 0 */
  remaining: number;
  /** fraction of usable already consumed, 0..1 */
  pressure: number;
}

export interface BudgetConfig {
  /** model context window */
  contextWindow: number;
  /** carve-out for the model's reply (and its tool calls) */
  reserveOutput?: number;
  /** extra head-room for system prompt, tool schemas, misc */
  reserveSystem?: number;
  /** compaction fires at this fraction of usable (default 0.95) */
  highWaterMark?: number;
}

/**
 * Tracks pressure against the context window. The reserve is SUBTRACTED
 * from the window before measuring the transcript, so a compaction
 * decision never strands the model without room to answer.
 */
export class TokenBudget {
  private contextWindow: number;
  private reserve: number;
  private overhead = 0;
  private readonly highWaterMark: number;
  private messages: MessageLike[] = [];

  constructor(config: BudgetConfig) {
    this.contextWindow = config.contextWindow;
    this.reserve =
      (config.reserveOutput ?? 8192) + (config.reserveSystem ?? 2048);
    this.highWaterMark = config.highWaterMark ?? 0.95;
  }

  configure(config: BudgetConfig): void {
    if (!Number.isSafeInteger(config.contextWindow) || config.contextWindow < 256) throw Error("Invalid model context window");
    this.contextWindow = config.contextWindow;
    this.reserve = Math.min(config.contextWindow - 128, (config.reserveOutput ?? Math.min(8192, Math.floor(config.contextWindow / 4))) + (config.reserveSystem ?? 1024));
  }

  get windowSize(): number { return this.contextWindow; }

  setOverhead(tokens: number): void { this.overhead = Math.max(0, tokens); }

  setMessages(messages: MessageLike[]): void {
    this.messages = messages;
  }

  addMessage(message: MessageLike): void {
    this.messages.push(message);
  }

  get used(): number {
    let total = this.overhead;
    for (const m of this.messages) total += estimateMessageTokens(m);
    return total;
  }

  get usable(): number {
    return Math.max(0, this.contextWindow - this.reserve);
  }

  breakdown(): BudgetBreakdown {
    const used = this.used;
    const usable = this.usable;
    const remaining = usable - used;
    return {
      used,
      reserve: this.reserve,
      usable,
      remaining,
      pressure: usable === 0 ? 1 : Math.min(1, used / usable),
    };
  }

  /** true when the transcript should be compacted before the next request */
  shouldCompact(): boolean {
    return this.breakdown().pressure >= this.highWaterMark;
  }
}
