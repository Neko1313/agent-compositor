import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compareVersions} from '@agent-compositor/loader';
import {buildApp,type BuiltApp} from '../../packages/app/src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
import {NetworkClient} from '../../packages/provider/src/network.js';
import {readSettings} from '../../packages/config/src/storage.js';
import {evaluationEnvironment} from '../evals/environment.js';
import {digest} from './certification.js';
import {withCandidate} from './candidate.js';
import {scenarioContext,scenarioEvidence,finishScenario} from './scenario.js';

type Previous={version:string;url:string;sha256:string};
export async function verifiedPreviousArchive(previous:Previous,fetcher:typeof fetch){
 const validate=(value:string,base?:string)=>{let url:URL;try{url=new URL(value,base);}catch{throw Error('Invalid previous archive URL');}if(url.protocol!=='https:'||url.username||url.password)throw Error('Previous archive requires credential-free HTTPS');return url.href;};
 let url=validate(previous.url);const signal=AbortSignal.timeout(60000),limit=128*1024*1024;
 for(let redirects=0;redirects<5;redirects++){
  let response:Response;
  try{response=await fetcher(url,{signal,redirect:'manual'});}catch{throw Error('Previous release transport failed');}
  if([301,302,303,307,308].includes(response.status)){
   const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('Previous archive redirect has no location');url=validate(next,url);continue;
  }
  if(!response.ok||!response.body){await response.body?.cancel();throw Error('Previous archive download failed: HTTP '+response.status);}
  if(Number(response.headers.get('content-length'))>limit){await response.body.cancel();throw Error('Previous archive exceeds download limit');}
  const chunks:Uint8Array[]=[];let size=0;
  try{for await(const chunk of response.body){size+=chunk.byteLength;if(size>limit)throw Error('Previous archive exceeds download limit');chunks.push(chunk);}}
  catch{throw Error(size>limit?'Previous archive exceeds download limit':'Previous release body transfer failed');}
  const bytes=Buffer.concat(chunks);assert.equal(digest(bytes),previous.sha256,'Previous archive checksum mismatch');return bytes;
 }
 throw Error('Previous archive redirect limit exceeded');
}

/** Real managed transitions, using published previous bytes and the exact candidate. */
export async function exerciseCiReleaseTransition(directory:string,previous:Previous,fetcher:typeof fetch,candidateArtifact?:{bytes:Buffer;sha256:string}){
 const name='ci-review',manifest=JSON.parse(await readFile(join(directory,'plugin.json'),'utf8'));
 assert.equal(manifest.name,name);assert.ok(compareVersions(manifest.version,previous.version)>0,'Candidate must follow the previous release');
 if(candidateArtifact)assert.equal(digest(candidateArtifact.bytes),candidateArtifact.sha256);
 const bytes=await verifiedPreviousArchive(previous,fetcher),root=await realpath(await mkdtemp(join(tmpdir(),'ci-release-transition-')));
 const cwd=join(root,'project'),home=join(root,'home'),market=join(root,'market'),observations:unknown[]=[];
 const settings={repository:'fixture/repo',maxRuns:3,maxChars:4000,timeoutMs:5000},provider=new ScriptedProvider([]);
 let app:BuiltApp|undefined,core:ReturnType<BuiltApp['createCore']>|undefined,downloads=0;
 const server=createServer((req,res)=>{downloads++;if(req.url==='/previous.tar.gz')res.end(bytes);else if(req.url==='/candidate.tar.gz'&&candidateArtifact)res.end(candidateArtifact.bytes);else{res.statusCode=404;res.end();}});
 try{
  await mkdir(cwd);await mkdir(home);await mkdir(join(market,'.claude-plugin'),{recursive:true});
  await cp(directory,join(market,'plugins',name),{recursive:true,dereference:false});
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false,skills:false,fileReferences:false},permissions:{rules:[{tool:'ci_review',decision:'allow'}]}}));
  await writeFile(join(cwd,'user-draft.txt'),'PRESERVED_TRANSITION_DRAFT\n');
  await new Promise<void>((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  const base=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const publish=async(version:string,source:unknown)=>writeFile(join(market,'.claude-plugin/marketplace.json'),JSON.stringify({name:'release-transition',owner:{name:'Release certification'},plugins:[{name,version,source,compositor:{format:'native'}}]}));
  const archiveSource=(url:string,sha256:string)=>({source:'archive',assets:{[`${process.platform}-${process.arch}`]:{url,sha256}}});
  await publish(previous.version,archiveSource(base+'/previous.tar.gz',previous.sha256));
  const options={cwd,env:evaluationEnvironment(home,root),provider,agentHub:false};
  app=await buildApp(options);core=app.createCore(async()=>true);
  const control=async(action:string,extra:Record<string,unknown>={})=>{const result=await core!.invokeTool('extension_control',{action,name,scope:'project',...extra});assert.equal(result.ok,true,result.error??action+' failed');return result.output as any;};
  const observe=async(phase:string,version:string)=>{
   const current=app!;assert.deepEqual(current.pluginErrors,[]);assert.equal(current.plugins.length,1);assert.equal(current.plugins[0].manifest.version,version);
   assert.equal(await realpath(current.plugins[0].dir),await realpath(join(cwd,'.agent-compositor/plugins',name)),'No fallback package may satisfy the transition');
   if(version===previous.version||candidateArtifact){
    const release=JSON.parse(await readFile(join(current.plugins[0].dir,'release.json'),'utf8'));
    assert.equal(release.plugin,name);assert.equal(release.version,version);assert.equal(release.platform,`${process.platform}-${process.arch}`);assert.equal(release.hostApi,1);
   }
   assert.deepEqual(await current.storage.config('ci-review.json'),settings);
   const calls:any[]=[],events:any[]=[],active=core!;
   active.host.unregisterPlugin('transition-gh');active.host.registerPlugin({name:'transition-gh',version:'1.0.0',trust:'trusted'},{'service.exec.run':event=>{
    if(event.plugin!==name)return;calls.push(event);return{value:{exitCode:0,stdout:'[]',stderr:''}};
   }});
   const unsubscribe=active.subscribe(event=>{if(event.kind==='catalog')events.push(event);});
   try{
    const result=await active.invokeTool('ci_review',{action:'runs'});assert.equal(result.ok,true,result.error??'CI review operation failed');assert.deepEqual(JSON.parse((result.output as any).output),[]);
    await active.submit('/ci');assert.equal(active.failure,undefined);assert.ok(events.some(event=>event.event==='ui.surface'&&event.input.plugin===name&&event.input.title==='CI review'));
    assert.equal(calls.length,1,'Opening the panel must not fetch again');assert.equal(calls[0].args[calls[0].args.indexOf('--repo')+1],settings.repository);
    assert.equal(calls[0].args[calls[0].args.indexOf('--limit')+1],String(settings.maxRuns));assert.equal(calls[0].timeoutMs,settings.timeoutMs);
   }finally{unsubscribe();}
   assert.deepEqual(await current.storage.config('ci-review.json'),settings,'Behavior probes must not rewrite the tested settings');
   assert.equal(await readFile(join(cwd,'user-draft.txt'),'utf8'),'PRESERVED_TRANSITION_DRAFT\n');
   assert.equal(await readFile(join(current.storage.paths.state,'unrelated.json'),'utf8'),'{"keep":"UNRELATED_SETTINGS"}\n');
   const lock=JSON.parse(await readFile(join(current.storage.paths.state,'extensions-state.json'),'utf8')).installed[name];assert.equal(lock.version,version);
   observations.push({phase,version,commit:lock.commit,digest:lock.digest,settingsPreserved:true,draftPreserved:true,ownedBehavior:true});return lock;
  };
  assert.equal((await core.invokeTool('marketplace_control',{action:'add',source:market,scope:'project'})).ok,true);
  const install=await control('install',{name:name+'@release-transition'});assert.equal(install.version,previous.version);assert.equal(install.activated,false);
  await app.reloadPlugins(core);assert.equal(app.plugins.length,0,'Installation must remain inactive');
  await app.storage.configure('ci-review.json',settings,'project');await writeFile(join(app.storage.paths.state,'unrelated.json'),'{"keep":"UNRELATED_SETTINGS"}\n');
  await control('enable');await app.reloadPlugins(core);assert.equal((await observe('previous-active',previous.version)).commit,previous.sha256);
  await publish(manifest.version,candidateArtifact?archiveSource(base+'/candidate.tar.gz',candidateArtifact.sha256):'./plugins/'+name);
  const updates=await control('check-updates');assert.ok(updates.updates.some((row:any)=>row.name===name&&row.installedVersion===previous.version&&row.availableVersion===manifest.version&&row.updateAvailable));
  assert.equal(app.plugins[0].manifest.version,previous.version,'Catalog refresh must not silently update active code');
  assert.equal((await control('update')).version,manifest.version);await app.reloadPlugins(core);const updated=await observe('candidate-active',manifest.version);
  if(candidateArtifact)assert.equal(updated.commit,candidateArtifact.sha256);
  await app.close();app=await buildApp(options);core=app.createCore(async()=>true);await observe('candidate-restarted',manifest.version);
  const beforeRollback=downloads;assert.equal((await control('rollback')).version,previous.version);await app.reloadPlugins(core);
  assert.equal((await observe('previous-restored',previous.version)).commit,previous.sha256);assert.equal(downloads,beforeRollback,'Rollback must use the locked backup without downloading again');
  await app.close();app=await buildApp(options);core=app.createCore(async()=>true);await observe('rollback-restarted',previous.version);
  assert.equal(provider.requests.length,0,'Transitions must not need model inference');
  return{plugin:name,previous:{version:previous.version,sha256:previous.sha256},candidateVersion:manifest.version,candidateSource:candidateArtifact?'archive':'directory',downloads,modelRequests:provider.requests.length,observations};
 }finally{try{await app?.close();}finally{server.closeAllConnections();if(server.listening)await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}}
}

if(import.meta.main){
 const ctx=await scenarioContext();assert.equal(ctx.identity.plugin,'ci-review');assert.ok(ctx.previousVersion&&ctx.previousArtifact);
 const network=new NetworkClient();network.configure(await readSettings(process.cwd(),'proxy.json'));
 try{
  // The archive path is supplied separately so the normal manager exercises its
  // archive branch too, rather than only copying an extracted package directory.
  const artifact=ctx.stage==='artifact'?{bytes:await readFile(ctx.artifact),sha256:ctx.artifactSha256}:undefined;
  const result=await withCandidate(ctx,directory=>exerciseCiReleaseTransition(directory,{version:ctx.previousVersion,...ctx.previousArtifact},network.fetch('tools'),artifact));
  const file=ctx.caseId+'.observations.json';await writeFile(join(ctx.output,file),JSON.stringify(result,null,2)+'\n');
  await finishScenario({id:ctx.caseId,kind:ctx.stage==='artifact'?'artifact':'upgrade',status:'passed',previous:result.previous,evidence:[await scenarioEvidence(file)]});
 }finally{await network.close();}
}
