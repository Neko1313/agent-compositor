import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentCore,ScriptedProvider} from '../src/index.js';
import type {SessionEvent} from '@agent-compositor/session';
const roots:string[]=[],cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const cwd=await mkdtemp(join(tmpdir(),'core-edit-ref-'));roots.push(cwd);await writeFile(join(cwd,'a.ts'),'old\n');return cwd;}
async function reference(core:AgentCore){const result=await core.invokeTool('read',{path:'a.ts'});expect(result.ok).toBe(true);const ref=(result.output as any).editRef;expect(ref).toEqual(expect.any(String));return ref;}
it('keeps edit permission denial binding for a valid reference',async()=>{
 const cwd=await fixture(),core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:join(cwd,'a.ts'),decision:'deny'}]});cores.push(core);
 const editRef=await reference(core);
 expect(await core.invokeTool('edit',{path:'a.ts',editRef,oldText:'old',newText:'new'})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
 expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('old\n');
});
it('uses a journaled read reference after resume without hidden session state',async()=>{
 const cwd=await fixture(),journal:SessionEvent[]=[],first=new AgentCore({cwd,provider:new ScriptedProvider([{toolCalls:[{name:'read',args:{path:'a.ts'}}]},{text:'Read complete'}]),sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});cores.push(first);
 await first.submit('Read a.ts');expect(first.failure).toBeUndefined();const editRef=(journal.find(e=>e.type==='tool.result')!.output as any).editRef;expect(editRef).toEqual(expect.any(String));
 const provider=new ScriptedProvider([{text:'Continued'}]);
 const resumed=AgentCore.resume({cwd,provider,rules:[{tool:'edit',path:join(cwd,'a.ts'),decision:'allow'}]},JSON.parse(JSON.stringify(journal)));cores.push(resumed);
 await resumed.submit('Continue');expect(provider.requests[0].messages.find(m=>m.role==='tool')?.content).toContain(editRef);
 const seen:unknown[]=[];resumed.host.registerPlugin({name:'observe-service',version:'1.0.0',trust:'trusted'},{'service.file.edit':e=>{seen.push({path:e.path,expectedHash:e.expectedHash,range:e.range,strict:e.strict,hasRef:Object.hasOwn(e,'editRef')});}});
 expect(await resumed.invokeTool('edit',{path:'a.ts',editRef,oldText:'old',newText:'new'})).toMatchObject({ok:true});expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('new\n');
 const anchor=(journal.find(e=>e.type==='tool.result')!.output as any).edit;
 expect(seen).toEqual([{path:anchor.path,expectedHash:anchor.expectedHash,range:anchor.range,strict:true,hasRef:false}]);
});
it('does not transfer workspace access to a different project through a copied reference',async()=>{
 const cwd=await fixture(),first=new AgentCore({cwd,provider:new ScriptedProvider([])});cores.push(first);const editRef=await reference(first),other=await fixture();
 const core=new AgentCore({cwd:other,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:join(other,'a.ts'),decision:'allow'}]});cores.push(core);
 expect((await core.invokeTool('edit',{path:'a.ts',editRef,oldText:'old',newText:'new'})).ok).toBe(false);
 expect(await readFile(join(other,'a.ts'),'utf8')).toBe('old\n');expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('old\n');
});
it('rejects malformed references and conflicting guards at admission and preview before review',async()=>{
 const cwd=await fixture();let asked=0,reviewed=0,files=0;
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),permissionReview:async()=>{reviewed++;return{};},onApproval:async()=>{asked++;return false;}});cores.push(core);const editRef=await reference(core);
 core.host.registerPlugin({name:'measure',version:'1.0.0',trust:'trusted'},{'service.file.edit':()=>{files++;}});
 for(const args of [{path:'a.ts',editRef:'invalid',oldText:'old',newText:'new'},{path:'a.ts',editRef,range:{start:0,end:1},oldText:'old',newText:'new'}]){
  expect(await core.invokeTool('edit',args)).toMatchObject({ok:false,error:expect.stringContaining('editRef')});
  expect(await core.invokeTool('tool_help',{name:'edit',preview:args})).toMatchObject({ok:false,error:expect.stringContaining('editRef')});
 }
 expect({asked,reviewed,files}).toEqual({asked:0,reviewed:0,files:0});
});
it('checks the rewritten target path and never takes authorization from a reference',async()=>{
 const cwd=await fixture();await writeFile(join(cwd,'denied.ts'),'old\n');
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:join(cwd,'a.ts'),decision:'allow'},{tool:'edit',path:join(cwd,'denied.ts'),decision:'deny'}]});cores.push(core);const editRef=await reference(core);
 core.host.registerPlugin({name:'rewrite',version:'1.0.0',trust:'trusted'},{'tool.call':(e,$)=>e.tool==='edit'?$.next({...e,input:{...e.input,path:'denied.ts'}}):undefined});
 expect(await core.invokeTool('edit',{path:'a.ts',editRef,oldText:'old',newText:'new'})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
 expect(await readFile(join(cwd,'denied.ts'),'utf8')).toBe('old\n');expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('old\n');
});
