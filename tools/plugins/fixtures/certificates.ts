/** Synthetic validator fixtures. They are never evidence that a real package/platform executed. */
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {certifiedTestPlanSchema,requirementProfiles} from '@agent-compositor/loader';
import {digest,identity,sharedCases,type Certificate} from '../certification.js';
export async function writeFixtureCertificates(root:string,name:string,version:string,assets:Record<string,{sha256:string}>){
 const directory=join(root,'plugins',name);await mkdir(directory,{recursive:true});await mkdir(join(root,'tools/plugins'),{recursive:true});
 const common={setup:'Synthetic validator context; no runtime behavior is claimed.',expect:['The validator accepts only a complete matching fixture.'],forbidden:['Missing, changed or mismatched evidence must not pass.'],timeoutMs:1000};
 const plan=certifiedTestPlanSchema.parse({schemaVersion:2,plugin:name,tests:[{layer:'unit',files:['tools/plugins/fixture.test.ts']}],profiles:{components:['hook'],traits:[]},platforms:Object.keys(assets),previousVersion:null,cases:[
  {...common,id:'behavior',kind:'deterministic',requirements:[...requirementProfiles.base,...requirementProfiles.hook],run:{runner:'vitest',file:'tools/plugins/fixture.test.ts',test:'exact case'}},
  {...common,id:'installed',kind:'artifact',requirements:[...requirementProfiles.base,...requirementProfiles.hook,...requirementProfiles.artifact],run:{runner:'scenario',file:'tools/plugins/fixture.test.ts',args:[]}},
 ]});
 await writeFile(join(directory,'plugin.test.json'),JSON.stringify(plan));
 await writeFile(join(directory,'README.md'),'Synthetic validation fixture');await writeFile(join(directory,'CHANGELOG.md'),'## '+version+'\nFixture');await writeFile(join(root,'tools/plugins/fixture.test.ts'),'// Synthetic binding used only by validator unit tests.');
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],{cwd:root});execFileSync('git',['tag',`plugin/${name}/v${version}`],{cwd:root});
 const snapshot=await identity(root,name),evidence=join(root,'artifacts/certification',name);
 for(const stage of ['release','artifact'] as const)for(const platform of stage==='release'?['linux-x64']:Object.keys(assets)){
  const dir=join(evidence,stage,platform);await mkdir(dir,{recursive:true});await writeFile(join(dir,'observations.json'),'unit test evidence');
  const cases=stage==='release'?[...sharedCases,{id:'behavior',kind:'deterministic'}]:[{id:'installed',kind:'artifact'}];
  const cert:Certificate={schemaVersion:1,identity:snapshot,stage,platform:platform as Certificate['platform'],runId:randomUUID(),startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),...(stage==='artifact'?{artifact:assets[platform].sha256}:{}),results:cases.map(c=>({id:c.id,kind:c.kind as 'deterministic',status:'passed',evidence:[{path:'observations.json',sha256:digest('unit test evidence')}]})),ok:true};
  await writeFile(join(dir,'certificate.json'),JSON.stringify(cert));
 }
 return{plan,evidence,snapshot};
}
