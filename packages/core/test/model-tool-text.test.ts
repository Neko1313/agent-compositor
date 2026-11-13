import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {AgentCore,ScriptedProvider,replayTranscript} from '../src/index.js';
import type {SessionEvent} from '@agent-compositor/session';
import type {ToolSpec} from '@agent-compositor/tools';

const roots:string[]=[],cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(source:string){
 const cwd=await mkdtemp(join(tmpdir(),'model-tool-text-'));roots.push(cwd);await writeFile(join(cwd,'source.mjs'),source);
 const journal:SessionEvent[]=[],provider=new ScriptedProvider([{toolCalls:[{name:'read',args:{path:'source.mjs'}}]},{text:'Read complete.'}]);
 const core=new AgentCore({cwd,provider,rules:[{tool:'edit',path:cwd+'/**',decision:'allow'}],sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});cores.push(core);
 await core.submit('Read the source before editing');
 return{cwd,core,provider,journal,sent:provider.requests[1].messages.find(message=>message.role==='tool')!.content,result:journal.find(event=>event.type==='tool.result')!};
}

it.each(['\n','\r\n'])('presents literal source with its unchanged anchor, line ending %j',async newline=>{
 const source=['export const separator="\\n";','// 😀 Unicode and tabs','export function value(){','\treturn 1;','}',''].join(newline);
 const f=await fixture(source),output=f.result.output as any;
 expect(f.sent).toBe('Read metadata (JSON):\n'+JSON.stringify({edit:output.edit,totalLines:output.totalLines,truncated:output.truncated})+'\n\nFile content (verbatim):\n'+source);
 expect(output.content).toBe(source);expect(output.edit.expectedHash).toBe(createHash('sha256').update(source).digest('hex'));expect(output.edit.range).toEqual({start:0,end:source.length});expect(output.edit.strict).toBe(true);
 const oldText=['export function value(){','\treturn 1;','}'].join(newline),newText=oldText.replace('return 1;','return 2;');
 expect(await f.core.invokeTool('edit',{...output.edit,oldText,newText})).toMatchObject({ok:true});
 expect(await readFile(join(f.cwd,'source.mjs'),'utf8')).toBe(source.replace(oldText,newText));
 expect(await f.core.invokeTool('edit',{...output.edit,oldText:newText,newText:oldText})).toMatchObject({ok:false,error:expect.stringContaining('stale')});
});

it('replays exactly the model-visible text through a JSON journal roundtrip',async()=>{
 const f=await fixture('export const x=1;\nexport const y="\\n";\n');
 expect(f.result.modelText).toBe(f.sent);
 const events=JSON.parse(JSON.stringify(f.journal));expect(replayTranscript(events).find(message=>message.role==='tool')?.content).toBe(f.sent);
 const provider=new ScriptedProvider([{text:'Continued.'}]),resumed=AgentCore.resume({cwd:f.cwd,provider},events);cores.push(resumed);await resumed.submit('Continue using the recorded source');
 expect(provider.requests[0].messages.find(message=>message.role==='tool')?.content).toBe(f.sent);
});

it.each(['\x1b[31m','bare\rreturn'])('retains escaped JSON for source containing terminal controls %j',async control=>{
 const source='line\n'+control+'\n',f=await fixture(source);
 expect(f.result.modelText).toBeUndefined();expect(JSON.parse(f.sent).content).toBe(source);
});
it('preserves rejection of binary/NUL content',async()=>{
 const f=await fixture('line\n\0\n');expect(f.result.ok).toBe(false);expect(f.result.modelText).toBeUndefined();expect(f.sent).toContain('read:');
});

it('bounds formatted output without presenting a truncated body as a complete edit source',async()=>{
 const f=await fixture('export const big="'+'x'.repeat(140000)+'";\n'),value=JSON.parse(f.sent);
 expect(value.truncated).toBe(true);expect(value).not.toHaveProperty('edit');expect(value.hint).toContain('not a complete edit source');expect(value.preview.length).toBeLessThanOrEqual(16000);
 expect(f.result.modelText).toBe(f.sent);expect((f.result.output as any).content.length).toBeGreaterThan(128*1024);
});
it('applies the same byte bound to explicit text in external replay records',()=>{
 const events:SessionEvent[]=[{type:'tool.call',callId:'big',tool:'read',input:{}},{type:'tool.result',callId:'big',tool:'read',ok:true,output:{content:'not authoritative'},modelText:'😀'.repeat(50000)}];
 const message=replayTranscript(events).find(message=>message.role==='tool')!,value=JSON.parse(message.content);
 expect(value.truncated).toBe(true);expect(value.originalBytes).toBe(200000);expect(Buffer.byteLength(message.content)).toBeLessThan(128*1024);
});

it('keeps legacy results and failures independent of optional presentation text',async()=>{
 const tools:ToolSpec[]=[{name:'legacy',description:'Legacy data',parameters:{type:'object'},describe:()=>({tool:'legacy'}),execute:async()=>({ok:true,data:{value:42}})},{name:'empty',description:'Empty presentation',parameters:{type:'object'},describe:()=>({tool:'empty'}),execute:async()=>({ok:true,data:{value:42},modelText:''})},{name:'failed',description:'Failed action',parameters:{type:'object'},describe:()=>({tool:'failed'}),execute:async()=>({ok:false,error:'Actual failure',modelText:'Pretend success'} as any)}];
 const provider=new ScriptedProvider([{toolCalls:[{name:'legacy',args:{}},{name:'empty',args:{}},{name:'failed',args:{}}]},{text:'Reported.'}]);
 const core=new AgentCore({cwd:process.cwd(),provider,tools,rules:tools.map(tool=>({tool:tool.name,decision:'allow'}))});cores.push(core);await core.submit('Inspect');
 const messages=provider.requests[1].messages.filter(message=>message.role==='tool');expect(JSON.parse(messages[0].content)).toEqual({value:42});expect(messages[1].content).toBe(messages[0].content);expect(messages[2].content).toBe('Actual failure');
 const old=replayTranscript([{type:'tool.call',callId:'old',tool:'legacy',input:{}},{type:'tool.result',callId:'old',tool:'legacy',ok:true,output:{value:42}}]);expect(JSON.parse(old.find(message=>message.role==='tool')!.content)).toEqual({value:42});
});
