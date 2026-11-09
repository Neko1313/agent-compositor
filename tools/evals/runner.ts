import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../packages/app/src/build.js";
import {
  ScriptedProvider,
  type ScriptedStep,
} from "../../packages/core/src/provider.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
export interface EvalCase {
  id: string;
  split?: string;
  prompt: string;
  files: Record<string, string>;
  rules?: any[];
  expect: any;
  script?: ScriptedStep[];
}
export async function runCase(
  test: EvalCase,
  options: {
    model: string;
    timeoutMs?: number;
    baseUrl?: string;
    harness?: string;
  }
) {
  const temp = await mkdtemp(join(tmpdir(), "compositor-eval-")),
    cwd = join(temp, "project"),
    home = join(temp, "home");
  await mkdir(cwd, { recursive: true });
  await mkdir(home);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const events: any[] = [],
    checks: { name: string; ok: boolean; detail?: string }[] = [];
  let requests = 0,
    error: string | undefined,
    answer = "";
  const started = Date.now();
  try {
    for (const [file, text] of Object.entries(test.files)) {
      if (file.includes("..") || file.startsWith("/"))
        throw Error("Invalid fixture path");
      await mkdir(dirname(join(cwd, file)), { recursive: true });
      await writeFile(join(cwd, file), text);
    }
    await writeFile(
      join(cwd, "agent-compositor.json"),
      JSON.stringify({
        permissions: {
          rules: [
            { tool: "write", path: cwd + "/**", decision: "allow" },
            { tool: "edit", path: cwd + "/**", decision: "allow" },
            ...(test.rules ?? []).map((rule) => ({
              ...rule,
              ...(rule.path?.startsWith("**/")
                ? { path: join(cwd, rule.path.slice(3)) }
                : {}),
            })),
          ],
        },
        compaction: { enabled: false },
      })
    );
    const provider =
      options.model === "scripted"
        ? new ScriptedProvider(test.script ?? [])
        : undefined;
    const system = options.harness
      ? await readFile(options.harness, "utf8")
      : undefined;
    app = await buildApp({
      cwd,
      env: {
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        AGENT_BASE_URL:
          options.baseUrl ??
          process.env.AGENT_EVAL_BASE_URL ??
          "http://127.0.0.1:11434/v1",
        AGENT_MODEL: options.model,
      },
      provider,
      systemPrompt: system,
      maxSteps: test.expect.grader ? 24 : 8,
      maxTokensPerTurn: test.expect.grader ? 80000 : 12000,
      agentHub: false,
      pluginDirs: [
        "todos",
        "guard-secrets",
        "guard-scope",
        "plan-mode",
        "network-proxy",
        ...(test.expect.grader?["callix"]:[]),
      ].map((p) => join(root, "plugins", p)),
    });
    if (app.pluginErrors.length) throw Error(JSON.stringify(app.pluginErrors));
    const core = app.createCore(async () => false);
    core.subscribe((e) => events.push(e));
    const timeout = setTimeout(
      () => core.interrupt(),
      options.timeoutMs ?? 120000
    );
    timeout.unref();
    try {
      await core.start();
      await core.submit(test.prompt);
    } finally {
      clearTimeout(timeout);
    }
    error =
      core.failure ??
      (core.getState() === "interrupted"
        ? "Eval deadline exceeded"
        : undefined);
    answer =
      [...core.getMessages()].reverse().find((m) => m.role === "assistant")
        ?.content ?? "";
    requests =
      provider?.requests.length ??
      events.filter((e) => e.kind === "catalog" && e.event === "turn.step")
        .length;
    const exp = test.expect;
    if (exp.responseIncludes)
      checks.push({
        name: "evidence answer",
        ok: answer.includes(exp.responseIncludes),
      });
    for (const tool of exp.tools ?? [])
      checks.push({
        name: `tool used: ${tool}`,
        ok: events.some(
          (e) =>
            e.kind === "catalog" &&
            e.event === "tool.call" &&
            e.input.tool === tool
        ),
      });
    if (exp.file) {
      const contents = await readFile(join(cwd, exp.file), "utf8").catch(
        () => undefined
      );
      checks.push({
        name: "file result",
        ok:
          exp.exact !== undefined
            ? contents === exp.exact
            : !!contents?.includes(exp.contains),
      });
    }
    if (exp.todos) {
      const tasks = JSON.parse(
        await readFile(
          join(app.storage.paths.state, "todos.json"),
          "utf8"
        ).catch(() => "null")
      );
      checks.push({
        name: "persisted todos",
        ok: JSON.stringify(tasks) === JSON.stringify(exp.todos),
      });
    }
    if (exp.deniedTool)
      checks.push({
        name: "policy denied actual tool call",
        ok: events.some(
          (e) =>
            e.kind === "catalog" &&
            e.event === "tool.result" &&
            e.input.tool === exp.deniedTool &&
            e.input.ok === false
        ),
      });
    if(exp.grader){
      // Graders live outside the agent workspace and are never sent to the model.
      // Run only trusted suite-authored JS, with an explicit bounded subprocess.
      const grader=join(temp,'grader.cjs');await writeFile(grader,exp.grader);
      try{await promisify(execFile)(process.execPath,[grader,cwd],{timeout:10000,maxBuffer:64000});checks.push({name:'held-out behavioral grader',ok:true});}
      catch(e){checks.push({name:'held-out behavioral grader',ok:false,detail:String(e).slice(0,1000)});}
    }
    if(exp.verification){
      checks.push({name:'agent executed verification successfully',ok:events.some(e=>e.kind==='catalog'&&e.event==='tool.result'&&e.input.tool==='exec'&&e.input.ok&&e.input.output?.exitCode===0&&String(e.input.output?.stdout??'').includes(exp.verification))});
    }
    if (exp.noModelCalls)
      checks.push({ name: "blocked before model", ok: requests === 0 });
  } catch (e) {
    error = String(e);
  } finally {
    await app?.close();
    await rm(temp, { recursive: true, force: true });
  }
  const usage = events
    .filter((e) => e.kind === "catalog" && e.event === "turn.usage")
    .reduce(
      (sum, e) => ({
        input: sum.input + Number(e.input.inputTokens ?? 0),
        output: sum.output + Number(e.input.outputTokens ?? 0),
      }),
      { input: 0, output: 0 }
    );
  return {
    id: test.id,
    split: test.split,
    model: options.model,
    ok: !error && checks.length > 0 && checks.every((c) => c.ok),
    checks,
    error,
    response: answer,
    requests,
    usage,
    durationMs: Date.now() - started,
    trajectory: events,
  };
}
