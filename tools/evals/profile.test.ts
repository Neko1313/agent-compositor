import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluationProfile} from './profile.js';
let root:string;
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'eval-profile-'));vi.stubEnv('AGENT_HOME',root);
 await writeFile(join(root,'providers.json'),JSON.stringify({profiles:{test:{type:'openai-responses',baseUrl:'https://api.openai.com/v1',model:'gpt-6.1-sol'}}}));
 await writeFile(join(root,'credentials.json'),JSON.stringify({test:{accessToken:'test-only-key'}}));
});
afterEach(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});
const request={messages:[{role:'user' as const,content:'Probe'}],tools:[],signal:new AbortController().signal,maxOutputTokens:128};
async function events(provider:Awaited<ReturnType<typeof evaluationProfile>>['provider']){const rows=[];for await(const e of provider.complete(request))rows.push(e);return rows;}
it('routes through Responses with parent-only credentials and settles reported usage',async()=>{
 const fake=vi.fn(async(url,init)=>{
  expect(url).toBe('https://api.openai.com/v1/responses');expect(init.headers.authorization).toBe('Bearer test-only-key');expect(init.redirect).toBe('error');
  expect(JSON.parse(init.body)).toMatchObject({model:'gpt-6.1-sol',store:false,max_output_tokens:128,service_tier:'default'});
  return new Response('data: {"type":"response.output_text.delta","delta":"READY"}\n\ndata: {"type":"response.completed","response":{"service_tier":"default","usage":{"input_tokens":10,"output_tokens":5,"input_tokens_details":{"cached_tokens":8,"cache_write_tokens":1}}}}\n\n');
 });vi.stubGlobal('fetch',fake);
 const profile=await evaluationProfile('test',1),rows=await events(profile.provider);
 expect(rows).toContainEqual({type:'text_delta',text:'READY'});expect(fake).toHaveBeenCalledTimes(1);
 expect(await profile.budget.status()).toMatchObject({reportedRequests:1,pendingRequests:0});
 expect((await profile.budget.status()).standardPriceEstimate).toMatchObject({usd:.000056,coveredRequests:1,unavailableRequests:0});
 expect(JSON.stringify(rows)).not.toContain('test-only-key');
});
it('refuses an unaffordable completion before the HTTP request',async()=>{
 const fake=vi.fn();vi.stubGlobal('fetch',fake);
 const profile=await evaluationProfile('test',.001),rows=await events(profile.provider);
 expect(fake).not.toHaveBeenCalled();expect(rows.at(-1)).toMatchObject({type:'finish',reason:'error'});
 expect(JSON.stringify(rows)).toContain('budget exhausted');
});
it('retains the reservation for an interrupted stream without reported usage',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')));
 const profile=await evaluationProfile('test',1),rows=await events(profile.provider);
 expect(rows.at(-1)).toMatchObject({type:'finish',reason:'error'});
 expect((await profile.budget.status()).pendingRequests).toBe(1);
});
it('rejects an unpriced or substituted model rather than reusing this cost authorization',async()=>{
 await writeFile(join(root,'providers.json'),JSON.stringify({profiles:{test:{type:'openai-responses',baseUrl:'https://api.openai.com/v1',model:'other-model'}}}));
 await expect(evaluationProfile('test',1)).rejects.toThrow('gpt-6.1-sol');
});
it.each(['priority',undefined])('retains the reservation and stops further requests when actual tier is %s',async tier=>{
 const fake=vi.fn(async()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{service_tier:tier,usage:{input_tokens:10,output_tokens:5}}})+'\n\n'));vi.stubGlobal('fetch',fake);
 const profile=await evaluationProfile('test',1),rows=await events(profile.provider);
 expect(rows.at(-1)).toMatchObject({type:'finish',reason:'error'});expect((await profile.budget.status()).pendingRequests).toBe(1);
 await events(profile.provider);const restarted=await evaluationProfile('test',1);await events(restarted.provider);expect(fake).toHaveBeenCalledTimes(1);expect(await profile.budget.status()).toMatchObject({pendingRequests:1,halted:'unconfirmed-response-pricing'});
});
it('checks tier metadata split across UTF-8 stream chunks before accepting usage',async()=>{
 const payload='data: '+JSON.stringify({type:'response.completed',response:{service_tier:'default',usage:{input_tokens:10,output_tokens:5}}})+'\n\n';
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(controller){for(const byte of new TextEncoder().encode(payload))controller.enqueue(new Uint8Array([byte]));controller.close();}}))));
 const profile=await evaluationProfile('test',1);await events(profile.provider);expect(await profile.budget.status()).toMatchObject({reportedRequests:1,pendingRequests:0});
});
it('uses saved model proxy settings and closes the owned network client after completion',async()=>{
 const {NetworkClient}=await import('../../packages/provider/src/network.js');
 const proxy={enabled:true,url:'http://127.0.0.1:12345',models:true,tools:false,noProxy:['localhost']};await writeFile(join(root,'proxy.json'),JSON.stringify(proxy));
 const configure=vi.spyOn(NetworkClient.prototype,'configure'),close=vi.spyOn(NetworkClient.prototype,'close');
 const transport=vi.fn(async()=>new Response('data: {"type":"response.completed","response":{"service_tier":"default","usage":{"input_tokens":10,"output_tokens":5}}}\n\n'));
 const select=vi.spyOn(NetworkClient.prototype,'fetch').mockReturnValue(transport as typeof fetch);
 const direct=vi.fn();vi.stubGlobal('fetch',direct);
 try{const profile=await evaluationProfile('test',1);await events(profile.provider);expect(configure).toHaveBeenCalledWith(proxy);expect(select).toHaveBeenCalledWith('models');expect(transport).toHaveBeenCalledTimes(1);expect(direct).not.toHaveBeenCalled();expect(close).toHaveBeenCalledTimes(1);expect((await profile.budget.status()).reportedRequests).toBe(1);}finally{vi.restoreAllMocks();}
});
it('closes the model proxy client when its HTTP request fails, retaining the charge',async()=>{
 const {NetworkClient}=await import('../../packages/provider/src/network.js');await writeFile(join(root,'proxy.json'),JSON.stringify({enabled:true,url:'http://127.0.0.1:12345'}));
 const close=vi.spyOn(NetworkClient.prototype,'close');vi.spyOn(NetworkClient.prototype,'fetch').mockReturnValue(async()=>{throw Error('fixture proxy unavailable');});
 try{const profile=await evaluationProfile('test',1);const rows=await events(profile.provider);expect(rows.at(-1)).toMatchObject({type:'finish',reason:'error'});expect(close).toHaveBeenCalledTimes(1);expect((await profile.budget.status()).pendingRequests).toBe(1);}finally{vi.restoreAllMocks();}
});
