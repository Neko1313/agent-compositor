import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

/** Both acceptance and refusal run the installed program with actual project effects. */
export async function smokeCodingVerification(binary,output){
 const root=await realpath(await mkdtemp(join(tmpdir(),'compositor-coding-smoke-'))),cases=[],errors=[];
 try{
  for(const mode of ['unchecked','checked']){
   const cwd=join(root,mode),home=join(root,mode+'-home');await mkdir(cwd);await mkdir(home);
   const check="import a from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';a.equal(readFileSync('result.txt','utf8'),'fixed');a.equal(readFileSync('user-draft.txt','utf8'),'PRESERVED');writeFileSync('verification-ran','yes');console.log('PACKED_CHECK_OK');";
   await writeFile(join(cwd,'verify.mjs'),check);await writeFile(join(cwd,'user-draft.txt'),'PRESERVED');
   await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agent-harness'],agent:{instructionsPreset:'coding',tools:['write','exec'],builtinTools:['write','exec'],controlTools:[],skills:false,projectContext:false,fileReferences:false},compaction:{enabled:false},permissions:{rules:[{tool:'write',path:cwd+'/**',decision:'allow'},{tool:'exec',command:'node verify.mjs',decision:'allow'}]}}));
   let requests=0,feedback=false,server;
   try{
    server=createServer(async(req,res)=>{try{
     if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'packed-coding-probe',context_window:16384}]}));return;}
     assert.equal(req.url,'/v1/chat/completions');assert.ok(++requests<=4,'Bounded coding model requests');let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<=200000);}
     const body=JSON.parse(raw);assert.equal(body.model,'packed-coding-probe');assert.ok(body.messages.some(message=>message.role==='system'&&message.content.includes('autonomous coding agent')));
     res.writeHead(200,{'content-type':'text/event-stream'});
     const frame=(delta,finish_reason='stop')=>'data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n';
     const call=(name,args)=>frame({tool_calls:[{index:0,id:'coding-'+requests,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
     if(requests>=3){feedback=body.messages.some(message=>message.role==='user'&&message.content.includes('no successful verification command'));assert.ok(feedback,'Coding completion must request verification without a plan');}
     const delta=requests===1?call('write',{path:'result.txt',content:'fixed'}):mode==='checked'&&requests===3?call('exec',{command:'node verify.mjs'}):frame({content:mode==='checked'&&requests===4?'Verified PACKED_CHECK_OK.':'Everything passed without running a check.'});
     res.end(delta+'data: [DONE]\n\n');
    }catch(error){errors.push(String(error));res.destroy(error);}});
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:root,TMP:root,TEMP:root,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AGENT_MODEL:'packed-coding-probe',AGENT_API_KEY:''};
    for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key];
    let execution;
    try{const result=await promisify(execFile)(resolve(binary),['-p','Write result.txt with fixed and verify the change.','--output-format','json'],{cwd,env,timeout:60000,maxBuffer:2000000});execution={code:0,stdout:result.stdout,stderr:result.stderr};}
    catch(error){execution={code:error.code,stdout:error.stdout,stderr:error.stderr};}
    let result;try{result=JSON.parse(execution.stdout);}catch{errors.push('Native coding response was not JSON');}
    const preserved=(await readFile(join(cwd,'user-draft.txt'),'utf8'))==='PRESERVED'&&(await readFile(join(cwd,'verify.mjs'),'utf8'))===check;
    const fileCorrect=await readFile(join(cwd,'result.txt'),'utf8').then(text=>text==='fixed',()=>false),checkRan=await readFile(join(cwd,'verification-ran'),'utf8').then(text=>text==='yes',()=>false);
    const ok=requests===4&&feedback&&preserved&&fileCorrect&&execution.stderr===''&&(mode==='checked'?execution.code===0&&!result?.error&&checkRan:execution.code===1&&String(result?.error).includes('Completion checks remain unsatisfied')&&!checkRan);
    cases.push({mode,ok,requests,feedback,preserved,fileCorrect,checkRan,execution,result});
   }finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(()=>done()));}}
  }
  const report={ok:errors.length===0&&cases.length===2&&cases.every(test=>test.ok),cases,errors,paidRequests:0};if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');assert.ok(report.ok,'Installed coding verification failed: '+JSON.stringify(report));return report;
 }finally{await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.argv[2])throw Error('Provide an installed compositor binary');console.log(JSON.stringify(await smokeCodingVerification(process.argv[2],process.argv[3])));}
