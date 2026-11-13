import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,symlink,unlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentCore,ScriptedProvider} from '../src/index.js';
import type {SessionEvent} from '@agent-compositor/session';
import type {ModelProvider,CompletionRequest} from '../src/provider.js';
import scopeGuard from '../../../plugins/guard-scope/hooks.js';
import {encodeEditAnchor} from '@agent-compositor/tools';
const roots:string[]=[],cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const cwd=await mkdtemp(join(tmpdir(),'core-edit-ref-'));roots.push(cwd);await writeFile(join(cwd,'a.ts'),'old\n');return cwd;}
async function reference(core:AgentCore){const result=await core.invokeTool('read',{path:'a.ts'});expect(result.ok).toBe(true);const ref=(result.output as any).editRef;expect(ref).toEqual(expect.any(String));return ref;}
it('keeps edit permission denial binding for a valid reference',async()=>{
 const cwd=await fixture(),core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:join(cwd,'a.ts'),decision:'deny'}]});cores.push(core);
 const editRef=await reference(core);
 expect(await core.invokeTool('edit',{path:'a.ts',editRef,oldText:'old',newText:'new'})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
 expect(await core.invokeTool('edit',{editRef,oldText:'old',newText:'new'})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
 expect(await core.invokeTool('tool_help',{name:'edit',preview:{editRef,oldText:'old',newText:'new'}})).toMatchObject({ok:true,output:{permission:{decision:'deny',executionAuthorized:false}}});
 expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('old\n');
});
it('provides the derived path to pre-tool/check hooks while leaving the caller input unchanged',async()=>{
 const cwd=await fixture(),core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:join(cwd,'a.ts'),decision:'allow'}]});cores.push(core);const editRef=await reference(core);
 const phases:any[]=[];let annotation:unknown;core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='tool.call'&&e.input.tool==='edit')annotation=e.input.metadata;});
 core.host.registerPlugin({name:'observe-path',version:'1.0.0',trust:'trusted'},{'tool.call':e=>{if(e.tool==='edit')phases.push({phase:'call',input:e.input});},'tool.check':e=>{if(e.tool==='edit')phases.push({phase:'check',input:e.input});}});
 const args={editRef,oldText:'old',newText:'new'},before=structuredClone(args);
 expect(await core.invokeTool('edit',args)).toMatchObject({ok:true});expect(args).toEqual(before);
 expect(phases).toMatchObject([{phase:'call',input:{path:join(cwd,'a.ts'),editRef}},{phase:'check',input:{path:join(cwd,'a.ts'),editRef}}]);expect(annotation).toMatchObject({compositorEditInput:{pathFromReference:true}});
 expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('new\n');
});
it('retains an actual scope-guard denial even when the reference points to an attached authorized root',async()=>{
 const cwd=await fixture(),other=await fixture(),core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:join(other,'a.ts'),decision:'allow'}]});cores.push(core);await core.attachWorkspace(other);
 const read=await core.invokeTool('read',{path:join(other,'a.ts')}),editRef=(read.output as any).editRef;expect(editRef).toEqual(expect.any(String));
 core.host.registerPlugin({name:'guard-scope',version:'1.0.0',trust:'trusted'},scopeGuard);
 expect(await core.invokeTool('edit',{editRef,oldText:'old',newText:'new'})).toMatchObject({ok:false,error:expect.stringContaining('guard-scope')});
 expect(await readFile(join(other,'a.ts'),'utf8')).toBe('old\n');
});
it('gives scope guards the canonical target of a symlink, for reference-only and explicit edits',async()=>{
 const cwd=await fixture(),other=await fixture(),link=join(cwd,'linked');await symlink(other,link,'junction');
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:join(other,'a.ts'),decision:'allow'}]});cores.push(core);await core.attachWorkspace(other);
 const read=await core.invokeTool('read',{path:join(other,'a.ts')}),anchor=(read.output as any).edit,linkedPath=join(link,'a.ts');
 const editRef=encodeEditAnchor({...anchor,path:linkedPath});expect(editRef).toEqual(expect.any(String));
 core.host.registerPlugin({name:'guard-scope',version:'1.0.0',trust:'trusted'},scopeGuard);
 for(const args of [{editRef,oldText:'old',newText:'new'},{...anchor,path:linkedPath,oldText:'old',newText:'new'}])
  expect(await core.invokeTool('edit',args)).toMatchObject({ok:false,error:expect.stringContaining('guard-scope')});
 expect(await readFile(join(other,'a.ts'),'utf8')).toBe('old\n');
});
it.each(['read','write','edit'] as const)('binds %s to the approved file if a symlink changes while approval is pending',async tool=>{
 const cwd=await fixture(),a=join(cwd,'a.ts'),b=join(cwd,'denied.ts'),link=join(cwd,'active.ts');await writeFile(b,tool==='read'?'blocked\n':'old\n');await symlink(a,link);
 let approvals=0;const core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool,path:a,decision:'ask'},{tool,path:b,decision:'deny'}],onApproval:async request=>{approvals++;expect(request.descriptor.path).toBe(a);await unlink(link);await symlink(b,link);return true;}});cores.push(core);
 const args=tool==='read'?{path:link}:tool==='write'?{path:link,content:'new\n'}:{path:link,oldText:'old',newText:'new'};
 const result=await core.invokeTool(tool,args);expect(result.ok).toBe(true);expect(approvals).toBe(1);
 if(tool==='read')expect(result.output).toMatchObject({content:'old\n'});else{expect(result.output).toMatchObject({path:a});expect(await readFile(a,'utf8')).toBe('new\n');}
 expect(await readFile(b,'utf8')).toBe(tool==='read'?'blocked\n':'old\n');
});
it.each(['read','write','edit'] as const)('rejects %s if the approved canonical path becomes a different symlink during approval',async tool=>{
 const cwd=await fixture(),a=join(cwd,'a.ts'),b=join(cwd,'denied.ts'),backup=join(cwd,'before.ts');await writeFile(b,tool==='read'?'blocked\n':'old\n');
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool,path:a,decision:'ask'},{tool,path:b,decision:'deny'}],onApproval:async request=>{expect(request.descriptor.path).toBe(a);await rename(a,backup);await symlink(b,a);return true;}});cores.push(core);
 const args=tool==='read'?{path:a}:tool==='write'?{path:a,content:'new\n'}:{path:a,oldText:'old',newText:'new'};
 expect(await core.invokeTool(tool,args)).toMatchObject({ok:false,error:expect.stringContaining('target changed')});
 expect(await readFile(b,'utf8')).toBe(tool==='read'?'blocked\n':'old\n');expect(await readFile(backup,'utf8')).toBe('old\n');
});
it('uses a journaled read reference after resume without hidden session state',async()=>{
 const cwd=await fixture(),journal:SessionEvent[]=[],first=new AgentCore({cwd,provider:new ScriptedProvider([{toolCalls:[{name:'read',args:{path:'a.ts'}}]},{text:'Read complete'}]),sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});cores.push(first);
 await first.submit('Read a.ts');expect(first.failure).toBeUndefined();const editRef=(journal.find(e=>e.type==='tool.result')!.output as any).editRef;expect(editRef).toEqual(expect.any(String));
 const provider=new ScriptedProvider([{text:'Continued'}]);
 const resumed=AgentCore.resume({cwd,provider,rules:[{tool:'edit',path:join(cwd,'a.ts'),decision:'allow'}]},JSON.parse(JSON.stringify(journal)));cores.push(resumed);
 await resumed.submit('Continue');expect(provider.requests[0].messages.find(m=>m.role==='tool')?.content).toContain(editRef);
 const seen:unknown[]=[];resumed.host.registerPlugin({name:'observe-service',version:'1.0.0',trust:'trusted'},{'service.file.edit':e=>{seen.push({path:e.path,expectedHash:e.expectedHash,range:e.range,strict:e.strict,hasRef:Object.hasOwn(e,'editRef')});}});
 expect(await resumed.invokeTool('edit',{editRef,oldText:'old',newText:'new'})).toMatchObject({ok:true});expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('new\n');
 const anchor=(journal.find(e=>e.type==='tool.result')!.output as any).edit;
 expect(seen).toEqual([{path:anchor.path,expectedHash:anchor.expectedHash,range:anchor.range,strict:true,hasRef:false}]);
});
it('journals the effective target and source annotation without losing provider metadata or mutating model arguments',async()=>{
 const cwd=await fixture(),journal:SessionEvent[]=[],requests:CompletionRequest[]=[];let editRef='',step=0;
 const provider:ModelProvider={name:'metadata-fixture',async*complete(req){
  requests.push(req);step++;
  if(step<=2){yield{type:'tool_call',id:'edit-'+step,name:'edit',args:step===1?{editRef,oldText:'old',newText:'new'}:{path:'a.ts',oldText:'new',newText:'final',strict:true},metadata:{signature:'signature-'+step,compositorEditInput:{forged:true}}};yield{type:'finish',reason:'tool_calls'};}
  else{yield{type:'text_delta',text:'Finished'};yield{type:'finish',reason:'stop'};}
 }};
 const core=new AgentCore({cwd,provider,rules:[{tool:'edit',path:join(cwd,'a.ts'),decision:'allow'}],sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});cores.push(core);editRef=await reference(core);
 await core.submit('Apply the edits');expect(core.failure).toBeUndefined();
 const calls=journal.filter(e=>e.type==='tool.call'&&e.tool==='edit');
 expect(calls[0]).toMatchObject({input:{path:join(cwd,'a.ts'),editRef},metadata:{signature:'signature-1',compositorEditInput:{pathFromReference:true}}});
 expect(calls[1].metadata).toEqual({signature:'signature-2'});
 const raw=requests[1].messages.find(m=>m.toolCalls?.[0]?.id==='edit-1')!.toolCalls![0].args;expect(raw).toEqual({editRef,oldText:'old',newText:'new'});
 const replay=(await import('../src/resume.js')).replayTranscript(JSON.parse(JSON.stringify(journal)));
 const restored=replay.find(m=>m.toolCalls?.[0]?.id==='edit-1')!.toolCalls![0];expect(restored.args).toEqual({editRef,oldText:'old',newText:'new'});expect(restored.metadata).toEqual({signature:'signature-1'});
 expect(replay.find(m=>m.toolCalls?.[0]?.id==='edit-2')?.toolCalls?.[0].args).toEqual({path:'a.ts',oldText:'new',newText:'final',strict:true});
 expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('final\n');
});
it('does not transfer workspace access to a different project through a copied reference',async()=>{
 const cwd=await fixture(),first=new AgentCore({cwd,provider:new ScriptedProvider([])});cores.push(first);const editRef=await reference(first),other=await fixture();
 const core=new AgentCore({cwd:other,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:join(other,'a.ts'),decision:'allow'}]});cores.push(core);
 expect((await core.invokeTool('edit',{path:'a.ts',editRef,oldText:'old',newText:'new'})).ok).toBe(false);
 expect((await core.invokeTool('edit',{editRef,oldText:'old',newText:'new'})).ok).toBe(false);
 expect(await readFile(join(other,'a.ts'),'utf8')).toBe('old\n');expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('old\n');
});
it('rejects malformed references and conflicting guards at admission and preview before review',async()=>{
 const cwd=await fixture();let asked=0,reviewed=0,files=0;
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),permissionReview:async()=>{reviewed++;return{};},onApproval:async()=>{asked++;return false;}});cores.push(core);const editRef=await reference(core);
 core.host.registerPlugin({name:'measure',version:'1.0.0',trust:'trusted'},{'service.file.edit':()=>{files++;}});
 for(const args of [{path:'a.ts',editRef:'invalid',oldText:'old',newText:'new'},{path:'a.ts',editRef,range:{start:0,end:1},oldText:'old',newText:'new'},{editRef:'invalid',oldText:'old',newText:'new'},{editRef,range:{start:0,end:1},oldText:'old',newText:'new'}]){
  expect(await core.invokeTool('edit',args)).toMatchObject({ok:false,error:expect.stringContaining('editRef')});
  expect(await core.invokeTool('tool_help',{name:'edit',preview:args})).toMatchObject({ok:false,error:expect.stringContaining('editRef')});
 }
 expect({asked,reviewed,files}).toEqual({asked:0,reviewed:0,files:0});
});
it('checks the rewritten target path and never takes authorization from a reference',async()=>{
 const cwd=await fixture();await writeFile(join(cwd,'denied.ts'),'old\n');
 const core=new AgentCore({cwd,provider:new ScriptedProvider([]),rules:[{tool:'edit',path:join(cwd,'a.ts'),decision:'allow'},{tool:'edit',path:join(cwd,'denied.ts'),decision:'deny'}]});cores.push(core);const editRef=await reference(core);
 const deniedRead=await core.invokeTool('read',{path:'denied.ts'}),deniedRef=(deniedRead.output as any).editRef;expect(deniedRef).toEqual(expect.any(String));
 core.host.registerPlugin({name:'rewrite',version:'1.0.0',trust:'trusted'},{'tool.call':(e,$)=>e.tool==='edit'?$.next({...e,input:{editRef:deniedRef,oldText:'old',newText:'new'}}):undefined});
 expect(await core.invokeTool('edit',{path:'a.ts',editRef,oldText:'old',newText:'new'})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
 expect(await readFile(join(cwd,'denied.ts'),'utf8')).toBe('old\n');expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('old\n');
});
