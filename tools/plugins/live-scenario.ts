import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {scenarioContext,scenarioEvidence,finishScenario} from './scenario.js';
import {liveTask,negativeControls} from './live-tasks.js';
import {digest,identity} from './certification.js';
const standalone=process.argv.includes('--standalone'),name=standalone?process.argv[2]:undefined;
const ctx=standalone?{identity:await identity(process.cwd(),name!),output:resolve(process.env.PLUGIN_LIVE_OUTPUT??'dist/plugin-live-'+name),caseId:'live-reference'}:await scenarioContext();
await mkdir(ctx.output,{recursive:true});
const plan=JSON.parse(await readFile('plugins/'+ctx.identity.plugin+'/plugin.test.json','utf8')),policy=plan.modelPolicy;
assert.ok(policy);const tasks=JSON.parse(await readFile(policy.taskSet,'utf8')).tasks;
const rows:any[]=[];let failure:unknown;const controls=negativeControls();
try{
 const selected=standalone&&process.env.PLUGIN_LIVE_TASK?tasks.filter((task:any)=>task.id===process.env.PLUGIN_LIVE_TASK):tasks;
 const repeats=standalone?Number(process.env.PLUGIN_LIVE_REPEATS??policy.repeats):policy.repeats;
 for(let repeat=0;repeat<repeats;repeat++)for(const task of selected){
  const row=await liveTask(ctx.identity.plugin,task.id,task.prompt,policy);rows.push({...row,repeat});
  await writeFile(join(ctx.output,'trajectory.json'),JSON.stringify({policy,rows},null,2));
  process.stderr.write(`${ctx.identity.plugin} ${task.id} repeat ${repeat+1} PASS\n`);
 }
}catch(error:any){failure=error;await writeFile(join(ctx.output,'failure.json'),JSON.stringify({error:String(error),trace:error.trace,rows},null,2));}
const report={identity:ctx.identity,plugin:ctx.identity.plugin,ok:!failure,policy,negativeControls:controls,completed:rows.length,expected:tasks.length*policy.repeats,observations:rows.map(({wire,messages,events,...row})=>row),limits:['Reference-model evidence is scoped to this exact task set and configuration.','Token usage is provider-reported when available. Monetary billing is unavailable from the local Ollama bridge.']};
await writeFile(join(ctx.output,'live-report.json'),JSON.stringify(report,null,2));
if(failure)throw failure;
assert.deepEqual(await identity(process.cwd(),ctx.identity.plugin),ctx.identity,'Live inputs changed during evaluation');
if(!standalone)await finishScenario({id:ctx.caseId,kind:'live',status:'passed',evidence:[await scenarioEvidence('trajectory.json'),await scenarioEvidence('live-report.json')],model:{provider:policy.provider,name:policy.name,configuration:digest(JSON.stringify(policy.configuration)),taskSet:policy.taskSetSha256,repeats:policy.repeats,successFloor:policy.successFloor,successRate:1,baseline:policy.baseline,cost:null,costStatus:'unavailable',criticalFailures:0}});
console.log(JSON.stringify({plugin:ctx.identity.plugin,ok:true,completed:rows.length}));
