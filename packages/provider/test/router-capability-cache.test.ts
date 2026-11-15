import {expect,it,vi} from 'vitest';
import {ProviderRouter,type ProviderProfile} from '../src/router.js';

it('isolates cached limits by explicit profile and refreshes after credential or header changes',async()=>{
 const fetcher=vi.fn(async(_url:any,init:any)=>{
  const headers=init.headers as Record<string,string>;
  const limit=headers.Authorization==='Bearer second'?64000:headers['x-tenant']==='other'?96000:32000;
  return Response.json({context_window:limit});
 });
 const base:ProviderProfile={baseUrl:'http://127.0.0.1:1234/v1',model:'same',apiKey:'first',metadataUrl:'/metadata',fetch:fetcher};
 const router=new ProviderRouter({default:{...base},other:{...base,apiKey:'second'}}),signal=new AbortController().signal;
 expect((await router.capabilities(signal,'default')).contextWindow).toBe(32000);
 expect((await router.capabilities(signal,'other')).contextWindow).toBe(64000);
 expect((await router.capabilities(signal,'other')).contextWindow).toBe(64000);expect(fetcher).toHaveBeenCalledTimes(2);
 router.profiles.default.apiKey='second';expect((await router.capabilities(signal,'default')).contextWindow).toBe(64000);
 router.profiles.default.apiKey='first';router.profiles.default.headers={'x-tenant':'other'};
 expect((await router.capabilities(signal,'default')).contextWindow).toBe(96000);expect(fetcher).toHaveBeenCalledTimes(4);
});

it('does not reuse a cached fallback after protocol or transport changes and respects cancellation',async()=>{
 const fetcher=vi.fn(async()=>Response.json({inputTokenLimit:64000}));
 const profile:ProviderProfile={baseUrl:'http://127.0.0.1:1234/v1',model:'same',apiKey:'',fetch:fetcher};
 const router=new ProviderRouter({default:profile}),signal=new AbortController().signal;
 expect((await router.capabilities(signal)).source).toBe('fallback');expect(fetcher).not.toHaveBeenCalled();
 router.profiles.default.type='gemini';
 expect((await router.capabilities(signal,'default')).contextWindow).toBe(64000);expect(fetcher).toHaveBeenCalledTimes(1);
 const replacement=vi.fn(async()=>Response.json({inputTokenLimit:128000}));router.profiles.default.fetch=replacement;
 expect((await router.capabilities(signal,'default')).contextWindow).toBe(128000);expect(replacement).toHaveBeenCalledTimes(1);
 const controller=new AbortController();controller.abort();await expect(router.capabilities(controller.signal,'default')).rejects.toMatchObject({name:'AbortError'});
});

it('retries against the current model when selection changes during metadata lookup',async()=>{
 let enter!:()=>void,release!:()=>void;const started=new Promise<void>(done=>{enter=done;}),held=new Promise<void>(done=>{release=done;});
 const fetcher=vi.fn(async(_url:any,init:any)=>{if(init.headers.Authorization==='Bearer first'){enter();await held;return Response.json({context_window:32000});}return Response.json({context_window:96000});});
 const base:ProviderProfile={baseUrl:'http://127.0.0.1:1234/v1',model:'same',apiKey:'first',metadataUrl:'/metadata',fetch:fetcher};
 const router=new ProviderRouter({default:{...base},other:{...base,apiKey:'second'}}),signal=new AbortController().signal;
 const pending=router.capabilities(signal);await started;router.select('other');release();
 expect((await pending).contextWindow).toBe(96000);expect(fetcher).toHaveBeenCalledTimes(2);
 expect((await router.capabilities(signal)).contextWindow).toBe(96000);expect(fetcher).toHaveBeenCalledTimes(2);
});

it('bounds retries when configuration changes on every discovery',async()=>{
 let profile:ProviderProfile;
 const fetcher=vi.fn(async()=>{profile.apiKey+='x';return Response.json({context_window:32000});});
 profile={baseUrl:'http://127.0.0.1:1234/v1',model:'same',apiKey:'first',metadataUrl:'/metadata',fetch:fetcher};
 const router=new ProviderRouter({default:profile});
 await expect(router.capabilities(new AbortController().signal)).rejects.toThrow('Model configuration changed repeatedly');
 expect(fetcher).toHaveBeenCalledTimes(3);
});

it('keeps an explicit profile independent of changes to the active profile',async()=>{
 let enter!:()=>void,release!:()=>void;const started=new Promise<void>(done=>{enter=done;}),held=new Promise<void>(done=>{release=done;});
 const fetcher=vi.fn(async()=>{enter();await held;return Response.json({context_window:32000});});
 const base:ProviderProfile={baseUrl:'http://127.0.0.1:1234/v1',model:'same',apiKey:'first',metadataUrl:'/metadata',fetch:fetcher};
 const router=new ProviderRouter({default:{...base},other:{...base,apiKey:'second'}});
 const pending=router.capabilities(new AbortController().signal,'default');await started;router.select('other');release();
 expect((await pending).contextWindow).toBe(32000);expect(fetcher).toHaveBeenCalledTimes(1);
});

it('evicts old capability entries instead of growing indefinitely',async()=>{
 const fetcher=vi.fn(async()=>Response.json({context_window:32000}));
 const profile:ProviderProfile={baseUrl:'http://127.0.0.1:1234/v1',model:'same',apiKey:'first',metadataUrl:'/metadata',fetch:fetcher};
 const router=new ProviderRouter({default:profile}),signal=new AbortController().signal;
 for(let i=0;i<129;i++){profile.model=`model-${i}`;await router.capabilities(signal,'default');}
 profile.model='model-0';await router.capabilities(signal,'default');expect(fetcher).toHaveBeenCalledTimes(130);
});
