import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EvalBudget,EVAL_BUDGET_POLICY} from './budget.js';
import {openEvaluationProfile,evaluationProfile} from './profile.js';
import {NetworkClient} from '../../packages/provider/src/network.js';

let root:string;
const key='test-only-profile-key',proxySecret='test-only-proxy-password';
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
const request=()=>({model:'gpt-6.1-sol',stream:true,store:false,max_output_tokens:128,include:['reasoning.encrypted_content'],tools:[],
 input:[{role:'user',content:[{type:'input_text',text:'Probe 窗'}]}]});
const terminal=(response:Record<string,unknown>={})=>'data: '+JSON.stringify({type:'response.completed',response:{id:'resp-test',service_tier:'default',
 usage:{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:8,cache_write_tokens:1}},...response}})+'\n\n';
const ledger=()=>join(root,'eval-budgets','test.json');
async function session(){return openEvaluationProfile('test',1,{existingOnly:true,parentScope:{cwd:root,env:{AGENT_HOME:root,HOME:root}}});}
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'eval-attempt-'));vi.stubEnv('AGENT_HOME',root);
 await mkdir(join(root,'eval-budgets'));
 await writeFile(join(root,'providers.json'),JSON.stringify({profiles:{test:{type:'openai-responses',baseUrl:'https://api.openai.com/v1',model:'gpt-6.1-sol',timeoutMs:1000}}}));
 await writeFile(join(root,'credentials.json'),JSON.stringify({test:{accessToken:key}}));
 await writeFile(ledger(),JSON.stringify({version:1,policy:EVAL_BUDGET_POLICY,profile:'test',model:'gpt-6.1-sol',limitMicroUsd:1e6,charges:{}}),{mode:0o600});
});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});

it('durably reserves the final body before HTTP and settles one charge independently of its consumer',async()=>{
 const seen:string[]=[],persisted=join(root,'reservation.json'),s=await session();
 const fetch=vi.fn(async(url,init)=>{
  expect(url).toBe(s.descriptor.endpoint);expect(init.headers.authorization).toBe('Bearer '+key);expect(init.redirect).toBe('error');
  expect(JSON.parse(await readFile(persisted,'utf8'))).toMatchObject({requestBytes:Buffer.byteLength(init.body),maxOutputTokens:128});
  const charges=Object.values(JSON.parse(await readFile(ledger(),'utf8')).charges);expect(charges).toHaveLength(1);expect(charges[0]).toMatchObject({status:'reserved'});
  return new Response(terminal());
 });vi.stubGlobal('fetch',fetch);
 const attempt=await s.start(request(),new AbortController().signal,{beforeEgress:async reservation=>{await writeFile(persisted,JSON.stringify(reservation));},onChunk:chunk=>{seen.push(new TextDecoder().decode(chunk));}});
 const result=await attempt.settled;
 expect(attempt.terminalObserved).toBe(true);expect(await attempt.terminalValidated).toMatchObject({reservation:attempt.reservation,usage:{inputTokens:10,outputTokens:5}});
 expect(result.budget.status).toMatchObject({reportedRequests:1,pendingRequests:0});expect(seen.join('')).toBe(terminal());
 expect(await attempt.response.text()).toBe(terminal());expect(fetch).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(s.descriptor)).not.toMatch(/test-only|credentials|proxy/);
});

it('never lets callback options replace the pinned body or budget authority',async()=>{
 const foreign=join(root,'forged-ledger.json'),s=await session();let posted:unknown;
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{posted=JSON.parse(init.body);return new Response(terminal());}));
 const attempt=await s.start(request(),new AbortController().signal,{body:{...request(),model:'other-model'},budget:new EvalBudget(foreign,'foreign','gpt-6.1-sol',50)}as never);
 await attempt.settled;expect(posted).toMatchObject({model:'gpt-6.1-sol',max_output_tokens:128});expect((await s.budget.status()).reportedRequests).toBe(1);
 await expect(readFile(foreign)).rejects.toMatchObject({code:'ENOENT'});
});

it('keeps collecting after consumer cancellation and preserves opaque reasoning and call IDs byte-for-byte',async()=>{
 let stream!:ReadableStreamDefaultController<Uint8Array>;const s=await session(),chunks:Uint8Array[]=[];
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({start(c){stream=c;}}))));
 const body=request();body.input.push({type:'reasoning',id:'reasoning-original',encrypted_content:'opaque_窗',summary:[]}as never,
  {type:'function_call',call_id:'call-original',name:'read',arguments:'{"path":"a"}'}as never,
  {type:'function_call_output',call_id:'call-original',output:'read-result'}as never);
 const attempt=await s.start(body,new AbortController().signal,{onChunk:bytes=>{chunks.push(bytes);}});
 await attempt.response.body!.cancel();
 const raw='data: '+JSON.stringify({type:'response.output_item.done',item:{type:'reasoning',encrypted_content:'opaque_窗'}})+'\n\n'+terminal();
 const bytes=new TextEncoder().encode(raw);for(const byte of bytes)stream.enqueue(new Uint8Array([byte]));stream.close();
 await attempt.settled;expect(Buffer.concat(chunks).toString()).toBe(raw);expect((await s.auditStatus()).status.reportedRequests).toBe(1);
});

it('retains the charge without HTTP when the durable pre-egress callback fails',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const s=await session();
 await expect(s.start(request(),new AbortController().signal,{beforeEgress:async()=>{throw Error('fixture persistence failed');}})).rejects.toThrow('persistence failed');
 expect(fetch).not.toHaveBeenCalled();expect(await s.budget.status()).toMatchObject({pendingRequests:1,reportedRequests:0});
});

it('revokes egress immediately but joins owned pre-egress persistence after cancellation',async()=>{
 const entered=gate(),release=gate(),controller=new AbortController(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);const s=await session();
 let settled=false;const start=s.start(request(),controller.signal,{beforeEgress:async()=>{entered.resolve();await release.promise;await writeFile(join(root,'durable.json'),'done');}});
 void start.then(()=>{settled=true;},()=>{settled=true;});await entered.promise;controller.abort();
 expect(settled).toBe(false);expect(fetch).not.toHaveBeenCalled();release.resolve();await expect(start).rejects.toThrow('aborted');
 expect(await readFile(join(root,'durable.json'),'utf8')).toBe('done');expect(fetch).not.toHaveBeenCalled();expect((await s.budget.status()).pendingRequests).toBe(1);
});

it('joins an already-started chunk persistence callback before rejecting or closing the attempt',async()=>{
 const entered=gate(),release=gate(),controller=new AbortController(),close=vi.spyOn(NetworkClient.prototype,'close');let cancelled=false;
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(terminal()));},cancel(){cancelled=true;}}))));
 const s=await session(),attempt=await s.start(request(),controller.signal,{onChunk:async()=>{entered.resolve();await release.promise;await writeFile(join(root,'chunk.json'),'done');}});
 let settled=false;void attempt.settled.then(()=>{settled=true;},()=>{settled=true;});await entered.promise;controller.abort();
 expect(cancelled).toBe(true);expect(settled).toBe(false);expect(close).not.toHaveBeenCalled();release.resolve();
 await expect(attempt.settled).rejects.toThrow('aborted');expect(await readFile(join(root,'chunk.json'),'utf8')).toBe('done');expect(close).toHaveBeenCalledTimes(1);
 expect((await s.budget.status()).pendingRequests).toBe(1);
});

it.each([{input_tokens:10,output_tokens:129},{input_tokens:10000,output_tokens:5}])('never grants terminal ownership for usage outside its actual reservation %j',async usage=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(terminal({usage}))));const s=await session(),attempt=await s.start(request(),new AbortController().signal);
 await expect(attempt.settled).rejects.toThrow('reserved token envelope');await expect(attempt.terminalValidated).rejects.toThrow('reserved token envelope');
 expect(attempt.terminalObserved).toBe(false);expect(await s.budget.status()).toMatchObject({pendingRequests:1,reportedRequests:0});
});

it.each([
 ['missing terminal','data: {"type":"response.output_text.delta","delta":"partial"}\n\n'],
 ['missing usage',terminal({usage:undefined})],
 ['duplicate terminal',terminal()+terminal()],
 ['malformed terminal','data: not-json\n\n'],
 ['provider error','data: {"type":"error","message":"test-only-profile-key"}\n\n'],
]as const)('retains one reservation for %s and records bounded raw failing bytes',async(_name,payload)=>{
 const raw:string[]=[];vi.stubGlobal('fetch',vi.fn(async()=>new Response(payload)));const s=await session(),attempt=await s.start(request(),new AbortController().signal,{onChunk:bytes=>{raw.push(new TextDecoder().decode(bytes));}});
 await expect(attempt.settled).rejects.toThrow();expect(await s.budget.status()).toMatchObject({pendingRequests:1,reportedRequests:0});expect(raw.join('')).toBe(payload);
});

it('persistently halts unconfirmed pricing but keeps its original reservation',async()=>{
 const fetch=vi.fn(async()=>new Response(terminal({service_tier:'priority'})));vi.stubGlobal('fetch',fetch);const s=await session(),raw:string[]=[];
 const attempt=await s.start(request(),new AbortController().signal,{onChunk:bytes=>{raw.push(new TextDecoder().decode(bytes));}});await expect(attempt.settled).rejects.toThrow('pricing');
 expect(attempt.terminalObserved).toBe(false);expect(raw.join('')).toBe(terminal({service_tier:'priority'}));
 const restarted=await session();await expect(restarted.start(request(),new AbortController().signal)).rejects.toThrow('stopped');expect(fetch).toHaveBeenCalledTimes(1);
 expect(await s.budget.status()).toMatchObject({pendingRequests:1,reportedRequests:0,halted:'unconfirmed-response-pricing'});
});

it('refuses a missing or subsequently removed existing ledger before egress',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const s=await session();await unlink(ledger());
 await expect(s.start(request(),new AbortController().signal)).rejects.toThrow('Existing evaluation budget');
 await expect(session()).rejects.toThrow('Existing evaluation budget');expect(fetch).not.toHaveBeenCalled();await expect(readFile(ledger())).rejects.toMatchObject({code:'ENOENT'});
});

it('does not reserve a pre-aborted call and bounds an upstream that never ends',async()=>{
 const s=await session(),controller=new AbortController(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);controller.abort(Error(key));
 await expect(s.start(request(),controller.signal)).rejects.not.toThrow(key);expect(fetch).not.toHaveBeenCalled();expect((await s.budget.status()).pendingRequests).toBe(0);
 await writeFile(join(root,'providers.json'),JSON.stringify({profiles:{test:{type:'openai-responses',baseUrl:'https://api.openai.com/v1',model:'gpt-6.1-sol',timeoutMs:25}}}));
 let cancelled=false;fetch.mockImplementation(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})));
 const held=await(await session()).start(request(),new AbortController().signal);await expect(held.settled).rejects.toThrow('deadline');expect(cancelled).toBe(true);expect((await s.budget.status()).pendingRequests).toBe(1);
});

it('bounds lines and total bytes without settling a partial completion',async()=>{
 const s=await session();vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: '+('x'.repeat(2_000_001)))));
 const line=await s.start(request(),new AbortController().signal);await expect(line.settled).rejects.toThrow('line exceeds');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(c){for(let i=0;i<17;i++)c.enqueue(new TextEncoder().encode(':'+('x'.repeat(999998))+'\n'));c.close();}}))));
 const bytes=await s.start(request(),new AbortController().signal);await expect(bytes.settled).rejects.toThrow('byte bound');expect(await s.budget.status()).toMatchObject({pendingRequests:2,reportedRequests:0});
});

it('sanitizes key and proxy credentials while closing failed HTTP resources',async()=>{
 await writeFile(join(root,'proxy.json'),JSON.stringify({enabled:true,url:'http://proxy-user:'+proxySecret+'@127.0.0.1:12345',models:true}));
 const close=vi.spyOn(NetworkClient.prototype,'close');vi.spyOn(NetworkClient.prototype,'fetch').mockReturnValue(async()=>{throw Error('network '+key+' http://proxy-user:'+proxySecret+'@127.0.0.1:12345');});
 const s=await session();let error:unknown;try{await s.start(request(),new AbortController().signal);}catch(value){error=value;}
 expect(String(error)).not.toMatch(new RegExp(key+'|'+proxySecret+'|proxy-user'));expect(close).toHaveBeenCalledTimes(1);expect((await s.budget.status()).pendingRequests).toBe(1);
});

it('uses the same exactly-once authority for typed reasoning and function round trips',async()=>{
 const payload='data: '+JSON.stringify({type:'response.output_item.done',item:{type:'reasoning',id:'r',encrypted_content:'opaque-cipher'}})+'\n\n'+
  'data: '+JSON.stringify({type:'response.output_item.done',item:{type:'function_call',call_id:'call-original',name:'read',arguments:'{"path":"a"}'}})+'\n\n'+terminal();
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(payload)));const f=await evaluationProfile('test',1),events=[];
 for await(const event of f.provider.complete({messages:[{role:'user',content:'Probe'}],tools:[],signal:new AbortController().signal,maxOutputTokens:128}))events.push(event);
 expect(events).toContainEqual({type:'tool_call',id:'call-original',name:'read',args:{path:'a'}});expect(events).toContainEqual({type:'metadata',data:{reasoning:[{type:'reasoning',id:'r',encrypted_content:'opaque-cipher'}]}});
 expect(events.at(-1)).toEqual({type:'finish',reason:'tool_calls'});expect(await f.budget.status()).toMatchObject({reportedRequests:1,pendingRequests:0});
});
