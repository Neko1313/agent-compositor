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
  it('restores saved tool arguments and results after restart without a model request',async()=>{
    const cwd=await temp();await writeFile(join(cwd,'history.txt'),'HISTORICAL_FILE_RESULT');
    const provider=new ScriptedProvider([{toolCalls:[{name:'read',args:{path:'history.txt'}}]},{text:'Inspection complete'}]);
    let app=await buildApp({cwd,env:{HOME:cwd},provider});let id='';
    try{
      let core=app.createCore(async()=>true);await core.start();
      const created=await core.invokeTool('agent_control',{action:'create',name:'Historian',worktree:false});expect(created.ok).toBe(true);id=(created.output as any).id;
      await core.invokeTool('agent_control',{action:'send',id,prompt:'Inspect history.txt'});
      await vi.waitFor(()=>expect(provider.exhausted).toBe(true));
      await vi.waitFor(async()=>{const listed=await core.invokeTool('agent_control',{action:'list',id});expect((listed.output as any[])[0].state).toBe('idle');});
      await app.close();app=await buildApp({cwd,env:{HOME:cwd},provider:new ScriptedProvider([])});
      const views=new Map<string,any>();core=app.createCore(async()=>true);core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface')views.set(String((event.input as any).id),(event.input as any).view);});await core.start();
      await core.host.emit('ui.press',{site:'plugin-agent-hub-agent-'+id,key:'history:'+id});const site='plugin-agent-hub-history-'+id;
      expect(views.get(site).table.rows.length).toBeGreaterThan(0);await core.host.emit('ui.press',{site,key:'filter:tools'});
      const calls=views.get(site).table.rows;expect(calls.map((row:any)=>row.cells[1])).toEqual(['tool.call','tool.result']);
      await core.host.emit('ui.press',{site,key:calls[0].action});expect(JSON.stringify(views.get(site))).toContain('history.txt');
      await core.host.emit('ui.press',{site,key:calls[1].action});expect(JSON.stringify(views.get(site))).toContain('HISTORICAL_FILE_RESULT');
      expect(core.getMessages().filter(message=>message.role==='user')).toHaveLength(0);expect(provider.requests).toHaveLength(2);
    }finally{await app.close();}
  });
  it('switches conversation tabs without mixing drafts or messages and sends the Reply draft by button',async()=>{
    const cwd=await temp(),provider=new ScriptedProvider([{text:'FIRST_RESULT'},{text:'SECOND_RESULT'}]);
    const app=await buildApp({cwd,env:{HOME:cwd},provider});let asks=0;
    try{
      const core=app.createCore(async()=>true,async()=>{asks++;return'unexpected question';});const views=new Map<string,any>();
      core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface')views.set(String((event.input as any).id),(event.input as any).view);});await core.start();
      const create=async(name:string)=>{const result=await core.invokeTool('agent_control',{action:'create',name,worktree:false});expect(result.ok).toBe(true);return(result.output as any).id as string;};
      const one=await create('First'),two=await create('Second'),site=(id:string)=>'plugin-agent-hub-agent-'+id;
      const press=(id:string,key:string)=>core.host.emit('ui.press',{site:site(id),key});
      const change=(id:string,value:string)=>core.host.emit('ui.change',{site:site(id),id:views.get(site(id)).input.id,value});
      expect(views.get(site(one)).tabs.map((tab:any)=>tab.id)).toEqual(['overview',one,two]);
      await change(one,'First task');await press(one,'send:'+one);
      await vi.waitFor(()=>expect(views.get(site(one)).lines.some((line:any)=>line.text==='FIRST_RESULT')).toBe(true));expect(asks).toBe(0);
      await press(one,'conversation:'+two);expect(views.get(site(two)).tabs.find((tab:any)=>tab.selected).id).toBe(two);expect(provider.requests).toHaveLength(1);
      await change(two,'Second task');await press(two,'enter');await vi.waitFor(()=>expect(provider.requests).toHaveLength(2));
      expect(provider.requests[1].messages.some(message=>message.content==='First task'||message.content==='FIRST_RESULT')).toBe(false);
      await change(one,'FIRST_DRAFT');await change(two,'SECOND_DRAFT');
      await press(two,'conversation:'+one);expect(views.get(site(one)).input.value).toBe('FIRST_DRAFT');
      await press(one,'conversation:'+two);expect(views.get(site(two)).input.value).toBe('SECOND_DRAFT');
      await press(two,'conversation:overview');expect(views.get('plugin-agent-hub-agents').table).toBeDefined();
      expect((await core.invokeTool('agent_control',{action:'archive',id:one})).ok).toBe(true);
      expect(views.get(site(two)).tabs.some((tab:any)=>tab.id===one)).toBe(false);
      const stale=await press(two,'conversation:'+one);expect(stale.faults.length).toBeGreaterThan(0);
      const listed=await core.invokeTool('agent_control',{action:'list',id:one});expect((listed.output as any[])[0]).toMatchObject({archived:true,state:'saved'});
      expect(provider.requests).toHaveLength(2);expect(asks).toBe(0);
    }finally{await app.close();}
  });
  it('keeps all sixteen agent conversations keyboard-reachable within twelve tabs',async()=>{
    const cwd=await temp(),provider=new ScriptedProvider([]);await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agent-hub'],agent:{maxAgents:16}}));
    const app=await buildApp({cwd,env:{HOME:cwd},provider});
    try{
      const core=app.createCore(async()=>true),views=new Map<string,any>();
      core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface')views.set(String((event.input as any).id),(event.input as any).view);});await core.start();
      const ids:string[]=[];for(let index=0;index<16;index++){const result=await core.invokeTool('agent_control',{action:'create',name:'Agent '+index,worktree:false});expect(result.ok).toBe(true);ids.push((result.output as any).id);}
      const site=(id:string)=>'plugin-agent-hub-agent-'+id;
      const first=views.get(site(ids[0]));expect(first.tabs).toHaveLength(12);expect(first.lines.some((line:any)=>line.action==='conversation-page:next')).toBe(true);
      await core.host.emit('ui.press',{site:site(ids[0]),key:'n'});
      const last=views.get(site(ids[11]));expect(last.tabs.find((tab:any)=>tab.selected).id).toBe(ids[11]);expect(last.tabs.map((tab:any)=>tab.id)).toEqual(['overview',...ids.slice(11)]);
      await core.host.emit('ui.press',{site:site(ids[11]),key:'p'});expect(views.get(site(ids[0])).tabs.find((tab:any)=>tab.selected).id).toBe(ids[0]);
      expect([...views.values()].filter(view=>view?.input).every(view=>view.tabs.length<=12)).toBe(true);expect(provider.requests).toHaveLength(0);
    }finally{await app.close();}
  });
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
      // Stop only once the second model request is actually held, not between steps.
      await vi.waitFor(()=>expect(provider.requests).toHaveLength(2),{timeout:3000});
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
