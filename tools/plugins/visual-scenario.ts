import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {scenarioContext,scenarioEvidence,finishScenario} from './scenario.js';
import {withCandidate} from './candidate.js';
import {runBounded} from './process.js';
import {requiredCases,certifiedTestPlanSchema} from '@agent-compositor/loader';
const ctx=await scenarioContext(),name=ctx.identity.plugin,output=join(ctx.output,'pty');
await withCandidate(ctx,async directory=>{
 await runBounded('node',['tools/visual/plugin-check.mjs',name],{cwd:process.cwd(),env:{...process.env,VISUAL_PLUGIN_DIR:directory,VISUAL_OUTPUT:output},timeout:150000,maxBuffer:2000000});
 const report=JSON.parse(await readFile(join(output,'report.json'),'utf8'));assert.equal(report.ok,true);assert.deepEqual(report.errors,[]);
 const loaded=JSON.parse(await readFile(join(output,'fixture-identity.json'),'utf8'));assert.equal(loaded.plugin,name);assert.equal(loaded.version,ctx.identity.version);assert.equal(loaded.directory,directory);
 const plan=certifiedTestPlanSchema.parse(JSON.parse(await readFile('plugins/'+name+'/plugin.test.json','utf8')));
 for(const requirement of requiredCases(plan.profiles,'release').filter(r=>r.kind==='visual'))assert.ok(report.checks.includes(requirement.id),'Missing real terminal observation: '+requirement.id);
 if(name==='test-reports')for(const id of ['user-tool.titlebar-close','user-tool.keyboard-close','report.narrow-last-diagnostic','report.page-up-field'])assert.ok(report.checks.includes(id),'Missing report interaction: '+id);
 if(name==='auto-approve')for(const id of ['command.immediate','command.no-view','conversation.restore','conversation.idempotent','draft.preserved'])assert.ok(report.checks.includes(id),'Missing immediate-control interaction: '+id);
 if(name==='btw')for(const id of ['conversation.concurrent','conversation.followup','conversation.restore','draft.preserved','conversation.cancel'])assert.ok(report.checks.includes(id),'Missing side-conversation interaction: '+id);
 if(name==='workflows'){
  const workflowOutput=join(ctx.output,'workflow-pty');
  await runBounded('node',['tools/visual/workflow-check.mjs'],{cwd:process.cwd(),env:{...process.env,VISUAL_PLUGIN_DIR:directory,VISUAL_OUTPUT:workflowOutput},timeout:150000,maxBuffer:2000000});
  const workflow=JSON.parse(await readFile(join(workflowOutput,'report.json'),'utf8'));assert.equal(workflow.ok,true);assert.deepEqual(workflow.errors,[]);
  for(const id of ['workflow.expand-join','workflow.pause-resume','workflow.result-detail','workflow.table.keyboard','workflow.table.filter','workflow.table.narrow','workflow.tabs.keyboard','workflow.tabs.pointer','workflow.closed-during-update'])assert.ok(workflow.checks.includes(id),'Missing workflow table observation: '+id);
  const identity=JSON.parse(await readFile(join(workflowOutput,'fixture-identity.json'),'utf8'));assert.equal(identity.directory,directory);assert.equal(identity.plugin,name);assert.equal(identity.version,ctx.identity.version);
 }
});
const folders=name==='workflows'?['pty','workflow-pty']:['pty'];
const evidence=(await Promise.all(folders.map(async folder=>Promise.all((await readdir(join(ctx.output,folder))).filter(file=>/\.(json|png|ansi|jsonl)$/.test(file)).map(file=>scenarioEvidence(folder+'/'+file)))))).flat();
await finishScenario({id:ctx.caseId,kind:ctx.stage==='artifact'?'artifact':'visual',status:'passed',evidence});
