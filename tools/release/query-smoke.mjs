import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

/** Actual installed queries, journal results, bounded refusal and recovery; no source injection. */
export async function smokeQueries(binary,output){
 const root=await realpath(await mkdtemp(join(tmpdir(),'compositor-query-smoke-'))),cases=[],errors=[];
 const original='const value = "QUERY_SENTINEL";\n';
 try{
  for(const mode of ['grep-loop','read-loop','recover']){
   const cwd=join(root,mode),home=join(root,mode+'-home');await mkdir(cwd);await mkdir(home);await writeFile(join(cwd,'actual.mjs'),original);await writeFile(join(cwd,'user-draft.txt'),'PRESERVED');
   await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['callix'],agent:{tools:['read','grep'],builtinTools:['read'],controlTools:[],skills:false,projectContext:false,fileReferences:false},compaction:{enabled:false}}));
   let requests=0,reminders=0,execution,server;
   const tool=mode==='read-loop'?'read':'grep';
   try{
    server=createServer(async(req,res)=>{try{
     if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'packed-query-probe',context_window:16384}]}));return;}
     assert.equal(req.url,'/v1/chat/completions');assert.ok(++requests<=8,'Bounded query probe requests');let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<=200000);}
     const body=JSON.parse(raw);assert.equal(body.model,'packed-query-probe');
     const count=body.messages.filter(message=>message.role==='user'&&message.content.includes('Query recovery:')).length;assert.ok(count<=1,'A query streak must not accumulate duplicate reminders');reminders=Math.max(reminders,count);
     res.writeHead(200,{'content-type':'text/event-stream'});
     const frame=(delta,finish_reason='stop')=>'data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n';
     const call=(name,args)=>frame({tool_calls:[{index:0,id:'query-'+requests,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
     const query=tool==='read'?call('read',{path:'actual.mjs'}):call('grep',{pattern:'QUERY_SENTINEL',maxTokens:512});
     const delta=mode==='recover'?(requests<=4?query:requests===5?call('read',{path:'actual.mjs'}):frame({content:'QUERY_RECOVERED'})):requests<=7?query:frame({content:'UNBOUNDED_QUERY_LOOP'});
     res.end(delta+'data: [DONE]\n\n');
    }catch(error){errors.push(String(error));res.destroy(error);}});
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),AGENT_STORAGE_MODE:'project',XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:root,TMP:root,TEMP:root,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AGENT_MODEL:'packed-query-probe',AGENT_API_KEY:''};
    for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key];
    try{const result=await promisify(execFile)(resolve(binary),['-p','Inspect the existing source and preserve all files.','--output-format','json'],{cwd,env,timeout:60000,maxBuffer:2000000});execution={code:0,stdout:result.stdout,stderr:result.stderr};}
    catch(error){execution={code:error.code,stdout:error.stdout,stderr:error.stderr};}
    let result;try{result=JSON.parse(execution.stdout);}catch{errors.push('Native query output was not JSON');}
    const journal=await readFile(join(cwd,'.agent-compositor','sessions',result.sessionId+'.jsonl'),'utf8');assert.ok(journal.length<2000000,'Bounded query journal');
    const observations=journal.trim().split('\n').map(line=>JSON.parse(line)).filter(event=>event.type==='tool.result');
    const valid=observations.every(event=>event.ok&&(event.tool==='read'?event.output.content===original:event.tool==='grep'&&event.output.matches.length===1&&event.output.matches[0].path==='actual.mjs'));
    const preserved=(await readFile(join(cwd,'actual.mjs'),'utf8'))===original&&(await readFile(join(cwd,'user-draft.txt'),'utf8'))==='PRESERVED';
    const ok=valid&&preserved&&reminders===1&&execution.stderr===''&&(mode==='recover'?requests===6&&observations.length===5&&execution.code===0&&!result.error&&result.response==='QUERY_RECOVERED':requests===7&&observations.length===7&&execution.code===1&&String(result.error).includes('Repeated query results'));
    cases.push({mode,ok,requests,reminders,observations:observations.length,valid,preserved,execution,result});
   }finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(()=>done()));}}
  }
  const report={ok:errors.length===0&&cases.length===3&&cases.every(test=>test.ok),cases,errors,paidRequests:0};if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');assert.ok(report.ok,'Installed query probe failed: '+JSON.stringify(report));return report;
 }finally{await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.argv[2])throw Error('Provide an installed compositor binary');console.log(JSON.stringify(await smokeQueries(process.argv[2],process.argv[3])));}
