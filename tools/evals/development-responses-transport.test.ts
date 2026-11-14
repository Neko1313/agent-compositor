import {afterEach,expect,it,vi} from 'vitest';
import {createServer,request,ServerResponse} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeProvider} from '../../packages/provider/src/native.js';
import {NetworkClient} from '../../packages/provider/src/network.js';
import {EvalBudget} from './budget.js';
import {openEvaluationProfile} from './profile.js';
import {createDevelopmentResponsesTransport} from './development-responses-transport.js';
import type {DevelopmentLimits} from './development-transport.js';

const persistence=vi.hoisted(()=>({before:undefined as undefined|((path:string)=>Promise<void>)}));
vi.mock('node:fs/promises',async original=>{
  const actual=await original<typeof import('node:fs/promises')>();
  return{...actual,writeFile:async(...args:Parameters<typeof actual.writeFile>)=>{await persistence.before?.(String(args[0]));return actual.writeFile(...args);}};
});
const cleanup:(()=>Promise<unknown>)[]=[],release:(()=>void)[]=[];
afterEach(async()=>{
  for(const free of release.splice(0))free();
  for(const close of cleanup.splice(0).reverse())await close();
  persistence.before=undefined;vi.restoreAllMocks();vi.unstubAllEnvs();
});
const model='gpt-6.1-sol',fakeKey='fixture-only-saved-secret';
const limits:DevelopmentLimits={maxRequests:2,maxRequestBytes:4000,maxTotalRequestBytes:8000,maxOutputTokens:8,maxMeasuredTokens:100,maxResponseBytes:4000,deadlineMs:10000};
const body={model,stream:true,store:false,max_output_tokens:99,include:['reasoning.encrypted_content'],input:[{role:'user',content:[{type:'input_text',text:'Work'}]}],tools:[]};
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,release:resolve};}
const line=(value:unknown)=>'data: '+JSON.stringify(value)+'\n\n';
const terminal=(tier='default',usage:unknown={input_tokens:4,output_tokens:2,input_tokens_details:{cached_tokens:1,cache_write_tokens:1}})=>({type:'response.completed',response:{id:'response-fixture',service_tier:tier,usage}});
function stream(response:ServerResponse){response.setHeader('content-type','text/event-stream');response.end(line({type:'response.output_text.delta',delta:'READY'})+line(terminal()));}
async function fixture(reply:(response:ServerResponse,index:number)=>void=stream,signal?:AbortSignal,overrides:Partial<DevelopmentLimits>={}){
  const root=await mkdtemp(join(tmpdir(),'development-responses-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));vi.stubEnv('AGENT_HOME',root);
  await writeFile(join(root,'providers.json'),JSON.stringify({profiles:{test:{type:'openai-responses',baseUrl:'https://api.openai.com/v1',model,maxOutputTokens:8}}}));
  await writeFile(join(root,'credentials.json'),JSON.stringify({test:{accessToken:fakeKey}}));
  const ledger=new EvalBudget(join(root,'eval-budgets','test.json'),'test',model,1),seed=await ledger.reserve(1,1,'standard');await ledger.reported(seed,1,1);
  const bodies:Record<string,any>[]=[],headers:Record<string,unknown>[]=[],pending=new Set<ServerResponse>();let maximum=0;
  const server=createServer(async(incoming,response)=>{
    let raw='';for await(const bytes of incoming)raw+=bytes;bodies.push(JSON.parse(raw));headers.push(incoming.headers);
    pending.add(response);maximum=Math.max(maximum,pending.size);response.once('close',()=>pending.delete(response));response.setHeader('content-type','text/event-stream');reply(response,bodies.length);
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));cleanup.push(()=>new Promise<void>(done=>{server.closeAllConnections();server.close(()=>done());}));
  const address=server.address();if(!address||typeof address==='string')throw Error('No fixture server');
  const remote=vi.fn<typeof fetch>(async(url,init)=>{
    expect(String(url)).toBe('https://api.openai.com/v1/responses');expect(init?.redirect).toBe('error');
    return fetch(`http://127.0.0.1:${address.port}/v1/responses`,init);
  });
  vi.spyOn(NetworkClient.prototype,'fetch').mockReturnValue(remote);
  const authority=await openEvaluationProfile('test',1,{existingOnly:true}),session={...authority,start:vi.fn(authority.start)},output=join(root,'transport');
  const transport=await createDevelopmentResponsesTransport({session,limits:{...limits,...overrides},output,signal});cleanup.push(()=>transport.close());
  const post=(value:unknown=body,signal?:AbortSignal)=>fetch(transport.baseUrl+'/responses',{method:'POST',body:JSON.stringify(value),headers:{'content-type':'application/json',authorization:'Bearer actor-dummy'},signal});
  return{root,output,session,transport,post,bodies,headers,remote,maximum:()=>maximum};
}
const provider=(baseUrl:string)=>new NativeProvider({type:'openai-responses',baseUrl,model,apiKey:'actor-dummy',maxOutputTokens:8,retries:0});
async function complete(actor:NativeProvider,messages:Parameters<NativeProvider['complete']>[0]['messages']=[{role:'user',content:'Work'}]){
  const events=[];for await(const event of actor.complete({messages,tools:[{name:'read',description:'Read',parameters:{type:'object'}}],signal:new AbortController().signal,maxOutputTokens:8}))events.push(event);return events;
}
function holdFile(path:string){
  const entered=gate(),permit=gate(),previous=persistence.before;release.push(permit.release);
  persistence.before=async file=>{await previous?.(file);if(file===path){entered.release();await permit.promise;}};
  return{entered:entered.promise,release:permit.release};
}

it('preserves actual native Responses reasoning/call IDs and settles only through the original profile authority',async()=>{
  const reasoning={type:'reasoning',id:'reasoning-1',encrypted_content:'opaque-exact'};
  const f=await fixture((response,index)=>{
    if(index===2){stream(response);return;}
    response.end(line({type:'response.output_item.done',item:reasoning})+line({type:'response.output_item.done',item:{type:'function_call',call_id:'call-exact',name:'read',arguments:'{"path":"known.txt"}'}})+line(terminal()));
  });
  const actor=provider(f.transport.baseUrl),first=await complete(actor);
  expect(first).toContainEqual({type:'metadata',data:{reasoning:[reasoning]}});expect(first).toContainEqual({type:'tool_call',id:'call-exact',name:'read',args:{path:'known.txt'}});
  const second=await complete(actor,[{role:'user',content:'Work'},{role:'assistant',content:'',metadata:{reasoning:[reasoning]},toolCalls:[{id:'call-exact',name:'read',args:{path:'known.txt'}}]},{role:'tool',toolCallId:'call-exact',content:'File result'}]);
  expect(second.at(-1)).toEqual({type:'finish',reason:'stop'});await f.transport.finish();
  expect(f.bodies[1].input).toEqual(expect.arrayContaining([reasoning,{type:'function_call',call_id:'call-exact',name:'read',arguments:'{"path":"known.txt"}'},{type:'function_call_output',call_id:'call-exact',output:'File result'}]));
  expect(f.bodies[0]).toMatchObject({model,store:false,stream:true,max_output_tokens:8,service_tier:'default'});expect(f.headers[0].authorization).toBe('Bearer '+fakeKey);
  expect(await f.session.budget.status()).toMatchObject({reportedRequests:3,pendingRequests:0});expect(f.maximum()).toBe(1);
  const snapshot=f.transport.snapshot();expect(snapshot.receipts.every(row=>row.settled&&row.reservation)).toBe(true);expect(JSON.stringify(snapshot)).not.toContain(fakeKey);
  for(const id of [1,2]){
    expect(JSON.parse(await readFile(join(f.output,`${id}-reservation.json`),'utf8'))).toEqual(snapshot.receipts[id-1].reservation);
    expect(await readFile(join(f.output,`${id}-response.sse`),'utf8')).toContain('response.completed');
  }
  expect(await readFile(join(f.output,'1-request.json'),'utf8')).not.toContain(fakeKey);
});

it('keeps one waiter behind durable settlement, rejects overflow and enforces the next exact request cap',async()=>{
  const f=await fixture(),receipt=holdFile(join(f.output,'1-receipt.json'));
  const first=f.post().then(response=>response.text());await receipt.entered;
  const second=f.post();await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);
  const overflow=await f.post();expect(overflow.status).toBe(409);expect(await overflow.json()).toEqual({error:{code:'development_transport_refused',message:'A completion is already waiting'}});
  expect(f.bodies).toHaveLength(1);receipt.release();await first;expect((await second).status).toBe(200);
  const capped=await f.post();expect(capped.status).toBe(409);expect((await capped.json()).error).toMatchObject({code:'development_transport_refused',message:expect.stringContaining('request cap')});
  expect(f.bodies).toHaveLength(2);expect(f.maximum()).toBe(1);expect(f.transport.snapshot().halted).toContain('request cap');
});

it('seals natural actor finalization and drains a validated terminal before EOF and receipt without another attempt',async()=>{
  let upstream!:ServerResponse;
  const f=await fixture(response=>{upstream=response;response.write(line({type:'response.output_text.delta',delta:'READY'})+line(terminal())+'data: [DONE]\n\n');});release.push(()=>upstream?.end());
  const receipt=holdFile(join(f.output,'1-receipt.json')),actor=provider(f.transport.baseUrl);
  expect((await complete(actor)).at(-1)).toEqual({type:'finish',reason:'stop'});
  expect(f.transport.snapshot().pendingRequest).toBe(true);expect((await f.session.budget.status()).pendingRequests).toBe(1);
  const waiting=f.post();await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);
  const finishing=f.transport.finish();let finished=false;void finishing.then(()=>{finished=true;});await Promise.resolve();expect(finished).toBe(false);
  const sealedWaiter=await waiting;expect(sealedWaiter.status).toBe(409);expect((await sealedWaiter.json()).error.message).toBe('Development admission is sealed');
  const rejected=await f.post();expect(rejected.status).toBe(409);expect((await rejected.json()).error.message).toBe('Development admission is sealed');
  expect(f.bodies).toHaveLength(1);upstream.end();await receipt.entered;expect(finished).toBe(false);receipt.release();await finishing;
  expect(f.transport.snapshot()).toMatchObject({pendingRequest:false,halted:undefined,receipts:[{settled:true}]});expect(await f.session.budget.status()).toMatchObject({pendingRequests:0,reportedRequests:2});
});

it('fails pre-egress evidence without contacting a provider and retains an already-created reservation',async()=>{
  const f=await fixture();await mkdir(join(f.output,'1-reservation.json'));
  const response=await f.post();expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('development_transport_refused');
  expect(f.remote).not.toHaveBeenCalled();expect(await f.session.budget.status()).toMatchObject({pendingRequests:1,reportedRequests:1});expect(f.transport.snapshot().halted).toBeDefined();
});

it('fails original request persistence before the profile authority can reserve or contact a provider',async()=>{
  const f=await fixture(),start=vi.spyOn(f.session,'start');await mkdir(join(f.output,'1-request.json'));
  const response=await f.post();expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('development_transport_refused');
  expect(start).not.toHaveBeenCalled();expect(f.remote).not.toHaveBeenCalled();expect(await f.session.budget.status()).toMatchObject({pendingRequests:0,reportedRequests:1});
});

it('refuses the waiter when its predecessor gateway receipt cannot persist without refunding settled usage',async()=>{
  const f=await fixture(),receipt=holdFile(join(f.output,'1-receipt.json'));await mkdir(join(f.output,'1-receipt.json'));
  const first=f.post().then(response=>response.text()).catch(()=>undefined);await receipt.entered;
  const waiting=f.post();await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);receipt.release();await first;
  const refused=await waiting;expect(refused.status).toBe(409);expect((await refused.json()).error.code).toBe('development_transport_refused');
  expect(f.bodies).toHaveLength(1);expect(f.transport.snapshot().halted).toMatch(/EEXIST|EISDIR/);expect(await f.session.budget.status()).toMatchObject({pendingRequests:0,reportedRequests:2});
  expect(await readFile(join(f.output,'1-response.sse'),'utf8')).toContain('response.completed');
});

it('rejects malformed or substituted protocol data before the authority and persists no secret values in errors',async()=>{
  const f=await fixture(),start=vi.spyOn(f.session,'start');
  const response=await f.post({...body,model:fakeKey});expect(response.status).toBe(409);const error=await response.text();expect(error).toContain('development_transport_refused');expect(error).not.toContain(fakeKey);
  expect(start).not.toHaveBeenCalled();expect(f.remote).not.toHaveBeenCalled();expect(await f.session.budget.status()).toMatchObject({pendingRequests:0,reportedRequests:1});
});

it.each(['missing','pricing'] as const)('retains unknown charge and refuses the waiter after %s terminal metadata',async mode=>{
  let response!:ServerResponse;
  const f=await fixture(value=>{response=value;value.write(line({type:'response.output_text.delta',delta:'Partial'}));});release.push(()=>response?.end());
  const first=f.post().then(value=>value.text()).catch(()=>undefined);await expect.poll(()=>f.bodies.length).toBe(1);
  const second=f.post();await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);
  response.end(mode==='missing'?'':line(terminal('priority')));await first;
  const refused=await second;expect(refused.status).toBe(409);expect((await refused.json()).error.code).toBe('development_transport_refused');
  expect(f.bodies).toHaveLength(1);expect(await f.session.budget.status()).toMatchObject({pendingRequests:1,reportedRequests:1});
  const raw=await readFile(join(f.output,'1-response.sse'),'utf8');expect(raw).toContain('Partial');if(mode==='pricing')expect(raw).toContain('"service_tier":"priority"');
});

it.each(['abort','deadline','close'] as const)('ends an admitted NEVER body on %s without a client-end rescue',async mode=>{
  const timers=vi.spyOn(globalThis,'setTimeout'),signal=new AbortController(),f=await fixture(stream,signal.signal,{deadlineMs:987654});
  const expiry=timers.mock.calls.find(([,ms])=>ms===987654)![0];timers.mockRestore();
  let client!:ReturnType<typeof request>;
  const received=new Promise<{status:number;body:string}|{error:string}>(done=>{
    client=request(f.transport.baseUrl+'/responses',{method:'POST'},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>done({status:response.statusCode!,body}));response.on('error',error=>done({error:String(error)}));});client.on('error',error=>done({error:String(error)}));
  });release.push(()=>client.destroy());client.write(JSON.stringify(body).slice(0,10));await expect.poll(()=>f.transport.snapshot().pendingRequest).toBe(true);
  let closing:Promise<void>|undefined;
  if(mode==='close')closing=f.transport.close();else if(mode==='abort')signal.abort(Error('Operator stopped development'));else{if(typeof expiry!=='function')throw Error('Expected gateway timer');expiry();}
  await expect.poll(()=>f.transport.snapshot().pendingRequest).toBe(false);const result=await received;
  if(mode==='close'&&'error'in result)expect(result.error).toMatch(/socket|aborted|reset|closed/i);
  else{expect('status'in result).toBe(true);if(!('status'in result))throw Error(result.error);expect(result.status).toBe(409);expect(JSON.parse(result.body).error.code).toBe('development_transport_refused');}
  await closing;expect(f.remote).not.toHaveBeenCalled();expect(await f.session.budget.status()).toMatchObject({pendingRequests:0,reportedRequests:1});
});

it('does not admit a transferred client that disconnects during forwarded evidence persistence',async()=>{
  const f=await fixture(),receipt=holdFile(join(f.output,'1-receipt.json')),forwarded=holdFile(join(f.output,'2-forwarded.json')),disconnected=gate();
  const assign=ServerResponse.prototype.assignSocket,port=Number(new URL(f.transport.baseUrl).port);
  vi.spyOn(ServerResponse.prototype,'assignSocket').mockImplementation(function(this:ServerResponse,socket){if(socket.localPort===port)this.once('close',()=>{if(!this.writableEnded)disconnected.release();});return Reflect.apply(assign,this,[socket]);});
  const first=f.post().then(response=>response.text());await receipt.entered;
  const controller=new AbortController(),second=f.post(body,controller.signal);void second.catch(()=>{});await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);
  receipt.release();await first;await forwarded.entered;controller.abort();await expect(second).rejects.toBeInstanceOf(Error);await disconnected.promise;forwarded.release();
  await expect.poll(()=>f.transport.snapshot().pendingRequest).toBe(false);expect(f.bodies).toHaveLength(1);expect(await f.session.budget.status()).toMatchObject({pendingRequests:0,reportedRequests:2});
});

it('removes only the cancelled waiter and keeps the current profile request alive',async()=>{
  const f=await fixture(),receipt=holdFile(join(f.output,'1-receipt.json')),first=f.post().then(response=>response.text());await receipt.entered;
  const signal=new AbortController(),abandoned=f.post(body,signal.signal);void abandoned.catch(()=>{});await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);
  signal.abort();await expect(abandoned).rejects.toBeInstanceOf(Error);await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(0);
  expect(f.transport.snapshot()).toMatchObject({pendingRequest:true,halted:undefined});receipt.release();await first;
  const next=await f.post();expect(next.status).toBe(200);await next.text();await f.transport.finish();expect(f.bodies).toHaveLength(2);
});

it.each(['abort','deadline'] as const)('refuses the waiting caller promptly on %s before another profile reservation',async mode=>{
  const timers=vi.spyOn(globalThis,'setTimeout'),signal=new AbortController(),f=await fixture(stream,signal.signal,{deadlineMs:987651});
  const expiry=timers.mock.calls.find(([,ms])=>ms===987651)![0];timers.mockRestore();
  const receipt=holdFile(join(f.output,'1-receipt.json')),first=f.post().then(response=>response.text()).catch(()=>undefined);await receipt.entered;
  const waiting=f.post();await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);
  if(mode==='abort')signal.abort(Error('Operator stopped development'));else{if(typeof expiry!=='function')throw Error('Expected gateway deadline');expiry();}
  const refused=await waiting;expect(refused.status).toBe(409);expect((await refused.json()).error).toMatchObject({code:'development_transport_refused',message:expect.stringMatching(mode==='abort'?/Operator stopped/:/deadline/)});
  expect(f.bodies).toHaveLength(1);expect(await f.session.budget.status()).toMatchObject({pendingRequests:0,reportedRequests:2});receipt.release();await first;
});

it('joins close callers through a held gateway receipt',async()=>{
  const signal=new AbortController(),f=await fixture(stream,signal.signal),receipt=holdFile(join(f.output,'1-receipt.json'));
  const response=f.post().then(value=>value.text()).catch(()=>undefined);await receipt.entered;
  const first=f.transport.close(),second=f.transport.close();expect(first).toBe(second);let finished=false;void second.then(()=>{finished=true;});await Promise.resolve();expect(finished).toBe(false);
  receipt.release();await Promise.all([first,second,response]);expect(f.transport.snapshot().pendingRequest).toBe(false);expect(f.bodies).toHaveLength(1);
});

it.each(['abort','deadline'] as const)('still aborts a validated terminal drain on explicit %s and retains its unknown reservation',async mode=>{
  let upstream!:ServerResponse;
  const timers=vi.spyOn(globalThis,'setTimeout'),signal=new AbortController(),f=await fixture(response=>{
    upstream=response;response.write(line({type:'response.output_text.delta',delta:'READY'})+line(terminal())+'data: [DONE]\n\n');
  },signal.signal,{deadlineMs:987652});
  const expiry=timers.mock.calls.find(([,ms])=>ms===987652)![0];timers.mockRestore();release.push(()=>upstream?.end());
  expect((await complete(provider(f.transport.baseUrl))).at(-1)).toEqual({type:'finish',reason:'stop'});const finishing=f.transport.finish();
  if(mode==='abort')signal.abort(Error('Operator stopped development'));else{if(typeof expiry!=='function')throw Error('Expected gateway deadline');expiry();}
  await finishing;expect(f.transport.snapshot().halted).toMatch(mode==='abort'?/Operator stopped/:/deadline/);expect(f.bodies).toHaveLength(1);
  expect(await f.session.budget.status()).toMatchObject({pendingRequests:1,reportedRequests:1});
});

it('still aborts a consumer disconnect before a validated terminal and admits no later upstream',async()=>{
  const upstreamClosed=gate(),f=await fixture(response=>{response.once('close',upstreamClosed.release);response.write(line({type:'response.output_text.delta',delta:'Partial'}));});
  const response=await f.post(),reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('Partial');await reader.cancel();await upstreamClosed.promise;
  await expect.poll(()=>f.transport.snapshot().pendingRequest).toBe(false);expect(f.transport.snapshot().halted).toMatch(/disconnect|abort/i);
  const next=await f.post();expect(next.status).toBe(409);expect((await next.json()).error.code).toBe('development_transport_refused');expect(f.bodies).toHaveLength(1);
  expect(await f.session.budget.status()).toMatchObject({pendingRequests:1,reportedRequests:1});
});

it.each([
  ['request',{maxRequestBytes:2000,maxTotalRequestBytes:4000},true],
  ['response',{maxResponseBytes:64},false],
  ['tokens',{maxMeasuredTokens:5},false],
] as const)('preserves the %s cap before any further provider admission',async(kind,override,large)=>{
  const f=await fixture(stream,undefined,override),value=large?{...body,input:[{role:'user',content:[{type:'input_text',text:'x'.repeat(3000)}]}]}:body;
  await f.post(value).then(response=>response.text()).catch(()=>undefined);
  await expect.poll(()=>f.transport.snapshot().pendingRequest).toBe(false);
  const next=await f.post();expect(next.status).toBe(409);expect((await next.json()).error.code).toBe('development_transport_refused');
  expect(f.transport.snapshot().halted).toMatch(kind==='request'?/request byte cap/:kind==='response'?/Response byte cap/:/token stop limit/);expect(f.bodies).toHaveLength(large?0:1);
});

it('enforces total normalized request bytes before a second profile reservation',async()=>{
  const f=await fixture(stream,undefined,{maxTotalRequestBytes:4000}),value={...body,input:[{role:'user',content:[{type:'input_text',text:'x'.repeat(2200)}]}]};
  const first=await f.post(value);expect(first.status).toBe(200);await first.text();const second=await f.post(value);expect(second.status).toBe(409);
  expect((await second.json()).error.message).toContain('serialized byte cap');expect(f.bodies).toHaveLength(1);expect(await f.session.budget.status()).toMatchObject({pendingRequests:0,reportedRequests:2});
});
