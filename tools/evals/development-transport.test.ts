import {afterEach,expect,it,vi} from 'vitest';
import {createServer,request,ServerResponse} from 'node:http';
import {mkdtemp,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDevelopmentTransport,validateDevelopmentProvider,validateDevelopmentLimits,type DevelopmentLimits} from './development-transport.js';
import {OpenAICompatProvider} from '../../packages/provider/src/openai-compat.js';

const persistence=vi.hoisted(()=>({before:undefined as undefined|((path:string)=>Promise<void>),after:undefined as undefined|((path:string)=>void)}));
vi.mock('node:fs/promises',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  return{...actual,appendFile:async(...args:Parameters<typeof actual.appendFile>)=>{
    await persistence.before?.(String(args[0]));await actual.appendFile(...args);persistence.after?.(String(args[0]));
  },writeFile:async(...args:Parameters<typeof actual.writeFile>)=>{
    await persistence.before?.(String(args[0]));await actual.writeFile(...args);persistence.after?.(String(args[0]));
  }};
});

const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();persistence.before=undefined;persistence.after=undefined;vi.restoreAllMocks();});
const limits:DevelopmentLimits={maxRequests:2,maxRequestBytes:2000,maxTotalRequestBytes:4000,maxOutputTokens:8,maxMeasuredTokens:100,maxResponseBytes:4000,deadlineMs:10000};
const body={model:'fixture',stream:true,max_tokens:99,messages:[{role:'user',content:'work'}]};
async function fixture(reply:(response:ServerResponse)=>void,signal?:AbortSignal,overrides:Partial<DevelopmentLimits>={}){
  const root=await mkdtemp(join(tmpdir(),'development-transport-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const upstreamBodies:any[]=[],upstreamHeaders:unknown[]=[];let inFlight=0,maximumInFlight=0;
  const server=createServer(async(request,response)=>{let text='';for await(const chunk of request)text+=chunk;upstreamBodies.push(JSON.parse(text));upstreamHeaders.push(request.headers);
    inFlight++;maximumInFlight=Math.max(maximumInFlight,inFlight);response.once('close',()=>{inFlight--;});reply(response);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No fixture address');
  cleanup.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  const output=join(root,'transport'),transport=await createDevelopmentTransport({provider:{kind:'ollama',baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'fixture'},limits:{...limits,...overrides},output,signal});cleanup.push(()=>transport.close());
  const post=(value:unknown=body,signal?:AbortSignal)=>fetch(transport.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'must-not-be-forwarded'},body:JSON.stringify(value),signal});
  return{root,output,transport,post,upstreamBodies,upstreamHeaders,maximumInFlight:()=>maximumInFlight};
}
const stream=(response:ServerResponse,usage:unknown={prompt_tokens:4,completion_tokens:2})=>{response.setHeader('content-type','text/event-stream');response.end('data: '+JSON.stringify({choices:[{delta:{content:'Observed'},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage})+'\n\ndata: [DONE]\n\n');};
function gate(){let release!:()=>void;const promise=new Promise<void>(done=>{release=done;});return{promise,release};}
function receiptGate(output:string,id=1,fail=false){
  const entered=gate(),permit=gate(),path=join(output,`${id}-receipt.json`);let committed=false;
  persistence.before=async file=>{if(file!==path)return;entered.release();await permit.promise;if(fail)throw Error('Controlled receipt commit failure');};
  persistence.after=file=>{if(file===path)committed=true;};cleanup.push(async()=>permit.release());
  return{entered:entered.promise,release:permit.release,committed:()=>committed};
}
const actor=(baseUrl:string)=>new OpenAICompatProvider({baseUrl,model:'fixture',apiKey:'local-fixture',maxOutputTokens:8,timeoutMs:10000});
async function complete(provider:OpenAICompatProvider,text:string){
  const events=[];for await(const event of provider.complete({messages:[{role:'user',content:text}],tools:[],signal:new AbortController().signal,maxOutputTokens:8}))events.push(event);return events;
}

it('serializes real DONE-consuming actor calls behind durable receipts, bounds one waiter and enforces the exact cap',async()=>{
  const persistedAtAdmission:boolean[]=[];let committed=()=>false;
  const f=await fixture(response=>{persistedAtAdmission.push(committed());stream(response);}),receipt=receiptGate(f.output);committed=receipt.committed;
  const provider=actor(f.transport.baseUrl),first=complete(provider,'first');await receipt.entered;
  expect(await first).toContainEqual({type:'finish',reason:'stop'});expect(receipt.committed()).toBe(false);
  const second=complete(provider,'second');await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);
  const overflow=await f.post();expect(overflow.status).toBe(409);expect(await overflow.json()).toEqual({error:{message:'A completion is already waiting'}});
  expect(f.upstreamBodies).toHaveLength(1);expect(f.transport.snapshot().halted).toBeUndefined();receipt.release();
  expect(await second).toContainEqual({type:'finish',reason:'stop'});expect(persistedAtAdmission).toEqual([false,true]);
  const capped=await f.post();expect(capped.status).toBe(409);expect(await capped.json()).toEqual({error:{message:'Error: Whole-attempt request cap reached'}});
  expect(f.transport.snapshot().halted).toContain('request cap');expect(f.upstreamBodies).toHaveLength(2);expect(f.maximumInFlight()).toBe(1);
});

it('keeps a valid DONE-consumed stream alive until HTTP EOF and its receipt settle before the next actor call',async()=>{
  let firstResponse!:ServerResponse;
  const f=await fixture(response=>{
    if(f.upstreamBodies.length!==1){stream(response);return;}firstResponse=response;
    response.writeHead(200,{'content-type':'text/event-stream'});
    response.write('data: '+JSON.stringify({choices:[{delta:{content:'Observed'},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:4,completion_tokens:2}})+'\n\ndata: [DONE]\n\n');
  });cleanup.push(async()=>firstResponse?.end());
  const provider=actor(f.transport.baseUrl);expect(await complete(provider,'first')).toContainEqual({type:'finish',reason:'stop'});
  const second=complete(provider,'second');await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);
  expect(f.transport.snapshot().halted).toBeUndefined();expect(f.upstreamBodies).toHaveLength(1);expect(firstResponse.destroyed).toBe(false);
  firstResponse.end();expect(await second).toContainEqual({type:'finish',reason:'stop'});await f.transport.close();
  expect(f.upstreamBodies).toHaveLength(2);expect(f.maximumInFlight()).toBe(1);expect(f.transport.snapshot().halted).toBeUndefined();
  expect(JSON.parse(await readFile(join(f.output,'1-receipt.json'),'utf8')).error).toBeUndefined();
});

it('refuses a queued actor call when the prior receipt cannot be persisted',async()=>{
  const f=await fixture(stream),receipt=receiptGate(f.output,1,true),provider=actor(f.transport.baseUrl),first=complete(provider,'first');await receipt.entered;await first;
  const second=complete(provider,'second');await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);receipt.release();
  expect(await second).toContainEqual(expect.objectContaining({type:'finish',reason:'error',error:expect.stringContaining('HTTP 409:')}));
  expect(f.transport.snapshot().halted).toContain('Controlled receipt commit failure');expect(f.upstreamBodies).toHaveLength(1);expect(f.transport.snapshot().receipts).toHaveLength(1);
});

it('does not contact the model when a transferred client disconnects during request evidence persistence',async()=>{
  const f=await fixture(stream),receipt=receiptGate(f.output),forwarded=gate(),permit=gate(),settled=gate(),disconnected=gate();cleanup.push(async()=>permit.release());
  const before=persistence.before!,after=persistence.after!;
  persistence.before=async file=>{await before(file);if(file===join(f.output,'2-forwarded.json')){forwarded.release();await permit.promise;}};
  persistence.after=file=>{after(file);if(file===join(f.output,'2-receipt.json'))settled.release();};
  const assign=ServerResponse.prototype.assignSocket,port=Number(new URL(f.transport.baseUrl).port);
  vi.spyOn(ServerResponse.prototype,'assignSocket').mockImplementation(function(this:ServerResponse,socket){
    if(socket.localPort===port)this.once('close',()=>{if(!this.writableEnded)disconnected.release();});
    return Reflect.apply(assign,this,[socket]);
  });
  const first=f.post().then(response=>response.text());await receipt.entered;await first;
  const client=new AbortController(),second=f.post(body,client.signal);void second.catch(()=>{});
  await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);receipt.release();await forwarded.promise;
  expect(f.upstreamBodies).toHaveLength(1);client.abort();await expect(second).rejects.toBeInstanceOf(Error);await disconnected.promise;
  permit.release();await settled.promise;
  expect(f.upstreamBodies).toHaveLength(1);expect(f.transport.snapshot().receipts[1].error).toContain('client disconnected');
});

it('removes a cancelled waiter without aborting the current completion or admitting its abandoned request',async()=>{
  const f=await fixture(stream,undefined,{maxRequests:3,maxTotalRequestBytes:6000}),receipt=receiptGate(f.output),first=f.post().then(response=>response.text());await receipt.entered;await first;
  const client=new AbortController(),second=f.post({...body,messages:[{role:'user',content:'abandoned'}]},client.signal);void second.catch(()=>{});
  await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);client.abort();await expect(second).rejects.toBeInstanceOf(Error);
  await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(0);expect(f.transport.snapshot().pendingRequest).toBe(true);expect(f.transport.snapshot().halted).toBeUndefined();
  receipt.release();const next=await f.post({...body,messages:[{role:'user',content:'after-cancel'}]});expect(next.status).toBe(200);expect(await next.text()).toContain('Observed');await f.transport.close();
  expect(f.upstreamBodies).toHaveLength(2);expect(f.upstreamBodies[1].messages[0].content).toBe('after-cancel');expect(f.maximumInFlight()).toBe(1);
});

it.each(['abort','deadline'] as const)('refuses the waiter promptly on whole-attempt %s while prior receipt persistence is held',async mode=>{
  const timers=vi.spyOn(globalThis,'setTimeout'),controller=new AbortController(),f=await fixture(stream,controller.signal,{deadlineMs:987654});
  const expiry=timers.mock.calls.find(([,delay])=>delay===987654)![0];timers.mockRestore();
  const receipt=receiptGate(f.output),first=f.post().then(response=>response.text());await receipt.entered;await first;
  const second=f.post();await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);
  if(mode==='abort')controller.abort();else{if(typeof expiry!=='function')throw Error('Expected the actual transport deadline callback');expiry();}
  const response=await second;expect(response.status).toBe(409);expect(await response.json()).toEqual({error:{message:mode==='abort'?'Development transport stopped':'Development wall-clock deadline reached'}});
  expect(f.transport.snapshot().waitingRequests).toBe(0);expect(f.upstreamBodies).toHaveLength(1);receipt.release();await f.transport.close();
});

it('closes a waiting request and joins the current durable receipt without a new upstream attempt',async()=>{
  const f=await fixture(stream),receipt=receiptGate(f.output),first=f.post().then(response=>response.text());await receipt.entered;await first;
  const second=f.post().then(async response=>({status:response.status,body:await response.json()})).catch(error=>({error:String(error)}));
  await expect.poll(()=>f.transport.snapshot().waitingRequests).toBe(1);const closing=f.transport.close(),result=await second;
  if('error'in result)expect(result.error).toMatch(/fetch failed|aborted|socket/i);else{expect(result.status).toBe(409);expect(result.body).toEqual({error:{message:'Transport is closed'}});}
  expect(f.transport.snapshot().waitingRequests).toBe(0);expect(f.upstreamBodies).toHaveLength(1);receipt.release();await closing;
  expect(JSON.parse(await readFile(join(f.output,'1-receipt.json'),'utf8')).error).toBeUndefined();
});

it('still aborts a real client disconnect before DONE and stops later admission',async()=>{
  const upstreamClosed=gate(),f=await fixture(response=>{response.once('close',upstreamClosed.release);response.writeHead(200,{'content-type':'text/event-stream'});response.write('data: '+JSON.stringify({choices:[{delta:{content:'Observed'},finish_reason:null}]})+'\n\n');});
  const response=await f.post(),reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('Observed');await reader.cancel();await upstreamClosed.promise;
  await expect.poll(()=>f.transport.snapshot().halted).toMatch(/abort/i);const next=await f.post();expect(next.status).toBe(409);expect((await next.json()).error.message).toMatch(/abort/i);expect(f.upstreamBodies).toHaveLength(1);
});

it('enforces total serialized bytes after queued settlement and before another upstream call',async()=>{
  const f=await fixture(stream,undefined,{maxTotalRequestBytes:2000}),large={...body,messages:[{role:'user',content:'x'.repeat(1100)}]};
  const first=await f.post(large);expect(first.status).toBe(200);await first.text();const second=await f.post(large);expect(second.status).toBe(409);
  expect(await second.json()).toEqual({error:{message:'Error: Whole-attempt serialized byte cap reached'}});expect(f.upstreamBodies).toHaveLength(1);expect(f.transport.snapshot().halted).toContain('serialized byte cap');
});

it.each([
  ['response bytes',{maxResponseBytes:64},'Response byte cap exceeded'],
  ['reported tokens',{maxMeasuredTokens:5},'Reported token stop limit exceeded'],
] as const)('keeps the %s cap fail-closed for a later request',async(_name,override,error)=>{
  const f=await fixture(stream,undefined,override);await f.post().then(response=>response.text()).catch(()=>{});
  const next=await f.post();expect(next.status).toBe(409);expect((await next.json()).error.message).toContain(error);expect(f.transport.snapshot().halted).toContain(error);expect(f.upstreamBodies).toHaveLength(1);
});

it.each(['abort','deadline','close'] as const)('settles an admitted NEVER-ending incoming body on %s without a client end rescue',async mode=>{
  const timers=vi.spyOn(globalThis,'setTimeout'),controller=new AbortController(),f=await fixture(stream,controller.signal,{deadlineMs:987653});
  const expiry=timers.mock.calls.find(([,delay])=>delay===987653)![0];timers.mockRestore();
  let incoming!:ReturnType<typeof request>;
  const received=new Promise<{status:number;body:string}|{error:string}>(done=>{
    incoming=request(f.transport.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'}},response=>{
      let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>done({status:response.statusCode!,body}));response.on('error',error=>done({error:String(error)}));
    });incoming.on('error',error=>done({error:String(error)}));
  });cleanup.push(async()=>{incoming.destroy();});
  incoming.write(JSON.stringify(body).slice(0,10));await expect.poll(()=>f.transport.snapshot().pendingRequest).toBe(true);
  let closing:Promise<void>|undefined;
  if(mode==='abort')controller.abort();else if(mode==='close')closing=f.transport.close();else{if(typeof expiry!=='function')throw Error('Expected actual deadline callback');expiry();}
  await expect.poll(()=>f.transport.snapshot().pendingRequest).toBe(false);
  const result=await received;
  if(mode==='close'&&'error'in result)expect(result.error).toMatch(/socket|aborted|reset|closed/i);
  else{expect('status'in result).toBe(true);if(!('status'in result))throw Error(result.error);expect(result.status).toBe(409);expect(JSON.parse(result.body)).toEqual({error:{message:mode==='deadline'?'Development wall-clock deadline reached':mode==='close'?'Transport is closed':'Development transport stopped'}});}
  await closing;expect(f.upstreamBodies).toHaveLength(0);expect(f.transport.snapshot().receipts).toHaveLength(0);
});

it('joins concurrent close callers until the same owned receipt cleanup has settled',async()=>{
  const f=await fixture(stream),receipt=receiptGate(f.output),response=f.post().then(value=>value.text());await receipt.entered;await response;
  const first=f.transport.close(),second=f.transport.close();expect(second).toBe(first);
  let settled=false;void second.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
  receipt.release();await Promise.all([first,second]);expect(settled).toBe(true);expect(f.upstreamBodies).toHaveLength(1);
  expect(f.transport.snapshot().pendingRequest).toBe(false);expect(f.transport.snapshot().waitingRequests).toBe(0);
});

it('pins actual model/endpoint/output cap, retains raw and forwarded input, and counts actual upstream attempts',async()=>{
  const f=await fixture(stream);expect(await (await f.post()).text()).toContain('Observed');
  expect(f.upstreamBodies).toHaveLength(1);expect(f.upstreamBodies[0]).toMatchObject({model:'fixture',max_tokens:8,stream_options:{include_usage:true}});
  expect((f.upstreamHeaders[0] as any).authorization).toBeUndefined();
  await f.transport.close();expect(f.transport.snapshot()).toMatchObject({reportedTokens:6,halted:undefined,receipts:[{inputTokens:4,outputTokens:2}]});
  expect(JSON.parse(await readFile(join(f.output,'1-request.json'),'utf8')).max_tokens).toBe(99);
  expect(JSON.parse(await readFile(join(f.output,'1-forwarded.json'),'utf8')).max_tokens).toBe(8);
  expect(JSON.parse(await readFile(join(f.output,'1-receipt.json'),'utf8')).error).toBeUndefined();
});
it('retains a first response with missing usage and refuses every later admission',async()=>{
  const f=await fixture(response=>{response.end('data: '+JSON.stringify({choices:[{delta:{content:'Unpriced first response'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});
  await f.post().then(response=>response.text()).catch(()=>{});
  expect(f.transport.snapshot().halted).toContain('omitted terminal usage');expect(await readFile(join(f.output,'1-response.sse'),'utf8')).toContain('Unpriced first response');
  expect((await f.post()).status).toBe(409);expect(f.upstreamBodies).toHaveLength(1);
});
it.each([{prompt_tokens:'4',completion_tokens:2},{prompt_tokens:4,completion_tokens:9}])('fails closed on invalid or excessive reported usage: %j',async usage=>{
  const f=await fixture(response=>stream(response,usage));await f.post().then(response=>response.text()).catch(()=>{});
  expect(f.transport.snapshot().halted).toMatch(/invalid provider usage|output-token cap/);expect((await f.post()).status).toBe(409);expect(f.upstreamBodies).toHaveLength(1);
});
it('stops at the whole-attempt request cap before contacting the upstream again',async()=>{
  const f=await fixture(stream);await (await f.post()).text();await (await f.post()).text();expect((await f.post()).status).toBe(409);
  expect(f.upstreamBodies).toHaveLength(2);expect(f.transport.snapshot().halted).toContain('request cap');
});
it('treats receipt persistence failure as a terminal admission error',async()=>{
  const f=await fixture(stream);await mkdir(join(f.output,'1-receipt.json'));
  await f.post().then(response=>response.text()).catch(()=>{});for(let i=0;i<50&&!f.transport.snapshot().halted;i++)await new Promise(resolve=>setTimeout(resolve,5));
  expect(f.transport.snapshot().halted).toMatch(/EEXIST|EISDIR/);expect(f.transport.snapshot().receipts[0].error).toMatch(/EEXIST|EISDIR/);
  expect((await f.post()).status).toBe(409);expect(f.upstreamBodies).toHaveLength(1);
});
it('refuses paid/nonloopback profiles, incomplete limits, unexpected models and oversized serialized input',async()=>{
  expect(()=>validateDevelopmentProvider({kind:'ollama',baseUrl:'https://api.openai.com/v1',model:'fixture'})).toThrow('loopback');
  expect(()=>validateDevelopmentProvider({kind:'paid' as any,baseUrl:'http://127.0.0.1:1/v1',model:'fixture'})).toThrow('paid profiles');
  expect(()=>validateDevelopmentLimits({} as DevelopmentLimits)).toThrow('every development limit');
  expect(()=>validateDevelopmentLimits(null as unknown as DevelopmentLimits)).toThrow('every development limit');
  expect(()=>validateDevelopmentLimits({...limits,unknown:1} as DevelopmentLimits)).toThrow('every development limit');
  const {deadlineMs:_omitted,...partial}=limits;expect(()=>validateDevelopmentLimits(partial as DevelopmentLimits)).toThrow('every development limit');
  const f=await fixture(stream);expect((await f.post({...body,model:'foreign'})).status).toBe(409);expect(f.upstreamBodies).toHaveLength(0);
  const g=await fixture(stream);expect((await g.post({...body,messages:[{role:'user',content:'x'.repeat(3000)}]})).status).toBe(409);expect(g.upstreamBodies).toHaveLength(0);
});
it('admits no upstream attempt when cancellation arrives during a partial request body',async()=>{
  const controller=new AbortController(),f=await fixture(stream,controller.signal),text=JSON.stringify(body);
  const entered=gate(),permit=gate();cleanup.push(async()=>permit.release());
  persistence.before=async file=>{if(file===join(f.output,'refusals.jsonl')){entered.release();await permit.promise;}};
  let incoming!:ReturnType<typeof request>;
  const response=new Promise<{status:number;text:string}>((resolveResponse,reject)=>{
    incoming=request(f.transport.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'}},response=>{let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolveResponse({status:response.statusCode!,text}));});incoming.on('error',reject);
  });
  incoming.write(text.slice(0,10));await expect.poll(()=>f.transport.snapshot().pendingRequest).toBe(true);
  expect(f.transport.snapshot().pendingRequest).toBe(true);controller.abort(Error('Operator canceled during body'));incoming.end(text.slice(10));
  expect((await response).status).toBe(409);expect(f.upstreamBodies).toHaveLength(0);expect(f.transport.snapshot().receipts).toHaveLength(0);
  // The cancellation path flushes 409 before it persists the refusal; the
  // admission slot is released only after that evidence write has settled.
  await entered.promise;expect(f.transport.snapshot().pendingRequest).toBe(true);
  await expect(readFile(join(f.output,'refusals.jsonl'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
  permit.release();
  await expect.poll(()=>f.transport.snapshot().pendingRequest).toBe(false);
  expect(await readFile(join(f.output,'refusals.jsonl'),'utf8')).toContain('pre-admission');
});
