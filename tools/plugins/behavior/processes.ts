import assert from 'node:assert/strict';
import {writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Fixture,Casebook} from './fixture.js';
const pause=(ms:number)=>new Promise(done=>setTimeout(done,ms));
export async function stopped(pid:number){for(let i=0;i<100;i++){try{process.kill(pid,0);if(process.platform==='linux'&&/\) Z /.test(await readFile('/proc/'+pid+'/stat','utf8')))return;}catch(error:any){if(error.code==='ESRCH'||error.code==='ENOENT')return;throw error;}await pause(10);}throw Error('Owned process still alive: '+pid);}
export function processes(f:Fixture,b:Casebook){
 if(f.name==='monty'){
  const run=async(code:string,extra:any={})=>f.emit('service.sandbox.run',{language:'python',code,...extra});
  const result=(r:any)=>r.value?.value??r.value;
  b.add(['hook.repeat','tool.success','process.success'],async()=>{for(let i=0;i<3;i++)assert.equal(result(await run('6*7')).output,42);});
  b.add(['hook.failure','tool.failure','process.failure'],async()=>{assert.match(JSON.stringify((await run('raise ValueError("expected failure")')).value),/expected failure/);assert.equal(result(await run('21*2')).output,42);});
  b.add('tool.invalid',async()=>{for(const input of [{language:'javascript',code:'1'},{language:'python',code:123},{language:'python',code:'1',timeoutMs:1}]){const r=await f.emit('service.sandbox.run',input,true);assert.ok(r.faults.length>0||/deny|Invalid|python/i.test(JSON.stringify(r.value)));}assert.equal(result(await run('42')).output,42);});
  b.add('tool.denied',async()=>{const app=await f.app({permissions:{rules:[{tool:'run_python',decision:'deny'}]}});const r=await app.createCore(async()=>true).invokeTool('run_python',{code:'6*7'});assert.equal(r.ok,false);});
  b.add('process.timeout',async()=>{const start=Date.now(),r=await run('while True: pass',{timeoutMs:150});assert.match(JSON.stringify(r.value),/timed out|timeout/i);assert.ok(Date.now()-start<3000);assert.equal(result(await run('42')).output,42);});
  b.add(['tool.cancel','process.cancel','process.cleanup'],async()=>{const work=run('while True: pass',{timeoutMs:2000});await pause(80);f.abort.abort(Error('cancelled'));const r=await work;assert.match(JSON.stringify(r.value),/cancel|aborted/i);f.resetHost();assert.equal(result(await run('42')).output,42);});
 }
 if(f.name==='mcp'){
  const worker=join(f.cwd,'mcp-fixture.mjs'),pidFile=join(f.cwd,'mcp-pids');
  const configure=async(mode='normal',tag='alpha')=>{
   await writeFile(worker,`import{createInterface}from'node:readline';import{appendFileSync}from'node:fs';appendFileSync(${JSON.stringify(pidFile)},process.pid+'\\n');const mode=process.argv[2],tag=process.argv[3];createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;if(mode==='hang')return;if(mode==='exit'){process.exit(3);}if(q.method==='tools/call'&&q.params.name==='hang')return;const result=q.method==='initialize'?{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:tag,version:'1'}}:q.method==='tools/list'?{tools:[{name:'echo',description:'Echo fixture'}]}:{content:[{type:'text',text:tag}],pid:process.pid};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,...(mode==='remote-error'&&q.method==='tools/call'?{error:{code:-32000,message:'fixture remote failure'}}:{result})})+'\\n');});`);
   return{mcpServers:{local:{command:process.execPath,args:[worker,mode,tag],timeoutMs:150}}};
  };
  let config:any;
  const tool=()=>f.module.tools.find((t:any)=>t.name==='mcp_call');
  const ctx=(signal=new AbortController().signal)=>({cwd:f.cwd,signal,settings:async()=>config});
  const call=(name='echo',signal?:AbortSignal)=>tool().execute(ctx(signal),{action:'call',server:'local',tool:name,arguments:{}});
  const pids=async()=>String(await readFile(pidFile,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(Number);
  b.add(['tool.success','mcp.rpc','process.success','hook.repeat'],async()=>{config=await configure();const a=await call(),c=await call();assert.equal(a.ok,true);assert.equal(a.data.content[0].text,'alpha');assert.equal(c.data.pid,a.data.pid);const listed=await tool().execute(ctx(),{action:'list'});assert.equal(listed.data.servers[0].tools[0].name,'echo');});
  b.add(['tool.invalid','mcp.invalid'],async()=>{const before=(await pids()).length;for(const value of [{mcpServers:[]},{mcpServers:{bad:{command:123}}},{mcpServers:{bad:{command:process.execPath,args:42}}}]){config=value;assert.equal((await tool().execute(ctx(),{action:'list'})).ok,false);}assert.equal((await pids()).length,before);config=await configure();assert.equal((await tool().execute(ctx(),{action:'call'})).ok,false);});
  b.add(['tool.denied','mcp.denied'],async()=>{config=await configure();await f.storage.configure('mcp.json',config);const before=(await pids()).length;const app=await f.app({permissions:{rules:[{tool:'mcp_call',decision:'deny'}]}});assert.equal((await app.createCore(async()=>true).invokeTool('mcp_call',{action:'list'})).ok,false);assert.equal((await pids()).length,before);});
  b.add(['tool.failure','mcp.failure','process.failure'],async()=>{config=await configure('remote-error');const r=await call();assert.equal(r.ok,false);assert.match(r.error,/remote failure/);config=await configure('exit');const exited=await call();assert.equal(exited.ok,false);assert.match(exited.error,/exited|closed/);});
  b.add(['mcp.timeout','process.timeout'],async()=>{config=await configure('hang');const r=await call();assert.equal(r.ok,false);assert.match(r.error,/timed out/);const pid=(await pids()).at(-1)!;await stopped(pid);});
  b.add(['tool.cancel','process.cancel'],async()=>{config=await configure();const ready=await call();assert.equal(ready.ok,true);const controller=new AbortController();const work=call('hang',controller.signal);await pause(25);controller.abort();const r=await work;assert.equal(r.ok,false);assert.match(r.error,/cancel/);await stopped(ready.data.pid);});
  b.add(['mcp.cleanup','process.cleanup'],async()=>{config=await configure();assert.equal((await call()).ok,true);await f.module.dispose();for(const pid of await pids())await stopped(pid);});
  b.add('mcp.namespace',async()=>{
   config=await configure();await f.storage.configure('mcp.json',{});const dir=join(f.cwd,'plugins/rpc-owner');await mkdir(dir,{recursive:true});await writeFile(join(dir,'plugin.json'),JSON.stringify({name:'rpc-owner',version:'1.0.0',trust:'trusted',mcpServers:config.mcpServers}));
   const app=await f.app();const core=app.createCore(async()=>true);assert.equal((await core.invokeTool('extension_control',{action:'enable',name:'rpc-owner',scope:'project'})).ok,true);await app.reloadPlugins(core);
   const r=await core.invokeTool('mcp_call',{action:'call',server:'rpc-owner-local',tool:'echo'});assert.equal(r.ok,true,r.error??'Namespaced RPC failed');assert.equal((r.output as any).content[0].text,'alpha');assert.equal((await core.invokeTool('mcp_call',{action:'call',server:'local',tool:'echo'})).ok,false);
  });
  b.add('mcp.reconnect',async()=>{await f.storage.configure('mcp.json',await configure('normal','first'));const app=await f.app(),core=app.createCore(async()=>true);const first=await core.invokeTool('mcp_call',{action:'call',server:'local',tool:'echo'});assert.equal(first.ok,true,first.error??'Initial MCP connection failed');const pid=(first.output as any).pid;await f.storage.configure('mcp.json',await configure('normal','second'));await app.reloadPlugins(core);await stopped(pid);const second=await core.invokeTool('mcp_call',{action:'call',server:'local',tool:'echo'});assert.equal(second.ok,true,second.error??'MCP reconnect failed');assert.equal((second.output as any).content[0].text,'second');assert.notEqual((second.output as any).pid,pid);});
  b.add(['view.empty','state.fresh'],async()=>{await f.storage.configure('mcp.json',{});f.resetHost();await f.start();await f.prompt('/mcp');assert.match(f.text(),/0 configured/);});
  b.add(['view.content','state.restart','state.migration'],async()=>{await f.storage.configure('mcp.json',await configure());f.resetHost();await f.start();await f.prompt('/mcp');assert.match(f.text(),/local/);assert.match(f.text(),/1 configured/);});
  b.add(['view.error','state.invalid'],async()=>{await f.storage.configure('mcp.json',{mcpServers:[]});f.resetHost();await f.start();await f.prompt('/mcp');assert.match(f.text(),/mcpServers|object/);});
  b.add('state.isolation',async()=>{const other=await new Fixture('mcp',f.directory).init();try{await other.start();await other.prompt('/mcp');assert.match(other.text(),/0 configured/);}finally{await other.close();}});
  b.add(['hook.failure','command.failure'],async()=>{f.failView=true;assert.equal((await f.prompt('/mcp',true)).faults.length,1);f.failView=false;await f.prompt('/mcp');assert.match(f.text(),/MCP connections/);});
  b.add('view.lifecycle',async()=>{const before=f.views.length;f.host.unregisterPlugin('mcp');await f.prompt('/mcp');assert.equal(f.views.length,before);f.resetHost();await f.prompt('/mcp');assert.ok(f.views.length>before);});
 }
}
