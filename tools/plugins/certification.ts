import {createHash} from 'node:crypto';
import {readFile,readlink,lstat,readdir} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {z} from 'zod';
import {certifiedTestPlanSchema,requiredCases,contained,type CertifiedTestPlan,type CertificationStage,type CertificationCase} from '@agent-compositor/loader';
export const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export const platforms=['linux-x64','linux-arm64','darwin-x64','darwin-arm64'] as const;
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const sourcePaths=['packages','plugins','tools','schema','.github','package.json','package-lock.json','vitest.config.ts','tsconfig.json'];
/** Git blob identities make local dirty snapshots comparable to a release tag without checking it out. */
export async function workspaceDigest(root:string,ref?:string){
 if(ref){
  const rows=execFileSync('git',['ls-tree','-r',ref,'--',...sourcePaths],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
  return digest(rows.sort().join('\n'));
 }
 const files=[...new Set(execFileSync('git',['ls-files','-co','--exclude-standard','-z','--',...sourcePaths],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))].sort();
 const rows=[];
 for(const file of files){
  let info;try{info=await lstat(join(root,file));}catch(error:any){if(error.code==='ENOENT')continue;throw error;}
  if(!info.isFile()&&!info.isSymbolicLink())throw Error('Unsupported certification input: '+file);
  const bytes=info.isSymbolicLink()?Buffer.from(await readlink(join(root,file))):await readFile(join(root,file));
  const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  rows.push(`${info.isSymbolicLink()?'120000':info.mode&0o111?'100755':'100644'} blob ${blob}\t${file}`);
 }
 return digest(rows.sort().join('\n'));
}
export async function packageDigest(directory:string){
 const entries:string[]=[];
 async function walk(path:string){for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name==='node_modules'||entry.name==='.git')continue;
  const file=join(path,entry.name),name=relative(directory,file).split('\\').join('/');
  if(entry.isSymbolicLink())throw Error('Certification inputs cannot contain symlinks: '+name);
  if(entry.isDirectory())await walk(file);else if(entry.isFile())entries.push(name+'\0'+digest(await readFile(file)));
 }}await walk(directory);return digest(entries.sort().join('\n'));
}
export const identitySchema=z.object({plugin:z.string(),version:z.string(),source:sha,workspace:sha,plan:sha,hostApi:z.literal(1)}).strict();
export type Identity=z.infer<typeof identitySchema>;
export async function identity(root:string,name:string,ref?:string):Promise<Identity>{
 const directory=join(root,'plugins',name),manifest=JSON.parse(await readFile(join(directory,'plugin.json'),'utf8'));
 return{plugin:name,version:manifest.version,source:await packageDigest(directory),workspace:await workspaceDigest(root,ref),plan:digest(await readFile(join(directory,'plugin.test.json'))),hostApi:1};
}
export const evidenceSchema=z.object({path:z.string().min(1),sha256:sha}).strict();
export const caseResultSchema=z.object({id:z.string(),kind:z.enum(['deterministic','visual','live','artifact','upgrade']),status:z.enum(['passed','failed','missing','blocked']),evidence:z.array(evidenceSchema),message:z.string().optional(),
 previous:z.object({version:z.string(),sha256:sha}).strict().optional(),
 model:z.object({provider:z.string().min(1),name:z.string().min(1),configuration:sha,taskSet:sha,repeats:z.number().int().min(2),successFloor:z.number().min(0).max(1),baseline:z.string().min(1),cost:z.number().nonnegative().nullable(),costStatus:z.enum(['reported','unavailable']).optional(),criticalFailures:z.literal(0),successRate:z.number().min(0).max(1)}).strict().optional(),
}).strict();
export type CaseResult=z.infer<typeof caseResultSchema>;
export const certificateSchema=z.object({schemaVersion:z.literal(1),identity:identitySchema,stage:z.enum(['pr','release','artifact']),platform:z.enum(platforms),runId:z.string().uuid(),startedAt:z.string().datetime(),finishedAt:z.string().datetime(),artifact:sha.optional(),results:z.array(caseResultSchema),ok:z.boolean()}).strict();
export type Certificate=z.infer<typeof certificateSchema>;
export const sharedCases:CertificationCase[]=[
 ['activation','packages/app/test/plugin-policy.test.ts','defaults to no executable plugins, retains offline default market and does not import inactive modules'],
 ['scope','packages/app/test/plugin-policy.test.ts','persists project activation, leaves other projects off, and applies project overrides over user decisions'],
 ['source','packages/app/test/plugin-policy.test.ts','keeps user/project versions separate when the workspace is HOME and does not substitute a different source after removal'],
 ['policy','packages/app/test/plugin-updates.test.ts','installs a pinned release archive through the marketplace and retains that version independently of catalog changes'],
 ['update-integrity','packages/app/test/plugin-updates.test.ts','locks independent versions, separates install/enable, checks updates, rolls back and rejects mutable versions'],
 ['archive-checksum','packages/app/test/plugin-archive.test.ts','checks the downloaded digest before extracting files'],
 ['api-compatibility','packages/loader/test/standard.test.ts','rejects unsupported compatibility declarations and empty or unknown test layers'],
 ['retained-capability','packages/hooks/test/hooks.test.ts','HooksHost / $ API revokes retained API handles on unload even if another instance reuses the name'],
 ['rollback','packages/app/test/plugin-updates.test.ts','installs a pinned release archive through the marketplace and retains that version independently of catalog changes'],
].map(([id,file,test])=>({id:'host.'+id,requirements:[],kind:'deterministic',setup:'Adversarial local packages in isolated user and project directories.',expect:['The host contract assertions pass.'],forbidden:['Unexpected activation or replacement of selected package contents.'],timeoutMs:60000,run:{runner:'vitest',file,test}}));
export function applicable(plan:CertifiedTestPlan,stage:CertificationStage){
 const requirements=requiredCases(plan.profiles,stage,plan.previousVersion);
 if(stage==='artifact')return requirements.filter(r=>r.kind!=='live'&&r.kind!=='upgrade').map(r=>({id:r.id,kind:'artifact' as const}));
 return requirements;
}
export function eligible(c:CertificationCase,kind:string,stage:CertificationStage){
 if(stage==='artifact')return c.kind==='artifact';
 if(kind==='upgrade')return c.kind==='upgrade';
 if(kind==='live'||kind==='visual')return c.kind===kind;
 return c.kind==='deterministic'||(stage==='release'&&c.kind==='upgrade');
}
/** Every declared binding for an applicable requirement must pass; one pass cannot hide a skipped/failing sibling. */
export function assess(plan:CertifiedTestPlan,stage:CertificationStage,results:CaseResult[],platform:string='linux-x64'){
 const problems:string[]=[];const ids=results.map(r=>r.id);
 for(const result of results)if(result.status!=='passed')problems.push('Unresolved case: '+result.id+' '+result.status);
 if(new Set(ids).size!==ids.length)problems.push('Duplicate result IDs');
 for(const requirement of applicable(plan,stage)){
  const bindings=plan.cases.filter(c=>c.requirements.includes(requirement.id)&&eligible(c,requirement.kind,stage)&&(!requirement.id.startsWith('release.')||c.kind==='upgrade'));
  if(!bindings.length){problems.push(`Missing binding: ${requirement.id}`);continue;}
  for(const binding of bindings){
   const result=results.find(r=>r.id===binding.id);
   if(!result||result.status!=='passed'||result.kind!==binding.kind||!result.evidence.length)problems.push(`${requirement.id}: ${binding.id} ${result?.status??'missing'}`);
   if(requirement.id.startsWith('release.')&&(!result?.previous||result.previous.version!==plan.previousVersion||result.previous.sha256!==plan.previousArtifacts?.[platform as keyof NonNullable<CertifiedTestPlan['previousArtifacts']>]?.sha256))problems.push('Invalid previous-release evidence: '+binding.id);
   if(result?.kind==='live'){
    const model=result.model,policy=plan.modelPolicy;
    if(!model||!policy||model.successRate<policy.successFloor||model.successFloor!==policy.successFloor||model.repeats<policy.repeats||model.name!==policy.name||model.provider!==policy.provider||model.baseline!==policy.baseline||model.configuration!==digest(JSON.stringify(policy.configuration))||model.taskSet!==policy.taskSetSha256||/scripted|mock|fake/i.test(model.provider))problems.push('Invalid live model evidence: '+binding.id);
   }
  }
 }
 for(const c of sharedCases)if(stage!=='artifact'){
  const r=results.find(r=>r.id===c.id);if(!r||r.status!=='passed'||r.kind!=='deterministic'||!r.evidence.length)problems.push('Missing host contract: '+c.id);
 }
 return problems;
}
export async function validateEvidence(directory:string,results:CaseResult[]){
 for(const result of results){for(const item of result.evidence){
  const file=await contained(directory,item.path);
  if(digest(await readFile(file))!==item.sha256)throw Error('Evidence checksum mismatch: '+item.path);
 }}
}
export async function verifyCertificate(directory:string,plan:CertifiedTestPlan,expected:Identity,stage:CertificationStage,platform:string,artifact?:string){
 const cert=certificateSchema.parse(JSON.parse(await readFile(join(directory,'certificate.json'),'utf8')));
 if(JSON.stringify(cert.identity)!==JSON.stringify(expected)||cert.stage!==stage||cert.platform!==platform||cert.artifact!==artifact)throw Error('Certification context does not match source, plan, stage, platform or artifact');
 if(!cert.ok||new Date(cert.finishedAt)<new Date(cert.startedAt)||new Date(cert.finishedAt)>new Date(Date.now()+300000))throw Error('Invalid certification outcome or timestamps');
 await validateEvidence(directory,cert.results);
 const problems=assess(plan,stage,cert.results,platform);if(problems.length)throw Error(problems.join('\n'));
 return cert;
}
/** Strictly match the requested file and exact full test name, including duplicate/retry/skipped results. */
export function vitestOutcome(report:any,root:string,file:string,test:string,diagnostics?:any,timeoutMs=Infinity){
 const matches=(report.testResults??[]).filter((suite:any)=>resolve(suite.name)===resolve(root,file)).flatMap((suite:any)=>suite.assertionResults??[]).filter((assertion:any)=>assertion.fullName===test);
 const attempts=(diagnostics?.results??[]).filter((r:any)=>resolve(r.file)===resolve(root,file)&&r.test===test);
 if(!diagnostics||diagnostics.errors?.length||attempts.length!==1||attempts[0].retryCount!==0||attempts[0].flaky||attempts[0].status!=='passed'||attempts[0].duration>timeoutMs)return false;
 if(!report?.success||matches.length!==1||matches[0].status!=='passed'||(matches[0].failureMessages??[]).length||matches[0].retryCount>0||matches[0].meta?.flaky)return false;
 return true;
}
