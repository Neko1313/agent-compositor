import {afterEach,expect,it} from 'vitest';
import {createServer,request,type ServerResponse} from 'node:http';
import {mkdtemp,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDevelopmentTransport,validateDevelopmentProvider,validateDevelopmentLimits,type DevelopmentLimits} from './development-transport.js';

const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const limits:DevelopmentLimits={maxRequests:2,maxRequestBytes:2000,maxTotalRequestBytes:4000,maxOutputTokens:8,maxMeasuredTokens:100,maxResponseBytes:4000,deadlineMs:10000};
const body={model:'fixture',stream:true,max_tokens:99,messages:[{role:'user',content:'work'}]};
async function fixture(reply:(response:ServerResponse)=>void,signal?:AbortSignal){
  const root=await mkdtemp(join(tmpdir(),'development-transport-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const upstreamBodies:any[]=[],upstreamHeaders:unknown[]=[];
  const server=createServer(async(request,response)=>{let text='';for await(const chunk of request)text+=chunk;upstreamBodies.push(JSON.parse(text));upstreamHeaders.push(request.headers);reply(response);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No fixture address');
  cleanup.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  const output=join(root,'transport'),transport=await createDevelopmentTransport({provider:{kind:'ollama',baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'fixture'},limits,output,signal});cleanup.push(()=>transport.close());
  const post=(value:unknown=body)=>fetch(transport.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'must-not-be-forwarded'},body:JSON.stringify(value)});
  return{root,output,transport,post,upstreamBodies,upstreamHeaders};
}
const stream=(response:ServerResponse,usage:unknown={prompt_tokens:4,completion_tokens:2})=>{response.setHeader('content-type','text/event-stream');response.end('data: '+JSON.stringify({choices:[{delta:{content:'Observed'},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage})+'\n\ndata: [DONE]\n\n');};

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
  let incoming!:ReturnType<typeof request>;
  const response=new Promise<{status:number;text:string}>((resolveResponse,reject)=>{
    incoming=request(f.transport.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'}},response=>{let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolveResponse({status:response.statusCode!,text}));});incoming.on('error',reject);
  });
  incoming.write(text.slice(0,10));for(let i=0;i<50&&!f.transport.snapshot().pendingRequest;i++)await new Promise(resolve=>setTimeout(resolve,5));
  expect(f.transport.snapshot().pendingRequest).toBe(true);controller.abort(Error('Operator canceled during body'));incoming.end(text.slice(10));
  expect((await response).status).toBe(409);expect(f.upstreamBodies).toHaveLength(0);expect(f.transport.snapshot().receipts).toHaveLength(0);
  expect(await readFile(join(f.output,'refusals.jsonl'),'utf8')).toContain('pre-admission');
});
