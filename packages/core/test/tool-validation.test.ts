import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentCore,ScriptedProvider} from '../src/index.js';
import type {ToolSpec} from '@agent-compositor/tools';
const cores:AgentCore[]=[],roots:string[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const cwd=await mkdtemp(join(tmpdir(),'tool-validation-'));roots.push(cwd);return cwd;}

it.each([{strict:true},{expectedHash:'0'.repeat(64)},{range:{start:0,end:4}}])('rejects certain no-op edits before review/approval/file services: %j',async anchor=>{
 const cwd=await fixture();let reviewed=0,asked=0,files=0,checks=0;
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),permissionReview:async()=>{reviewed++;return{};},onApproval:async()=>{asked++;return false;}});cores.push(core);
 core.host.registerPlugin({name:'measure',version:'1.0.0',trust:'trusted'},{'service.file.read':()=>{files++;},'service.file.edit':()=>{files++;},'tool.check':e=>{if(e.tool==='edit')checks++;}});
 const args={path:'missing.ts',oldText:'same',newText:'same',...anchor};
 expect(await core.invokeTool('edit',args)).toMatchObject({ok:false,error:expect.stringContaining('edit.newText is identical')});
 expect(await core.invokeTool('tool_help',{name:'edit',preview:args})).toMatchObject({ok:false,error:expect.stringContaining('edit.newText is identical')});
 expect({reviewed,asked,files,checks}).toEqual({reviewed:0,asked:0,files:0,checks:0});
});

it('sends corrected edits through normal permission handling instead of treating validation as a refusal or grant',async()=>{
 const cwd=await fixture();await writeFile(join(cwd,'a.ts'),'old');let asked=0;
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),onApproval:async()=>{asked++;return false;}});cores.push(core);
 expect(await core.invokeTool('edit',{path:'a.ts',oldText:'old',newText:'old',strict:true})).toMatchObject({ok:false,error:expect.stringContaining('identical')});
 expect(asked).toBe(0);
 expect(await core.invokeTool('edit',{path:'a.ts',oldText:'old',newText:'new',strict:true})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
 expect(asked).toBe(1);expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('old');
});

it('preserves unguarded whitespace normalization when equal arguments can change actual source',async()=>{
 const cwd=await fixture();await writeFile(join(cwd,'a.ts'),'a   b\na   b\n');
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:cwd+'/**',decision:'allow'}]});cores.push(core);
 expect(await core.invokeTool('edit',{path:'a.ts',oldText:'a b',newText:'a b',replaceAll:true})).toMatchObject({ok:true,output:{match:'normalized',replacements:2}});
 expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('a b\na b\n');
});

it('validates effective rewritten calls, while a validator cannot rewrite the arguments used for policy or execution',async()=>{
 const cwd=await fixture();let executions=0,described=0;
 const tool:ToolSpec<any>={name:'probe',description:'Validated action',parameters:{type:'object'},validate:args=>{const invalid=args.action==='invalid';args.action='mutated';return invalid?'probe.action is invalid':undefined;},describe:args=>{described++;return{tool:'probe',command:['do',args.action]};},execute:async(_ctx,args)=>{executions++;return{ok:true,data:args.action};}};
 const alias:ToolSpec<any>={name:'alias',description:'Rewritten action',parameters:{type:'object'},validate:()=> 'Original tool must not run',describe:()=>({tool:'alias'}),execute:async()=>{throw Error('Original tool must not execute');}};
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),extraTools:[tool,alias],rules:[{tool:'probe',command:'do allowed',decision:'allow'}]});cores.push(core);
 expect(await core.invokeTool('probe',{action:'allowed'})).toMatchObject({ok:true,output:'allowed'});expect(described).toBe(1);
 core.host.registerPlugin({name:'rewrite',version:'1.0.0',trust:'trusted'},{'tool.call':(e,$)=>e.tool==='probe'?$.next({...e,input:{action:'invalid'}}):e.tool==='alias'?$.next({...e,tool:'probe',input:{action:'allowed'}}):undefined});
 expect(await core.invokeTool('probe',{action:'allowed'})).toMatchObject({ok:false,error:'probe.action is invalid'});
 expect(described).toBe(1);expect(executions).toBe(1);
 expect(await core.invokeTool('alias',{action:'invalid'})).toMatchObject({ok:true,output:'allowed'});expect(described).toBe(2);expect(executions).toBe(2);
});

it('contains validator exceptions and malformed asynchronous returns without executing the action',async()=>{
 const cwd=await fixture();let executions=0;
 const tools:ToolSpec<any>[]=[()=>{throw Error('Bad argument');},()=>Promise.reject(Error('Unsupported async validator'))].map((validate,index)=>({name:'probe'+index,description:'Invalid validator',parameters:{type:'object'},validate:validate as any,describe:()=>({tool:'probe'+index}),execute:async()=>{executions++;return{ok:true,data:'wrong'};}}));
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),extraTools:tools});cores.push(core);
 expect(await core.invokeTool('probe0',{})).toMatchObject({ok:false,error:expect.stringContaining('Bad argument')});
 expect(await core.invokeTool('probe1',{})).toMatchObject({ok:false,error:expect.stringContaining('validator must return')});expect(executions).toBe(0);
});
it.each([null,false])('does not treat a malformed falsy validator %s as an absent callback',async validate=>{
 const cwd=await fixture();let executions=0;
 const tool:ToolSpec<any>={name:'probe',description:'Malformed validator',parameters:{},validate:validate as any,describe:()=>({tool:'probe'}),execute:async()=>{executions++;return{ok:true,data:'wrong'};}};
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),extraTools:[tool],rules:[{tool:'probe',decision:'allow'}]});cores.push(core);
 expect(await core.invokeTool('probe',{})).toMatchObject({ok:false,error:expect.stringContaining('validator must be a function')});expect(executions).toBe(0);
});
