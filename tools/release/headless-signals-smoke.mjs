import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,readdir,realpath,lstat,readlink,unlink} from 'node:fs/promises';
import {dirname,basename,join,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const exec=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const alive=pid=>{try{process.kill(pid,0);return pid>0;}catch{return false;}};
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function poll(check,label,timeout=30000){const started=Date.now();while(!await check()){if(Date.now()-started>=timeout)throw Error('Timed out waiting for '+label);await pause(10);}}
function environment(home,temp,base){
  const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),AGENT_STORAGE_MODE:'project',XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:temp,TMP:temp,TEMP:temp,AGENT_BASE_URL:base+'/v1',AGENT_MODEL:'headless-signal-probe',AGENT_API_KEY:''};
  for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key];return env;
}
function launch(command,args,options){
  const child=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});
  const state={pid:child.pid,stdout:'',stderr:'',exited:false,code:null,signal:null};
  state.closed=new Promise(done=>{
    child.once('error',error=>{state.error=String(error);});
    child.once('close',(code,signal)=>{Object.assign(state,{code,signal,exited:true});done();});
  });
  for(const stream of ['stdout','stderr'])child[stream].on('data',data=>{
    state[stream]+=data;if(Buffer.byteLength(state[stream])>2000000){state.error='Fixture output byte limit exceeded';child.kill('SIGTERM');}
  });
  return{child,state};
}
async function identity(binary,options){
  const path=await realpath(resolve(binary)),result={mode:options.source?'source':'installed',executable:{path,sha256:sha(await readFile(path))}};
  const checker=fileURLToPath(import.meta.url);result.checker={path:checker,sha256:sha(await readFile(checker))};
  if(options.source){
    const entry=await realpath(options.source),root=resolve(dirname(entry),'../../..');
    assert.equal(entry,join(root,'packages/app/src/bin.ts'),'Source mode requires the actual Compositor CLI entry');
    result.entry={path:entry,sha256:sha(await readFile(entry))};result.sourceFiles=[];
    for(const name of ['packages/app/src/bin.ts','packages/app/src/main.ts','packages/app/src/headless.ts','packages/app/src/build.ts','packages/app/src/agents.ts','packages/core/src/loop.ts','packages/hooks/src/hooks.ts','packages/hooks/src/exec.ts','packages/runtime/src/dispatcher.ts','packages/tools/src/resolvers.ts'])result.sourceFiles.push({path:name,sha256:sha(await readFile(join(root,name)))});
  }else{
    const renderer=join(dirname(path),'node_modules/@agent-compositor/renderer-opentui/index.js');result.renderer={path:renderer,sha256:sha(await readFile(renderer))};
  }
  if(options.archive){assert.equal(sha(await readFile(options.archive.path)),options.archive.sha256,'Canonical archive identity');result.archive={path:resolve(options.archive.path),sha256:options.archive.sha256};}
  return result;
}
async function evidenceFiles(root){
  const rows=[],links=[],hidden=[];
  async function visit(directory){for(const name of (await readdir(directory)).sort()){
    const path=join(directory,name),info=await lstat(path),relativePath=relative(root,path).replaceAll('\\','/');
    if(info.isDirectory())await visit(path);
    else if(info.isFile()){
      const bytes=await readFile(path),entry={path:relativePath,bytes:info.size,sha256:sha(bytes)};
      if(relativePath.split('/').some(part=>part.startsWith('.')))hidden.push({...entry,data:bytes});else rows.push(entry);
    }
    else if(info.isSymbolicLink()){
      // Never upload a live link or inspect its target. Preserve the link as
      // regular data only after all owned CLI/worker processes have exited.
      links.push({path:relativePath,target:await readlink(path)});await unlink(path);
    }else throw Error('Unexpected non-regular evidence entry: '+relative(root,path));
  }}
  await visit(root);
  // GitHub's artifact upload omits hidden components. Preserve exact journal
  // and state bytes in visible files, with their original path/hash mapping.
  // The original hidden workspace remains local and is not a hashed upload row.
  if(hidden.length){
    const directory=join(root,'retained-state');await mkdir(directory);const mapping=[];
    for(const [index,{path,bytes,sha256,data}] of hidden.entries()){
      const extension=/\.(jsonl|json|txt|log)$/.exec(path)?.[0]??'.data',target='retained-state/'+String(index+1).padStart(5,'0')+extension;
      await writeFile(join(root,target),data,{flag:'wx'});mapping.push({sourcePath:path,path:target,bytes,sha256});rows.push({path:target,bytes,sha256});
    }
    const path='retained-state/manifest.json',bytes=Buffer.from(json({files:mapping}));await writeFile(join(root,path),bytes,{flag:'wx'});rows.push({path,bytes:bytes.length,sha256:sha(bytes)});
  }
  if(links.length){const path=join(root,'retained-symlinks.json'),bytes=Buffer.from(json({links}));await writeFile(path,bytes,{flag:'wx'});rows.push({path:'retained-symlinks.json',bytes:bytes.length,sha256:sha(bytes)});}
  return rows.sort((a,b)=>a.path.localeCompare(b.path));
}

/** Real installed CLI signal handling; fixtures never import application/Core
 * modules. Force-killing a failed fixture is cleanup, never passing evidence. */
export async function smokeHeadlessSignals(binary,output,options={}){
  assert.ok(['linux','darwin'].includes(process.platform),'Headless signal smoke requires a declared POSIX release platform');
  assert.ok(typeof output==='string'&&output.endsWith('.json'),'A fresh retained JSON report path is required');
  const reportPath=resolve(output),rawRoot=reportPath.slice(0,-5);await mkdir(dirname(reportPath),{recursive:true});
  await assert.rejects(readFile(reportPath),error=>error.code==='ENOENT','Preserve an existing smoke report');
  await mkdir(rawRoot);const attempt=await realpath(await mkdtemp(join(rawRoot,'attempt-'))),before=await identity(binary,options);
  const cases=[],errors=[];let server,current;
  const frame=(delta,finish_reason=null)=>'data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n';
  const sourceArgs=options.source?[await realpath(options.source)]:[];
  try{
    server=createServer((request,response)=>{void(async()=>{
      const active=current;assert.ok(active,'A case must own every fixture request');assert.equal(request.url,'/v1/chat/completions');assert.equal(request.method,'POST');
      const number=++active.modelRequests;assert.ok(number<=2,'Bounded loopback model requests');let text='';
      for await(const chunk of request){text+=chunk;assert.ok(Buffer.byteLength(text)<=200000,'Bounded model request');}
      const body=JSON.parse(text);assert.equal(body.model,'headless-signal-probe');assert.ok(body.messages.some(message=>message.role==='user'&&message.content===active.task));
      await writeFile(join(active.directory,`http-${number}.json`),text,{flag:'wx'});
      response.writeHead(200,{'content-type':'text/event-stream'});
      if(active.mode==='sdk-command')throw Error('An immediate command must not reach a model');
      if(number===1){
        const args={command:active.command,timeoutMs:60000,...(active.mode==='held-model'?{background:true}:{})};
        response.end(frame({tool_calls:[{index:0,id:'signal-exec',type:'function',function:{name:'exec',arguments:JSON.stringify(args)}}]},'tool_calls')+'data: [DONE]\n\n');
      }else{
        assert.equal(active.mode,'held-model');const last=body.messages.at(-1);assert.equal(last.role,'tool');
        const result=JSON.parse(last.content);assert.equal(result.started,true);assert.equal(typeof result.shellId,'string');active.backgroundReceipt=result;
        active.held=true;response.on('close',()=>{active.heldConnectionClosed=true;});response.flushHeaders();response.write(frame({content:'HEADLESS_SIGNAL_HELD'}));
      }
    })().catch(error=>{errors.push(String(error));response.destroy(error);});});
    await new Promise(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${server.address().port}`;
    for(const signal of ['SIGINT','SIGTERM'])for(const mode of ['sdk-command','foreground-tool','held-model']){
      const directory=join(attempt,signal.toLowerCase()+'-'+mode),cwd=join(directory,'project with spaces'),home=join(directory,'home'),plugins=join(directory,'signal-plugin');
      await Promise.all([cwd,home,plugins].map(path=>mkdir(path,{recursive:true})));
      const ownNames=mode==='sdk-command'?['sdk-command']:mode==='foreground-tool'?['native-foreground']:['native-background','sdk-background'];
      const state={id:signal+'-'+mode,mode,signal,directory,task:mode==='sdk-command'?'/headless-signal-owned':'HEADLESS_SIGNAL_'+mode,modelRequests:0,ownedNames:ownNames};cases.push(state);current=state;
      const actions=[],record=value=>actions.push({at:Date.now(),...value}),workerPath=name=>join(cwd,name+'.mjs'),pidPath=name=>join(cwd,name+'.pid');
      for(const name of [...ownNames,'unrelated-neighbor'])await writeFile(workerPath(name),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidPath(name))},String(process.pid));setInterval(()=>{},1000);setTimeout(()=>process.exit(89),90000);\n`);
      await writeFile(join(cwd,'user-draft.txt'),'PRESERVED_SIGNAL_DRAFT\n');
      const nativeName=mode==='foreground-tool'?'native-foreground':'native-background';state.command='exec node '+quote(workerPath(nativeName));
      // Exec descriptors remove shell quoting before exact command matching.
      state.permissionCommand='exec node '+workerPath(nativeName);
      await writeFile(join(plugins,'plugin.json'),json({name:'headless-signal-probe',version:'1.0.0',main:'hooks.js',trust:'trusted',compositor:{standard:1,apiVersion:1},commands:[{name:'/headless-signal-owned',description:'Run the controlled owned worker',execution:'immediate'}],hookTimeouts:{'command.invoke':120000}}));
      await writeFile(join(plugins,'hooks.js'),`import {appendFile} from 'node:fs/promises';
const record=value=>appendFile(${JSON.stringify(join(directory,'sdk-caller.jsonl'))},JSON.stringify(value)+'\\n');
export default {
 'session.start':(_event,$)=>{if(${JSON.stringify(mode)}!=='held-model')return;const api=$.background();void api.exec.run('node',[${JSON.stringify(workerPath('sdk-background'))}],{timeoutMs:60000}).then(value=>record({kind:'background-settled',value}),error=>record({kind:'background-aborted',error:String(error)}));},
 'command.invoke':async(event,$)=>{if(event.name!=='/headless-signal-owned')return;try{await $.exec.run('node',[${JSON.stringify(workerPath('sdk-command'))}],{timeoutMs:60000});}finally{await record({kind:'command-settled'});}}
};`);
      await writeFile(join(cwd,'agent-compositor.json'),json({enabledPlugins:['headless-signal-probe'],providers:{default:{type:'openai-compat',baseUrl:base+'/v1',model:'headless-signal-probe',contextWindow:32768,maxOutputTokens:128,retries:0}},agent:{tools:mode==='sdk-command'?[]:['exec'],builtinTools:mode==='sdk-command'?[]:['exec'],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},permissions:{rules:[{tool:'exec',command:state.permissionCommand,decision:'allow'}]},compaction:{enabled:false}}));
      const env=environment(home,directory,base),neighbor=launch('node',[workerPath('unrelated-neighbor')],{cwd,env,detached:true});
      let actor,owned=[],forcedOwnedCleanup=[];
      try{
        await poll(async()=>await readFile(pidPath('unrelated-neighbor'),'utf8').catch(()=>'')!=='','unrelated neighbor readiness');
        actor=launch(before.executable.path,[...sourceArgs,'--cwd',cwd,'--plugins',plugins,'--max-steps','4','-p',state.task,'--output-format','stream-json'],{cwd,env});
        record({kind:'spawn',pid:actor.state.pid});
        await poll(async()=>{
          if(actor.state.exited)throw Error('CLI exited before the real workers were ready: '+JSON.stringify(actor.state));
          const values=await Promise.all(ownNames.map(async name=>({name,pid:Number(await readFile(pidPath(name),'utf8').catch(()=>''))})));
          if(values.some(value=>!value.pid||!alive(value.pid)))return false;owned=values;
          return mode!=='held-model'||state.held&&actor.state.stdout.includes('HEADLESS_SIGNAL_HELD');
        },'owned workers and active headless lane');
        record({kind:'workers-ready',owned});state.ownedPids=owned;state.neighborPid=Number(await readFile(pidPath('unrelated-neighbor'),'utf8'));
        actor.child.kill(signal);record({kind:'external-signal',signal,pid:actor.state.pid});
        await poll(()=>actor.state.exited,'graceful headless exit',10000);await actor.state.closed;record({kind:'exit',code:actor.state.code,signal:actor.state.signal});
        const goneAt=Date.now();while(owned.some(value=>alive(value.pid))&&Date.now()-goneAt<2000)await pause(10);
        state.ownedPids=owned.map(value=>({...value,reaped:!alive(value.pid)}));state.neighborPreserved=alive(state.neighborPid);
        state.exitCode=actor.state.code;state.exitSignal=actor.state.signal;
        const lines=actor.state.stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line)),results=lines.filter(value=>value.type==='result');state.results=results;
        state.preservation=await readFile(join(cwd,'user-draft.txt'),'utf8')==='PRESERVED_SIGNAL_DRAFT\n';
        record({kind:'before-fixture-cleanup',owned:state.ownedPids,neighborPreserved:state.neighborPreserved});
        assert.equal(actor.state.error,undefined);assert.equal(actor.state.code,signal==='SIGINT'?130:143);assert.equal(actor.state.signal,null);
        assert.equal(results.length,1,'Exactly one final structured result');assert.equal(lines.at(-1).type,'result','No late records after final result');assert.equal(results[0].error,'Interrupted by '+signal);
        assert.ok(state.ownedPids.every(value=>value.reaped),'Every actual owned worker must be gone before fixture cleanup');assert.equal(state.neighborPreserved,true);assert.equal(state.preservation,true);
        assert.equal(state.modelRequests,mode==='sdk-command'?0:mode==='foreground-tool'?1:2);
        if(mode==='held-model')assert.equal(state.heldConnectionClosed,true,'Aborted Main must close its pending model connection');
        state.ok=true;
      }catch(error){state.error=String(error);state.ok=false;throw error;}
      finally{
        if(actor&&!actor.state.exited){actor.child.kill('SIGTERM');await Promise.race([actor.state.closed,pause(2000)]);if(!actor.state.exited){actor.child.kill('SIGKILL');await actor.state.closed;state.forcedActorCleanup=true;}}
        // This runs only after grading facts above. Unique fixture argv verifies
        // ownership before failed-case cleanup; never use it as product proof.
        for(const name of ownNames){const pid=Number(await readFile(pidPath(name),'utf8').catch(()=>''));if(pid&&alive(pid)){
          const command=(await exec('ps',['-p',String(pid),'-o','command=']).catch(()=>({stdout:''}))).stdout;
          if(command.includes(workerPath(name))){try{process.kill(-pid,'SIGKILL');}catch{try{process.kill(pid,'SIGKILL');}catch{}}forcedOwnedCleanup.push({name,pid});}
        }}
        if(!neighbor.state.exited){neighbor.child.kill('SIGTERM');await Promise.race([neighbor.state.closed,pause(2000)]);if(!neighbor.state.exited){neighbor.child.kill('SIGKILL');await neighbor.state.closed;}}
        state.fixtureCleanup={forcedOwnedCleanup,neighborExit:neighbor.state.code,neighborSignal:neighbor.state.signal};
        if(actor){await writeFile(join(directory,'stdout.jsonl'),actor.state.stdout,{flag:'wx'});await writeFile(join(directory,'stderr.txt'),actor.state.stderr,{flag:'wx'});}
        await writeFile(join(directory,'actions.jsonl'),actions.map(value=>JSON.stringify(value)).join('\n')+'\n',{flag:'wx'});
        await writeFile(join(directory,'case.json'),json({...state,artifact:before}),{flag:'wx'});
      }
    }
    assert.equal(errors.length,0,JSON.stringify(errors));assert.deepEqual(await identity(binary,options),before,'Executable/module/source identity must remain unchanged');
    const report={schema:1,platform:process.platform+'-'+process.arch,ok:true,scope:'Actual headless CLI graceful SIGINT/SIGTERM; no SIGKILL cleanup guarantee',evidencePolicy:'Visible regular files only; hidden state copied byte-for-byte, symlinks recorded as metadata without reading targets',artifact:before,cases,errors,paidRequests:0,
      evidenceDirectory:basename(rawRoot),runDirectory:basename(attempt),evidence:await evidenceFiles(rawRoot)};
    await writeFile(reportPath,json(report),{flag:'wx'});return report;
  }catch(error){
    const report={schema:1,platform:process.platform+'-'+process.arch,ok:false,error:String(error),evidencePolicy:'Visible regular files only; hidden state copied byte-for-byte, symlinks recorded as metadata without reading targets',artifact:before,cases,errors,paidRequests:0,evidenceDirectory:basename(rawRoot),runDirectory:basename(attempt),evidence:await evidenceFiles(rawRoot)};
    await writeFile(reportPath,json(report),{flag:'wx'});throw error;
  }finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(()=>done()));}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const source=process.argv[2]==='--source',binary=source?process.execPath:process.argv[2],entry=source?process.argv[3]:undefined,output=process.argv[source?4:3];
  if(!binary||!output)throw Error('Usage: bun headless-signals-smoke.mjs BINARY REPORT.json | --source packages/app/src/bin.ts REPORT.json');
  console.log(JSON.stringify(await smokeHeadlessSignals(binary,output,{source:entry})));
}
