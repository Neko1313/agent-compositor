import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,access,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

/** Installed binary, real stdin/EOF and bounded loopback transport; no paid provider. */
export async function smokePlainControls(binary,output){
 const root=await realpath(await mkdtemp(join(tmpdir(),'compositor-plain-controls-')));
 const home=join(root,'home'),cwd=join(root,'project'),plugins=join(root,'plugins'),runs=[],errors=[];
 let server,child,current,requests=0,reportWritten=false;
 const exists=path=>access(path).then(()=>true,()=>false);
 const poll=async(check,label)=>{const until=Date.now()+15000;while(Date.now()<until){if(await check())return;await new Promise(done=>setTimeout(done,10));}throw Error('Timed out: '+label);};
 const stop=async()=>{if(!child)return;const previous=child;child=undefined;if(!previous.pid)return;previous.kill('SIGTERM');await new Promise(done=>{if(previous.exitCode!==null||previous.signalCode!==null)return done();const timer=setTimeout(()=>previous.kill('SIGKILL'),1000);previous.once('close',()=>{clearTimeout(timer);done();});});};
 const start=(args,pty=false)=>{
  const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),AGENT_STORAGE_MODE:'project',XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:root,TMP:root,TEMP:root,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AGENT_MODEL:'plain-controls-probe',AGENT_API_KEY:''};
  for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key];
  current={args,pty,stdout:'',stderr:'',exited:false,code:null};runs.push(current);const result=current;
  const argv=[resolve(binary),...args,'--plugins',plugins];
  child=spawn(pty?(process.env.PYTHON??'python3'):argv[0],pty?['-u',resolve('tools/visual/pty_bridge.py'),...argv]:argv.slice(1),{cwd,env,stdio:['pipe','pipe','pipe']});const spawned=child;
  child.once('error',error=>{errors.push(String(error));result.exited=true;});child.once('close',(code,signal)=>{result.exited=true;result.code=code;result.signal=signal;});
  child.stdin.on('error',error=>errors.push('Input: '+error.code));
  let wire='';
  for(const stream of ['stdout','stderr'])child[stream].on('data',chunk=>{
   if(pty&&stream==='stdout'){wire+=chunk.toString();let index;while((index=wire.indexOf('\n'))>=0){const line=wire.slice(0,index);wire=wire.slice(index+1);try{const event=JSON.parse(line);if(event.type==='data')result.stdout+=event.data;}catch(error){errors.push(String(error));}}}
   else result[stream]+=chunk;
   if(result[stream].length>2_000_000||wire.length>2_000_000){errors.push('Output limit exceeded');spawned.kill('SIGTERM');}
  });
  return result;
 };
 try{
  await mkdir(cwd);await mkdir(home);await mkdir(join(plugins,'plain-control'),{recursive:true});
  await writeFile(join(plugins,'plain-control/plugin.json'),JSON.stringify({name:'plain-control',version:'1.0.0',trust:'trusted',main:'hooks.js',commands:[{name:'/native-control',execution:'immediate',description:'Controlled native release probe'}],hookTimeouts:{'command.invoke':30000}}));
  await writeFile(join(plugins,'plain-control/hooks.js'),`import{access}from'node:fs/promises';import{join}from'node:path';
const wait=async(path,signal)=>{while(!await access(path).then(()=>true,()=>false)){signal.throwIfAborted();await new Promise(done=>setTimeout(done,10));}};
export default{'command.invoke':async(e,$)=>{if(e.name!=='/native-control')return;
 if(e.args==='release'){await wait(join($.session.cwd,'request-started'),$.signal);await $.fs.write('release-main','ready');await $.ui.notify('CONTROL_RELEASED');}
 else if(e.args==='hold'){await $.fs.write('control-started','ready');await wait(join($.session.cwd,'release-command'),$.signal);await $.ui.notify('CONTROL_FINISHED');}
}};`);
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['plain-control','btw','auto-approve'],agent:{tools:['write'],builtinTools:['write'],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},compaction:{enabled:false}}));
  server=createServer(async(req,res)=>{try{
   if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'plain-controls-probe'}]}));return;}
   assert.equal(req.url,'/v1/chat/completions');assert.ok(++requests<=5,'Bounded local model requests');
   let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<200000,'Bounded request body');}
   const body=JSON.parse(raw),prompt=body.messages.filter(message=>message.role==='user').at(-1)?.content;
   res.writeHead(200,{'content-type':'text/event-stream'});
   const say=text=>res.end('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:3}})+'\n\ndata: [DONE]\n\n');
   if(prompt==='NATIVE_APPROVAL'){
    assert.deepEqual(body.messages.filter(message=>message.role==='user').map(message=>message.content),['NATIVE_APPROVAL']);
    if(body.messages.at(-1)?.role==='tool'){
     assert.match(body.messages.at(-1).content,/native-approved/);
     // Text is observable before completion. Hold the stream until the user interrupts it.
     res.write('data: '+JSON.stringify({choices:[{delta:{content:'APPROVAL_DONE'},finish_reason:null}]})+'\n\n');
     await new Promise(done=>res.once('close',done));
    }
    else res.end('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'controlled-native-write',type:'function',function:{name:'write',arguments:JSON.stringify({path:'native-approved.txt',content:'APPROVED'})}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n');
   }else if(prompt==='NATIVE_MAIN 👩🏽‍💻'){
    await writeFile(join(cwd,'request-started'),'ready');await poll(()=>exists(join(cwd,'release-main')),'controlled main release');say('MAIN_FINISHED');
   }else{assert.match(prompt,/NATIVE_ONCE/);say('NATIVE_ONCE_ANSWER');}
  }catch(error){errors.push(String(error));res.destroy(error);}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const pasted=start(['--plain']);child.stdin.end('NATIVE_MAIN 👩🏽‍💻\r/native-control release\r');
  await poll(()=>pasted.exited,'pasted control process');assert.equal(pasted.code,0,JSON.stringify(pasted));assert.match(pasted.stdout,/CONTROL_RELEASED/);assert.match(pasted.stdout,/MAIN_FINISHED/);assert.equal(requests,1);
  await rm(join(cwd,'request-started'));await rm(join(cwd,'release-main'));
  const pending=start(['--plain']);child.stdin.write('NATIVE_MAIN 👩🏽‍💻\r');await poll(()=>exists(join(cwd,'request-started')),'held native request');
  child.stdin.write('/native-control hold\r');await poll(()=>exists(join(cwd,'control-started')),'independent control started');child.stdin.end();
  await writeFile(join(cwd,'release-main'),'ready');await poll(()=>pending.stdout.includes('MAIN_FINISHED')||pending.exited,'main turn finished');
  assert.equal(pending.exited,false,'EOF must wait for the command after the model finishes');
  await writeFile(join(cwd,'release-command'),'ready');await poll(()=>pending.exited,'command drained after EOF');assert.equal(pending.code,0,JSON.stringify(pending));assert.match(pending.stdout,/CONTROL_FINISHED/);assert.equal(requests,2);
  const once=start(['-p','/btw --once NATIVE_ONCE','--output-format','json']);child.stdin.end();await poll(()=>once.exited,'one-shot headless response');assert.equal(once.code,0,JSON.stringify(once));
  const answer=JSON.parse(once.stdout);assert.equal(answer.response,'NATIVE_ONCE_ANSWER');assert.deepEqual(answer.usage,{inputTokens:7,outputTokens:3});assert.equal(requests,3);
  const unavailable=start(['-p','/btw NATIVE_UNAVAILABLE','--output-format','json']);child.stdin.end();await poll(()=>unavailable.exited,'missing capability response');assert.equal(unavailable.code,1);
  const failure=JSON.parse(unavailable.stdout);assert.match(failure.error,/agent-hub/);assert.equal(failure.response,failure.error);assert.equal(requests,3);
  const raw=start(['--plain'],true),send=text=>child.stdin.write(JSON.stringify({type:'input',data:text})+'\n');
  await poll(()=>raw.stdout.includes('Enter submit')||raw.exited,'raw PTY startup');assert.equal(raw.exited,false);
  send('NATIVE_APPROVAL\r');await poll(()=>raw.stdout.includes('Allow?')||raw.exited,'raw native approval');assert.equal(raw.exited,false);
  send('y\r');await poll(()=>raw.stdout.includes('APPROVAL_DONE')||raw.exited,'human answer consumed');
  assert.equal(await readFile(join(cwd,'native-approved.txt'),'utf8'),'APPROVED');assert.equal(requests,5);
  assert.doesNotMatch(raw.stdout,/\[steer\]|\[queued\]/,'The human answer must not be steered or queued as a task');
  send('\x03');await poll(()=>raw.stdout.includes('[interrupted]')||raw.exited,'raw stream interruption');assert.equal(raw.exited,false);
  send('\x03');await poll(()=>raw.exited,'idle raw PTY exit');assert.match(raw.stdout,/bye/);assert.equal(raw.code,0,JSON.stringify(raw));assert.equal(requests,5);
  const report={ok:errors.length===0,pastedCommand:true,eofWaitsForCommand:true,rawApprovalAnswerNotSubmitted:true,rawInterruptThenExit:true,oneShotResponse:answer.response,oneShotUsage:answer.usage,missingCapabilityExit:unavailable.code,requests,runs,errors,paidRequests:0};
  if(output){await writeFile(output,JSON.stringify(report,null,2)+'\n');reportWritten=true;}assert.ok(report.ok,JSON.stringify(report));return report;
 }catch(error){
  if(output&&!reportWritten)await writeFile(output,JSON.stringify({ok:false,error:String(error),requests,runs,errors,paidRequests:0},null,2)+'\n');throw error;
 }finally{
  await stop();if(server){server.closeAllConnections();await new Promise(done=>server.close(()=>done()));}
  await rm(root,{recursive:true,force:true});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!process.argv[2])throw Error('Provide the installed binary path');console.log(JSON.stringify(await smokePlainControls(process.argv[2],process.argv[3])));
}
