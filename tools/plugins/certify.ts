import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {runBounded} from './process.js';
import {randomUUID} from 'node:crypto';
import {verifyPreviousVersion} from './gate.js';
import {checkPlugin} from './check.js';
import {certifiedTestPlanSchema,contained,type CertificationStage,type CertificationCase} from '@agent-compositor/loader';
import {identity,workspaceDigest,digest,applicable,eligible,assess,sharedCases,caseResultSchema,validateEvidence,vitestOutcome,type Certificate,type CaseResult} from './certification.js';
const execute=runBounded;
export async function audit(root:string,name:string,stage:CertificationStage){
 const checked=await checkPlugin(root,name),parsed=certifiedTestPlanSchema.safeParse(checked.plan);
 if(!parsed.success)return{plugin:name,stage,ok:false,problems:['schemaVersion 2 certification plan required'],requirements:[]};
 const plan=parsed.data;
 const requirements=applicable(plan,stage).map(r=>({...r,cases:plan.cases.filter(c=>c.requirements.includes(r.id)&&eligible(c,r.kind,stage)).map(c=>c.id)}));
 return{plugin:name,stage,ok:requirements.every(r=>r.cases.length>0),problems:requirements.filter(r=>!r.cases.length).map(r=>'Missing binding: '+r.id),requirements};
}
export async function certify(root:string,name:string,stage:CertificationStage,options:{output?:string;artifact?:string}={}){
 const checked=await checkPlugin(root,name),plan=certifiedTestPlanSchema.parse(checked.plan),snapshot=await identity(root,name),runId=randomUUID(),platform=`${process.platform}-${process.arch}` as Certificate['platform'];
 if(!plan.platforms.includes(platform))throw Error('Current platform is not declared by the plugin');
 const output=resolve(root,options.output??`reports/certification/${name}/${stage}/${platform}`);
 if(!relative(resolve(root,'reports'),output)||relative(resolve(root,'reports'),output).startsWith('..'))throw Error('Certification output must be a child of reports/');
 await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
 const artifact=options.artifact?digest(await readFile(options.artifact)):undefined;
 if(stage==='artifact'&&!artifact)throw Error('Artifact certification requires --artifact <archive>');
 if(stage!=='artifact'&&artifact)throw Error('Artifact supplied for a source certification stage');
 const cert:Certificate={schemaVersion:1,identity:snapshot,stage,platform,runId,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),...(artifact?{artifact}:{}),results:[],ok:false};
 const requirements=applicable(plan,stage),bindings=plan.cases.filter(c=>requirements.some(r=>c.requirements.includes(r.id)&&eligible(c,r.kind,stage)));
 if(stage!=='artifact')bindings.unshift(...sharedCases);
 let fatal:string|undefined;
 try{
  if(stage==='release'){
   if(snapshot.workspace!==await workspaceDigest(root,'HEAD'))throw Error('Release certification requires a clean, committed source snapshot');
   verifyPreviousVersion(root,name,snapshot.version,plan.previousVersion);
  }
  const vitest=bindings.filter(c=>c.run.runner==='vitest');
  if(vitest.length){
   const files=[...new Set(vitest.map(c=>(c.run as {file:string}).file))];
   const escape=(name:string)=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   const pattern=vitest.map(c=>escape((c.run as {test:string}).test).replaceAll(' ','[ >]+')).join('|');
   let error;try{
    const result=await execute('node',[join(root,'node_modules/vitest/vitest.mjs'),'run',...files,'--testNamePattern',pattern,'--retry=0','--reporter=json','--outputFile.json='+join(output,'vitest.json'),'--reporter=junit','--outputFile.junit='+join(output,'junit.xml'),'--reporter='+join(root,'tools/plugins/certification-reporter.mjs')],{cwd:root,env:{...process.env,PLUGIN_TEST_NAME:name,PLUGIN_CERT_DIAGNOSTICS:join(output,'diagnostics.json')},timeout:Math.max(...vitest.map(c=>c.timeoutMs))+30000,maxBuffer:8000000});
    await writeFile(join(output,'vitest.log'),result.stdout+result.stderr);
   }catch(cause:any){error=String(cause);await writeFile(join(output,'vitest.log'),String(cause.stdout??'')+String(cause.stderr??'')+error);}
   const report=await readFile(join(output,'vitest.json'),'utf8').then(JSON.parse).catch(()=>null);
   const diagnostics=await readFile(join(output,'diagnostics.json'),'utf8').then(JSON.parse).catch(()=>null);
   const evidence=await Promise.all(['vitest.log',...(report?['vitest.json','junit.xml']:[]),...(diagnostics?['diagnostics.json']:[])].map(async path=>({path,sha256:digest(await readFile(join(output,path)))})));
   for(const c of vitest){const run=c.run as {file:string;test:string};cert.results.push({id:c.id,kind:c.kind,status:!error&&vitestOutcome(report,root,run.file,run.test,diagnostics,c.timeoutMs)?'passed':'failed',evidence,...(error?{message:error.slice(0,2000)}:{})});}
  }
  for(const binding of bindings.filter(c=>c.run.runner==='scenario')){
   const run=binding.run as {file:string;args:string[]},context={schemaVersion:1,runId,identity:snapshot,stage,platform,caseId:binding.id,artifact:options.artifact?resolve(options.artifact):undefined,artifactSha256:artifact,previousVersion:plan.previousVersion,previousArtifact:plan.previousArtifacts?.[platform],output,startedAt:cert.startedAt};
   const contextFile=join(output,binding.id+'.context.json'),resultFile=join(output,binding.id+'.result.json'),log=binding.id+'.log';
   await writeFile(contextFile,JSON.stringify(context,null,2));
   try{
    const result=await execute(process.execPath,[await contained(root,run.file),...run.args],{cwd:root,env:{...process.env,PLUGIN_CERT_CONTEXT:contextFile,PLUGIN_CERT_RESULT:resultFile},timeout:binding.timeoutMs,maxBuffer:8000000});
    await writeFile(join(output,log),result.stdout+result.stderr);
    const data=JSON.parse(await readFile(resultFile,'utf8'));
    if(data.runId!==runId||data.context!==digest(await readFile(contextFile)))throw Error('Stale or mismatched scenario evidence');
    const outcome=caseResultSchema.parse(data.result);
    if(outcome.id!==binding.id||outcome.kind!==binding.kind)throw Error('Scenario identity or kind mismatch');
    if(binding.kind==='live'){
      const policy=plan.modelPolicy,model=outcome.model;
      if(!policy||!model||model.provider!==policy.provider||model.name!==policy.name||model.repeats<policy.repeats||model.successFloor!==policy.successFloor||model.baseline!==policy.baseline||model.configuration!==digest(JSON.stringify(policy.configuration))||model.taskSet!==digest(await readFile(await contained(root,policy.taskSet))))throw Error('Live result does not match predeclared model policy and task set');
    }
    await validateEvidence(output,[outcome]);
    cert.results.push(outcome);
   }catch(error:any){
    await writeFile(join(output,log),String(error.stdout??'')+String(error.stderr??'')+String(error));
    cert.results.push({id:binding.id,kind:binding.kind,status:'failed',message:String(error).slice(0,2000),evidence:[{path:log,sha256:digest(await readFile(join(output,log)))}]});
   }
  }
  if(snapshot.workspace!==(await identity(root,name)).workspace)throw Error('Certification inputs changed during the run');
 }catch(error){fatal=String(error);}
 const problems=assess(plan,stage,cert.results,platform);if(fatal)problems.push(fatal);
 cert.finishedAt=new Date().toISOString();cert.ok=problems.length===0;
 await writeFile(join(output,'certificate.json'),JSON.stringify(cert,null,2)+'\n');
 await writeFile(join(output,'readiness.json'),JSON.stringify({plugin:name,stage,ok:cert.ok,problems,requirements},null,2)+'\n');
 return{plugin:name,stage,ok:cert.ok,problems,output};
}
if(import.meta.main){
 const args=process.argv.slice(2),stage=(args.includes('--stage')?args[args.indexOf('--stage')+1]:'pr') as CertificationStage;
 if(!['pr','release','artifact'].includes(stage))throw Error('Invalid certification stage');
 const names=args.includes('--all')?(await import('node:fs/promises')).readdir('plugins',{withFileTypes:true}).then(entries=>entries.filter(e=>e.isDirectory()).map(e=>e.name)):Promise.resolve([args[0]]);
 const results=[];
 for(const name of await names){
  if(!name||name.startsWith('--'))throw Error('Provide a plugin or --all');
  try{results.push(args.includes('--audit')?await audit(process.cwd(),name,stage):await certify(process.cwd(),name,stage,{artifact:args.includes('--artifact')?args[args.indexOf('--artifact')+1]:undefined}));}
  catch(error){results.push({plugin:name,stage,ok:false,problems:[String(error)]});}
 }
 if(args.includes('--all')){
  await mkdir('reports/certification',{recursive:true});
  await writeFile('reports/certification/summary.json',JSON.stringify(results,null,2)+'\n');
  await writeFile('reports/certification/summary-'+stage+'.json',JSON.stringify(results,null,2)+'\n');
 }
 console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.ok))process.exitCode=1;
}
