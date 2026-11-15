import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

/** Installed CLI and actual journal across a process death after a controlled effect. */
export async function smokeEffectCrash(binary,output,options={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'compositor-effect-smoke-')));
 const cwd=join(root,'project'),home=join(root,'home'),plugins=join(root,'plugins'),effect=join(cwd,'effect.txt'),sessions=join(cwd,'.agent-compositor/sessions');
 const task='Apply the controlled effect exactly once.',followup='Inspect the state before doing anything else.';
 const result={ok:false,unknownBeforeEffect:Boolean(options.unknownBeforeEffect),paidRequests:0,requests:[],executions:[],errors:[],executable:{path:resolve(binary),sha256:createHash('sha256').update(await readFile(binary)).digest('hex')}};
 let server,child,sessionId;
 const poll=async(fn,label)=>{const deadline=Date.now()+30000;while(Date.now()<deadline){if(await fn())return;await new Promise(done=>setTimeout(done,25));}throw Error('Timed out: '+label);};
 const journal=async()=>{const names=(await readdir(sessions).catch(()=>[])).filter(name=>name.endsWith('.jsonl'));assert.ok(names.length<=1,'Only one session is allowed');if(!names.length)return[];sessionId=names[0].slice(0,-6);const lines=(await readFile(join(sessions,names[0]),'utf8')).split('\n');lines.pop();return lines.filter(Boolean).map(line=>JSON.parse(line));};
 const start=resume=>{
  const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),AGENT_STORAGE_MODE:'project',XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:root,TMP:root,TEMP:root,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AGENT_MODEL:'effect-crash-probe',AGENT_API_KEY:''};
  for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key];
  const record={stdout:'',stderr:'',code:null,signal:null,exited:false};result.executions.push(record);
  child=spawn(resolve(binary),['--plain','--plugins',plugins,...(resume?['--resume',sessionId]:[])],{cwd,env,stdio:['pipe','pipe','pipe']});
  child.stdin.on('error',()=>{});for(const name of ['stdout','stderr'])child[name].on('data',data=>{record[name]+=data;if(record[name].length>2_000_000)child.kill('SIGKILL');});
  record.closed=new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{Object.assign(record,{code,signal,exited:true});done();});});return record;
 };
 try{
  await mkdir(cwd);await mkdir(home);await mkdir(join(plugins,'effect-crash-probe'),{recursive:true});
  await writeFile(join(cwd,'user-draft.txt'),'PRESERVED_USER_DRAFT\n');
  await writeFile(join(plugins,'effect-crash-probe','plugin.json'),JSON.stringify({name:'effect-crash-probe',version:'1.0.0',trust:'trusted',compositor:{standard:1,apiVersion:1}}));
  await writeFile(join(plugins,'effect-crash-probe','tools.js'),`import {appendFile} from 'node:fs/promises';export default [{name:'effect_once',description:'Apply a controlled effect',parameters:{type:'object'},describe:()=>({tool:'effect_once'}),execute:async()=>{await appendFile(${JSON.stringify(effect)},'APPLIED_ONCE\\n');setInterval(()=>{},1000);await new Promise(()=>{});}}];`);
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['effect-crash-probe'],agent:{tools:['effect_once'],builtinTools:[],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},compaction:{enabled:false},permissions:{rules:[{tool:'effect_once',decision:'allow'}]}}));
  server=createServer(async(req,res)=>{try{
   if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'effect-crash-probe'}]}));return;}
   assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<1_000_000);}
   const body=JSON.parse(raw);result.requests.push(body);const effectStep=options.unknownBeforeEffect?2:1;
   assert.ok(result.requests.length<=effectStep+1,'Bounded provider requests');
   const call=(id,name,args)=>({tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
   const delta=options.unknownBeforeEffect&&result.requests.length===1?call('unknown-call','missing_tool',{path:'wanted.txt'}):result.requests.length===effectStep?call('effect-call','effect_once',{}):{content:'RECOVERY_INSPECT_FIRST'};
   res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta,finish_reason:result.requests.length<=effectStep?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
  }catch(error){result.errors.push(String(error));res.destroy(error);}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const first=start(false);child.stdin.write(task+'\r');
  await poll(async()=>first.exited||(await readFile(effect,'utf8').catch(()=>''))==='APPLIED_ONCE\n','effect before process death');
  assert.equal(first.exited,false,'CLI must still be running when the effect is observed');
  const before=await journal(),call=before.find(event=>event.type==='tool.call'&&event.tool==='effect_once');
  assert.ok(call?.callId,'Tool admission must be journaled before the effect');assert.ok(!before.some(event=>event.type==='tool.result'&&event.callId===call.callId),'No result may be saved before the kill');
  assert.equal(child.kill('SIGKILL'),true);await first.closed;assert.equal(first.signal,'SIGKILL');
  const effectStep=options.unknownBeforeEffect?2:1;assert.equal(result.requests.length,effectStep);assert.equal(await readFile(effect,'utf8'),'APPLIED_ONCE\n');
  const second=start(true);child.stdin.write(followup+'\r');
  await poll(async()=>second.exited||second.stdout.includes('RECOVERY_INSPECT_FIRST'),'resumed model response');
  assert.ok(second.stdout.includes('RECOVERY_INSPECT_FIRST'),'Resumed CLI must receive the controlled response');
  assert.equal(result.requests.length,effectStep+1);const body=result.requests[effectStep];
  if(options.unknownBeforeEffect){
   const rejected=body.messages.find(message=>message.role==='tool'&&message.tool_call_id==='unknown-call');
   const original=body.messages.flatMap(message=>message.tool_calls??[]).find(call=>call.id==='unknown-call');
   assert.match(String(rejected?.content),/unknown tool/i);assert.equal(original?.function?.name,'missing_tool');
   assert.deepEqual(JSON.parse(original.function.arguments),{path:'wanted.txt'});
  }
  assert.ok(body.messages.some(message=>message.role==='user'&&message.content===task),'Original task must survive');
  const outcome=body.messages.find(message=>message.role==='tool'&&message.tool_call_id===call.callId);
  assert.match(String(outcome?.content),/outcome is unknown/i);assert.match(String(outcome?.content),/inspect its state before retrying/i);
  assert.equal(await readFile(effect,'utf8'),'APPLIED_ONCE\n');assert.equal(await readFile(join(cwd,'user-draft.txt'),'utf8'),'PRESERVED_USER_DRAFT\n');
  child.stdin.end();await poll(()=>second.exited,'resumed CLI exit');assert.equal(second.code,0);result.ok=true;
 }catch(error){result.errors.push(String(error));}
 finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await result.executions.at(-1).closed.catch(()=>{});}
  server?.closeAllConnections();if(server)await new Promise(done=>server.close(()=>done()));
  for(const record of result.executions)delete record.closed;
  if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n');
  await rm(root,{recursive:true,force:true});
 }
 if(!result.ok)throw Error('Installed effect crash smoke failed: '+result.errors.join('; '));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await smokeEffectCrash(process.argv[2],process.argv[3],{unknownBeforeEffect:process.argv[4]==='--unknown-before-effect'});}catch(error){console.error(error);process.exitCode=1;}
}
