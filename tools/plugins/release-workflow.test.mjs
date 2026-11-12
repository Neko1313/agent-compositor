import {it,expect} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const workflow=JSON.parse(execFileSync('bun',['-e',
 'console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))',
 resolve('.github/workflows/plugin-release.yml')],{encoding:'utf8'}));
const evaluate=(expression,github,inputs={})=>Function('github','inputs',`return (${expression.replace(/^\$\{\{\s*|\s*\}\}$/g,'')});`)(github,inputs);

it('never publishes a manual plugin validation, including a dispatch from a tag',()=>{
 const condition=workflow.jobs.publish.if;
 expect(evaluate(condition,{event_name:'push',ref_type:'tag'})).toBe(true);
 expect(evaluate(condition,{event_name:'push',ref_type:'branch'})).toBe(false);
 for(const ref_type of ['tag','branch'])expect(evaluate(condition,{event_name:'workflow_dispatch',ref_type})).toBe(false);
 expect(workflow.permissions).toEqual({contents:'read'});
 const diagnostics=workflow.jobs.packages.steps.find(step=>step.name==='Preserve platform certification diagnostics');
 expect(diagnostics.if).toBe('always()');
 expect(diagnostics.with.path).toContain('reports/');
 expect(diagnostics.with.name).not.toMatch(/^plugin-/);
 const sourceDiagnostics=workflow.jobs.verify.steps.find(step=>step.name==='Preserve plugin quality reports');
 expect(sourceDiagnostics.with.name).not.toMatch(/^plugin-/);
});
it('pins every packaging/publication job to the commit resolved by verification',()=>{
 const checkout=workflow.jobs.verify.steps[0].with.ref,sha='a'.repeat(40);
 expect(workflow.jobs.verify.outputs.sha).toBe('${{ steps.source.outputs.sha }}');
 const source=workflow.jobs.verify.steps.find(step=>step.id==='source');
 expect(source.run).toContain('git rev-parse HEAD');
 expect(source.run).toContain('source-commit.txt');
 expect(evaluate(checkout,{event_name:'workflow_dispatch',ref_name:'v0.7.0'},{candidate_sha:sha})).toBe(sha);
 expect(evaluate(checkout,{event_name:'workflow_dispatch'},{tag:'plugin/probe/v1.0.0'})).toBe('plugin/probe/v1.0.0');
 expect(evaluate(checkout,{event_name:'push',ref_name:'plugin/probe/v1.0.0'},{})).toBe('plugin/probe/v1.0.0');
 for(const name of ['packages','publish'])expect(workflow.jobs[name].steps[0].with.ref).toBe('${{ needs.verify.outputs.sha }}');
 expect(workflow.jobs.packages.strategy.matrix.runner).toEqual(['ubuntu-24.04','ubuntu-24.04-arm','macos-15-intel','macos-15']);
 const guard=workflow.jobs.publish.steps.find(step=>step.env?.CERTIFIED_SHA);
 expect(guard.run).toContain('git rev-parse --verify');
 expect(guard.env.CERTIFIED_SHA).toBe('${{ needs.verify.outputs.sha }}');
});

it('requires browser readiness before UI certification without reinstalling hosted system packages',()=>{
 for(const name of ['verify','packages']){
  const job=workflow.jobs[name],index=job.steps.findIndex(step=>step.name?.startsWith('Prepare browser'));
  expect(index).toBeGreaterThan(0);
  const prepare=job.steps[index];
  expect(prepare['timeout-minutes']).toBe(10);
  expect(prepare.run).toContain('npx playwright install chromium');
  expect(prepare.run).not.toContain('--with-deps');
  expect(prepare.run).toContain('await chromium.launch');
  expect(prepare.run).toContain('await page.goto');
  expect(job.steps.slice(index+1).some(step=>step.run?.includes('plugin:certify'))).toBe(true);
  expect(job['timeout-minutes']).toBe(30);
 }
});

it('stops at failed release metadata even when its diagnostics are piped through tee',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-workflow-failure-'));
 try{
  const step=workflow.jobs.verify.steps.find(step=>step.id==='metadata'),output=join(root,'outputs');
  await writeFile(output,'');
  const script=step.run.replace('bun tools/plugins/release-metadata.mjs','bun '+JSON.stringify(resolve('tools/plugins/release-metadata.mjs')));
  // GitHub enables pipefail for explicit bash; its unspecified Linux shell is bash -e.
  const flags=step.shell==='bash'?['--noprofile','--norc','-e','-o','pipefail','-c']:['-e','-c'];
  const result=spawnSync('bash',[...flags,script],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:output,PLUGIN_RELEASE_TAG:'invalid-tag',PLUGIN_CANDIDATE_NAME:'',PLUGIN_CANDIDATE_SHA:''}});
  expect(result.stderr).toContain('Use plugin/<name>/v<SemVer>');
  expect(result.status).not.toBe(0);
  expect(await readFile(output,'utf8')).toBe('');
 }finally{await rm(root,{recursive:true,force:true});}
});
