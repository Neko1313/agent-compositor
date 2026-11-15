import {expect,it} from 'vitest';
import {ProviderRouter,type ProviderProfile} from '../src/router.js';

it('rejects inherited profiles before modifying settings or calling a provider',async()=>{
 const inherited:ProviderProfile={baseUrl:'http://127.0.0.1:1/v1',model:'inherited',apiKey:'',reasoningEffort:'low'};
 const profiles=Object.assign(Object.create({inherited}),{default:{baseUrl:'http://127.0.0.1:1/v1',model:'default',apiKey:''}});
 const router=new ProviderRouter(profiles);
 for(const name of ['inherited','constructor','__proto__']){
  expect(()=>router.setReasoningEffort(name,'high')).toThrow('Unknown provider profile');
  await expect(router.capabilities(new AbortController().signal,name)).rejects.toThrow('Unknown model profile');
  expect(()=>router.complete({profile:name} as any)).toThrow('Unknown model profile');
 }
 expect(inherited.reasoningEffort).toBe('low');
 expect(Object.hasOwn(Object.prototype,'reasoningEffort')).toBe(false);
});

it('accepts an explicitly owned profile even when its name matches a prototype property',()=>{
 const profiles=Object.assign(Object.create(null),{default:{baseUrl:'http://127.0.0.1:1/v1',model:'default',apiKey:''},
  constructor:{baseUrl:'http://127.0.0.1:1/v1',model:'owned',apiKey:''}});
 const router=new ProviderRouter(profiles);router.select('constructor');
 expect(router.model).toBe('owned');router.setReasoningEffort('constructor','high');
 expect(router.reasoningEffort).toBe('high');
});

it('requires the default profile to be explicitly owned',()=>{
 const inherited=Object.create({default:{baseUrl:'http://127.0.0.1:1/v1',model:'inherited',apiKey:''}});
 expect(()=>new ProviderRouter(inherited)).toThrow('Unknown model profile: default');
});
