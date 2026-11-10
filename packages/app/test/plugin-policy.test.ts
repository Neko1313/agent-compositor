import {afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,readFile,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
import {pluginSelection} from '../src/plugin-activation.js';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const a of apps.splice(0))await a.close();for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'ac-policy-'));roots.push(root);const cwd=join(root,'project'),home=join(root,'home'),source=join(cwd,'plugins/probe');await mkdir(source,{recursive:true});await mkdir(home);await writeFile(join(source,'plugin.json'),JSON.stringify({name:'probe',version:'1.0.0',trust:'trusted'}));await writeFile(join(source,'hooks.ts'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(root,'imported'))},'IMPORTED');export default{};`);return{root,cwd,home};}
async function app(f:Awaited<ReturnType<typeof fixture>>,cwd=f.cwd){const a=await buildApp({cwd,env:{HOME:f.home},provider:new ScriptedProvider([]),agentHub:false});apps.push(a);return a;}
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
