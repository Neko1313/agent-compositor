import assert from 'node:assert/strict';
import {writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Fixture,Casebook} from './fixture.js';
import {stopped} from './processes.js';
const exec=promisify(execFile),pause=(ms:number)=>new Promise(done=>setTimeout(done,ms));
export function callix(f:Fixture,b:Casebook){
 if(f.name!=='callix')return;
 const pids=join(f.cwd,'.agent-compositor/callix-pids');
 const configure=async(mode='success')=>{
  const file=join(f.cwd,'.agent-compositor','fake-callix-'+mode);
  await writeFile(file,`#!/usr/bin/env node\nconst fs=require('node:fs'),path=require('node:path');fs.appendFileSync(${JSON.stringify(pids)},process.pid+'\\n');${mode==='hang'?'setInterval(()=>{},1000);':mode==='fail'?'process.stderr.write("fixture binary failed");process.exit(3);':mode==='invalid'?'console.log(JSON.stringify({schema_version:2,nodes:[],relations:[],metadata:{}}));':`const name=fs.readFileSync(path.join(process.argv[3],'source.ts'),'utf8').trim();console.log(JSON.stringify({schema_version:1,nodes:[{id:name,name,qualified_name:name,kind:'function',file_path:'source.ts',span:[0,Buffer.byteLength(name)]}],relations:[],metadata:{fixture:true}}));`}`,{mode:0o700});
  await f.storage.configure('callix.json',{executable:file,background:false,timeoutMs:mode==='hang'?150:2000});return file;
 };
 const query=async(extra:any={})=>{const r=await f.emit('service.project.query',{cwd:f.cwd,action:'symbols',pattern:'alpha',...extra});return r.value;};
 const count=async()=>String(await readFile(pids,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).length;
 const good=async()=>{await writeFile(join(f.cwd,'source.ts'),'alpha');await configure();const r=await query();assert.doesNotMatch(JSON.stringify(r),/deny/);assert.match(JSON.stringify(r),/alpha/);return r;};
 b.add(['tool.success','process.success','hook.repeat','mutation.result','state.fresh'],async()=>{await good();const n=await count();await query();await query();assert.equal(await count(),n);assert.match(await f.saved('cache/callix/index.json'),/alpha/);});
 b.add(['tool.invalid','mutation.invalid'],async()=>{const before=await f.saved('cache/callix/index.json'),n=await count();const app=await f.app(),core=app.createCore(async()=>true);assert.equal((await core.invokeTool('code_query',{action:'unknown'})).ok,false);assert.equal(await count(),n);assert.equal(await f.saved('cache/callix/index.json'),before);});
 b.add(['tool.denied','mutation.denied'],async()=>{const before=await f.saved('cache/callix/index.json'),n=await count();const app=await f.app({permissions:{rules:[{tool:'code_query',decision:'deny'}]}});assert.equal((await app.createCore(async()=>true).invokeTool('code_query',{action:'symbols',pattern:'alpha'})).ok,false);assert.equal(await count(),n);assert.equal(await f.saved('cache/callix/index.json'),before);});
 b.add(['hook.failure','tool.failure','process.failure','mutation.recovery'],async()=>{const before=await f.saved('cache/callix/index.json');await configure('invalid');assert.match(JSON.stringify(await query({refresh:true})),/deny|Unsupported/);assert.equal(await f.saved('cache/callix/index.json'),before);await configure('fail');assert.match(JSON.stringify(await query({refresh:true})),/deny|failed/);await good();});
 b.add('process.timeout',async()=>{await configure('hang');const now=Date.now();assert.match(JSON.stringify(await query({refresh:true})),/exceeded|timeout/);assert.ok(Date.now()-now<3000);});
 b.add(['tool.cancel','process.cancel'],async()=>{await configure('hang');const before=await count(),pending=query({refresh:true});for(let i=0;i<100&&await count()===before;i++)await pause(10);f.abort.abort(Error('cancelled'));assert.match(JSON.stringify(await pending),/cancel|aborted/i);f.resetHost();await good();});
 b.add('process.cleanup',async()=>{for(const pid of String(await readFile(pids,'utf8')).trim().split('\n').map(Number))await stopped(pid);await f.module.dispose();const n=await count();await writeFile(join(f.cwd,'source.ts'),'after-dispose');await pause(220);assert.equal(await count(),n);await writeFile(join(f.cwd,'source.ts'),'alpha');});
 b.add('state.restart',async()=>{await f.app();await writeFile(join(f.cwd,'agent-compositor.json'),'{"agent":{"projectContext":false}}');await good();const n=await count();const result=await exec('bun',[join(import.meta.dirname,'restart.ts'),f.name,f.cwd,f.home,f.directory],{timeout:10000});assert.match(result.stdout,/alpha/);assert.equal(await count(),n);});
 b.add('state.invalid',async()=>{await f.seed('cache/callix/index.json','bad cache');await f.app();await writeFile(join(f.cwd,'agent-compositor.json'),'{"agent":{"projectContext":false}}');const result=await exec('bun',[join(import.meta.dirname,'restart.ts'),f.name,f.cwd,f.home,f.directory],{timeout:10000});assert.match(result.stdout,/alpha/);assert.doesNotThrow(()=>JSON.parse(result.stdout.trim()));JSON.parse(await f.saved('cache/callix/index.json'));});
 b.add('state.migration',async()=>{await good();const settings=await f.storage.config('callix.json');await writeFile(join(f.cwd,'.agent-compositor/callix.json'),JSON.stringify(settings));await f.app();await writeFile(join(f.cwd,'agent-compositor.json'),'{"agent":{"projectContext":false}}');const result=await exec('bun',[join(import.meta.dirname,'restart.ts'),f.name,f.cwd,f.home,f.directory],{timeout:10000});assert.match(result.stdout,/alpha/);});
 b.add('state.isolation',async()=>{const other=await new Fixture(f.name,f.directory).init();try{await assert.rejects(stat(other.file('cache/callix/index.json')));await writeFile(join(other.cwd,'other.txt'),'OTHER_PROJECT');const r=await other.emit('service.project.query',{cwd:other.cwd,action:'glob',pattern:'*.txt'});assert.doesNotMatch(JSON.stringify(r.value),/source.ts|alpha/);}finally{await other.close();}});
}
