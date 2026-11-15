import {expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProviderRouter} from '@agent-compositor/provider';
import {authentication} from '../src/auth.js';

it('rejects inherited provider names before saving credentials, opening a form or fetching',async()=>{
 const root=await mkdtemp(join(tmpdir(),'auth-profile-boundary-'));
 const inherited={baseUrl:'http://127.0.0.1:1/v1',model:'inherited',apiKey:'original'};
 const profiles=Object.assign(Object.create({inherited}),{default:{baseUrl:'http://127.0.0.1:1/v1',model:'default',apiKey:''}});
 const router=new ProviderRouter(profiles);let requests=0,forms=0;const notices:string[]=[];
 const auth=await authentication(root,{HOME:root,TEST_TOKEN:'fixture'},profiles,router,async()=>{requests++;throw Error('unexpected network');});
 const api:any={signal:new AbortController().signal,ui:{form:async()=>{forms++;return null;},notify:async(message:string)=>{notices.push(message);},view:async()=>{}},auth:{login:async()=>{throw Error('unexpected login');}}};
 try{
  for(const name of ['inherited','constructor','__proto__']){
   await expect(auth.setKey(name,'fixture')).rejects.toThrow('Unknown provider profile');
   await expect(auth.refresh(name,api.signal)).rejects.toThrow('Unknown provider profile');
   expect(await (auth.plugin.hooks['service.auth.login'] as any)({provider:name},api)).toMatchObject({deny:expect.stringContaining('Unknown provider profile')});
   await (auth.plugin.hooks['prompt.submit'] as any)({text:`/login ${name} TEST_TOKEN`},api);
   expect(notices.at(-1)).toContain('Unknown profile');
  }
  expect(inherited.apiKey).toBe('original');expect(forms).toBe(0);expect(requests).toBe(0);
  await expect(readFile(join(root,'.agent-compositor','credentials.json'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
