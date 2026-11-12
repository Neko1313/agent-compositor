import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ScriptedProvider } from "@agent-compositor/core";
import { buildApp } from "../src/build.js";
import { extensionManager } from "../src/extensions.js";
const exec = promisify(execFile),
  roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "agent-features-"));
  roots.push(root);
  return root;
}
const dirs = [join(process.cwd(), "plugins")];
describe("independent agents, authentication and extensions", () => {
  it('keeps plugin-owned agent commands authoritative and hides the disabled host command',async()=>{
    const cwd=await temp(),directory=join(cwd,'override');await mkdir(directory);
    await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'agents-override',version:'1.0.0',main:'hooks.js',trust:'trusted',commands:[{name:'/agents',description:'Custom agent screen'}]}));
    await writeFile(join(directory,'hooks.js'),"export default {'prompt.submit':event=>event.text==='/agents'?{drop:'custom agents'}:undefined};");
    await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agents-override','agent-hub']}));
    const provider=new ScriptedProvider([]),app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[directory]});
    try{
      const core=app.createCore(async()=>true);await core.start();
      expect(app.pluginErrors).toEqual([]);
      const command=app.commands().find(command=>command.name==='/agents');expect(command).toMatchObject({description:'Custom agent screen'});expect(command?.execution).toBeUndefined();
      expect(core.hasImmediateCommand('/agents')).toBe(false);await core.submit('/agents');expect(provider.requests).toHaveLength(0);
      expect((await core.invokeTool('agent_control',{action:'list'})).ok).toBe(true);
    }finally{await app.close();}
    const disabled=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false});
    try{expect(disabled.commands().some(command=>command.name==='/agents')).toBe(false);expect(disabled.createCore(async()=>false).hasImmediateCommand('/agents')).toBe(false);}finally{await disabled.close();}
  });
  it('opens the agent overview independently of a held foreground model',async()=>{
    const cwd=await temp(),provider=new ScriptedProvider([{text:'main working',hold:true}]);
    const app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:dirs});
    try{
      const core=app.createCore(async()=>true);await core.start();let overview:any;
      core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface'&&(event.input as any).id==='plugin-agent-hub-agents')overview=(event.input as any).view;});
      const turn=core.submit('Main task');await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
      expect(core.hasImmediateCommand('/agents')).toBe(true);
      expect(await core.invokeCommand('/agents')).toBe(true);
      expect(overview.table).toBeDefined();expect(core.getState()).toBe('running');
      expect(core.getMessages().filter(message=>message.role==='user').map(message=>message.content)).toEqual(['Main task']);
      expect(provider.requests).toHaveLength(1);core.interrupt();await turn;
    }finally{await app.close();}
  });
  it('updates the expandable agent overview while a side turn runs and keeps filters independent of the model',async()=>{
    const cwd=await temp(),provider=new ScriptedProvider([{toolCalls:[{name:'read',args:{path:'overview.txt'}}]},{text:'working',hold:true}]);
    await writeFile(join(cwd,'overview.txt'),'PRIVATE_FILE_BODY');
    const app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:dirs});
    try{
      const core=app.createCore(async()=>true);let view:any;let fallback='';
      core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface'&&(event.input as any).id==='plugin-agent-hub-agents'){view=(event.input as any).view;fallback=String((event.input as any).text);}});
      await core.start();
      const created=await core.invokeTool('agent_control',{action:'create',name:'Explorer',worktree:false});expect(created.ok).toBe(true);const id=(created.output as any).id;
      expect(await core.invokeCommand('/agents')).toBe(true);expect(view.table.rows[0].cells).toEqual(['Explorer','idle','0']);
      await core.host.emit('ui.press',{site:'plugin-agent-hub-agents',key:`expand:${id}`});
      expect(view.table.rows[0].expanded).toBe(true);expect(fallback).toContain('Workspace:');
      await core.invokeTool('agent_control',{action:'send',id,prompt:'Inspect'});
      await vi.waitFor(()=>expect(view.table.rows[0].cells[1]).toBe('running'));
      await vi.waitFor(()=>expect(view.table.rows[0].details.some((line:any)=>line.text==='Tool finished: read')).toBe(true));
      expect(JSON.stringify(view)).not.toContain('PRIVATE_FILE_BODY');
      expect(view.table.rows[0].details.some((line:any)=>line.text==='Turn started')).toBe(true);
      await core.host.emit('ui.press',{site:'plugin-agent-hub-agents',key:'filter'});expect(view.tabs.find((tab:any)=>tab.selected).id).toBe('running');expect(view.table.rows).toHaveLength(1);
      await core.invokeTool('agent_control',{action:'stop',id});await vi.waitFor(()=>expect(view.table.rows).toHaveLength(0));
      await core.host.emit('ui.press',{site:'plugin-agent-hub-agents',key:'filter'});expect(view.table.rows).toHaveLength(1);expect(view.table.rows[0].cells[1]).toBe('interrupted');
      expect(view.table.rows[0].details.some((line:any)=>line.text==='Turn interrupted')).toBe(true);
      expect(provider.requests).toHaveLength(2);expect(core.getMessages().filter(message=>message.role==='user')).toHaveLength(0);
    }finally{await app.close();}
  });
  it("persists separate agent conversations and restores their windows after restart", async () => {
    const cwd = await temp(),
      provider = new ScriptedProvider([
        { text: "first agent result" },
        { text: "second agent result" },
      ]);
    const app = await buildApp({
      cwd,
      env: { HOME: cwd },
      provider,
      pluginDirs: dirs,
    });
    let initialClosed = false;
    try {
      const core = app.createCore(async () => true);
      await core.start();
      const one = await core.invokeTool("agent_control", {
        action: "create",
        name: "one",
        worktree: false,
        maxTokens: 10000,
      });
      const id1 = (one.output as any).id;
      const two = await core.invokeTool("agent_control", {
        action: "create",
        name: "two",
        worktree: false,
        maxTokens: 10000,
      });
      const id2 = (two.output as any).id;
      expect(one.ok && two.ok).toBe(true);
      expect(id1).not.toBe(id2);
      await core.invokeTool("agent_control", {
        action: "send",
        id: id1,
        prompt: "first task",
      });
      await vi.waitFor(async () => {
        const rows: any = (
          await core.host.emit("service.agent.control", { action: "list" })
        ).value;
        expect(rows.value.find((r: any) => r.id === id1).state).toBe("idle");
      }, { timeout: 10000 });
      await core.invokeTool("agent_control", {
        action: "send",
        id: id2,
        prompt: "second task",
      });
      await vi.waitFor(() => expect(provider.requests).toHaveLength(2), { timeout: 10000 });
      await app.close();
      initialClosed = true;
      expect(
        provider.requests[1].messages.some((m) => m.content === "first task")
      ).toBe(false);
      const restart = await buildApp({
        cwd,
        env: { HOME: cwd },
        provider: new ScriptedProvider([]),
        pluginDirs: dirs,
      });
      try {
        const next = restart.createCore(async () => true);
        const views: string[] = [];
        next.subscribe((e) => {
          if (e.kind === "catalog" && e.event === "ui.surface")
            views.push(String(e.input.text));
        });
        await next.start();
        expect(views.join("\n")).toContain("first agent result");
        expect(views.join("\n")).toContain("second agent result");
      } finally {
        await restart.close();
      }
    } finally {
      if (!initialClosed) await app.close();
    }
  }, 30000);
  it("creates a real isolated Git worktree and preserves it on archive", async () => {
    const cwd = await temp();
    await exec("git", ["init", "-b", "main"], { cwd });
    await writeFile(join(cwd, "tracked.txt"), "base");
    await exec("git", ["add", "tracked.txt"], { cwd });
    await exec(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "initial",
      ],
      { cwd }
    );
    const app = await buildApp({
      cwd,
      env: { HOME: cwd },
      provider: new ScriptedProvider([]),
      pluginDirs: dirs,
    });
    const core = app.createCore(async () => true);
    await core.start();
    const result = await core.invokeTool("agent_control", {
      action: "create",
      name: "isolated",
    });
    expect(result.ok).toBe(true);
    const record: any = result.output;
    expect(await readFile(join(record.cwd, "tracked.txt"), "utf8")).toBe(
      "base"
    );
    expect(record.branch).toMatch(/^agent\//);
    await writeFile(join(record.cwd, "tracked.txt"), "agent change");
    expect(await readFile(join(cwd, "tracked.txt"), "utf8")).toBe("base");
    expect(
      (
        await core.invokeTool("agent_control", {
          action: "archive",
          id: record.id,
        })
      ).ok
    ).toBe(true);
    expect(await readFile(join(record.cwd, "tracked.txt"), "utf8")).toBe(
      "agent change"
    );
    await app.close();
  });
  it("saves provider credentials with private permissions without putting keys in the transcript", async () => {
    const cwd = await temp(),
      key = "test-private-provider-key";
    const app = await buildApp({
      cwd,
      env: { HOME: cwd, MY_PROVIDER_KEY: key },
      provider: new ScriptedProvider([]),
    });
    const core = app.createCore(async () => false);
    await core.start();
    await core.submit("/login default MY_PROVIDER_KEY");
    const file = join(cwd, ".agent-compositor/credentials.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(core.getMessages())).not.toContain(key);
    expect(JSON.parse(await readFile(file, "utf8")).default.accessToken).toBe(
      key
    );
    await core.submit("/logout default");
    expect(JSON.parse(await readFile(file, "utf8")).default).toBeUndefined();
    await app.close();
  });
  it("installs a catalog extension at a named version and disables it before importing code", async () => {
    const cwd = await temp(),
      home = await temp(),
      repository = await temp();
    await exec("git", ["init", "-b", "main"], { cwd: repository });
    await writeFile(
      join(repository, "plugin.json"),
      '{"name":"sample","version":"1.0.0","trust":"trusted"}'
    );
    await writeFile(
      join(repository, "hooks.ts"),
      'export default {"prompt.submit":()=>undefined};'
    );
    await exec("git", ["add", "."], { cwd: repository });
    await exec(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "plugin",
      ],
      { cwd: repository }
    );
    await exec("git", ["tag", "v1"], { cwd: repository });
    await mkdir(join(cwd, ".agent-compositor"));
    await writeFile(
      join(cwd, ".agent-compositor/extensions.json"),
      JSON.stringify([{ name: "sample", repository, ref: "v1" }])
    );
    const manager = await extensionManager(cwd, home);
    const ctx: any = { signal: new AbortController().signal };
    const install = await manager.tool.execute(ctx, {
      action: "install",
      name: "sample",
    });
    expect(install.ok).toBe(true);
    await manager.tool.execute(ctx, { action: "disable", name: "sample" });
    await writeFile(
      join(home, ".agent-compositor/plugins/sample/hooks.ts"),
      'throw new Error("MUST NOT IMPORT");'
    );
    const app = await buildApp({
      cwd,
      env: { HOME: home },
      provider: new ScriptedProvider([]),
    });
    expect(app.pluginErrors).toEqual([]);
    expect(app.plugins.some((p) => p.manifest.name === "sample")).toBe(false);
    await app.close();
  });
});
