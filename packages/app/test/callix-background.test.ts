import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {buildAppWithPlugins as buildApp} from "./plugin-fixture.js";
import { ScriptedProvider } from "@agent-compositor/core";
const dirs: string[] = [],
  apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function poll(test: () => Promise<boolean>) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Index did not refresh");
}
describe("persistent reactive project index", () => {
  it('starts warming immediately without blocking startup, shares the first query and drains on session end',async()=>{
    const cwd=await mkdtemp(join(tmpdir(),'callix-eager-'));dirs.push(cwd);
    await mkdir(join(cwd,'.agent-compositor'));await writeFile(join(cwd,'source.ts'),'alpha');
    const executable=join(cwd,'.agent-compositor/slow-callix');
    await writeFile(executable,`#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync('.agent-compositor/runs','1\\n');fs.writeFileSync('.agent-compositor/pid',String(process.pid));setTimeout(()=>console.log(JSON.stringify({schema_version:1,nodes:[{id:'alpha',name:'alpha',qualified_name:'alpha',kind:'function'}],relations:[],metadata:{}})),1500);`,{mode:0o700});
    await writeFile(join(cwd,'.agent-compositor/callix.json'),JSON.stringify({executable,queryWaitMs:50,debounceMs:10000}));
    const app=await buildApp({cwd,env:{HOME:join(cwd,'home')},agentHub:false,provider:new ScriptedProvider([]),pluginDirs:[join(process.cwd(),'plugins/callix')]});apps.push(app);
    const core=app.createCore(async()=>true);await core.start();
    // The build is launched independently of both prompts and the 10s debounce.
    await poll(async()=>!!(await readFile(join(cwd,'.agent-compositor/pid'),'utf8').catch(()=>'')));
    expect(await core.invokeTool('code_query',{action:'status'})).toMatchObject({ok:true,output:{state:'indexing'}});
    expect(await core.invokeTool('code_query',{action:'symbols'})).toMatchObject({ok:true,output:{pending:true}});
    expect(await readFile(join(cwd,'.agent-compositor/runs'),'utf8')).toBe('1\n');
    const pid=Number(await readFile(join(cwd,'.agent-compositor/pid'),'utf8'));
    await core.host.emit('session.end',{reason:'clear'});
    expect(()=>process.kill(pid,0)).toThrow();
    await writeFile(join(cwd,'.agent-compositor/callix.json'),JSON.stringify({executable,background:false}));
    await core.host.emit('session.reload',{plugins:[]});
    expect(await core.invokeTool('code_query',{action:'status'})).toMatchObject({ok:true,output:{state:'not-indexed'}});
    expect(await readFile(join(cwd,'.agent-compositor/runs'),'utf8')).toBe('1\n');
  });
  it('stops an attached-project background query when its workspace grant is removed',async()=>{
    const root=await mkdtemp(join(tmpdir(),'callix-revoke-'));dirs.push(root);
    const cwd=join(root,'primary'),other=join(root,'secondary');
    await mkdir(join(cwd,'.agent-compositor'),{recursive:true});await mkdir(other);
    await writeFile(join(other,'source.ts'),'alpha');
    const executable=join(cwd,'.agent-compositor/hanging-callix');
    await writeFile(executable,`#!/usr/bin/env node\nrequire('node:fs').writeFileSync('worker.pid',String(process.pid));setInterval(()=>{},1000);`,{mode:0o700});
    await writeFile(join(cwd,'.agent-compositor/callix.json'),JSON.stringify({executable,queryWaitMs:50}));
    const app=await buildApp({cwd,workspacePaths:[other],env:{HOME:join(root,'home')},agentHub:false,provider:new ScriptedProvider([]),pluginDirs:[join(process.cwd(),'plugins/callix')]});apps.push(app);
    const core=app.createCore(async()=>true);
    expect(await core.invokeTool('code_query',{action:'symbols',cwd:other})).toMatchObject({ok:true,output:{pending:true}});
    await poll(async()=>!!(await readFile(join(other,'worker.pid'),'utf8').catch(()=>'')));
    const pid=Number(await readFile(join(other,'worker.pid'),'utf8'));
    await core.removeWorkspace(other);
    expect(()=>process.kill(pid,0)).toThrow();
  });
  it('cancels a retained slow query on close rather than leaving a native worker behind',async()=>{
    const cwd=await mkdtemp(join(tmpdir(),'callix-retained-'));dirs.push(cwd);
    await mkdir(join(cwd,'.agent-compositor'));
    await writeFile(join(cwd,'source.ts'),'alpha');
    const executable=join(cwd,'.agent-compositor/hanging-callix');
    await writeFile(executable,`#!/usr/bin/env node\nrequire('node:fs').writeFileSync('.agent-compositor/pid',String(process.pid));setInterval(()=>{},1000);`,{mode:0o700});
    await writeFile(join(cwd,'.agent-compositor/callix.json'),JSON.stringify({executable,queryWaitMs:50}));
    const app=await buildApp({cwd,env:{HOME:join(cwd,'home')},agentHub:false,provider:new ScriptedProvider([]),pluginDirs:[join(process.cwd(),'plugins/callix')]});apps.push(app);
    expect(await app.createCore(async()=>true).invokeTool('code_query',{action:'symbols'})).toMatchObject({ok:true,output:{pending:true,complete:false}});
    await poll(async()=>!!(await readFile(join(cwd,'.agent-compositor/pid'),'utf8').catch(()=>'')));
    const pid=Number(await readFile(join(cwd,'.agent-compositor/pid'),'utf8'));
    await app.close();apps.splice(apps.indexOf(app),1);
    expect(()=>process.kill(pid,0)).toThrow();
  });
  it('returns pending for a slow semantic query, shares the build and remains usable',async()=>{
    const cwd=await mkdtemp(join(tmpdir(),'callix-responsive-'));dirs.push(cwd);
    await mkdir(join(cwd,'.agent-compositor'));
    await writeFile(join(cwd,'source.ts'),'alpha');
    const executable=join(cwd,'.agent-compositor/slow-callix');
    await writeFile(executable,`#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync('.agent-compositor/runs','1\\n');setTimeout(()=>console.log(JSON.stringify({schema_version:1,nodes:[{id:'alpha',name:'alpha',qualified_name:'alpha',kind:'function'}],relations:[],metadata:{}})),700);`,{mode:0o700});
    await writeFile(join(cwd,'.agent-compositor/callix.json'),JSON.stringify({executable,queryWaitMs:50,debounceMs:10000}));
    const app=await buildApp({cwd,env:{HOME:join(cwd,'home')},agentHub:false,provider:new ScriptedProvider([]),pluginDirs:[join(process.cwd(),'plugins/callix')]});apps.push(app);
    const core=app.createCore(async()=>true);
    const first=await core.invokeTool('code_query',{action:'definition',pattern:'alpha'});
    expect(first).toMatchObject({ok:true,output:{pending:true,complete:false,requestedAction:'definition'}});
    expect(await core.invokeTool('grep',{pattern:'alpha',path:'source.ts'})).toMatchObject({ok:true});
    await poll(async()=>{
      const status=await core.invokeTool('code_query',{action:'status'});
      return status.ok&&(status.output as any).state==='ready';
    });
    expect(await core.invokeTool('code_query',{action:'definition',pattern:'alpha'})).toMatchObject({ok:true,output:{symbols:[{name:'alpha'}]}});
    expect(await readFile(join(cwd,'.agent-compositor/runs'),'utf8')).toBe('1\n');
  });
  it("warms a native CLI index, refreshes external edits and reuses disk state after restart", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "callix-background-"));
    dirs.push(cwd);
    const home = join(cwd, "home");
    await mkdir(home);
    await mkdir(join(cwd, ".agent-compositor"));
    const binary = join(cwd, ".agent-compositor/fake-callix");
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');const root=process.argv[3],file=path.join(root,'.agent-compositor/count');let count=0;try{count=Number(fs.readFileSync(file))}catch{}fs.writeFileSync(file,String(count+1));const name=fs.readFileSync(path.join(root,'source.ts'),'utf8').trim();console.log(JSON.stringify({schema_version:1,nodes:[{id:name,name,qualified_name:name,kind:'function'}],relations:[],metadata:{}}));`
    );
    await chmod(binary, 0o755);
    await writeFile(join(cwd, "source.ts"), "alpha");
    await writeFile(
      join(cwd, ".agent-compositor/callix.json"),
      JSON.stringify({ executable: binary, debounceMs: 100 })
    );
    const create = () =>
      buildApp({
        cwd,
        env: { HOME: home },
        agentHub: false,
        provider: new ScriptedProvider([]),
        pluginDirs: [join(process.cwd(), "plugins/callix")],
      });
    const app = await create();
    apps.push(app);
    const core = app.createCore(async () => true);
    const signals: any[] = [];
    core.host.registerPlugin(
      { name: "observer", version: "1.0.0", trust: "trusted" },
      {
        "project.changed": (e) => {
          signals.push(e);
        },
      }
    );
    await core.start();
    const index = join(app.storage.paths.state, "cache/callix/index.json");
    await poll(async () => !!(await readFile(index, "utf8").catch(() => "")));
    await writeFile(join(cwd, "source.ts"), "beta");
    await poll(async () => (await readFile(index, "utf8")).includes("beta"));
    expect(signals.length).toBeGreaterThan(0);
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const count = await readFile(join(cwd, ".agent-compositor/count"), "utf8");
    const next = await create();
    apps.push(next);
    const second = next.createCore(async () => true);
    const result = await second.host.emit("service.project.query", {
      cwd,
      action: "symbols",
      pattern: "beta",
    });
    expect(JSON.stringify(result.value)).toContain("beta");
    expect(await readFile(join(cwd, ".agent-compositor/count"), "utf8")).toBe(
      count
    );
  });
});
