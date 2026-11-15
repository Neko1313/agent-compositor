import {afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,readFile,cp,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
import {pluginSelection} from '../src/plugin-activation.js';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const a of apps.splice(0))await a.close();for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'ac-policy-'));roots.push(root);const cwd=join(root,'project'),home=join(root,'home'),source=join(cwd,'plugins/probe');await mkdir(source,{recursive:true});await mkdir(home);await writeFile(join(source,'plugin.json'),JSON.stringify({name:'probe',version:'1.0.0',trust:'trusted'}));await writeFile(join(source,'hooks.ts'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(root,'imported'))},'IMPORTED');export default{};`);return{root,cwd,home};}
async function app(f:Awaited<ReturnType<typeof fixture>>,cwd=f.cwd){const a=await buildApp({cwd,env:{HOME:f.home},provider:new ScriptedProvider([]),agentHub:false});apps.push(a);return a;}
it('reloads a plugin into all live cores of the same application',async()=>{
 const f=await fixture();await writeFile(join(f.cwd,'plugins/probe/tools.ts'),`export default[{name:'probe_value',description:'Probe',parameters:{type:'object'},describe:()=>({tool:'probe_value',readOnly:true}),execute:async()=>({ok:true,data:'available'})}];`);
 await writeFile(join(f.cwd,'plugins/probe/hooks.ts'),`import{writeFileSync}from'node:fs';import{join}from'node:path';export default{'session.reload':async(_,$)=>writeFileSync(join(${JSON.stringify(f.root)},$.session.id),'reloaded')};`);
 const a=await app(f),first=a.createCore(async()=>true),second=a.createCore(async()=>true);
 expect((await first.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'})).ok).toBe(true);
 await a.reloadPlugins(first);
 expect(first.getToolNames()).toContain('probe_value');expect(second.getToolNames()).toContain('probe_value');
 expect(await readFile(join(f.root,first.sessionId),'utf8')).toBe('reloaded');expect(await readFile(join(f.root,second.sessionId),'utf8')).toBe('reloaded');
});
it('allows plugin reload hooks to await their own tools while external work is barred',async()=>{
 const f=await fixture(),marker=join(f.root,'reload-tool.json');await writeFile(join(f.cwd,'source.txt'),'fixture');
 await writeFile(join(f.cwd,'plugins/probe/hooks.ts'),`import{writeFileSync}from'node:fs';export default{'session.reload':async(_,$)=>writeFileSync(${JSON.stringify(marker)},JSON.stringify(await $.agent.tool('read',{path:'source.txt'})))};`);
 const a=await app(f),core=a.createCore(async()=>true);
 expect((await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'})).ok).toBe(true);
 await a.reloadPlugins(core);expect(JSON.parse(await readFile(marker,'utf8'))).toMatchObject({ok:true});
});
it('waits for another live core and ignores it after close before reloading',async()=>{
 const f=await fixture(),provider=new ScriptedProvider([{text:'working',hold:true}]);
 const a=await buildApp({cwd:f.cwd,env:{HOME:f.home},provider,agentHub:false});apps.push(a);
 const first=a.createCore(async()=>true),second=a.createCore(async()=>true);
 expect((await first.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'})).ok).toBe(true);
 const running=second.submit('Hold this session');
 try{
  await expect.poll(()=>provider.requests.length).toBe(1);
  expect(await a.reloadPlugins(first)).toContain('Wait until');
  expect(first.host.hasPlugin('probe')).toBe(false);expect(second.host.hasPlugin('probe')).toBe(false);
 }finally{provider.release();await running;}
 await a.reloadPlugins(first);expect(first.host.hasPlugin('probe')).toBe(true);expect(second.host.hasPlugin('probe')).toBe(true);
 await second.close();await second.whenClosed;
 expect((await first.invokeTool('extension_control',{action:'disable',name:'probe',scope:'project'})).ok).toBe(true);
 expect(await a.reloadPlugins(first)).toContain('Reloaded 0 plugins');expect(first.host.hasPlugin('probe')).toBe(false);
});
it('prevents one core from removing an installed plugin while another core runs',async()=>{
 const f=await fixture(),provider=new ScriptedProvider([{text:'working',hold:true}]);
 const a=await buildApp({cwd:f.cwd,env:{HOME:f.home},provider,agentHub:false});apps.push(a);
 const first=a.createCore(async()=>true),second=a.createCore(async()=>true);
 expect((await first.invokeTool('extension_control',{action:'install',name:'todos@agent-compositor',scope:'project'})).ok).toBe(true);
 expect((await first.invokeTool('extension_control',{action:'enable',name:'todos',scope:'project'})).ok).toBe(true);await a.reloadPlugins(first);
 const directory=a.plugins.find(plugin=>plugin.manifest.name==='todos')!.dir,running=second.submit('Hold this session');
 try{
  await expect.poll(()=>provider.requests.length).toBe(1);
  const removal=await first.invokeTool('extension_control',{action:'remove',name:'todos',scope:'project'});
  expect(removal.ok).toBe(false);expect(await stat(directory)).toBeTruthy();
 }finally{provider.release();await running;}
 expect((await first.invokeTool('extension_control',{action:'remove',name:'todos',scope:'project'})).ok).toBe(true);
});
it('does not reload application plugins while a managed shared-workspace agent is running',async()=>{
 const f=await fixture(),provider=new ScriptedProvider([{text:'agent working',hold:true}]);
 const a=await buildApp({cwd:f.cwd,env:{HOME:f.home},provider});apps.push(a);
 const main=a.createCore(async()=>true);await main.start();
 const created=await main.invokeTool('agent_control',{action:'create',name:'shared',worktree:false});expect(created.ok).toBe(true);
 const id=(created.output as {id:string}).id;
 try{
  expect((await main.invokeTool('agent_control',{action:'send',id,prompt:'Work independently'})).ok).toBe(true);
  await expect.poll(()=>provider.requests.length).toBe(1);
  expect(await a.reloadPlugins(main)).toContain('Wait until');
 }finally{provider.release();}
 await expect.poll(async()=>{const list=await main.invokeTool('agent_control',{action:'list'});return (list.output as any[]).find(row=>row.id===id)?.state;}).toBe('idle');
 expect(await a.reloadPlugins(main)).toContain('Reloaded');
});
it('defers removal of an installed plugin until a managed agent finishes',async()=>{
 const f=await fixture(),provider=new ScriptedProvider([{text:'agent working',hold:true}]);
 const a=await buildApp({cwd:f.cwd,env:{HOME:f.home},provider});apps.push(a);
 const main=a.createCore(async()=>true);await main.start();
 expect((await main.invokeTool('extension_control',{action:'install',name:'todos@agent-compositor',scope:'project'})).ok).toBe(true);
 expect((await main.invokeTool('extension_control',{action:'enable',name:'todos',scope:'project'})).ok).toBe(true);
 await a.reloadPlugins(main);const directory=a.plugins.find(plugin=>plugin.manifest.name==='todos')!.dir;
 const created=await main.invokeTool('agent_control',{action:'create',name:'shared',worktree:false});expect(created.ok).toBe(true);const id=(created.output as {id:string}).id;
 try{
  expect((await main.invokeTool('agent_control',{action:'send',id,prompt:'Work independently'})).ok).toBe(true);
  await expect.poll(()=>provider.requests.length).toBe(1);
  const result=await main.host.emit('service.extension.control',{action:'remove',name:'todos',scope:'project'});
  expect(JSON.stringify(result.value)).toContain('"queued":true');expect(await stat(directory)).toBeTruthy();
  expect(await a.reloadPlugins(main)).toContain('Wait until');
 }finally{provider.release();}
 await expect.poll(async()=>{const list=await main.invokeTool('agent_control',{action:'list'});return (list.output as any[]).find(row=>row.id===id)?.state;}).toBe('idle');
 await a.reloadPlugins(main);expect(await stat(directory).catch(()=>null)).toBeNull();
});
it('does not let a running managed agent remove a shared installed plugin',async()=>{
 const f=await fixture(),provider=new ScriptedProvider([
  {toolCalls:[{name:'extension_control',args:{action:'remove',name:'todos',scope:'project'}}]},
  {text:'Could not remove the plugin'},
 ]);
 const a=await buildApp({cwd:f.cwd,env:{HOME:f.home},provider});apps.push(a);
 const main=a.createCore(async()=>true);await main.start();
 expect((await main.invokeTool('extension_control',{action:'install',name:'todos@agent-compositor',scope:'project'})).ok).toBe(true);
 expect((await main.invokeTool('extension_control',{action:'enable',name:'todos',scope:'project'})).ok).toBe(true);await a.reloadPlugins(main);
 const directory=a.plugins.find(plugin=>plugin.manifest.name==='todos')!.dir;
 const created=await main.invokeTool('agent_control',{action:'create',name:'worker',worktree:false});expect(created.ok).toBe(true);const id=(created.output as {id:string}).id;
 expect((await main.invokeTool('agent_control',{action:'send',id,prompt:'Remove the plugin'})).ok).toBe(true);
 await expect.poll(()=>provider.requests.length).toBe(2);
 await expect.poll(async()=>{const list=await main.invokeTool('agent_control',{action:'list'});return (list.output as any[]).find(row=>row.id===id)?.state;}).toBe('idle');
 expect(provider.requests[1].messages.filter(message=>message.role==='tool').map(message=>String(message.content)).join('\n')).toContain('use the main session after they finish');
 expect(await stat(directory)).toBeTruthy();
 expect((await main.invokeTool('extension_control',{action:'remove',name:'todos',scope:'project'})).ok).toBe(true);
 expect(await stat(directory).catch(()=>null)).toBeNull();
});
it('does not let a delegated task remove a plugin used by its parent',async()=>{
 const f=await fixture(),provider=new ScriptedProvider([
  {toolCalls:[{name:'task',args:{prompt:'Remove the plugin'}}]},
  {toolCalls:[{name:'extension_control',args:{action:'remove',name:'todos',scope:'project'}}]},
  {text:'Could not remove the plugin'}, {text:'Child finished'},
 ]);
 const a=await buildApp({cwd:f.cwd,env:{HOME:f.home},provider});apps.push(a);
 const main=a.createCore(async()=>true);await main.start();
 expect((await main.invokeTool('extension_control',{action:'install',name:'todos@agent-compositor',scope:'project'})).ok).toBe(true);
 expect((await main.invokeTool('extension_control',{action:'enable',name:'todos',scope:'project'})).ok).toBe(true);await a.reloadPlugins(main);
 const directory=a.plugins.find(plugin=>plugin.manifest.name==='todos')!.dir;
 await main.submit('Delegate plugin removal');
 expect(await stat(directory)).toBeTruthy();
 expect(provider.requests[2].messages.filter(message=>message.role==='tool').map(message=>String(message.content)).join('\n')).toContain('Plugin changes are unavailable');
 expect((await main.invokeTool('extension_control',{action:'remove',name:'todos',scope:'project'})).ok).toBe(true);
 expect(await stat(directory).catch(()=>null)).toBeNull();
});
it('does not replace installed plugin files during the main model turn',async()=>{
 const f=await fixture(),provider=new ScriptedProvider([
  {toolCalls:[{name:'extension_control',args:{action:'remove',name:'todos',scope:'project'}}]},
  {text:'Plugin change requires a safe point'},
 ]);
 const a=await buildApp({cwd:f.cwd,env:{HOME:f.home},provider});apps.push(a);
 const main=a.createCore(async()=>true);await main.start();
 expect((await main.invokeTool('extension_control',{action:'install',name:'todos@agent-compositor',scope:'project'})).ok).toBe(true);
 expect((await main.invokeTool('extension_control',{action:'enable',name:'todos',scope:'project'})).ok).toBe(true);await a.reloadPlugins(main);
 const directory=a.plugins.find(plugin=>plugin.manifest.name==='todos')!.dir;
 await main.submit('Remove the plugin');expect(await stat(directory)).toBeTruthy();
 expect(provider.requests[1].messages.filter(message=>message.role==='tool').map(message=>String(message.content)).join('\n')).toContain('Plugin changes are unavailable');
});
it('refreshes plugin tools in an already loaded idle managed agent',async()=>{
 const f=await fixture(),provider=new ScriptedProvider([{text:'done'},{text:'done again'}]);
 await writeFile(join(f.cwd,'plugins/probe/tools.ts'),`export default[{name:'probe_value',description:'Probe',parameters:{type:'object'},describe:()=>({tool:'probe_value',readOnly:true}),execute:async()=>({ok:true,data:'available'})}];`);
 const a=await buildApp({cwd:f.cwd,env:{HOME:f.home},provider});apps.push(a);
 const main=a.createCore(async()=>true),views:any[]=[];
 main.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface')views.push(event.input);});await main.start();
 const created=await main.invokeTool('agent_control',{action:'create',name:'shared',worktree:false});expect(created.ok).toBe(true);const id=(created.output as {id:string}).id;
 expect((await main.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'})).ok).toBe(true);
 expect(await a.reloadPlugins(main)).toContain('Reloaded');
 expect((await main.invokeTool('agent_control',{action:'send',id,prompt:'Check available tools'})).ok).toBe(true);
 await expect.poll(()=>provider.requests.length).toBe(1);
 expect(provider.requests[0].tools.map(tool=>tool.name)).toContain('probe_value');
 await expect.poll(async()=>{const list=await main.invokeTool('agent_control',{action:'list'});return (list.output as any[]).find(row=>row.id===id)?.state;}).toBe('idle');
 expect((await main.invokeTool('extension_control',{action:'disable',name:'probe',scope:'project'})).ok).toBe(true);
 expect(await a.reloadPlugins(main)).toContain('Reloaded');
 expect((await main.invokeTool('agent_control',{action:'send',id,prompt:'Check tools again'})).ok).toBe(true);
 await expect.poll(()=>provider.requests.length).toBe(2);
 expect(provider.requests[1].tools.map(tool=>tool.name)).not.toContain('probe_value');
 await expect.poll(()=>views.some(view=>view.id===`plugin-agent-hub-agent-${id}`&&JSON.stringify(view).includes('done again'))).toBe(true);
});
it('updates the reported plugin load errors after reload and recovery',async()=>{
 const f=await fixture();await writeFile(join(f.cwd,'plugins/probe/hooks.ts'),'export default { invalid syntax');
 const a=await app(f),core=a.createCore(async()=>true);
 expect((await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'})).ok).toBe(true);
 await a.reloadPlugins(core);expect(a.pluginErrors.length).toBeGreaterThan(0);expect(core.host.hasPlugin('probe')).toBe(false);
 await writeFile(join(f.cwd,'plugins/probe/hooks.ts'),'export default {};');
 await a.reloadPlugins(core);expect(a.pluginErrors).toEqual([]);expect(core.host.hasPlugin('probe')).toBe(true);
});
it('defaults to no executable plugins, retains offline default market and does not import inactive modules',async()=>{
 const f=await fixture(),a=await app(f),core=a.createCore(async()=>true);expect(a.plugins).toEqual([]);
 await expect(readFile(join(f.root,'imported'))).rejects.toMatchObject({code:'ENOENT'});
 const markets=await core.invokeTool('marketplace_control',{action:'list'});expect(markets).toMatchObject({ok:true,output:expect.arrayContaining([expect.objectContaining({name:'agent-compositor',builtin:true})])});
 expect((await core.invokeTool('extension_control',{action:'list'})).output).toMatchObject({enabled:[],available:expect.arrayContaining([expect.objectContaining({name:'probe',version:'1.0.0',kind:'plugin',enabled:false})])});
});
it('persists project activation, leaves other projects off, and applies project overrides over user decisions',async()=>{
 const f=await fixture(),a=await app(f),core=a.createCore(async()=>true);
 expect((await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'})).ok).toBe(true);await a.reloadPlugins(core);expect(a.plugins.map(p=>p.manifest.name)).toEqual(['probe']);
 const next=await app(f);expect(next.plugins.map(p=>p.manifest.name)).toEqual(['probe']);
 const other=join(f.root,'other');await mkdir(other);expect((await app(f,other)).plugins).toEqual([]);
 expect((await core.invokeTool('extension_control',{action:'disable',name:'probe',scope:'user'})).ok).toBe(true);await a.reloadPlugins(core);expect(a.plugins.map(p=>p.manifest.name)).toEqual(['probe']);
 expect((await core.invokeTool('extension_control',{action:'disable',name:'probe',scope:'project'})).ok).toBe(true);await a.reloadPlugins(core);expect(a.plugins).toEqual([]);
});
it('preserves an exact configured capability ceiling and refuses activation of unknown packages',async()=>{
 const f=await fixture();await writeFile(join(f.cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['extension-manager']}));const a=await app(f),core=a.createCore(async()=>true);
 expect(await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'})).toMatchObject({ok:false,error:expect.stringContaining('allowlist')});
 const fresh=await fixture(),b=await app(fresh);expect((await b.createCore(async()=>true).invokeTool('extension_control',{action:'enable',name:'invented',scope:'user'})).ok).toBe(false);
});
it('resolves scoped decisions deterministically',()=>{
 expect(pluginSelection({enabled:['a'],disabled:['b']},{enabled:['b'],disabled:['a']})).toEqual(['b']);
 expect(pluginSelection({enabled:['a','b'],disabled:[]},{enabled:[],disabled:[]},['b'])).toEqual(['b']);
});

it('keeps user activation on shared code and requires explicit project consent for a local override',async()=>{
 const f=await fixture(),shared=join(f.home,'.agent-compositor/plugins/probe');await mkdir(join(shared,'..'),{recursive:true});await cp(join(f.cwd,'plugins/probe'),shared,{recursive:true});
 await writeFile(join(shared,'hooks.ts'),'export default{};');
 const a=await app(f),core=a.createCore(async()=>true);
 expect((await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'user'})).ok).toBe(true);await a.reloadPlugins(core);
 expect(a.plugins[0].dir).toBe(shared);await expect(readFile(join(f.root,'imported'))).rejects.toMatchObject({code:'ENOENT'});
 const other=join(f.root,'other');await mkdir(other);const b=await app(f,other);expect(b.plugins[0].dir).toBe(shared);
 await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'});await a.reloadPlugins(core);expect(a.plugins[0].dir).toBe(join(f.cwd,'plugins/probe'));expect(await readFile(join(f.root,'imported'),'utf8')).toBe('IMPORTED');
 await core.invokeTool('extension_control',{action:'disable',name:'probe',scope:'project'});await a.reloadPlugins(core);expect(a.plugins).toEqual([]);
 const second=b.createCore(async()=>true);await b.reloadPlugins(second);expect(b.plugins[0].dir).toBe(shared);
});

it('keeps user/project versions separate when the workspace is HOME and does not substitute a different source after removal',async()=>{
 const f=await fixture(),cwd=f.home,repo=join(f.root,'scope-market'),source=join(repo,'plugins/probe');await mkdir(source,{recursive:true});await mkdir(join(repo,'.claude-plugin'));
 const publish=async(version:string)=>{await writeFile(join(source,'plugin.json'),JSON.stringify({name:'probe',version,trust:'trusted'}));await writeFile(join(source,'tools.js'),`export default[{name:'scoped_probe',description:'Probe',parameters:{type:'object'},describe:()=>({tool:'scoped_probe',readOnly:true}),execute:async()=>({ok:true,data:'${version}'})}];`);await writeFile(join(repo,'.claude-plugin/marketplace.json'),JSON.stringify({name:'scope-market',owner:{name:'Fixture'},plugins:[{name:'probe',version,source:'./plugins/probe'}]}));};
 await publish('1.0.0');const a=await app(f,cwd),core=a.createCore(async()=>true);await core.invokeTool('marketplace_control',{action:'add',source:repo});
 expect((await core.invokeTool('extension_control',{action:'install',name:'probe@scope-market',scope:'user'})).ok).toBe(true);await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'user'});await a.reloadPlugins(core);expect(await core.invokeTool('scoped_probe',{})).toMatchObject({ok:true,output:'1.0.0'});
 await publish('1.1.0');expect((await core.invokeTool('extension_control',{action:'install',name:'probe@scope-market',scope:'project'})).ok).toBe(true);await a.reloadPlugins(core);expect(a.plugins).toEqual([]);await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'});await a.reloadPlugins(core);expect(await core.invokeTool('scoped_probe',{})).toMatchObject({ok:true,output:'1.1.0'});
 const other=await app(f),second=other.createCore(async()=>true);expect(await second.invokeTool('scoped_probe',{})).toMatchObject({ok:true,output:'1.0.0'});
 await core.invokeTool('extension_control',{action:'remove',name:'probe',scope:'project'});await a.reloadPlugins(core);expect(a.plugins).toEqual([]);
 await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'});await a.reloadPlugins(core);expect(await core.invokeTool('scoped_probe',{})).toMatchObject({ok:true,output:'1.0.0'});
 await second.invokeTool('extension_control',{action:'remove',name:'probe',scope:'user'});
 const impostor=join(cwd,'plugins/probe');await mkdir(impostor,{recursive:true});await writeFile(join(impostor,'plugin.json'),JSON.stringify({name:'probe',version:'9.0.0',trust:'trusted'}));await writeFile(join(impostor,'hooks.js'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(f.root,'impostor'))},'executed');export default{};`);
 await a.reloadPlugins(core);expect(a.plugins).toEqual([]);await expect(readFile(join(f.root,'impostor'))).rejects.toMatchObject({code:'ENOENT'});
});
