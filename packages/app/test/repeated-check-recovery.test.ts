import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';

it('reminds after identical failed checks and still lets the agent repair and rerun them',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'repeat-check-'));
 let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try{
  await writeFile(join(cwd,'answer.txt'),'bad');
  await writeFile(join(cwd,'user-draft.txt'),'preserve me');
  await writeFile(join(cwd,'checks.mjs'),`import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const path='counter.txt',count=existsSync(path)?Number(readFileSync(path,'utf8')):0;writeFileSync(path,String(count+1));
const ok=readFileSync('answer.txt','utf8')==='good';console.log(ok?'PASS':'FAIL: expected good');process.exitCode=ok?0:1;`);
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{tools:['read','edit','exec'],builtinTools:['read','edit','exec'],controlTools:[],skills:false,projectContext:false,fileReferences:false},compaction:{enabled:false},permissions:{rules:[{tool:'exec',command:'node checks.mjs',decision:'allow'},{tool:'edit',path:cwd+'/**',decision:'allow'}]}}));
  const check={toolCalls:[{name:'exec',args:{command:'node checks.mjs'}}]};
  const provider=new ScriptedProvider([check,{toolCalls:[{name:'read',args:{path:'answer.txt'}}]},check,check,
   {toolCalls:[{name:'edit',args:{path:'answer.txt',oldText:'bad',newText:'good'}}]},check,{text:'Fixed and checked.'}]);
  app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,pluginDirs:[]});
  const core=app.createCore(async()=>false),results:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='tool.result')results.push(e.input);});
  await core.submit('Fix the answer and run the check');
  expect(core.failure).toBeUndefined();
  expect(provider.requests[2].messages.some(m=>m.content.includes('Verification recovery:'))).toBe(false);
  expect(provider.requests[3].messages.filter(m=>m.content.includes('Verification recovery:'))).toHaveLength(1);
  expect(provider.requests[4].messages.filter(m=>m.content.includes('Verification recovery:'))).toHaveLength(1);
  expect(results.filter(r=>r.tool==='exec').map(r=>r.output?.exitCode)).toEqual([1,1,1,0]);
  expect(await readFile(join(cwd,'counter.txt'),'utf8')).toBe('4');
  expect(await readFile(join(cwd,'answer.txt'),'utf8')).toBe('good');
  expect(await readFile(join(cwd,'user-draft.txt'),'utf8')).toBe('preserve me');
 }finally{await app?.close();await rm(cwd,{recursive:true,force:true});}
},20000);

it('does not treat refused check requests as executed failures',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'refused-check-'));let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try{
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{tools:['exec'],builtinTools:['exec'],controlTools:[],skills:false,projectContext:false,fileReferences:false},permissions:{rules:[{tool:'exec',command:'node checks.mjs',decision:'deny'}]},compaction:{enabled:false}}));
  const check={toolCalls:[{name:'exec',args:{command:'node checks.mjs'}}]},provider=new ScriptedProvider([check,check,{text:'The command was denied.'}]);
  app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,pluginDirs:[]});const core=app.createCore(async()=>false),results:any[]=[];
  core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='tool.result')results.push(e.input);});await core.submit('Run the check');
  expect(results).toHaveLength(2);expect(results.every(result=>result.denied===true)).toBe(true);
  expect(provider.requests.at(-1)?.messages.some(message=>message.content.includes('Verification recovery:'))).toBe(false);
 }finally{await app?.close();await rm(cwd,{recursive:true,force:true});}
},20000);
