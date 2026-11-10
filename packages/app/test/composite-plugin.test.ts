import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ScriptedProvider} from '@agent-compositor/core';
import {buildApp} from '../src/build.js';

const roots:string[]=[], apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const file=async(root:string,path:string,value:string)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),value);};
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};

it('manages every component as one marketplace package and disposes MCP processes on update, disable and removal',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ac-composite-'));roots.push(root);
  const cwd=join(root,'project'),home=join(root,'home'),repo=join(root,'market'),source=join(repo,'plugins/workspace-suite');
  await mkdir(cwd);await mkdir(home);
  await file(repo,'.claude-plugin/marketplace.json',JSON.stringify({name:'suite-market',owner:{name:'Fixture'},plugins:[{name:'workspace-suite',source:'./plugins/workspace-suite'}]}));
  const publish=async(version:string)=>{
    await file(source,'plugin.json',JSON.stringify({name:'workspace-suite',version,trust:'trusted',main:'hooks.ts',commands:[{name:'/workspace-suite',description:'Open suite'}],provides:['service.agent.instructions'],mcpServers:'config/servers.json',resources:['mcp']}));
    await file(source,'hooks.ts',`export default {'prompt.submit':async(e,$)=>{if(e.text!=='/workspace-suite')return;await $.ui.notify('SUITE_${version}');await $.ui.view('main','Suite',{lines:[{text:'SUITE_${version}'}]});return{drop:'suite'};},'service.agent.instructions':async()=>({value:'SUITE_INSTRUCTIONS_${version}'})};`);
    await file(source,'tools.ts',`export default [{name:'suite_probe',description:'Suite probe',parameters:{type:'object'},describe:()=>({tool:'suite_probe',readOnly:true}),execute:async()=>({ok:true,data:'SUITE_TOOL_${version}'})}];`);
    await file(source,'skills/suite-workflow/SKILL.md',`---\nname: suite-workflow\ndescription: Suite workflow ${version}\n---\nSUITE_SKILL_${version}`);
    await file(source,'config/servers.json',JSON.stringify({mcpServers:{local:{command:process.execPath,args:['${PLUGIN_ROOT}/mcp/server.mjs'],env:{SUITE_ENV:'${PLUGIN_ROOT}'},cwd:'${PLUGIN_ROOT}'}}}));
    await file(source,'mcp/server.mjs',`import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;let result;if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'suite',version:'${version}'}};else if(r.method==='tools/list')result={tools:[{name:'probe',description:'Probe'}]};else result={content:[{type:'text',text:'SUITE_MCP_${version}'}],pid:process.pid,cwd:process.cwd(),root:process.env.SUITE_ENV};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`);
  };
  await publish('1.0.0');
  await file(cwd,'.agent-compositor/mcp.json',JSON.stringify({mcpServers:{independent:{command:'independent-user-setting'}}}));
  const provider=new ScriptedProvider([{text:'Selected provider observed'}]);
  const app=await buildApp({cwd,env:{HOME:home},provider,agentHub:false,pluginDirs:[join(process.cwd(),'plugins/mcp')]});apps.push(app);
  const core=app.createCore(async()=>true),events:any[]=[];core.subscribe(e=>{if(e.kind==='catalog')events.push(e);});
  expect((await core.invokeTool('marketplace_control',{action:'add',source:repo})).ok).toBe(true);
  expect(await core.invokeTool('extension_control',{action:'install',name:'workspace-suite@suite-market',scope:'project'})).toMatchObject({ok:true,output:{version:'1.0.0'}});
  expect(app.plugins).toEqual([]);
  await core.invokeTool('extension_control',{action:'enable',name:'mcp',scope:'project'});
  await core.invokeTool('extension_control',{action:'enable',name:'workspace-suite',scope:'project'});
  await app.reloadPlugins(core);
  const installed=join(cwd,'.agent-compositor/plugins/workspace-suite');
  const call=()=>core.invokeTool('mcp_call',{action:'call',server:'workspace-suite-local',tool:'probe'});
  const verify=async(version:string)=>{
    expect(app.commands().some(c=>c.name==='/workspace-suite')).toBe(true);
    await core.submit('/workspace-suite');expect(provider.requests).toHaveLength(0);
    expect(events.some(e=>e.event==='ui.notification'&&e.input.message==='SUITE_'+version)).toBe(true);
    expect(events.some(e=>e.event==='ui.surface')).toBe(true);
    expect(await core.invokeTool('suite_probe',{})).toMatchObject({ok:true,output:'SUITE_TOOL_'+version});
    expect(await core.invokeTool('skills',{name:'suite-workflow'})).toMatchObject({ok:true,output:{body:'SUITE_SKILL_'+version}});
    const response=await call();expect(response,response.error).toMatchObject({ok:true,output:{content:[{text:'SUITE_MCP_'+version}],cwd:installed,root:installed}});
    return (response.output as any).pid as number;
  };
  const first=await verify('1.0.0');expect(alive(first)).toBe(true);
  // Provider selection is explicit and takes effect in a fresh app.
  await file(cwd,'agent-compositor.json',JSON.stringify({agent:{projectContext:false},serviceProviders:{'service.agent.instructions':'workspace-suite'}}));
  const selected=await buildApp({cwd,env:{HOME:home},provider,agentHub:false});apps.push(selected);
  await selected.createCore(async()=>true).submit('Use selected instructions');
  expect(provider.requests[0].messages.filter(m=>m.role==='system').some(m=>m.content.includes('SUITE_INSTRUCTIONS_1.0.0'))).toBe(true);
  await selected.close();apps.splice(apps.indexOf(selected),1);provider.requests.splice(0);
  expect(alive(first)).toBe(true);
  // A rejected update must leave every component of the installed version intact.
  await publish('1.0.1');
  await file(source,'config/servers.json',JSON.stringify({mcpServers:{local:{type:'http',url:'https://example.invalid/mcp'}}}));
  expect((await core.invokeTool('extension_control',{action:'update',name:'workspace-suite'})).ok).toBe(false);
  expect(JSON.parse(await readFile(join(installed,'plugin.json'),'utf8')).version).toBe('1.0.0');
  expect(await core.invokeTool('suite_probe',{})).toMatchObject({ok:true,output:'SUITE_TOOL_1.0.0'});
  expect(alive(first)).toBe(true);
  await publish('1.1.0');
  expect(await core.invokeTool('extension_control',{action:'update',name:'workspace-suite'})).toMatchObject({ok:true,output:{version:'1.1.0'}});
  await app.reloadPlugins(core);await expect.poll(()=>alive(first)).toBe(false);
  const second=await verify('1.1.0');expect(second).not.toBe(first);
  expect((await core.invokeTool('extension_control',{action:'disable',name:'workspace-suite',scope:'project'})).ok).toBe(true);
  await app.reloadPlugins(core);await expect.poll(()=>alive(second)).toBe(false);
  expect(app.commands().some(c=>c.name==='/workspace-suite')).toBe(false);
  expect(core.getToolNames()).not.toContain('suite_probe');
  expect((await core.invokeTool('skills',{name:'suite-workflow'})).ok).toBe(false);
  expect((await call()).ok).toBe(false);
  expect(await app.storage.config('mcp.json')).toEqual({mcpServers:{independent:{command:'independent-user-setting'}}});
  expect((await core.invokeTool('extension_control',{action:'enable',name:'workspace-suite',scope:'project'})).ok).toBe(true);
  await app.reloadPlugins(core);const third=await verify('1.1.0');
  expect((await core.invokeTool('marketplace_control',{action:'remove',name:'suite-market'})).ok).toBe(true);
  // Catalog removal retains installed packages; managed removal is separate.
  await app.reloadPlugins(core);await expect.poll(()=>alive(third)).toBe(false);
  const fourth=await verify('1.1.0');
  expect((await core.invokeTool('extension_control',{action:'remove',name:'workspace-suite'})).ok).toBe(true);
  await app.reloadPlugins(core);await expect.poll(()=>alive(fourth)).toBe(false);
  expect(app.plugins.some(p=>p.manifest.name==='workspace-suite')).toBe(false);
  expect(core.getToolNames()).not.toContain('suite_probe');expect((await call()).ok).toBe(false);
  expect((await core.invokeTool('skills',{name:'suite-workflow'})).ok).toBe(false);
  expect(JSON.parse(await readFile(join(cwd,'.agent-compositor/mcp.json'),'utf8'))).toEqual({mcpServers:{independent:{command:'independent-user-setting'}}});
},20000);
