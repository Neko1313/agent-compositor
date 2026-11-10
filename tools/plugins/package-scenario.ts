import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scenarioContext,scenarioEvidence,finishScenario} from './scenario.js';
import {exercisePackage} from './package-contract.js';
import {installPluginArchive} from '../../packages/app/src/plugin-archive.js';
const ctx=await scenarioContext(),name=ctx.identity.plugin;
let directory=join(process.cwd(),'plugins',name),temporary:string|undefined;
try{
 if(ctx.stage==='artifact'){
  temporary=await mkdtemp(join(tmpdir(),'ac-cert-archive-'));
  await installPluginArchive({url:'https://artifact.example/candidate.tar.gz',sha256:ctx.artifactSha256},temporary,name,new AbortController().signal,(async()=>new Response(await readFile(ctx.artifact))) as typeof fetch);
  directory=join(temporary,name);
  const manifest=JSON.parse(await readFile(join(directory,'plugin.json'),'utf8')),release=JSON.parse(await readFile(join(directory,'release.json'),'utf8'));
  assert.equal(manifest.name,name);assert.equal(manifest.version,ctx.identity.version);assert.equal(manifest.compositor.apiVersion,ctx.identity.hostApi);
  assert.deepEqual(release.certification,ctx.identity,'Built artifact must identify the same source/plan/tooling snapshot');
  assert.equal(release.platform,ctx.platform);
 }
 const result=await exercisePackage(directory,name,ctx.stage==='artifact');
 const path=ctx.caseId+'.observations.json';await writeFile(join(ctx.output,path),JSON.stringify(result,null,2));
 await finishScenario({id:ctx.caseId,kind:ctx.stage==='artifact'?'artifact':'deterministic',status:'passed',evidence:[await scenarioEvidence(path)]});
}finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
