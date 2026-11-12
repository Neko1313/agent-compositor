import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

/** Real installed host, owned shell, local protocol fixture and journal replay. */
export async function smokeBackgroundTask(binary,output){
 const root=await realpath(await mkdtemp(join(tmpdir(),'compositor-background-smoke-')));
 const cwd=join(root,'project'),home=join(root,'home'),plugins=join(root,'plugins'),name='task-reference-probe';
 const task='Review the controlled background build, preserve user-draft.txt, and report its evidence. Continue this task after build completion.';
 const errors=[],references=[],executions=[];let server,child,mainCalls=0,requests=0,sessionId,reportWritten=false;
 const state=join(cwd,'.agent-compositor'),sessions=join(state,'sessions');
 const poll=async(check,label)=>{const until=Date.now()+20000;while(Date.now()<until){if(await check())return;await new Promise(done=>setTimeout(done,10));}throw Error('Timed out: '+label);};
 const journal=async()=>{const files=await readdir(sessions).catch(()=>[]);const rolls=files.filter(file=>file.endsWith('.jsonl'));assert.ok(rolls.length<=1,'Only the original session may exist');if(!rolls.length)return[];sessionId=rolls[0].slice(0,-6);const text=await readFile(join(sessions,rolls[0]),'utf8');assert.ok(text.length<2_000_000,'Bounded journal');const lines=text.split('\n');lines.pop();return lines.filter(Boolean).map(line=>JSON.parse(line));};
 const start=(resume=false)=>{
  const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),AGENT_STORAGE_MODE:'project',XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:root,TMP:root,TEMP:root,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AGENT_MODEL:'background-task-probe',AGENT_API_KEY:''};
  for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key];
  const processResult={stdout:'',stderr:'',code:null,exited:false};executions.push(processResult);
  child=spawn(resolve(binary),['--plain','--plugins',plugins,...(resume?['--resume',sessionId]:[])],{cwd,env,stdio:['pipe','pipe','pipe']});
  const current=child;processResult.closed=new Promise(done=>{current.once('error',error=>{processResult.error=String(error);processResult.exited=true;done();});current.once('exit',(code,signal)=>{Object.assign(processResult,{code,signal,exited:true});done();});});
  current.stdin.on('error',error=>{processResult.stdinError=String(error);errors.push('Child input failed: '+error.code);});
  for(const stream of ['stdout','stderr'])current[stream].on('data',chunk=>{processResult[stream]+=chunk;if(processResult[stream].length>2_000_000){errors.push('Child output limit exceeded');current.kill('SIGTERM');}});
  return processResult;
 };
 const stop=async()=>{if(!child)return;const current=child,result=executions.at(-1);const exited=async ms=>{let timer;try{await Promise.race([result.closed,new Promise(done=>{timer=setTimeout(done,ms);})]);}finally{clearTimeout(timer);}return result.exited;};if(!result.exited)current.stdin.end();if(!await exited(5000)){current.kill('SIGTERM');if(!await exited(1000))current.kill('SIGKILL');await result.closed;}delete result.closed;child=undefined;};
 try{
  await mkdir(cwd);await mkdir(home);await mkdir(join(plugins,name),{recursive:true});
  await writeFile(join(cwd,'user-draft.txt'),'PRESERVED_BACKGROUND_DRAFT\n');
  await writeFile(join(cwd,'build-evidence.txt'),'Controlled build observation. '.repeat(1800));
  await writeFile(join(cwd,'resume-evidence.txt'),'RESUMED_BUILD_EVIDENCE\n');
  await writeFile(join(plugins,name,'plugin.json'),JSON.stringify({name,version:'1.0.0',main:'hooks.js',trust:'trusted',provides:['service.permission.review'],capabilities:['service.permission.review','prompt.submit'],compositor:{standard:1,apiVersion:1}}));
  await mkdir(join(state,'plugin-state',name),{recursive:true});await writeFile(join(state,'plugin-state',name,'reviews.json'),'[]');
  // A public SDK fixture records the packaged host's real permission context.
  // It does not import source modules or replace core/context/session services.
  await writeFile(join(plugins,name,'hooks.js'),`export default {
   'service.permission.review':async(input,$)=>{const previous=await $.storage.get('reviews','project')??[];await $.storage.set('reviews',[...previous,input.context.task],'project');return{value:{decision:'allow',risk:'low',reason:'Controlled read-only fixture'}};},
   'prompt.submit':async(input,$)=>{if(input.text!=='/resume-background-probe')return;await $.emit('service.agent.enqueue',{plugin:'task-reference-probe',key:'resume',text:'Automated background continuation: inspect the resumed build evidence and continue the original task.'});return{drop:'fixture continuation route'};}
  };`);
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['background-jobs',name],agent:{tools:['exec','read'],builtinTools:['exec','read'],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},compaction:{enabled:true,contextWindow:8192,reserveOutput:1024,reserveSystem:256,highWaterMark:0.65},permissions:{rules:[{tool:'exec',decision:'allow'},{tool:'read',decision:'ask'}]}}));
  server=createServer(async(req,res)=>{try{
   if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'background-task-probe',context_window:8192}]}));return;}
   assert.equal(req.url,'/v1/chat/completions');assert.ok(++requests<=20,'Bounded local request count');
   let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<=200000,'Bounded request body');}
   const body=JSON.parse(raw);assert.equal(body.model,'background-task-probe');res.writeHead(200,{'content-type':'text/event-stream'});
   const frame=(delta,finish_reason='stop')=>'data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n';
   const say=text=>res.end(frame({content:text})+'data: [DONE]\n\n');
   const call=(tool,args)=>res.end(frame({tool_calls:[{index:0,id:'background-'+mainCalls,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]},'tool_calls')+'data: [DONE]\n\n');
   if(body.messages[0]?.content.startsWith('Summarize transcript data')){
    references.push(body.messages.find(m=>m.role==='user'&&m.content.startsWith('Current user request, verbatim JSON reference'))?.content??'MISSING');say('The controlled build completed; its evidence was read. Preserve the user draft and continue the original review task.');return;
   }
   assert.ok(++mainCalls<=6,'Bounded main request count');
   if(mainCalls===1)call('exec',{command:'echo $$ > worker.pid; while [ ! -f allow-completion ]; do sleep 0.01; done; printf CONTROLLED_BUILD_OK',background:true,timeoutMs:30000});
   else if(mainCalls===2)say('ORIGINAL_TASK_WAITING_FOR_BUILD');
   else if(mainCalls===3)call('read',{path:'build-evidence.txt'});
   else if(mainCalls===4){if(!body.messages.some(m=>m.role==='user'&&m.content===task))errors.push('Original task missing after background compaction');say('BACKGROUND_TASK_VERIFIED');}
   else if(mainCalls===5)call('read',{path:'resume-evidence.txt'});
   else {if(!body.messages.some(m=>m.role==='user'&&m.content===task))errors.push('Original task missing after session resume');say('RESUMED_BACKGROUND_TASK_VERIFIED');}
  }catch(error){errors.push(String(error));res.destroy(error);}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const first=start();child.stdin.write(task+'\r');
  await poll(async()=>first.stdout.includes('ORIGINAL_TASK_WAITING_FOR_BUILD')||first.exited,'initial turn');assert.equal(first.exited,false,JSON.stringify(first));
  await writeFile(join(cwd,'allow-completion'),'ready');
  await poll(async()=>(await journal()).some(e=>e.type==='turn.complete'&&e.text==='BACKGROUND_TASK_VERIFIED')||first.exited,'background completion');
  await stop();assert.equal(first.code,0,JSON.stringify(first));
  const second=start(true);
  // A handled command queues through the SDK without adding a new user task.
  child.stdin.write('/resume-background-probe\r');
  await poll(async()=>(await journal()).some(e=>e.type==='turn.complete'&&e.text==='RESUMED_BACKGROUND_TASK_VERIFIED')||second.exited,'resumed follow-up');
  await stop();assert.equal(second.code,0,JSON.stringify(second));
  const events=await journal(),reviews=JSON.parse(await readFile(join(state,'plugin-state',name,'reviews.json'),'utf8'));
  const automatic=events.filter(e=>e.type==='prompt.submit'&&e.text!==task);
  const meta=JSON.parse(await readFile(join(sessions,sessionId+'.meta.json'),'utf8'));
  const completed=events.filter(e=>e.type==='shell.completed');
  const preservation=await readFile(join(cwd,'user-draft.txt'),'utf8')==='PRESERVED_BACKGROUND_DRAFT\n';
  const failures=[];
  if(reviews.length!==2||reviews.some(value=>value!==task))failures.push('Permission review lost the original task');
  if(!references.length||references.some(value=>!value.endsWith(JSON.stringify(task))))failures.push('Compaction lost the original task reference');
  if(automatic.length!==2||automatic.some(event=>event.origin!=='harness'))failures.push('Automatic prompt journal provenance missing');
  if(meta.firstPrompt!==task||meta.lastPrompt!==task)failures.push('Session previews replaced the user task');
  if(completed.length!==1||completed[0].exitCode!==0)failures.push('Expected one successful owned shell completion');
  if(!preservation)failures.push('User draft changed');
  if(mainCalls!==6)failures.push('Unexpected main request count');
  const report={ok:!errors.length&&!failures.length,mainCalls,summaryCalls:references.length,requests,reviews,references,automatic:automatic.map(({text,origin})=>({text,origin})),shellCompletions:completed.length,preservation,sessionId,sessionPreview:meta.lastPrompt,errors,failures,executions,paidRequests:0};
  if(output){await writeFile(output,JSON.stringify(report,null,2)+'\n');reportWritten=true;}
  assert.ok(report.ok,'Installed background-task smoke failed: '+JSON.stringify(report));return report;
 }catch(error){
  if(output&&!reportWritten)await writeFile(output,JSON.stringify({ok:false,error:String(error),mainCalls,requests,references,errors,executions:executions.map(({closed,...result})=>result),events:(await journal()).filter(e=>['turn.failed','turn.complete','prompt.submit','tool.result','shell.completed','plugin.fault'].includes(e.type))},null,2)+'\n');
  throw error;
 }finally{
  await writeFile(join(cwd,'allow-completion'),'cleanup').catch(()=>{});await stop();
  if(server){server.closeAllConnections();await new Promise(done=>server.close(()=>done()));}
  await rm(root,{recursive:true,force:true});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!process.argv[2])throw Error('Provide the installed compositor binary path');
 console.log(JSON.stringify(await smokeBackgroundTask(process.argv[2],process.argv[3])));
}
