import {expect,it,vi} from 'vitest';
import {ProviderRouter} from '@agent-compositor/provider';
import {quotaReader} from '../src/quota.js';

it('refreshes quota after credential, mapping, endpoint or transport changes',async()=>{
 const fetcher=vi.fn(async(_url:any,init:any)=>Response.json({remaining:init.headers.Authorization==='Bearer second'?7:90,limit:100,other:4}));
 const profile:any={baseUrl:'http://127.0.0.1:1234/v1',model:'test',apiKey:'first',fetch:fetcher,quota:{url:'http://127.0.0.1:1234/quota'}};
 const router=new ProviderRouter({default:profile}),read=quotaReader(router);
 expect((await read()).value).toMatchObject({remaining:90});expect((await read()).value).toMatchObject({remaining:90});expect(fetcher).toHaveBeenCalledTimes(1);
 profile.apiKey='second';expect((await read()).value).toMatchObject({remaining:7});
 profile.quota.remainingPath='other';expect((await read()).value).toMatchObject({remaining:4});
 profile.quota.url='http://127.0.0.1:1234/other';await read();expect(fetcher).toHaveBeenCalledTimes(4);
 const replacement=vi.fn(async()=>Response.json({other:3,limit:100}));profile.fetch=replacement;
 expect((await read()).value).toMatchObject({remaining:3});expect(replacement).toHaveBeenCalledTimes(1);
 profile.quota.url='http://127.0.0.1:9999/quota';await expect(read()).rejects.toThrow('Quota endpoint must share the provider origin');
 expect(replacement).toHaveBeenCalledTimes(1);
});

it('stops reading an oversized quota response before buffering the rest',async()=>{
 let cancelled=false,pulls=0;
 const fetcher=vi.fn(async()=>new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(60000));},cancel(){cancelled=true;}})));
 const profile:any={baseUrl:'http://127.0.0.1:1234/v1',model:'test',apiKey:'',fetch:fetcher,quota:{url:'http://127.0.0.1:1234/quota'}};
 await expect(quotaReader(new ProviderRouter({default:profile}))()).rejects.toThrow('Quota response exceeds limit');
 expect(cancelled).toBe(true);expect(pulls).toBeLessThanOrEqual(3);
});

it('decodes a multibyte reset value split across response chunks',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({remaining:1,limit:2,reset:'завтра'}));
 const split=bytes.indexOf(0xd0)+1;
 const fetcher=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,split));controller.enqueue(bytes.slice(split));controller.close();}}));
 const profile:any={baseUrl:'http://127.0.0.1:1234/v1',model:'test',apiKey:'',fetch:fetcher,quota:{url:'http://127.0.0.1:1234/quota'}};
 expect((await quotaReader(new ProviderRouter({default:profile}))()).value).toMatchObject({reset:'завтра'});
});
