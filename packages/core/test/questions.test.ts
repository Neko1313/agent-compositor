import { describe, it, expect, vi } from "vitest";
import { AgentCore, ScriptedProvider } from "../src/index.js";
const form = {
  title: "Setup",
  questions: [
    {
      id: "target",
      question: "Target?",
      options: ["Stage", "Production"],
      allowOther: false,
    },
  ],
};
describe("questionnaire agent tool", () => {
  it.each([
    ["headless", undefined, "headless"],
    ["missing answers", async () => ({ answers: [] }), "Answer every question"],
    [
      "invalid option",
      async () => ({ answers: [{ id: "target", selected: ["Invented"] }] }),
      "Invalid selected option",
    ],
    [
      "cancelled",
      async () => {
        throw Error("Cancelled by user");
      },
      "Cancelled by user",
    ],
  ] as const)(
    "returns a tool error and permits recovery when %s",
    async (_reason, onAsk, error) => {
      const provider = new ScriptedProvider([
        { toolCalls: [{ name: "ask_questions", args: form }] },
        { text: "Recovered" },
      ]);
      const approve = vi.fn();
      const core = new AgentCore({
        cwd: process.cwd(),
        provider,
        onAsk,
        onApproval: approve,
      });
      await core.submit("Set up");
      expect(
        core.getMessages().find((m) => m.role === "tool")?.content,
      ).toContain(error);
      expect(core.getMessages().at(-1)?.content).toBe("Recovered");
      expect(approve).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate question IDs before requesting human input", async () => {
    const onAsk = vi.fn();
    const provider = new ScriptedProvider([
      {
        toolCalls: [
          {
            name: "ask_questions",
            args: { questions: [...form.questions, ...form.questions] },
          },
        ],
      },
      { text: "Recovered" },
    ]);
    const core = new AgentCore({ cwd: process.cwd(), provider, onAsk });
    await core.submit("Set up");
    expect(onAsk).not.toHaveBeenCalled();
    expect(
      core.getMessages().find((m) => m.role === "tool")?.content,
    ).toContain("unique");
  });
  it("forwards the active abort signal to a questionnaire", async () => {
    let signal: AbortSignal | undefined;
    const onAsk = vi.fn(async (req) => {
      signal = req.signal;
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(Error("Interrupted")), {
          once: true,
        }),
      );
      return { answers: [] };
    });
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "ask_questions", args: form }] },
    ]);
    const core = new AgentCore({ cwd: process.cwd(), provider, onAsk });
    const run = core.submit("Set up");
    await vi.waitFor(() => expect(onAsk).toHaveBeenCalledOnce());
    core.interrupt();
    await run;
    expect(signal?.aborted).toBe(true);
    expect(core.getState()).not.toBe("running");
  });
});
