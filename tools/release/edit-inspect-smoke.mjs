import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readModelResult} from './model-read.mjs';
import {pathToFileURL} from 'node:url';
export async function smokeEditInspect(binary,out){
 binary=resolve(binary);
 const root=await realpath(await mkdtemp(join(tmpdir(),'compositor-edit-inspect-'))),cwd=join(root,'project'),home=join(root,'home');
const header="import {subtotal, discount} from './math.mjs';",line='export function checkout(items, percent=0) { return discount(subtotal(items), percent); }',original=header+'\n'+line+'\n';
let server,requests=0,anchor,inspect,seen,errors=[];
try {
 await mkdir(cwd);await mkdir(home);await writeFile(join(cwd,'checkout.mjs'),original);await writeFile(join(cwd,'user-draft.txt'),'PRESERVED');
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:[],agent:{tools:['read','edit'],builtinTools:['read','edit'],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},compaction:{enabled:false},permissions:{rules:[{tool:'edit',path:cwd+'/**',decision:'allow'}]}}));
 server=createServer(async(req,res)=>{try{
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'inspect-probe',context_window:16384}]}));return;}
  assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;assert.ok(requests<=5);
  const last=body.messages.filter(m=>m.role==='tool').at(-1)?.content;
  if(requests===2){const r=readModelResult(last);assert.equal(r.content,original);anchor=r.editRef;assert.ok(anchor);}
  if(requests===3){const r=JSON.parse(last);assert.match(r.warning,/duplicated adjacent/);inspect=r.inspect;assert.deepEqual(inspect,{path:join(cwd,'checkout.mjs'),offset:1,limit:21});}
  if(requests===4){const r=readModelResult(last);seen=r.content;assert.equal(seen,header+'\n'+line+'\n'+line+'\n');anchor=r.editRef;assert.ok(anchor);}
  if(requests===5){const r=JSON.parse(last);assert.equal(r.fileAction,'edited');}
  const frame=(delta,finish_reason='stop')=>'data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n';
  const call=(name,args)=>frame({tool_calls:[{index:0,id:'inspect-'+requests,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
  const response=requests===1?call('read',{path:'checkout.mjs'}):requests===2?call('edit',{target:anchor,oldText:header,newText:header+'\n'+line}):requests===3?call('read',inspect):requests===4?call('edit',{target:anchor,oldText:line+'\n'+line,newText:line}):frame({content:'INSPECTION_RECOVERY_COMPLETE'});
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(response+'data: [DONE]\n\n');
 }catch(e){errors.push(String(e));res.destroy(e);}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const env={HOME:home,USERPROFILE:home,AGENT_HOME:join(home,'.agent-compositor'),XDG_CONFIG_HOME:join(home,'.config'),TMPDIR:root,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AGENT_MODEL:'inspect-probe',AGENT_API_KEY:''};for(const k of ['PATH','LANG','LC_ALL'])if(process.env[k])env[k]=process.env[k];
 let execution;try{await promisify(execFile)(binary,['-p','Inspect and repair the fixture using the supplied tools.','--output-format','json'],{cwd,env,timeout:60000,maxBuffer:2000000});execution=0;}catch(e){execution=e.code;}
 const restored=await readFile(join(cwd,'checkout.mjs'),'utf8')===original,preserved=await readFile(join(cwd,'user-draft.txt'),'utf8')==='PRESERVED';
 const report={ok:execution===0&&requests===5&&restored&&preserved&&errors.length===0,executableSha256:createHash('sha256').update(await readFile(binary)).digest('hex'),requests,inspect,restored,preserved,execution,errors,paidRequests:0};
 if(out)await writeFile(resolve(out),JSON.stringify(report,null,2)+'\n');return report;
}finally{if(server)await new Promise(done=>server.close(done));await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.argv[2])throw Error('Provide an installed compositor binary');const report=await smokeEditInspect(process.argv[2],process.argv[3]);console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
