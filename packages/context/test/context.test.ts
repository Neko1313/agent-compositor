import { describe, expect, it } from "vitest";
import { compactTranscript, type MessageLike } from "../src/index.js";
import { estimateTokens, TokenBudget } from "../src/index.js";

const msg = (role: string, content: string): MessageLike => ({ role, content });
const longText = (words: number) => Array.from({ length: words }, (_, i) => `w${i}`).join(" ");

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("TokenBudget", () => {
  it("carves the reserve out of the window before measuring", () => {
    const budget = new TokenBudget({ contextWindow: 100_000, reserveOutput: 8_192, reserveSystem: 2_048 });
    expect(budget.usable).toBe(89_760);
    expect(budget.breakdown().pressure).toBe(0);
  });

  it("measures pressure as used/usable and trips at the high-water mark", () => {
    const budget = new TokenBudget({ contextWindow: 10_000, reserveOutput: 2_000, reserveSystem: 0, highWaterMark: 0.9 });
    // usable = 8000; 90% = 7200 tokens ≈ 28_800 chars
    budget.setMessages([msg("user", longText(30_000))]);
    expect(budget.used).toBeGreaterThan(7_000);
    expect(budget.shouldCompact()).toBe(true);
  });

  it("does not compact when under pressure", () => {
    const budget = new TokenBudget({ contextWindow: 100_000 });
    budget.setMessages([msg("user", "short prompt")]);
    expect(budget.shouldCompact()).toBe(false);
  });

  it("monotonic: adding messages never reduces usage", () => {
    const budget = new TokenBudget({ contextWindow: 100_000 });
    budget.setMessages([msg("user", "a")]);
    const before = budget.used;
    budget.addMessage(msg("assistant", "b"));
    expect(budget.used).toBeGreaterThan(before);
  });
});

describe("compactTranscript", () => {
  const transcript = (): MessageLike[] => [
    msg("system", "You are a helpful agent."),
    msg("user", "first question"),
    msg("assistant", "first answer with some detail about the project structure"),
    msg("user", "follow-up about auth"),
    msg("assistant", "auth answer"),
    msg("user", "now about logging"),
    msg("assistant", "logging answer"),
    msg("user", "current question"),
    msg("assistant", "current answer"),
  ];

  const summarize = async (messages: MessageLike[]) =>
    `Folded ${messages.length} messages: ` + messages.map((m) => m.content.slice(0, 20)).join(" | ");

  it("keeps system + tail verbatim, folds the middle into a summary message", async () => {
    const result = await compactTranscript(transcript(), summarize, { keepTail: 4 });
    expect(result.foldedCount).toBeGreaterThan(0);
    expect(result.messages[0]).toMatchObject({ role: "system", content: "You are a helpful agent." });
    const summaryMsg = result.messages[1];
    expect(summaryMsg.role).toBe("system");
    expect(summaryMsg.content).toContain("Summary of earlier conversation:");
    expect(summaryMsg.content).toContain("first question");
    // tail preserved verbatim, ending with the current exchange
    expect(result.messages.at(-2)).toMatchObject({ content: "current question" });
    expect(result.messages.at(-1)).toMatchObject({ content: "current answer" });
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it("returns the transcript untouched when there is no middle to fold", async () => {
    const tiny: MessageLike[] = [msg("system", "sys"), msg("user", "hi")];
    const result = await compactTranscript(tiny, summarize);
    expect(result.foldedCount).toBe(0);
    expect(result.messages).toEqual(tiny);
  });

  it("preserves all original messages when the summarizer fails", async () => {
    const boom = async () => {
      throw new Error("model down");
    };
    const result = await compactTranscript(transcript(), boom, { keepTail: 2 });
    expect(result.messages).toEqual(transcript());
    expect(result.foldedCount).toBe(0);
    expect(result.failure).toContain("model down");
    expect(result.messages.at(-1)).toMatchObject({ content: "current answer" });
  });
});

it('folds an oversized newest tool group while pinning the original user task verbatim',async()=>{
 const task=msg('user','Analyze the export; preserve the exact fee and validation requirements.');
 const call={...msg('assistant',''),toolCalls:[{name:'read',args:{path:'export.json'}}]};
 const result=msg('tool','x'.repeat(30000));let folded:MessageLike[]=[];
 const compacted=await compactTranscript([msg('system','System instructions'),task,call,result],async messages=>{folded=messages;return'Export was read successfully. Continue analysis.';},{keepTail:1,maxTailTokens:1000,preserveLastUser:true});
 expect(compacted.failure).toBeUndefined();expect(compacted.foldedCount).toBe(2);expect(folded).toEqual([call,result]);
 expect(compacted.messages.at(-1)).toBe(task);expect(compacted.messages.some(m=>m.role==='tool'||m.toolCalls?.length)).toBe(false);
 expect(compacted.tokensAfter).toBeLessThan(1000);
});
it('retains a fitting recent group intact and leaves the transcript untouched on summary failure',async()=>{
 const task=msg('user','Original task'),call={...msg('assistant',''),toolCalls:[{name:'read',args:{path:'recent'}}]},result=msg('tool','recent result');
 const messages=[task,msg('assistant','x'.repeat(5000)),msg('user','Latest task'),call,result];
 const success=await compactTranscript(messages,async()=> 'Earlier progress',{keepTail:1,maxTailTokens:1000,preserveLastUser:true});
 expect(success.messages.slice(-3)).toEqual(messages.slice(-3));
 const failed=await compactTranscript(messages,async()=>{throw Error('Summary unavailable');},{keepTail:1,maxTailTokens:0,preserveLastUser:true});
 expect(failed.messages).toBe(messages);expect(failed.foldedCount).toBe(0);expect(failed.failure).toContain('Summary unavailable');
});

it('packs ASCII and Unicode summary segments by estimated tokens, not tiny character slices',async()=>{
 const {summarizeChunks}=await import('../src/index.js');
 for(const content of ['a'.repeat(6000),'日本語😀'.repeat(1000)]){
  const requests:string[]=[];
  const summary=await summarizeChunks([msg('tool',content)],async text=>{requests.push(text);return'Short progress note';},2048);
  expect(summary).toContain('Short progress note');
  expect(requests.every(text=>estimateTokens(text)<=2048)).toBe(true);
  expect(requests.every(text=>!text.includes('\uFFFD'))).toBe(true);
  if(content.startsWith('a'))expect(requests).toHaveLength(1);
 }
});
