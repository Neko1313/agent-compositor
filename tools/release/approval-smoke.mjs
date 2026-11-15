import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

/** Installed host and bundled reviewer; transport fixtures establish protocol, not model quality. */
export async function smokeApprovals(binary,output){
 const root=await realpath(await mkdtemp(join(tmpdir(),'compositor-approval-smoke-')));
 const cases=[],errors=[];let server,current,reportWritten=false;
 try{
  server=createServer(async(req,res)=>{try{
   if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'approval-probe'}]}));return;}
   assert.equal(req.url,'/v1/chat/completions');assert.ok(++current.requests<=4,'Bounded local request count');
   let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<=200000,'Bounded request body');}
   const body=JSON.parse(raw);assert.equal(body.model,'approval-probe');
   res.writeHead(200,{'content-type':'text/event-stream'});
   const frame=(delta,finish_reason='stop')=>'data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n';
   if(body.messages[0]?.content.startsWith('You assess one proposed tool action')){
    current.reviews++;
    const payload=JSON.parse(body.messages.find(message=>message.role==='user').content);
    assert.equal(payload.context.task,current.task);assert.equal(payload.tool,current.tool);
    if(current.tool==='write'){assert.equal(payload.input.path,join(current.cwd,'result.txt'));assert.equal(payload.input.content,'APPROVED_WRITE\n');}
    else assert.equal(payload.input.command,'npm test');
    res.end(frame({content:JSON.stringify({approved:current.approved,risk:current.approved?'medium':'high',reason:current.approved?'Bounded write requested by the user':'Controlled reviewer refusal'})})+'data: [DONE]\n\n');return;
   }
   current.mainCalls++;
   assert.ok(body.messages.some(message=>message.role==='user'&&message.content===current.task),'Exact user task retained');
   const last=body.messages.at(-1);
   if(last?.role==='tool'){
    current.toolResult=last.content;
    res.end(frame({content:'APPROVAL_PROBE_COMPLETE'})+'data: [DONE]\n\n');
   }else res.end(frame({tool_calls:[{index:0,id:'approval-probe-action',type:'function',function:{name:current.tool,arguments:JSON.stringify(current.tool==='write'?{path:'result.txt',content:'APPROVED_WRITE\n'}:{command:'npm test'})}}]},'tool_calls')+'data: [DONE]\n\n');
  }catch(error){errors.push(String(error));res.destroy(error);}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  for(const [name,approved,rule,tool] of [['allow',true,'ask','write'],['refuse',false,'ask','write'],['host-deny',true,'deny','write'],['ci-allow',true,'ask','exec'],['ci-refuse',false,'ask','exec']]){
   const cwd=join(root,name),home=join(root,name+'-home');await mkdir(cwd);await mkdir(home);
   const task=tool==='write'?'Write result.txt with exactly APPROVED_WRITE followed by a newline. Preserve user-draft.txt.':'Run npm test in this project and preserve user-draft.txt.';
   current={name,approved,task,cwd,tool,requests:0,reviews:0,mainCalls:0};cases.push(current);
   await writeFile(join(cwd,'result.txt'),'ORIGINAL\n');await writeFile(join(cwd,'user-draft.txt'),'USER_DRAFT\n');
   await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{test:'node check.cjs'}}));await writeFile(join(cwd,'check.cjs'),"require('node:fs').writeFileSync('ci-ran.txt','CI_CHECK_OK\\n');\n");
   await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['auto-approve'],agent:{tools:[tool],builtinTools:[tool],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},compaction:{enabled:false},permissions:{rules:[{tool,decision:rule}]}}));
   const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),AGENT_STORAGE_MODE:'project',XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:root,TMP:root,TEMP:root,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AGENT_MODEL:'approval-probe',AGENT_API_KEY:''};
   for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key];
   const execution=promisify(execFile)(resolve(binary),['--plain'],{cwd,env,timeout:30000,maxBuffer:2_000_000});
   execution.child.stdin.on('error',error=>errors.push('Child input: '+error.code));
   execution.child.stdin.end('/auto on\r'+task+'\r');
   const result=await execution;current.stdout=result.stdout;current.stderr=result.stderr;
   assert.match(result.stdout,/APPROVAL_PROBE_COMPLETE/);assert.doesNotMatch(result.stdout,/\[permission\]/,'No manual question for concrete allow/refusal/host deny');
   assert.equal(current.mainCalls,2);assert.equal(current.reviews,rule==='deny'?0:1);
   assert.equal(await readFile(join(cwd,'result.txt'),'utf8'),name==='allow'?'APPROVED_WRITE\n':'ORIGINAL\n');
   if(tool==='exec'){const output=await readFile(join(cwd,'ci-ran.txt'),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});assert.equal(output,approved?'CI_CHECK_OK\n':null);}
   assert.equal(await readFile(join(cwd,'user-draft.txt'),'utf8'),'USER_DRAFT\n');
   if(!approved||rule==='deny')assert.match(current.toolResult,/denied/i);
   if(!approved)assert.match(current.toolResult,/denied by automatic review/);
   current.ok=true;
  }
  const report={ok:errors.length===0&&cases.every(item=>item.ok),cases,errors,paidRequests:0};
  if(output){await writeFile(output,JSON.stringify(report,null,2)+'\n');reportWritten=true;}
  assert.ok(report.ok,JSON.stringify(report));return report;
 }catch(error){
  if(output&&!reportWritten)await writeFile(output,JSON.stringify({ok:false,error:String(error),cases,errors,paidRequests:0},null,2)+'\n');
  throw error;
 }finally{
  if(server){server.closeAllConnections();await new Promise(done=>server.close(()=>done()));}
  await rm(root,{recursive:true,force:true});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!process.argv[2])throw Error('Provide the installed compositor binary path');
 console.log(JSON.stringify(await smokeApprovals(process.argv[2],process.argv[3])));
}
