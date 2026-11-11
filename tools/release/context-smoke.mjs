import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

/** Exercise the installed binary with local transport; no source-runtime injection. */
export async function smokeContextTask(binary,output){
 const root=await realpath(await mkdtemp(join(tmpdir(),'compositor-context-smoke-')));
 const cwd=join(root,'project'),home=join(root,'home'),references=[],errors=[];
 const task='Write result.txt with exactly corrected followed by a newline, preserve user-draft.txt, and report the concrete result. No project verification command is available in this fixture.';
 let server,mainCalls=0,requests=0,writes=0,execution;
 try{
  await mkdir(cwd);await mkdir(home);
  await writeFile(join(cwd,'result.txt'),'original\n');await writeFile(join(cwd,'user-draft.txt'),'USER_DRAFT_MUST_SURVIVE\n');
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agent-harness'],agent:{tools:['write'],builtinTools:['write'],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:true},compaction:{enabled:true,contextWindow:16384,reserveOutput:8192,reserveSystem:256,highWaterMark:0.65},permissions:{rules:[{tool:'write',path:cwd+'/**',decision:'allow'}]}}));
  server=createServer(async(req,res)=>{try{
   if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'packed-context-probe',context_window:16384}]}));return;}
   assert.equal(req.url,'/v1/chat/completions');assert.ok(++requests<=16,'Bounded local model requests');
   let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<=200000,'Bounded request body');}
   const body=JSON.parse(raw);assert.equal(body.model,'packed-context-probe');
   res.writeHead(200,{'content-type':'text/event-stream'});
   const frame=(delta,finish_reason='stop')=>'data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n';
   if(body.messages[0]?.content.startsWith('Summarize transcript data')){
    references.push(body.messages.find(m=>m.role==='user'&&m.content.startsWith('Current user request, verbatim JSON reference'))?.content??'MISSING');
    res.end(frame({content:'The requested file was written once. Preserve the user draft and report actual results; verification is unavailable.'})+'data: [DONE]\n\n');return;
   }
   assert.ok(++mainCalls<=3,'Bounded main model requests');
   if(mainCalls===1){
    writes++;res.end(frame({tool_calls:[{index:0,id:'write-once',type:'function',function:{name:'write',arguments:JSON.stringify({path:'result.txt',content:'corrected\n'})}}]},'tool_calls')+'data: [DONE]\n\n');
   }else if(mainCalls===2){
    // Below the 8192-token output allowance, but enough to force input pressure.
    res.end(frame({content:'Intermediate inspection evidence. '.repeat(900)})+'data: [DONE]\n\n');
   }else{
    if(!body.messages.some(m=>m.role==='user'&&m.content===task))errors.push('Original task was not retained verbatim after compaction');
    res.end(frame({content:'Wrote result.txt once and preserved the user draft. [verification unavailable] This isolated fixture provides no verification command.'})+'data: [DONE]\n\n');
   }
  }catch(error){errors.push(String(error));res.destroy(error);}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:root,TMP:root,TEMP:root,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AGENT_MODEL:'packed-context-probe',AGENT_API_KEY:''};
  for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key];
  try{
   const result=await promisify(execFile)(resolve(binary),['-p',task,'--output-format','json'],{cwd,env,timeout:60000,maxBuffer:2_000_000});
   execution={code:0,result:JSON.parse(result.stdout)};
  }catch(error){execution={code:error.code,error:String(error),stdout:error.stdout,stderr:error.stderr};}
  const preservation=(await readFile(join(cwd,'user-draft.txt'),'utf8'))==='USER_DRAFT_MUST_SURVIVE\n';
  const fileCorrect=(await readFile(join(cwd,'result.txt'),'utf8'))==='corrected\n';
  if(!references.length)errors.push('Automatic auxiliary compaction did not run');
  if(references.some(reference=>!reference.endsWith(JSON.stringify(task))))errors.push('Auxiliary summary received feedback instead of the user task');
  const ok=execution.code===0&&!execution.result?.error&&errors.length===0&&mainCalls===3&&writes===1&&preservation&&fileCorrect;
  const report={ok,mainCalls,summaryCalls:references.length,writes,preservation,fileCorrect,references,errors,execution,paidRequests:0};
  if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
  assert.ok(ok,'Installed binary context smoke failed: '+JSON.stringify(report));return report;
 }finally{
  if(server){server.closeAllConnections();await new Promise(done=>server.close(()=>done()));}
  await rm(root,{recursive:true,force:true});
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!process.argv[2])throw Error('Provide the installed compositor binary path');
 const result=await smokeContextTask(process.argv[2],process.argv[3]);
 console.log(JSON.stringify(result));
}
