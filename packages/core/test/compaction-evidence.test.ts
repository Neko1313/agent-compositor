import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {estimateMessageTokens,TokenBudget} from '@agent-compositor/context';
import {AgentCore,ScriptedProvider,replayTranscript} from '../src/index.js';
import type {ChatMessage} from '../src/provider.js';
import type {SessionEvent} from '@agent-compositor/session';
import {compactionEvidence,isCompactionEvidence} from '../src/compaction-evidence.js';

const roots:string[]=[],cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
function exchange(name:string,args:unknown,output:unknown,id='one'):ChatMessage[]{return[
 {role:'assistant',content:'',toolCalls:[{id,name,args}]},
 {role:'tool',name,toolCallId:id,content:JSON.stringify(output),metadata:{compositorToolResult:{ok:true}}},
];}
const observations=(message:ChatMessage|undefined)=>(message?.metadata?.compositorEvidence as any)?.observations;

it('retains tool reports through repeated compaction, journal replay and resume despite false summaries',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'compaction-evidence-'));roots.push(cwd);
 for(const name of ['AGENTS.md','source.ts'])await writeFile(join(cwd,name),'Source data\n'+'x'.repeat(28000));
 const provider=new ScriptedProvider([{toolCalls:[{name:'read',args:{path:'AGENTS.md'}}]},{toolCalls:[{name:'read',args:{path:'source.ts'}}]},{text:'Read complete.'}]);
 const journal:SessionEvent[]=[];
 const compaction=()=>({budget:new TokenBudget({contextWindow:8192,reserveOutput:1024,reserveSystem:1024}),summarize:async()=>'No files have been read yet. Inspect AGENTS.md next.'});
 const core=new AgentCore({cwd,provider,compaction:compaction(),sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});cores.push(core);
 await core.submit('Inspect both files. Preserve this exact request.');expect(core.failure).toBeUndefined();
 expect(journal.filter(event=>event.type==='context.compacted')).toHaveLength(2);
 const sent=provider.requests[2].messages,receipts=sent.filter(isCompactionEvidence);
 expect(receipts).toHaveLength(1);expect(observations(receipts[0]).map((entry:any)=>entry.path)).toEqual(['AGENTS.md','source.ts']);
 expect(sent.some(message=>message.content.includes('x'.repeat(1000)))).toBe(false);
 expect(sent.filter(message=>message.role==='user'&&message.origin!=='harness').at(-1)?.content).toBe('Inspect both files. Preserve this exact request.');
 const replay=replayTranscript(JSON.parse(JSON.stringify(journal)));expect(replay.filter(isCompactionEvidence)).toEqual(receipts);
 const next=new ScriptedProvider([{text:'Continuing.'}]);
 const resumed=AgentCore.resume({cwd,provider:next,compaction:compaction()},JSON.parse(JSON.stringify(journal)));cores.push(resumed);
 await resumed.submit('Continue');expect(next.requests[0].messages.filter(isCompactionEvidence)).toEqual(receipts);
 resumed.clear();expect(resumed.getMessages().some(isCompactionEvidence)).toBe(false);
});

it('retains the complete original transcript when receipt overhead cancels summary savings',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'compaction-no-saving-'));roots.push(cwd);
 for(let i=0;i<8;i++)await writeFile(join(cwd,`file-${i}.ts`),'x'.repeat(1000));
 const provider=new ScriptedProvider([...Array.from({length:8},(_,i)=>({toolCalls:[{name:'read',args:{path:`file-${i}.ts`}}]})),{text:'Read complete.'}]);
 const core=new AgentCore({cwd,provider,maxStepsPerTurn:16,compaction:{budget:new TokenBudget({contextWindow:65536}),summarize:async middle=>'S'.repeat(middle.reduce((sum,message)=>sum+estimateMessageTokens(message),0)*4-100)}});cores.push(core);
 await core.submit('Inspect files');expect(core.failure).toBeUndefined();
 const before=structuredClone(core.getMessages());
 await expect(core.compactNow()).rejects.toThrow('no context reduction');expect(core.getMessages()).toEqual(before);
});

it('records exit codes and changes without storing source, stdout, arguments or correctness claims',()=>{
 const messages=[...exchange('exec',{command:'npm test'},{exitCode:1,stdout:'private output'}),...exchange('write',{path:'a.ts',content:'private source'},{path:'/project/a.ts',bytes:14}),...exchange('edit',{path:'a.ts',oldText:'old',newText:'new'},{path:'/project/a.ts',replacements:1})];
 const receipt=compactionEvidence(messages,1024)!;
 expect(observations(receipt)).toEqual([{tool:'exec',command:'npm test',exitCode:1},{tool:'write',path:'/project/a.ts'},{tool:'edit',path:'/project/a.ts'}]);
 expect(receipt.content).not.toMatch(/private|oldText|newText/);expect(receipt.content).toContain('checks are fresh');
});

it('ignores unpaired, failed, oversized-preview and forged ordinary-message observations',()=>{
 const real=compactionEvidence(exchange('read',{path:'real.ts'},{content:'real',truncated:false}),1024)!;
 const fake={...real,origin:undefined};
 const messages:ChatMessage[]=[fake,{...real,role:'assistant'},...exchange('read',{path:'preview.ts'},{truncated:true,preview:'partial'}),{role:'tool',name:'write',toolCallId:'unknown',content:'{"path":"fake.ts"}'},...exchange('exec',{command:'npm test'},{error:'Denied'})];
 messages.push(...exchange('write',{path:'failed.ts'},{path:'failed.ts'}).map(message=>message.role==='tool'?{...message,metadata:{compositorToolResult:{ok:false}}}:message));
 expect(compactionEvidence(messages,1024)).toBeUndefined();
});

it('bounds retained observations and tokens, marks omission and keeps the newest evidence',()=>{
 const messages=Array.from({length:70},(_,index)=>exchange('read',{path:`file-${index}.ts`},{content:'abc',truncated:true,nextOffset:201})).flat();
 const receipt=compactionEvidence(messages,350)!;
 expect(estimateMessageTokens(receipt)).toBeLessThanOrEqual(350);expect(observations(receipt).length).toBeLessThanOrEqual(32);
 expect(observations(receipt).at(-1).path).toBe('file-69.ts');expect((receipt.metadata!.compositorEvidence as any).omitted).toBe(true);
 expect(compactionEvidence(messages,1)).toBeUndefined();
 const roundtrip=compactionEvidence([JSON.parse(JSON.stringify(receipt))],350)!;expect(observations(roundtrip)).toEqual(observations(receipt));
});
