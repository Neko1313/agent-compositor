import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {estimateMessageTokens,estimateTokens} from '../../packages/context/src/index.js';
import {OpenAICompatProvider} from '../../packages/provider/src/openai-compat.js';
import {runCase,type EvalCase} from './runner.js';
import {verifyLocalCache,localModelServer,localCompletionFetch,type ModelPin} from './local-model.js';
const args=process.argv.slice(2),value=(key:string,fallback:string)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const output=resolve(value('--output','dist/local-cpu-development')),cache=resolve(value('--cache','dist/local-qwen-eval/models'));
const repeat=Number(value('--repeat','2'));if(!Number.isInteger(repeat)||repeat<1||repeat>5)throw Error('repeat must be 1..5');
const pin:ModelPin=JSON.parse(await readFile(new URL('./local-qwen.json',import.meta.url),'utf8'));
const suite=await readFile(new URL('./agent-cases.json',import.meta.url),'utf8'),selected=(JSON.parse(suite) as EvalCase[]).filter(test=>test.id===value('--case','multi-file-bug'));
if(selected.length!==1)throw Error('Choose one existing development case');
const preset=value('--preset','coding');if(preset!=='coding'&&preset!=='general')throw Error('preset must be general or coding');
await mkdir(dirname(output),{recursive:true});await mkdir(output);
const composition:{tools:string[];agentHarness:boolean;instructionsPreset:'coding'|'general'}={tools:['read','write','edit','exec'],agentHarness:true,instructionsPreset:preset};
const sourceInputs=Object.fromEntries(await Promise.all(['local-cpu.ts','local-model.ts','local-qwen.json','runner.ts','agent-cases.json'].map(async name=>[name,createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex')])));
const configuration={sourceInputs,sourceDirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),model:pin.model,localOnly:true,paidRequests:0,contextWindow:16384,maxOutputTokens:1536,maxRequestsPerCase:12,threads:2,seed:17,repeat,composition,suiteSha256:createHash('sha256').update(suite).digest('hex'),case:selected[0].id,caseSha256:createHash('sha256').update(JSON.stringify(selected[0])).digest('hex'),scope:'Known development diagnostic, not an unseen benchmark or general model-quality claim'};
await writeFile(join(output,'configuration.json'),JSON.stringify(configuration,null,2)+'\n');
const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(Error('Local CPU evaluation deadline')),20*60_000);
const abort=()=>controller.abort(Error('Operator stopped local CPU evaluation'));process.once('SIGINT',abort);process.once('SIGTERM',abort);
let server:Awaited<ReturnType<typeof localModelServer>>|undefined;
const results:any[]=[];
try{
 const preflight=[];
for(const test of selected){
 const absent=await runCase({...test,script:[{text:'No changes made.'}]},{model:'scripted',...composition});
 const correct=await runCase(test,{model:'scripted',...composition});
 preflight.push({case:test.id,absentRejected:!absent.ok,correctAccepted:correct.ok,absent,correct});
 if(absent.ok||!correct.ok){await writeFile(join(output,'preflight.json'),JSON.stringify(preflight,null,2)+'\n');throw Error('Independent project oracle preflight failed');}
}
await writeFile(join(output,'preflight.json'),JSON.stringify(preflight,null,2)+'\n');
console.log(JSON.stringify({phase:'preflight',ok:true}));
const verified=await verifyLocalCache(cache,pin,controller.signal);await writeFile(join(output,'verified-cache.json'),JSON.stringify(verified,null,2)+'\n');

 server=await localModelServer(cache,pin,controller.signal);await writeFile(join(output,'model-identity.json'),JSON.stringify(await server.metadata(),null,2)+'\n');
 console.log(JSON.stringify({phase:'ready',localOnly:true,pid:server.pid}));
 for(let repetition=0;repetition<repeat;repetition++)for(const test of selected){
  let admitted=0;const transport=new OpenAICompatProvider({baseUrl:server.base+'/v1',model:server.model,apiKey:'',retries:0,timeoutMs:180000,maxOutputTokens:1536,reasoningEffort:'none',fetch:localCompletionFetch(server.base,server.model)});
  const provider={name:'owned-local-cpu',async *complete(request:any){
   if(request.model!==server!.model)throw Error('Nonlocal model name');if(admitted>=12)throw Error('Local request ceiling reached');
   const input=request.messages.reduce((sum:number,message:any)=>sum+estimateMessageTokens(message),0)+estimateTokens(JSON.stringify(request.tools));if(input+1536>16384)throw Error('Local context ceiling reached before transport');
   admitted++;yield*transport.complete({...request,maxOutputTokens:1536,signal:AbortSignal.any([request.signal,controller.signal])});
  }};
  const result={...(await runCase({...test,prompt:test.prompt+'\n/no_think'},{model:server.model,provider,baseUrl:server.base+'/v1',timeoutMs:300000,...composition})),repetition,admitted};results.push(result);
  await writeFile(join(output,`${test.id}-${repetition}.json`),JSON.stringify(result,null,2)+'\n');
  await writeFile(join(output,'cpu-runtime.json'),JSON.stringify(await server.cpu(),null,2)+'\n');
  console.log(JSON.stringify({case:test.id,repetition,ok:result.ok,admitted,error:result.error}));
 }
 const report={...configuration,completed:true,results,passed:results.filter(result=>result.ok).length,total:results.length};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');if(report.passed!==report.total)process.exitCode=1;
}catch(error){
 await writeFile(join(output,'report.json'),JSON.stringify({...configuration,completed:false,results,error:String(error)},null,2)+'\n');throw error;
}finally{
 clearTimeout(deadline);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
 const cleanup=await server?.stop();await writeFile(join(output,'cleanup.json'),JSON.stringify(cleanup??{serverStarted:false},null,2)+'\n');console.log(JSON.stringify({phase:'cleanup',...cleanup}));
}
