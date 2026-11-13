import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,stat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentCore,type AgentCoreOptions} from '../src/loop.js';
import {ScriptedProvider} from '../src/provider.js';
import {ApprovalSession} from '@agent-compositor/permissions';
import type {ToolSpec} from '@agent-compositor/tools';

const cores:AgentCore[]=[],roots:string[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(options:Partial<AgentCoreOptions>={}){
 const root=await mkdtemp(join(tmpdir(),'permission-preview-'));roots.push(root);const cwd=join(root,'project');await mkdir(cwd);
 let executions=0;
 const probe:ToolSpec<any>={name:'probe',description:'A guarded action',parameters:{type:'object'},describe:args=>({tool:'probe',command:['do',args.action]}),execute:async()=>{executions++;return{ok:true,data:'executed'};}};
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),extraTools:[probe],...options});cores.push(core);
 return{core,cwd,root,executions:()=>executions};
}
const preview=(core:AgentCore,action:string)=>core.invokeTool('tool_help',{name:'probe',preview:{action}});

it('previews allow/ask/deny without executing, reviewing, asking or exposing rules',async()=>{
 let reviewed=0,asked=0,targetChecks=0;
 const f=await fixture({rules:[{tool:'probe',command:'do allowed',decision:'allow',reason:'PRIVATE_RULE_REASON'},{tool:'probe',command:'do blocked',decision:'deny'}],permissionReview:async()=>{reviewed++;return{value:{decision:'allow',risk:'low',reason:'Reviewed'}};},onApproval:async()=>{asked++;return true;}});
 f.core.host.registerPlugin({name:'observer',version:'1.0.0',trust:'trusted'},{'tool.check':e=>{if(e.tool==='probe')targetChecks++;}});
 for(const [action,decision] of [['allowed','allow'],['other','ask'],['blocked','deny']]){
  const result=await preview(f.core,action);
  expect(result).toMatchObject({ok:true,output:{permission:{decision,scope:'rules-and-session-approvals',executionAuthorized:false}}});
  expect(JSON.stringify(result)).not.toContain('PRIVATE_RULE_REASON');
 }
 expect(f.executions()).toBe(0);expect(reviewed).toBe(0);expect(asked).toBe(0);expect(targetChecks).toBe(0);
 expect(await f.core.invokeTool('probe',{action:'other'})).toMatchObject({ok:true});
 expect(reviewed).toBe(1);expect(asked).toBe(0);expect(f.executions()).toBe(1);
});

it('rechecks session approvals instead of treating a preview as an authorization grant',async()=>{
 const approvals=new ApprovalSession();approvals.approve({tool:'probe',command:['do','approved']});
 let asked=0;const f=await fixture({approvals,onApproval:async()=>{asked++;return false;}});
 expect(await preview(f.core,'approved')).toMatchObject({output:{permission:{decision:'allow',via:'approval',executionAuthorized:false}}});
 expect(approvals.list()).toHaveLength(1);approvals.revoke(0);
 expect(await f.core.invokeTool('probe',{action:'approved'})).toMatchObject({ok:false});
 expect(asked).toBe(1);expect(f.executions()).toBe(0);expect(approvals.list()).toHaveLength(0);
});

it('keeps actual plugin guards and argument rewrites after an allowed snapshot',async()=>{
 const f=await fixture({rules:[{tool:'probe',command:'do allowed',decision:'allow'},{tool:'probe',command:'do blocked',decision:'deny'}]});
 expect(await preview(f.core,'allowed')).toMatchObject({output:{permission:{decision:'allow'}}});
 f.core.host.registerPlugin({name:'rewrite',version:'1.0.0',trust:'trusted'},{'tool.call':(e,$)=>e.tool==='probe'?$.next({...e,input:{action:'blocked'}}):undefined});
 expect(await f.core.invokeTool('probe',{action:'allowed'})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
 expect(f.executions()).toBe(0);
 const guarded=await fixture({rules:[{tool:'probe',decision:'allow'}]});
 guarded.core.host.registerPlugin({name:'guard',version:'1.0.0',trust:'trusted'},{'tool.check':e=>e.tool==='probe'?{decision:'deny',reason:'Dynamic guard'}:undefined});
 expect(await preview(guarded.core,'allowed')).toMatchObject({output:{permission:{decision:'allow'}}});
 expect(await guarded.core.invokeTool('probe',{action:'allowed'})).toMatchObject({ok:false,error:expect.stringContaining('Dynamic guard')});
 expect(guarded.executions()).toBe(0);
});

it('uses the actual file confinement and read-only shell classification without writing or running a check',async()=>{
 const f=await fixture();
 expect(await f.core.invokeTool('tool_help',{name:'exec',preview:{command:'pwd'}})).toMatchObject({ok:true,output:{permission:{decision:'allow'}}});
 expect(await f.core.invokeTool('tool_help',{name:'exec',preview:{command:'npm test'}})).toMatchObject({ok:true,output:{permission:{decision:'ask'}}});
 expect(await f.core.invokeTool('tool_help',{name:'write',preview:{path:'new.txt',content:'must not write'}})).toMatchObject({ok:true,output:{permission:{decision:'ask'}}});
 await expect(stat(join(f.cwd,'new.txt'))).rejects.toMatchObject({code:'ENOENT'});
 await symlink(f.root,join(f.cwd,'escape'));
 expect(await f.core.invokeTool('tool_help',{name:'write',preview:{path:'escape/outside.txt',content:'must not escape'}})).toMatchObject({ok:false});
 await expect(stat(join(f.root,'outside.txt'))).rejects.toMatchObject({code:'ENOENT'});
});

it('rejects malformed or unavailable previews while preserving ordinary help',async()=>{
 const f=await fixture();
 for(const args of [{preview:{}},{name:'probe',preview:null},{name:'probe',preview:[]},{name:'missing',preview:{}}])
  expect(await f.core.invokeTool('tool_help',args)).toMatchObject({ok:false});
 expect(await f.core.invokeTool('tool_help',{name:'probe'})).toMatchObject({ok:true,output:{name:'probe'}});
 expect(await f.core.invokeTool('tool_help',{})).toMatchObject({ok:true,output:expect.any(Array)});
 expect(f.executions()).toBe(0);
});

it('bounds repeated identical successful previews using the existing query-recovery guard',async()=>{
 const provider=new ScriptedProvider(Array.from({length:12},()=>({toolCalls:[{name:'tool_help',args:{name:'probe',preview:{action:'other'}}}]})));
 const f=await fixture({provider});await f.core.submit('Inspect permission for an existing action');
 expect(f.core.failure).toContain('Repeated query results');expect(provider.requests).toHaveLength(7);expect(f.executions()).toBe(0);
});
