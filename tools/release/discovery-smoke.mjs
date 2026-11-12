import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

/** Probe the installed tool schemas and real discovery/read services without source injection. */
export async function smokeDiscovery(binary,output){
 const root=await realpath(await mkdtemp(join(tmpdir(),'compositor-discovery-smoke-'))),cwd=join(root,'project'),home=join(root,'home'),errors=[];
 let server,requests=0,execution,readRejected=false,emptyHint=false,discovered=false,readCorrect=false,noOpRejected=false,anchor;
 const original='export const amount = 18;\n';
 try{
  await mkdir(cwd);await mkdir(home);await writeFile(join(cwd,'actual.mjs'),original);await writeFile(join(cwd,'user-draft.txt'),'PRESERVED');
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['callix'],agent:{tools:['read','edit','glob','grep'],builtinTools:['read','edit'],controlTools:[],skills:false,projectContext:false,fileReferences:false},compaction:{enabled:false},permissions:{rules:[{tool:'edit',path:cwd+'/**',decision:'allow'}]}}));
  server=createServer(async(req,res)=>{try{
   if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'packed-discovery-probe',context_window:16384}]}));return;}
   assert.equal(req.url,'/v1/chat/completions');assert.ok(++requests<=6,'Bounded discovery requests');let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<=200000);}
   const body=JSON.parse(raw);assert.equal(body.model,'packed-discovery-probe');
   const read=body.tools.find(tool=>tool.function.name==='read')?.function.parameters.properties;
   if(read?.offset.type!=='integer'||read.offset.minimum!==1||read.limit.maximum!==10000)errors.push('Read pagination schema does not match the runtime limits');
   const last=body.messages.filter(message=>message.role==='tool').at(-1)?.content;
   if(requests===2){const result=JSON.parse(last);emptyHint=result.matches.length===0&&String(result.hint??'').includes('glob')&&String(result.hint??'').includes('shorter literal');if(!emptyHint)errors.push('Empty text result lacks factual discovery guidance');}
   if(requests===3){const result=JSON.parse(last);discovered=result.files.includes('actual.mjs');if(!discovered)errors.push('Glob did not return the actual project path');}
   if(requests===4){readRejected=last.includes('read.offset')&&last.includes('1-based');if(!readRejected)errors.push('Invalid read pagination lacks a clear error');}
   if(requests===5){const result=JSON.parse(last);anchor=result.edit;readCorrect=result.content===original&&anchor?.strict===true;if(!readCorrect)errors.push('Valid ranged read lost content or its edit anchor');}
   if(requests===6){noOpRejected=last.includes('edit:')&&last.includes('unchanged');if(!noOpRejected)errors.push('Edit that leaves the actual file unchanged was accepted');}
   res.writeHead(200,{'content-type':'text/event-stream'});
   const frame=(delta,finish_reason='stop')=>'data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n';
   const call=(name,args)=>frame({tool_calls:[{index:0,id:'discovery-'+requests,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
   res.end((requests===1?call('grep',{pattern:'nonexistent description phrase',maxTokens:256}):requests===2?call('glob',{pattern:'**/*',maxTokens:512}):requests===3?call('read',{path:'actual.mjs',offset:0}):requests===4?call('read',{path:'actual.mjs',offset:1,limit:10}):requests===5?call('edit',{...anchor,oldText:original,newText:original}):frame({content:'DISCOVERY_RECOVERY_OK'}))+'data: [DONE]\n\n');
  }catch(error){errors.push(String(error));res.destroy(error);}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:root,TMP:root,TEMP:root,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AGENT_MODEL:'packed-discovery-probe',AGENT_API_KEY:''};
  for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key];
  try{const result=await promisify(execFile)(resolve(binary),['-p','Discover the existing source and read it without modifying files.','--output-format','json'],{cwd,env,timeout:60000,maxBuffer:2000000});execution={code:0,stdout:result.stdout,stderr:result.stderr};}
  catch(error){execution={code:error.code,stdout:error.stdout,stderr:error.stderr};}
  let result;try{result=JSON.parse(execution.stdout);}catch{errors.push('Native discovery output was not JSON');}
  const preserved=(await readFile(join(cwd,'actual.mjs'),'utf8'))===original&&(await readFile(join(cwd,'user-draft.txt'),'utf8'))==='PRESERVED';
  const report={ok:errors.length===0&&requests===6&&execution.code===0&&execution.stderr===''&&!result?.error&&result?.response==='DISCOVERY_RECOVERY_OK'&&preserved&&emptyHint&&discovered&&readRejected&&readCorrect&&noOpRejected,requests,emptyHint,discovered,readRejected,readCorrect,noOpRejected,preserved,errors,execution,paidRequests:0};
  if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');assert.ok(report.ok,'Installed discovery probe failed: '+JSON.stringify(report));return report;
 }finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(()=>done()));}await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.argv[2])throw Error('Provide an installed compositor binary');console.log(JSON.stringify(await smokeDiscovery(process.argv[2],process.argv[3])));}
