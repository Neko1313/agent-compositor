import { describe, expect, it } from "vitest";
import { Runtime } from "../src/index.js";
import type { PluginManifest } from "../src/index.js";
import { ChainTrace } from "../src/trace.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function manifest(name: string, trust: PluginManifest["trust"] = "trusted"): PluginManifest {
  return { name, version: "0.1.0", trust };
}

const toolCallInput = { tool: "Bash", input: { command: "ls" }, callId: "c1" };

async function emitAll(r: Runtime, event: string, input: unknown) {
  const yields: unknown[] = [];
  const gen = r.emit(event, input);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const step = await gen.next();
    if (step.done) return { value: step.value as { value: unknown; faults: unknown[] }, yields };
    yields.push(step.value);
  }
}

describe("Runtime", () => {
  it("selects a replaceable provider while preserving guard hooks", async () => {
    const r = new Runtime({ providers: { "service.project.query": "replacement" } });
    let oldCalls = 0, guards = 0;
    r.register({ ...manifest("callix"), provides: ["service.project.query"] }, { "service.project.query": () => { oldCalls++; return { value: "old" }; } });
    r.register({ ...manifest("replacement"), provides: ["service.project.query"] }, { "service.project.query": () => ({ value: "new" }) });
    r.register(manifest("guard"), { "service.project.query": () => { guards++; } }, "prepend");
    expect((await emitAll(r, "service.project.query", { cwd: ".", action: "status" })).value.value).toEqual({ value: "new" });
    expect(oldCalls).toBe(0); expect(guards).toBe(1);
    const missing = new Runtime({ providers: { "service.project.query": "missing" } });
    missing.register({ ...manifest("callix"), provides: ["service.project.query"] }, { "service.project.query": () => ({ value: "wrong" }) });
    await expect(emitAll(missing, "service.project.query", { cwd: ".", action: "status" })).rejects.toThrow("Selected provider");
  });

  it("applies declared timeouts to trusted provider hooks", async () => {
    const r = new Runtime();
    r.register({ ...manifest("provider"), hookTimeouts: { "service.project.query": 20 } }, {
      "service.project.query": async (_event, ctx) => {
        await new Promise<void>(done => ctx.signal.addEventListener("abort", () => done(), { once: true }));
        return { deny: "provider cancelled" };
      },
    });
    const result=await emitAll(r,"service.project.query",{cwd:".",action:"status"});
    expect(result.value.faults).toMatchObject([{plugin:"provider"}]);
    expect((result.value.faults[0] as any).kind).toMatch(/^(own|thread)-budget$/);
  });

  it("returns input unchanged when no hooks are registered", async () => {
    const r = new Runtime();
    const { value, yields } = await emitAll(r, "tool.call", toolCallInput);
    expect(value.value).toEqual(toolCallInput);
    expect(yields).toEqual([]);
  });

  it("throws on unknown event and invalid input", async () => {
    const r = new Runtime();
    await expect(emitAll(r, "nope.nada", {})).rejects.toThrow(/unknown event/);
    await expect(emitAll(r, "tool.call", { nope: 1 })).rejects.toThrow();
  });

  it("orders hooks by tier, stable within a tier", async () => {
    const order: string[] = [];
    const r = new Runtime();
    const seen = (p: string) => () => {
      order.push(p);
      return undefined;
    };
    r.register(manifest("b"), { "tool.call": seen("b") }, "append");
    r.register(manifest("p"), { "tool.call": seen("p") }, "prepend");
    r.register(manifest("a"), { "tool.call": seen("a") }, "user");
    r.register(manifest("q"), { "tool.call": seen("q") }, "prepend");
    await emitAll(r, "tool.call", toolCallInput);
    expect(order).toEqual(["p", "q", "a", "b"]);
  });

  it("rewrites the event via next(e); later hooks see the rewrite", async () => {
    const r = new Runtime();
    const seen: unknown[] = [];
    r.register(manifest("rewrite"), {
      "tool.call": (_e: unknown, ctx: { next: (e?: unknown) => unknown }) =>
        ctx.next({ ...toolCallInput, callId: "rewritten" }),
    });
    r.register(manifest("spy"), {
      "tool.call": (e: unknown) => {
        seen.push(e);
        return undefined;
      },
    });
    const { value } = await emitAll(r, "tool.call", toolCallInput);
    expect(seen[0]).toMatchObject({ callId: "rewritten" });
    expect(value.value).toMatchObject({ callId: "rewritten" });
  });

  it("terminal response short-circuits the chain", async () => {
    const r = new Runtime();
    let called = false;
    r.register(manifest("denier"), {
      "tool.call": () => ({ deny: "not today" }),
    });
    r.register(manifest("later"), {
      "tool.call": () => {
        called = true;
        return undefined;
      },
    });
    const { value } = await emitAll(r, "tool.call", toolCallInput);
    expect(value.value).toEqual({ deny: "not today" });
    expect(called).toBe(false);
  });

  it("streams generator-hook yields in order, returns the return value", async () => {
    const r = new Runtime();
    r.register(manifest("gen"), {
      "turn.step": async function* () {
        yield { step: 1 };
        yield { step: 2 };
        return undefined; // pass through
      },
    });
    const { value, yields } = await emitAll(r, "turn.step", { turnId: "t1" });
    expect(yields).toEqual([{ step: 1 }, { step: 2 }]);
    expect(value.value).toEqual({ turnId: "t1" });
  });

  it("fail-operational: a thrown error is recorded and the chain continues", async () => {
    const r = new Runtime();
    const seen: string[] = [];
    r.register(manifest("boom"), {
      "tool.call": () => {
        throw new Error("kaboom");
      },
    });
    r.register(manifest("after"), {
      "tool.call": (e: { tool: string }) => {
        seen.push(e.tool);
        return undefined;
      },
    });
    const { value, yields } = await emitAll(r, "tool.call", toolCallInput);
    expect(seen).toEqual(["Bash"]);
    expect(value.faults).toMatchObject([{ plugin: "boom", kind: "error", message: "kaboom" }]);
    expect(yields).toEqual([]);
  });

  it("thread budget: slow hook is aborted, chain continues with original input", async () => {
    const r = new Runtime();
    const h = {
      "tool.call": async (_e: unknown, ctx: { signal: AbortSignal }) => {
        await sleep(60);
        if (ctx.signal.aborted) throw new Error("aborted");
        return { deny: "never reached" };
      },
    };
    // shrink the budget through the internals? budgets are per-hook defaults; simulate by overriding after register
    r.register(manifest("slow"), h);
    for (const hook of (r as unknown as { hooks: { budget: { threadMs: number } }[] }).hooks) hook.budget.threadMs = 20;
    const { value } = await emitAll(r, "tool.call", toolCallInput);
    expect(value.value).toEqual(toolCallInput);
    expect(value.faults).toMatchObject([{ plugin: "slow", kind: "thread-budget" }]);
  });

  it("own budget: time spent awaiting next() is not own time", async () => {
    const r = new Runtime();
    r.register(manifest("caller"), {
      "tool.call": (_e: unknown, ctx: { next: (e?: unknown) => unknown }) => ctx.next(),
    });
    r.register(manifest("slow-next"), {
      "tool.call": async () => {
        await sleep(40);
        return undefined;
      },
    });
    // caller waits ~40ms on next() — own time must stay tiny
    // only the caller's own-time budget is tightened; it awaits next() ~40ms,
    // which must NOT count as its own time. slow-next keeps default budgets.
    const caller = (r as unknown as { hooks: { plugin: string; budget: { ownMs: number; threadMs: number } }[] }).hooks.find(
      (h) => h.plugin === "caller",
    )!;
    caller.budget.ownMs = 1;
    caller.budget.threadMs = 500;
    const { value } = await emitAll(r, "tool.call", toolCallInput);
    expect(value.value).toEqual(toolCallInput);
    expect(value.faults.filter((f) => (f as { plugin: string }).plugin === "caller")).toEqual([]);
  });

  it("yield budget: generator silent for too long is faulted", async () => {
    const r = new Runtime();
    r.register(manifest("silent"), {
      "turn.step": async function* () {
        yield { once: true };
        await sleep(50);
        yield { tooLate: true };
        return undefined;
      },
    });
    for (const hook of (r as unknown as { hooks: { budget: { yieldMs: number; threadMs: number } }[] }).hooks) {
      hook.budget.yieldMs = 10;
      hook.budget.threadMs = 500;
    }
    const { value, yields } = await emitAll(r, "turn.step", { turnId: "t1" });
    expect(yields).toEqual([{ once: true }]);
    expect(value.faults).toMatchObject([{ plugin: "silent", kind: "yield-budget" }]);
    expect(value.value).toEqual({ turnId: "t1" }); // fail-operational
  });

  it("invalid response form is faulted, chain continues", async () => {
    const r = new Runtime();
    r.register(manifest("bad"), {
      "tool.call": () => ({ bogus: true }),
    });
    const { value } = await emitAll(r, "tool.call", toolCallInput);
    expect(value.faults).toMatchObject([{ plugin: "bad", kind: "invalid-response" }]);
    expect(value.value).toEqual(toolCallInput);
  });

  it("registering hooks by alias resolves to the canonical event", async () => {
    const r = new Runtime();
    let fired = "";
    r.register(manifest("legacy"), {
      "classic.PreToolUse": () => {
        fired = "alias";
        return undefined;
      },
    });
    await emitAll(r, "tool.call", toolCallInput);
    expect(fired).toBe("alias");
  });

  it("render-only plugins may hook ui.* but not core events", () => {
    const r = new Runtime();
    r.register(manifest("widget", "render-only"), {
      "ui.render": () => ({ tree: null }),
    });
    expect(() =>
      r.register(manifest("evil", "render-only"), { "tool.call": () => undefined }),
    ).toThrow(/render-only/);
  });

  it("duplicate plugin name and duplicate hook are rejected", () => {
    const r = new Runtime();
    r.register(manifest("dup"), { "tool.call": () => undefined });
    expect(() => r.register(manifest("dup"), {})).toThrow(/already registered/);
    expect(() => r.register(manifest("two"), { "tool.call": () => undefined, "classic.PreToolUse": () => undefined })).toThrow(
      /duplicate hook/,
    );
  });

  it("unregister removes hooks; reload works", async () => {
    const r = new Runtime();
    r.register(manifest("temp"), { "tool.call": () => ({ deny: "old" }) });
    expect(r.unregister("temp")).toBe(true);
    const { value } = await emitAll(r, "tool.call", toolCallInput);
    expect(value.value).toEqual(toolCallInput);
    expect(r.unregister("temp")).toBe(false);
  });

  it("writes chain-trace entries with phases", async () => {
    const trace = new ChainTrace();
    const r = new Runtime({ trace: (e) => trace.write(e) });
    r.register(manifest("traced"), { "tool.call": () => ({ result: 42 }) });
    await emitAll(r, "tool.call", toolCallInput);
    const phases = trace.entries.map((e) => e.phase);
    expect(phases).toContain("enter");
    expect(phases).toContain("exit");
    expect(phases).toContain("result");
    const exit = trace.entries.find((e) => e.phase === "exit");
    expect(exit).toMatchObject({ plugin: "traced", detail: "response:result" });
  });
});
