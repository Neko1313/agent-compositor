import {afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {certifiedTestPlanSchema,requiredCases,requirementProfiles,type CertifiedTestPlan} from '@agent-compositor/loader';
import {assess,sharedCases,verifyCertificate,identity,digest,workspaceDigest,vitestOutcome,type Certificate} from './certification.js';
import {audit,certify} from './certify.js';
import {publicationGate} from './gate.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
function testCase(id:string,requirements:string[],kind='deterministic'){
 return{id,requirements,kind,setup:'Isolated certification fixture with a declared objective oracle.',expect:['Observed result matches the declared fixture outcome.'],forbidden:['Skipped, stale or unrelated tests cannot count as evidence.'],timeoutMs:1000,run:{runner:'vitest',file:'tools/plugins/fixture.test.ts',test:'exact case'}};
}
function plan():CertifiedTestPlan{return certifiedTestPlanSchema.parse({schemaVersion:2,plugin:'probe',tests:[{layer:'unit',files:['tools/plugins/fixture.test.ts']}],profiles:{components:['hook'],traits:[]},platforms:['linux-x64','linux-arm64','darwin-x64','darwin-arm64'],previousVersion:null,cases:[testCase('behavior',[...requirementProfiles.base,...requirementProfiles.hook]),{...testCase('installed',[...requirementProfiles.base,...requirementProfiles.hook,...requirementProfiles.artifact],'artifact'),run:{runner:'scenario',file:'tools/plugins/fixture.test.ts',args:[]}}]});}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'ac-cert-gate-'));roots.push(root);
 for(const dir of ['plugins/probe','tools/plugins','.claude-plugin','reports/evidence'])await mkdir(join(root,dir),{recursive:true});
 await writeFile(join(root,'plugins/probe/plugin.json'),JSON.stringify({name:'probe',version:'1.0.0',trust:'trusted',compositor:{standard:1,apiVersion:1}}));
 await writeFile(join(root,'plugins/probe/plugin.test.json'),JSON.stringify(plan()));
 await writeFile(join(root,'plugins/probe/README.md'),'Certification fixture');await writeFile(join(root,'plugins/probe/CHANGELOG.md'),'## 1.0.0\nInitial fixture');
 await writeFile(join(root,'tools/plugins/fixture.test.ts'),'// Binding fixture; successful test execution is intentionally simulated only in validator unit tests.');
 await writeFile(join(root,'.claude-plugin/marketplace.json'),JSON.stringify({name:'fixture',owner:{name:'Test'},plugins:[]}));
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],{cwd:root});execFileSync('git',['tag','plugin/probe/v1.0.0'],{cwd:root});
 const snapshot=await identity(root,'probe'),evidence=join(root,'reports/evidence'),assets=Object.fromEntries(plan().platforms.map(platform=>[platform,{sha256:digest(platform)}]));
 for(const stage of ['release','artifact'] as const)for(const platform of stage==='release'?['linux-x64']:plan().platforms){
  const dir=join(evidence,stage,platform);await mkdir(dir,{recursive:true});await writeFile(join(dir,'observations.json'),'unit test evidence');
  const cases=stage==='release'?[...sharedCases,{id:'behavior',kind:'deterministic'}]:[{id:'installed',kind:'artifact'}];
  const cert:Certificate={schemaVersion:1,identity:snapshot,stage,platform:platform as Certificate['platform'],runId:randomUUID(),startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),...(stage==='artifact'?{artifact:assets[platform].sha256}:{}),results:cases.map(c=>({id:c.id,kind:c.kind as 'deterministic',status:'passed',evidence:[{path:'observations.json',sha256:digest('unit test evidence')}]})),ok:true};
  await writeFile(join(dir,'certificate.json'),JSON.stringify(cert));
 }
 return{root,evidence,snapshot,assets};
}
it('derives the union of every component and trait and keeps live/UI obligations out of deterministic PR results',()=>{
 const profiles={components:['tool','skill','view','interactive-ui'],traits:['mutation','network','model']};
 const pr=requiredCases(profiles,'pr').map(r=>r.id),release=requiredCases(profiles,'release','0.9.0').map(r=>r.id);
 for(const id of ['tool.denied','mutation.recovery','network.cancel','skill.precedence','composite.lifecycle'])expect(pr).toContain(id);
 expect(pr).not.toContain('model.intended');expect(pr).not.toContain('ui.keyboard');
 for(const id of ['model.intended','ui.keyboard','view.narrow','release.upgrade','release.rollback'])expect(release).toContain(id);
});
it('rejects duplicate IDs, unknown obligations, incomplete skill profiles and model plans without predeclared policy',()=>{
 const base=plan();expect(certifiedTestPlanSchema.safeParse({...base,cases:[...base.cases,base.cases[0]]}).success).toBe(false);
 expect(certifiedTestPlanSchema.safeParse({...base,cases:[testCase('bad',['fictional.requirement'])]}).success).toBe(false);
 expect(certifiedTestPlanSchema.safeParse({...base,profiles:{components:['skill'],traits:[]}}).success).toBe(false);
 expect(certifiedTestPlanSchema.safeParse({...base,profiles:{components:['hook'],traits:['model']}}).success).toBe(false);
});
it('blocks missing bindings/results, duplicates, failures, zero evidence and a skipped sibling despite a passing binding',async()=>{
 const f=await fixture(),cert=JSON.parse(await readFile(join(f.evidence,'release/linux-x64/certificate.json'),'utf8'));
 expect(assess(plan(),'release',cert.results)).toEqual([]);
 expect(assess({...plan(),cases:[]},'release',cert.results).some(p=>p.includes('Missing binding'))).toBe(true);
 for(const status of ['failed','blocked','missing'])expect(assess(plan(),'release',cert.results.map((r:any)=>r.id==='behavior'?{...r,status}:r)).length).toBeGreaterThan(0);
 expect(assess(plan(),'release',cert.results.filter((r:any)=>r.id!=='behavior')).length).toBeGreaterThan(0);
 expect(assess(plan(),'release',[...cert.results,cert.results[0]]).length).toBeGreaterThan(0);
 expect(assess(plan(),'release',cert.results.map((r:any)=>({...r,evidence:[]}))).length).toBeGreaterThan(0);
 const two={...plan(),cases:[...plan().cases,testCase('sibling',['hook.intended'])]} as CertifiedTestPlan;
 expect(assess(two,'release',cert.results)).toContain('hook.intended: sibling missing');
});
it('matches exact executed files and names and rejects retries, duplicate names, skips and unrelated passing tests',()=>{
 const file=resolve('tools/plugins/fixture.test.ts'),assertion={fullName:'exact case',status:'passed',failureMessages:[]},report={success:true,testResults:[{name:file,assertionResults:[assertion]}]},diagnostics={errors:[],results:[{file,test:'exact case',status:'passed',retryCount:0,flaky:false}]};
 expect(vitestOutcome(report,process.cwd(),'tools/plugins/fixture.test.ts','exact case',diagnostics)).toBe(true);
 expect(vitestOutcome(report,process.cwd(),'different.test.ts','exact case',diagnostics)).toBe(false);
 expect(vitestOutcome(report,process.cwd(),'tools/plugins/fixture.test.ts','nearby case',diagnostics)).toBe(false);
 for(const patch of [{retryCount:1},{flaky:true},{status:'skipped'}])expect(vitestOutcome(report,process.cwd(),'tools/plugins/fixture.test.ts','exact case',{...diagnostics,results:[{...diagnostics.results[0],...patch}]})).toBe(false);
 expect(vitestOutcome({...report,testResults:[{name:file,assertionResults:[assertion,assertion]}]},process.cwd(),'tools/plugins/fixture.test.ts','exact case',diagnostics)).toBe(false);
});
it('accepts complete content-bound evidence and blocks tampering, different platform/artifact, and missing platform results',async()=>{
 const f=await fixture();expect(await publicationGate(f.root,'probe',f.evidence,f.assets,'1.0.0')).toMatchObject({certified:true});
 const path=join(f.evidence,'artifact/linux-x64');
 await expect(verifyCertificate(path,plan(),f.snapshot,'artifact','linux-arm64',f.assets['linux-x64'].sha256)).rejects.toThrow('context');
 await expect(verifyCertificate(path,plan(),f.snapshot,'artifact','linux-x64','0'.repeat(64))).rejects.toThrow('context');
 await writeFile(join(path,'observations.json'),'tampered');await expect(publicationGate(f.root,'probe',f.evidence,f.assets,'1.0.0')).rejects.toThrow('checksum');
});
it('does not let edited tests, plans or plugin code reuse prior evidence, and fingerprints untracked source files',async()=>{
 const f=await fixture();expect(await workspaceDigest(f.root)).toBe(await workspaceDigest(f.root,'HEAD'));
 await writeFile(join(f.root,'tools/plugins/new.test.ts'),'new test');expect(await workspaceDigest(f.root)).not.toBe(f.snapshot.workspace);
 await expect(verifyCertificate(join(f.evidence,'release/linux-x64'),plan(),await identity(f.root,'probe'),'release','linux-x64')).rejects.toThrow('context');
});
it('requires v2 for certification and reports missing requirements for a newly added plugin',async()=>{
 const f=await fixture(),path=join(f.root,'plugins/probe/plugin.test.json');
 await writeFile(path,JSON.stringify({...plan(),cases:[]}));const result=await audit(f.root,'probe','pr');expect(result.ok).toBe(false);expect(result.problems).toContain('Missing binding: package.activate');
 await writeFile(path,JSON.stringify({schemaVersion:1,plugin:'probe',tests:plan().tests}));expect((await audit(f.root,'probe','pr')).problems).toContain('schemaVersion 2 certification plan required');
});

it('cannot waive actual previous tags by declaring the next release to be a first release',async()=>{
 const f=await fixture();execFileSync('git',['tag','plugin/probe/v0.9.0'],{cwd:f.root});
 await expect(publicationGate(f.root,'probe',f.evidence,f.assets,'1.0.0')).rejects.toThrow('preceding plugin tag');
});
it('blocks missing platform certificates and reports invalid evidence paths',async()=>{
 const f=await fixture();await rm(join(f.evidence,'artifact/darwin-arm64'),{recursive:true});
 await expect(publicationGate(f.root,'probe',f.evidence,f.assets,'1.0.0')).rejects.toThrow();
 const path=join(f.evidence,'release/linux-x64/certificate.json'),cert=JSON.parse(await readFile(path,'utf8'));
 cert.results[0].evidence[0].path='../../../../plugins/probe/plugin.json';await writeFile(path,JSON.stringify(cert));
 await expect(verifyCertificate(join(f.evidence,'release/linux-x64'),plan(),f.snapshot,'release','linux-x64')).rejects.toThrow();
});
it('requires the released tag source even when the working-tree version matches its label',async()=>{
 const f=await fixture();await writeFile(join(f.root,'plugins/probe/plugin.test.json'),JSON.stringify({...plan(),cases:[]}));
 // A reviewed older release is still valid; a modified working tree cannot redefine its plan.
 expect(await publicationGate(f.root,'probe',f.evidence,f.assets,'1.0.0')).toMatchObject({certified:true});
 const path=join(f.evidence,'release/linux-x64/certificate.json'),cert=JSON.parse(await readFile(path,'utf8'));
 cert.identity=await identity(f.root,'probe');await writeFile(path,JSON.stringify(cert));
 await expect(publicationGate(f.root,'probe',f.evidence,f.assets,'1.0.0')).rejects.toThrow('context');
});

it('requires component behavior again on the archive; a single install smoke cannot certify its tool or skill',()=>{
 const base=plan(),profiles={components:['tool','skill'] as const,traits:['model'] as const};
 const requirements=requiredCases(profiles,'artifact').map(r=>r.id);expect(requirements).toContain('tool.denied');expect(requirements).toContain('skill.resources');
 const artifactPlan={...base,profiles} as unknown as CertifiedTestPlan;
 expect(assess(artifactPlan,'artifact',[{id:'installed',kind:'artifact',status:'passed',evidence:[{path:'smoke.json',sha256:'0'.repeat(64)}]}])).toContain('Missing binding: tool.denied');
});
it('rejects scripted models, relaxed thresholds and task/config drift even when the live case reports passed',async()=>{
 const f=await fixture(),cert=JSON.parse(await readFile(join(f.evidence,'release/linux-x64/certificate.json'),'utf8'));
 const modelPolicy={provider:'ollama',name:'reference',repeats:3,successFloor:1,baseline:'First reference baseline',taskSet:'tasks.json',taskSetSha256:digest('tasks'),configuration:{temperature:0}};
 const live={...testCase('model-tasks',[...requirementProfiles.model],'live'),run:{runner:'scenario' as const,file:'live.ts',args:[]}};
 const modelPlan={...plan(),profiles:{components:['hook'],traits:['model']},modelPolicy,cases:[...plan().cases,live]} as CertifiedTestPlan;
 const result={id:'model-tasks',kind:'live' as const,status:'passed' as const,evidence:[{path:'transcript.json',sha256:digest('transcript')}],model:{provider:'ollama',name:'reference',repeats:3,successFloor:1,successRate:1,criticalFailures:0 as const,cost:0,baseline:modelPolicy.baseline,configuration:digest(JSON.stringify(modelPolicy.configuration)),taskSet:modelPolicy.taskSetSha256}};
 expect(assess(modelPlan,'release',[...cert.results,result])).toEqual([]);
 for(const patch of [{provider:'scripted'},{successFloor:0},{successRate:0.9},{taskSet:digest('different')},{configuration:digest('changed')},{repeats:1}])expect(assess(modelPlan,'release',[...cert.results,{...result,model:{...result.model,...patch}}]).some(p=>p.includes('Invalid live model evidence'))).toBe(true);
});
