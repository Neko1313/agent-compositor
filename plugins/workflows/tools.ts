/**
 * Deterministic multi-agent workflows (Restate "Dynamic Workflows" pattern,
 * compressed): the model writes a Python snippet; every awaited
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
 * Code runs through the selected sandbox provider. Only task/log host
 * capabilities are supplied. JavaScript journals are preserved, not executed.
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
  stateDir?: string;
  request<T = unknown>(service: string, payload: unknown): Promise<T>;
}

const sha1 = (s: string): string => createHash("sha1").update(s).digest("hex");
const WORKFLOW_TIMEOUT_MS = 300_000;

function journalPathFor(cwd: string, codeHash: string): string {
  return path.join(
    cwd,
    ".agent-compositor",
    "workflows",
    codeHash,
    "journal.json"
  );
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
    "Run a deterministic multi-agent workflow in the configured Python sandbox. Provide Python source; inside it, " +
    "await task('self-contained prompt') to run subagents — results are journaled, and an identical " +
    "re-run replays them without calling the model. The final expression is the workflow result. " +
    "Keep the structure deterministic: task() calls must happen in a fixed order.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "Python source. Available: await task(prompt) returns a subagent result; await log(message) records progress. End with the result expression. Example: a = await task('inspect files')\na",
      },
    },
    required: ["code"],
  },
  describe: () => ({ tool: "workflow" }),
  async execute(ctx: WorkflowContext, rawArgs: unknown) {
    const args = rawArgs as WorkflowArgs;
    if (!args.code || typeof args.code !== "string")
      return { ok: false, error: "workflow: code is required" };

    const codeHash = sha1("python-v1\0" + args.code);
    const journalFile = ctx.stateDir
      ? path.join(ctx.stateDir, "workflows", codeHash, "journal.json")
      : journalPathFor(ctx.cwd, codeHash);
    await fs.mkdir(path.dirname(journalFile), { recursive: true });
    await fs.writeFile(
      path.join(path.dirname(journalFile), "code.py"),
      args.code,
      "utf8"
    );
    const journal = await readJournal(journalFile);

    // `steps` is the growing final journal; `cursor` walks the loaded one.
    // prevHash always chains from codeHash — replay walks the same path the
    // original run did, one entry at a time.
    const steps: JournalEntry[] = [];
    let cursor = 0;
    let prevHash = codeHash;
    let replayed = 0;
    let ran = 0;
    let taskRunning = false;

    const task = async (
      prompt: string,
      signal: AbortSignal
    ): Promise<string> => {
      signal.throwIfAborted();
      if (typeof prompt !== "string" || !prompt.trim())
        throw new Error("task(prompt): prompt must be a non-empty string");
      const stepHash = sha1(`${codeHash}|${prevHash}|${prompt}`);
      const candidate = cursor < journal.length ? journal[cursor] : undefined;
      if (candidate && candidate.stepHash === stepHash) {
        // exact-order replay hit: no model call, no subagent
        cursor++;
        replayed++;
        prevHash = candidate.stepHash;
        steps.push(candidate);
        return candidate.result;
      }
      const spawned = await ctx.request<{ output: string }>(
        "service.agent.spawn",
        {
          prompt,
          agentId: `wf-${codeHash.slice(0, 8)}-${steps.length}`,
          signal,
        }
      );
      signal.throwIfAborted();
      const entry: JournalEntry = { stepHash, prompt, result: spawned.output };
      steps.push(entry);
      prevHash = entry.stepHash;
      ran++;
      await fs.mkdir(path.dirname(journalFile), { recursive: true });
      await fs.writeFile(
        journalFile + ".tmp",
        JSON.stringify(steps, null, 2),
        "utf8"
      );
      await fs.rename(journalFile + ".tmp", journalFile);
      return spawned.output;
    };

    const logs: string[] = [];
    const log = (...parts: unknown[]): void => {
      logs.push(
        parts
          .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
          .join(" ")
      );
    };

    let output: unknown;
    let error: string | undefined;
    try {
      const result = await ctx.request<{ output: unknown; stdout: string }>(
        "service.sandbox.run",
        {
          language: "python",
          code: args.code,
          timeoutMs: WORKFLOW_TIMEOUT_MS,
          functions: {
            task: async (args: unknown[], signal: AbortSignal) => {
              if (args.length !== 1 || typeof args[0] !== "string")
                throw new Error("task expects one prompt string");
              if (taskRunning)
                throw new Error("Workflow tasks must be awaited sequentially");
              taskRunning = true;
              try {
                return await task(args[0], signal);
              } finally {
                taskRunning = false;
              }
            },
            log: async (args: unknown[]) => {
              if (logs.length >= 100)
                throw new Error("workflow log limit reached");
              log(...args);
            },
          },
        }
      );
      output = result.output;
      if (result.stdout) logs.push(result.stdout.slice(0, 64000));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (error !== undefined) return { ok: false, error: `workflow: ${error}` };
    return {
      ok: true,
      data: { output, steps: steps.length, replayed, ran, logs },
    };
  },
};



export const workflowRunTool = {
  name:'workflow_run',
  description:'Start and manage a persistent background workflow with named dependency stages. Independent ready stages run concurrently (1..8). Use expand on a discovery stage to create workers from its JSON array; downstream stages join those workers. Outputs feed dependent prompts as data. Start returns a run ID immediately; use status (optionally waitMs) to observe, pause to stop scheduling, retry a failed stage, resume or stop. Completed stages are retained after restart; interrupted work requires explicit resume and may repeat side effects.',
  parameters:{type:'object',properties:{action:{enum:['start','list','status','pause','resume','retry','stop']},id:{type:'string'},stageId:{type:'string'},title:{type:'string'},concurrency:{type:'integer',minimum:1,maximum:8},maxStages:{type:'integer',minimum:1,maximum:500},maxTokensPerStage:{type:'integer',minimum:100,maximum:1000000},stageTimeoutMs:{type:'integer',minimum:1000,maximum:3600000},waitMs:{type:'integer',minimum:0,maximum:30000},stages:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},prompt:{type:'string'},dependsOn:{type:'array',items:{type:'string'}},profile:{type:'string'},expand:{type:'boolean'},workerPrompt:{type:'string'},when:{type:'object',properties:{stage:{type:'string'},includes:{type:'string'}},required:['stage','includes']}},required:['id','prompt']}}},required:['action']},
  describe:()=>({tool:'workflow_run'}),
  async execute(ctx:any,args:any){
    try{
      return{ok:true,data:await ctx.request('service.workflow.run',args)};
    }catch(e){return{ok:false,error:e instanceof Error?e.message:String(e)};}
  },
};

export default [workflowTool,workflowRunTool];
