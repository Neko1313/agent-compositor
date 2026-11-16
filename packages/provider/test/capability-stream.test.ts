import {expect,it,vi} from 'vitest';
import {discoverCapabilities} from '../src/capabilities.js';

it('matches a running Unicode model when UTF-8 characters cross network chunks',async()=>{
 const name='модель:latest';
 const fetcher=vi.fn(async(url:any)=>{
  if(String(url).endsWith('/api/show'))return Response.json({model_info:{'model.context_length':131072}});
  const bytes=new TextEncoder().encode(JSON.stringify({models:[{name,context_length:4096}]})),split=bytes.indexOf(0xd0)+1;
  return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,split));controller.enqueue(bytes.slice(split));controller.close();}}));
 });
 const result=await discoverCapabilities({baseUrl:'http://127.0.0.1:11434/v1',model:name,apiKey:'',metadataProvider:'ollama',fetch:fetcher},new AbortController().signal);
 expect(result).toMatchObject({contextWindow:4096,source:'provider'});expect(fetcher).toHaveBeenCalledTimes(2);
});

it('cancels an oversized metadata stream and uses the conservative fallback',async()=>{
 let cancelled=false,pulls=0;
 const fetcher=vi.fn(async()=>new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(600000));},cancel(){cancelled=true;}})));
 const result=await discoverCapabilities({baseUrl:'http://127.0.0.1:1234/v1',model:'test',apiKey:'',metadataUrl:'/metadata',fetch:fetcher},new AbortController().signal);
 expect(result).toMatchObject({contextWindow:32768,source:'fallback'});expect(cancelled).toBe(true);expect(pulls).toBeLessThanOrEqual(3);
});

it('propagates cancellation during the running-model lookup instead of returning stale metadata',async()=>{
 const controller=new AbortController();
 const fetcher=vi.fn(async(url:any)=>{
  if(String(url).endsWith('/api/show'))return Response.json({model_info:{'model.context_length':131072}});
  controller.abort();throw new DOMException('Stopped','AbortError');
 });
 await expect(discoverCapabilities({baseUrl:'http://127.0.0.1:11434/v1',model:'test',apiKey:'',metadataProvider:'ollama',fetch:fetcher},controller.signal)).rejects.toMatchObject({name:'AbortError'});
 expect(fetcher).toHaveBeenCalledTimes(2);
});
