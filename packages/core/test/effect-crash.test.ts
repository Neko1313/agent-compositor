import {expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {appendFile,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AgentCore,ScriptedProvider} from '../src/index.js';
import type {SessionEvent} from '@agent-compositor/session';

it('preserves an unknown tool outcome after the process dies following an external effect',async()=>{
 const root=await mkdtemp(join(tmpdir(),'compositor-effect-crash-'));
 const journal=join(root,'journal.jsonl'),effect=join(root,'effect.txt'),runner=join(root,'runner.mjs');
 const entry=pathToFileURL(resolve('packages/core/src/index.ts')).href;
 await writeFile(runner,`import {AgentCore,ScriptedProvider} from ${JSON.stringify(entry)};
 import {appendFile,writeFile} from 'node:fs/promises';
 const journal=${JSON.stringify(journal)},effect=${JSON.stringify(effect)};
 const sessions={create:async()=>{},append:async(_id,events)=>{await appendFile(journal,events.map(event=>JSON.stringify(event)+'\\n').join(''));}};
 const tool={name:'effect',description:'Write an external effect',parameters:{type:'object'},describe:()=>({tool:'effect'}),execute:async()=>{
   await appendFile(effect,'APPLIED_ONCE\\n');setInterval(()=>{},1000);await new Promise(()=>{});
 }};
 const core=new AgentCore({cwd:${JSON.stringify(root)},provider:new ScriptedProvider([{toolCalls:[{name:'effect',args:{}}]}]),
   sessions,tools:[tool],controlTools:[],rules:[{tool:'effect',decision:'allow'}]});
 await core.submit('Apply the controlled effect');`);
 const child=spawn(process.execPath,['--import','tsx',runner],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:root,LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exit=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}));});
 let resumed:AgentCore|undefined;
 try{
  await expect.poll(async()=>readFile(effect,'utf8').catch(()=>''),{timeout:10000}).toBe('APPLIED_ONCE\n');
  const before=(await readFile(journal,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as SessionEvent);
  const call=before.find(event=>event.type==='tool.call'&&event.tool==='effect');
  expect(typeof call?.callId).toBe('string');
  expect(before.some(event=>event.type==='tool.result'&&event.callId===call!.callId)).toBe(false);
  expect(child.kill('SIGKILL')).toBe(true);expect(await exit).toMatchObject({signal:'SIGKILL'});expect(stderr).toBe('');
  const events=(await readFile(journal,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as SessionEvent);
  const provider=new ScriptedProvider([{text:'Inspect the effect before retrying.'}]);
  resumed=AgentCore.resume({cwd:root,provider,tools:[{name:'effect',description:'Write an external effect',parameters:{type:'object'},
   describe:()=>({tool:'effect'}),execute:async()=>{await appendFile(effect,'APPLIED_ONCE\n');return{ok:true,data:'applied'};}}],
   controlTools:[],rules:[{tool:'effect',decision:'allow'}],sessions:{create:async()=>{},append:async(_id,records)=>{await appendFile(journal,records.map(event=>JSON.stringify(event)+'\n').join(''));}}},events);
  expect(await readFile(effect,'utf8')).toBe('APPLIED_ONCE\n');expect(provider.requests).toHaveLength(0);
  await resumed.submit('Inspect before doing anything else');
  expect(provider.requests[0].messages.some(message=>message.role==='user'&&message.content==='Apply the controlled effect')).toBe(true);
  const result=provider.requests[0].messages.find(message=>message.role==='tool'&&message.toolCallId===call!.callId);
  expect(result?.content).toContain('outcome is unknown');expect(result?.content).toContain('Inspect its state before retrying');
  expect(await readFile(effect,'utf8')).toBe('APPLIED_ONCE\n');
 }finally{
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit.catch(()=>{});}
  await resumed?.close();await rm(root,{recursive:true,force:true});
 }
},15000);
