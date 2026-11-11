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
  /** Host-generated continuation feedback must not replace the user task. */
  origin?: "harness";
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
  private contextWindow = 32768;
  private reserve = 0;
  private output = 8192;
  private settings: BudgetConfig;
  private overhead = 0;
  private highWaterMark = 0.95;
  private messages: MessageLike[] = [];

  constructor(config: BudgetConfig) {
    this.settings = {...config};
    this.applyCapacity();
  }

  configure(config: BudgetConfig): void {
    const previous=this.settings;
    this.settings = {...config};
    try{this.applyCapacity();}catch(error){this.settings=previous;throw error;}
  }

  get windowSize(): number { return this.contextWindow; }
  get outputReserve(): number { return this.output; }

  /** Resolve a provider's capacity without replacing the caller's settings. */
  applyCapacity(capacity?:{contextWindow?:number;maxOutputTokens?:number},overrides:Partial<BudgetConfig>={}):void {
    const config={...this.settings,...overrides};
    const window=overrides.contextWindow??capacity?.contextWindow??config.contextWindow;
    if(!Number.isSafeInteger(window)||window<256)throw Error('Invalid model context window');
    const output=config.reserveOutput??Math.min(8192,Math.floor(window/4));
    const system=config.reserveSystem??Math.min(2048,Math.floor(window/8));
    if(!Number.isSafeInteger(output)||output<1)throw Error('Invalid output reserve; use a positive integer');
    if(!Number.isSafeInteger(system)||system<0)throw Error('Invalid system reserve');
    const ceiling=capacity?.maxOutputTokens??Infinity;
    if(ceiling!==Infinity&&(!Number.isSafeInteger(ceiling)||ceiling<1))throw Error('Invalid provider output capacity');
    const highWaterMark=config.highWaterMark??0.95;
    if(!Number.isFinite(highWaterMark)||highWaterMark<=0||highWaterMark>1)throw Error('Invalid context high-water mark');
    this.contextWindow=window;
    this.output=Math.min(output,ceiling,window-128);
    this.reserve=this.output+Math.min(system,window-128-this.output);
    this.highWaterMark=highWaterMark;
  }

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
