/**
 * Deterministic multi-agent workflows (Restate "Dynamic Workflows" pattern,
 * compressed): the model writes a small async function; every awaited
 * task("prompt") runs as a subagent and is journaled as
 *   stepHash = sha1(codeHash | prevStepHash | prompt)
 * Re-running identical code replays recorded results from the journal instead
 * of the model — orchestration becomes a pure function of the journal.
 *
 * Honest limits: replay memoizes identical prompts strictly in order, so
 * workflow code must be deterministic in structure (no Date/random-driven
 * branching around task calls). Side effects outside task() are NOT
 * journaled.
 *
 * The code runs via new AsyncFunction in this process — same trust as any
 * tool execution.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface WorkflowArgs {
  code: string;
}

interface JournalEntry {
  stepHash: string;
  prompt: string;
  result: string;
}

interface WorkflowContext {
  cwd: string;
  request<T = unknown>(service: string, payload: unknown): Promise<T>;
}

const sha1 = (s: string): string => createHash("sha1").update(s).digest("hex");
const WORKFLOW_TIMEOUT_MS = 300_000;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...argNames: string[]
) => (...args: unknown[]) => Promise<unknown>;

function journalPathFor(cwd: string, codeHash: string): string {
  return path.join(cwd, ".agent-compositor", "workflows", codeHash, "journal.json");
}

async function readJournal(file: string): Promise<JournalEntry[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as JournalEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const workflowTool = {
  name: "workflow",
  description:
    "Run a deterministic multi-agent workflow. Provide a small async JS function body; inside it, " +
    "await task('self-contained prompt') to run subagents — results are journaled, and an identical " +
    "re-run replays them without calling the model. Return the workflow's final value. " +
    "Keep the structure deterministic: task() calls must happen in a fixed order.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "async function body. Available: task(prompt) → subagent result (string); log(...args) → progress note. Return the final value.",
      },
    },
    required: ["code"],
  },
  describe: () => ({ tool: "workflow" }),
  async execute(ctx: WorkflowContext, rawArgs: unknown) {
    const args = rawArgs as WorkflowArgs;
    if (!args.code || typeof args.code !== "string") return { ok: false, error: "workflow: code is required" };

    const codeHash = sha1(args.code);
    const journalFile = journalPathFor(ctx.cwd, codeHash);
    const journal = await readJournal(journalFile);

    // `steps` is the growing final journal; `cursor` walks the loaded one.
    // prevHash always chains from codeHash — replay walks the same path the
    // original run did, one entry at a time.
    const steps: JournalEntry[] = [...journal];
    let cursor = 0;
    let prevHash = codeHash;
    let replayed = 0;
    let ran = 0;

    const task = async (prompt: string): Promise<string> => {
      if (typeof prompt !== "string" || !prompt.trim()) throw new Error("task(prompt): prompt must be a non-empty string");
      const stepHash = sha1(`${codeHash}|${prevHash}|${prompt}`);
      const candidate = cursor < journal.length ? journal[cursor] : undefined;
      if (candidate && candidate.stepHash === stepHash) {
        // exact-order replay hit: no model call, no subagent
        cursor++;
        replayed++;
        prevHash = candidate.stepHash;
        return candidate.result;
      }
      const spawned = await ctx.request<{ output: string }>("service.agent.spawn", {
        prompt,
        agentId: `wf-${codeHash.slice(0, 8)}-${steps.length}`,
      });
      const entry: JournalEntry = { stepHash, prompt, result: spawned.output };
      steps.push(entry);
      prevHash = entry.stepHash;
      ran++;
      await fs.mkdir(path.dirname(journalFile), { recursive: true });
      await fs.writeFile(journalFile, JSON.stringify(steps, null, 2), "utf8");
      return spawned.output;
    };

    const logs: string[] = [];
    const log = (...parts: unknown[]): void => {
      logs.push(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" "));
    };

    let output: unknown;
    let error: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fn = new AsyncFunction("task", "log", args.code) as (task: unknown, log: unknown) => Promise<unknown>;
      output = await Promise.race([
        fn(task, log),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`workflow timed out after ${WORKFLOW_TIMEOUT_MS / 1000}s`)),
            WORKFLOW_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (error !== undefined) return { ok: false, error: `workflow: ${error}` };
    return { ok: true, data: { output, steps: steps.length, replayed, ran, logs } };
  },
};

export default [workflowTool];
