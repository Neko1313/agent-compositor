import {builtinTools} from '../../packages/tools/src/index.js';
import {evaluationEnvironmentOverlay} from './environment.js';
import {gradeProject} from './grading.js';
import {permissionDiagnostics} from './permission-diagnostics.js';
import {estimateTokens} from "../../packages/context/src/index.js";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../packages/app/src/build.js";
import {
  ScriptedProvider,
  type ScriptedStep,
  type ModelProvider,
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
  navigationMode?:"semantic"|"text";
  system?:string;
}
export async function runCase(
  test: EvalCase,
  options: {
    model: string;
    provider?: ModelProvider;
    timeoutMs?: number;
    baseUrl?: string;
    harness?: string;
    tools?: string[];
    agentHarness?: boolean;
    instructionsPreset?: "general"|"coding";
    fileReferences?: boolean;
  }
) {
  const useCallix=!!(test.expect.grader||test.navigationMode||options.tools?.some(name=>['glob','grep','code_query'].includes(name)));
  const temp = await mkdtemp(join(tmpdir(), "compositor-eval-")),
    cwd = join(temp, "project"),
    home = join(temp, "home");
  await mkdir(cwd, { recursive: true });
  await mkdir(home);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const events: any[] = [],
    checks: { name: string; ok: boolean; detail?: string }[] = [];
  let transcript:any[]=[],schemaTokens=0;
  let requests = 0,
    error: string | undefined,
    answer = "";
  const started = Date.now();
  try {
    if(options.instructionsPreset==='coding'&&!options.agentHarness)
      throw Error('Coding instructions preset requires agentHarness: true; otherwise its policy is not active');
    for (const [file, text] of Object.entries(test.files)) {
      if (file.includes("..") || file.startsWith("/"))
        throw Error("Invalid fixture path");
      await mkdir(dirname(join(cwd, file)), { recursive: true });
      await writeFile(join(cwd, file), text);
    }
    await writeFile(
      join(cwd, "agent-compositor.json"),
      JSON.stringify({
        enabledPlugins:['todos','guard-secrets','guard-scope','plan-mode','network-proxy',...(options.agentHarness?['agent-harness']:[]),...(useCallix?['callix']:[])],
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
        ...((options.tools||options.instructionsPreset||options.fileReferences!==undefined)?{agent:{...(options.tools?{tools:options.tools,builtinTools:options.tools.filter(name=>builtinTools.some(tool=>tool.name===name)),controlTools:[],skills:false,projectContext:false,fileReferences:false}:{}),...(options.fileReferences!==undefined?{fileReferences:options.fileReferences}:{}),instructionsPreset:options.instructionsPreset}}:{}),
        compaction: { enabled: false },
      })
    );
    if(test.navigationMode){await mkdir(join(cwd,".agent-compositor"),{recursive:true});await writeFile(join(cwd,".agent-compositor/callix.json"),JSON.stringify({background:false,executable:process.env.CALLIX_TEST_BIN??join(root,"plugins/callix/bin/callix")}));}
    const provider =
      options.provider ?? (options.model === "scripted"
        ? new ScriptedProvider(test.script ?? [])
        : undefined);
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
      systemPrompt: [system,test.system].filter(Boolean).join("\n\n")||undefined,
      maxSteps: test.expect.grader ? 24 : 8,
      maxTokensPerTurn: test.expect.grader ? 80000 : 12000,
      agentHub: false,
      pluginDirs: [
        "todos",
        "guard-secrets",
        "guard-scope",
        "plan-mode",
        "network-proxy",
        ...(useCallix?["callix"]:[]),
      ].map((p) => join(root, "plugins", p)),
    });
    if (app.pluginErrors.length) throw Error(JSON.stringify(app.pluginErrors));
    if(test.navigationMode==='text')for(const plugin of app.plugins)if(plugin.manifest.name==='callix')plugin.tools=plugin.tools?.filter(t=>t.name!=='code_query');
    const core = app.createCore(async () => false);
    const missing=options.tools?.filter(name=>!core.getToolNames().includes(name));if(missing?.length)throw Error('Requested evaluation tools are unavailable: '+missing.join(', '));
    core.host.registerPlugin({name:"eval-measurement",version:"1.0.0",trust:"trusted"},{
      "service.model.stream":(e:any)=>{if(!schemaTokens)schemaTokens=estimateTokens(JSON.stringify(e.request.tools));},
      "service.shell.exec":(e,$)=>$.next({...e,env:{...e.env,...evaluationEnvironmentOverlay(home,temp)}}),
    });
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
      (provider instanceof ScriptedProvider ? provider.requests.length : undefined) ??
      events.filter((e) => e.kind === "catalog" && e.event === "turn.step")
        .length;
    transcript=[...core.getMessages()];
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
    const toolCalls=events.filter(e=>e.kind==="catalog"&&e.event==="tool.call");
    if(exp.allowedTools) checks.push({name:"only appropriate tools used",ok:toolCalls.every(e=>exp.allowedTools.includes(e.input.tool))});
    if(exp.maxToolCalls!==undefined) checks.push({name:"bounded tool calls",ok:toolCalls.length<=exp.maxToolCalls});
    if(exp.maxResultTokens!==undefined) checks.push({name:"bounded result tokens",ok:transcript.filter(m=>m.role==="tool").reduce((n,m)=>n+estimateTokens(m.content),0)<=exp.maxResultTokens});
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
    checks.push(...await gradeProject({cwd,home,temp,fixtures:test.files,expect:exp,events}));
    if (exp.noModelCalls)
      checks.push({ name: "blocked before model", ok: requests === 0 });
  } catch (e) {
    error = String(e);
  } finally {
    await app?.close();
    await rm(temp, { recursive: true, force: true });
  }
  const usage = events
    .filter((e) => e.kind === "catalog" && e.event === "model.usage")
    .reduce(
      (sum, e) => ({
        input: sum.input + Number(e.input.inputTokens ?? 0),
        output: sum.output + Number(e.input.outputTokens ?? 0),
        cacheWriteInput:sum.cacheWriteInput+Number(e.input.cacheWriteInputTokens??0),
        cachedInput:sum.cachedInput+Number(e.input.cachedInputTokens??0),
        estimatedCalls:sum.estimatedCalls+(e.input.estimated?1:0),
        reportedCalls:sum.reportedCalls+(e.input.estimated?0:1),
      }),
      { input: 0, output: 0,cacheWriteInput:0,cachedInput:0,estimatedCalls:0,reportedCalls:0 }
    );
  return {
    id: test.id,
    split: test.split,
    model: options.model,
    composition:{tools:options.tools,agentHarness:options.agentHarness??false,instructionsPreset:options.instructionsPreset??"general",...(options.fileReferences!==undefined?{fileReferences:options.fileReferences}:{})},
    ok: !error && checks.length > 0 && checks.every((c) => c.ok),
    checks,
    error,
    response: answer,
    requests,
    usage,
    permissionDiagnostics: permissionDiagnostics(events),
    navigationMode:test.navigationMode,
    toolTraffic:{schemaTokens,estimateMethod:"utf8-weighted-heuristic",resultTokens:transcript.filter(m=>m.role==='tool').reduce((n,m)=>n+estimateTokens(m.content),0),resultBytes:transcript.filter(m=>m.role==='tool').reduce((n,m)=>n+Buffer.byteLength(m.content),0),calls:events.filter(e=>e.kind==='catalog'&&e.event==='tool.call').map(e=>({tool:e.input.tool,argumentTokens:estimateTokens(JSON.stringify(e.input.input)),action:(e.input.input as any)?.action}))},
    durationMs: Date.now() - started,
    trajectory: events,
  };
}
