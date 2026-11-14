import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluationEnvironment} from './environment.js';
import {developmentTask,prepareDevelopmentTask} from './development-task.js';
import {developmentInventory,developmentContentDigest,gradeDevelopmentPlugin} from './development-grade.js';
import {createDevelopmentTransport,validateDevelopmentProvider,validateDevelopmentLimits,type DevelopmentProvider,type DevelopmentLimits} from './development-transport.js';

export const developmentLimits:DevelopmentLimits={maxRequests:40,maxRequestBytes:200000,maxTotalRequestBytes:6000000,maxOutputTokens:4096,maxMeasuredTokens:1200000,maxResponseBytes:4000000,deadlineMs:1200000};
export interface DevelopmentSavedProfile {kind:'saved-openai-profile';profile:string;model:'gpt-6.1-sol';maxUsd:number}
export interface DevelopmentOptions {
  binary:string;binarySha256:string;output:string;provider:DevelopmentProvider|DevelopmentSavedProfile;limits:DevelopmentLimits;
  execute?:boolean;providerAccessNote?:string;maxSteps?:number;contextWindow?:number;signal?:AbortSignal;
}
export function validateDevelopmentSource(provider:DevelopmentOptions['provider']):void {
  if(provider.kind!=='saved-openai-profile'){validateDevelopmentProvider(provider);return;}
  if(Object.keys(provider).sort().join(',')!=='kind,maxUsd,model,profile'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(provider.profile)||provider.model!=='gpt-6.1-sol'||!Number.isFinite(provider.maxUsd)||provider.maxUsd<=0)
    throw Error('Saved development requires an explicit profile, gpt-6.1-sol and its existing total USD ceiling');
}
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
const exec=promisify(execFile);

export async function inspectDevelopmentBinary(path:string,expected:string) {
  if(!isAbsolute(path)||!/^[a-f0-9]{64}$/.test(expected))throw Error('An absolute installed binary and exact SHA256 are required');
  const binary=await realpath(path),info=await lstat(binary),bytes=await readFile(binary);
  if(!info.isFile()||!(info.mode&0o111)||hash(bytes)!==expected)throw Error('Installed executable identity/mode differs');
  const magic=bytes.subarray(0,4).toString('hex');
  if(!['7f454c46','cffaedfe','feedfacf','cafebabe','bebafeca','cefaedfe'].includes(magic))throw Error('Expected a packaged native Compositor executable, not a source/script launcher');
  const root=resolve(binary,'..'),version=(await readFile(join(root,'VERSION'),'utf8')).trim();
  if(!/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))throw Error('Packaged VERSION is missing or invalid');
  const renderer=join(root,'node_modules','@agent-compositor','renderer-opentui','index.js');
  return{path:binary,sha256:expected,bytes:bytes.length,mode:info.mode&0o777,version,renderer:{path:renderer,sha256:hash(await readFile(renderer))}};
}

/** Keep every candidate and receipt. Preparation and execution are distinct. */
export async function runDevelopment(options:DevelopmentOptions) {
  // Capture the parent authority before constructing the isolated actor home.
  const parentScope={cwd:process.cwd(),env:{...process.env}},saved=options.provider.kind==='saved-openai-profile'?options.provider:undefined;
  validateDevelopmentSource(options.provider);validateDevelopmentLimits(options.limits);options.signal?.throwIfAborted();
  if(options.execute&&!options.providerAccessNote?.trim())throw Error('Live execution requires an explicit reviewed provider-access/billing note; local Ollama is not necessarily free');
  const maxSteps=options.maxSteps??40,contextWindow=options.contextWindow??32768;
  if(!Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>100||!Number.isSafeInteger(contextWindow)||contextWindow<4096||contextWindow>131072||contextWindow<=options.limits.maxOutputTokens+2048)throw Error('Invalid step/context envelope');
  const binary=await inspectDevelopmentBinary(options.binary,options.binarySha256),output=resolve(options.output);
  if(output.startsWith(resolve(binary.path,'..')+'/'))throw Error('Evidence must be outside the installed package');
  await mkdir(output,{recursive:false});
  const project=join(output,'project'),home=join(output,'home'),temp=join(output,'tmp'),evidence=join(output,'evidence');
  await Promise.all([project,home,temp,evidence].map(path=>mkdir(path)));
  const fixtures:Record<string,string>={...await prepareDevelopmentTask(project),'.gitignore':'.agent-compositor/\n'};
  await writeFile(join(project,'.gitignore'),fixtures['.gitignore'],{flag:'wx'});
  const environment=evaluationEnvironment(home,temp);
  let effectiveOutputTokens=options.limits.maxOutputTokens,reasoningEffort:string|undefined;
  const configuration=(baseUrl:string)=>({enabledPlugins:['agent-harness','guard-secrets','guard-scope','callix'],
    providers:{default:{type:saved?'openai-responses':'openai-compat',baseUrl,model:options.provider.model,apiKey:'development-local',contextWindow,maxOutputTokens:effectiveOutputTokens,...(reasoningEffort?{reasoningEffort}:{}),retries:0,timeoutMs:Math.min(options.limits.deadlineMs,180000)}},
    agent:{tools:['read','write','edit','exec','glob','grep','tool_help'],builtinTools:['read','write','edit','exec'],controlTools:['tool_help'],skills:false,projectContext:false,fileReferences:false,instructionsPreset:'coding',
      maxSteps,maxTokensPerTurn:options.limits.maxMeasuredTokens,maxTokensPerSession:options.limits.maxMeasuredTokens},compaction:{enabled:true,contextWindow,reserveOutput:effectiveOutputTokens,reserveSystem:1024,highWaterMark:.8},
    permissions:{rules:[...developmentTask.writable.flatMap(path=>['write','edit'].map(tool=>({tool,path:join(project,path),decision:'allow'}))),...developmentTask.commands.map(command=>({tool:'exec',command,decision:'allow'}))]}});
  fixtures['agent-compositor.json']=json(configuration('http://127.0.0.1:9/v1'));
  await writeFile(join(project,'agent-compositor.json'),fixtures['agent-compositor.json'],{flag:'wx'});
  const preflight=[];
  for(const [file,expectedExit] of [['project-checks.mjs',0],['checks.mjs',1]] as const){
    let code=0,stdout='',stderr='';
    try{const result=await exec('node',[file],{cwd:project,env:environment,timeout:10000,maxBuffer:64000});stdout=result.stdout;stderr=result.stderr;}
    catch(error){const result=error as {code?:unknown;stdout?:string;stderr?:string};code=typeof result.code==='number'?result.code:-1;stdout=result.stdout??'';stderr=result.stderr??String(error);}
    preflight.push({file,expectedExit,code,stdout,stderr,ok:code===expectedExit});
  }
  await writeFile(join(evidence,'preflight.json'),json(preflight),{flag:'wx'});
  if(preflight.some(row=>!row.ok))throw Error('Original project/absent-plugin preflight failed; evidence retained');
  const toolingNames=['development.ts','development-task.ts','development-grade.ts','development-transport.ts','development-responses-transport.ts','responses-contract.ts','profile.ts','profile-attempt.ts','budget.ts','grading.ts','environment.ts'];
  const tooling=Object.fromEntries(await Promise.all(toolingNames.map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])));
  const source=await exec('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:environment,maxBuffer:64000});
  const manifest={task:developmentTask.id,actor:'installed-compositor-cli',binary,provider:options.provider,providerAccessNote:options.providerAccessNote??'No live execution admitted',tooling,toolingSourceCommit:source.stdout.trim(),
    limits:options.limits,maxSteps,configuredContextWindow:contextWindow,contextCapacity:'Explicit configured capacity, not a discovered model capability',promptSha256:hash(developmentTask.prompt),
    fixtureHashes:Object.fromEntries(Object.entries(fixtures).map(([path,text])=>[path,hash(text)])),preparedAt:new Date().toISOString(),execute:options.execute===true,
    scope:'Known original useful-plugin authoring task. SDK grading, package certification and actual terminal lifecycle are separate. Local services imply no USD estimate; saved profiles reuse only their original persistent lifetime ledger.'};
  await writeFile(join(evidence,'manifest.json'),json(manifest),{flag:'wx'});await writeFile(join(evidence,'task.txt'),developmentTask.prompt,{flag:'wx'});
  if(!options.execute){const report={ok:true,prepared:true,authoringExecuted:false,modelRequests:0,project,manifest:join(evidence,'manifest.json'),preflight};await writeFile(join(output,'report.json'),json(report),{flag:'wx'});return report;}
  let transport:Awaited<ReturnType<typeof createDevelopmentTransport>>|Awaited<ReturnType<typeof import('./development-responses-transport.js')['createDevelopmentResponsesTransport']>>|undefined;
  let session:Awaited<ReturnType<typeof import('./profile.js')['openEvaluationProfile']>>|undefined;
  const controller=new AbortController(),abort=()=>controller.abort(options.signal?.reason??Error('Operator stopped development'));
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)abort();
  let actor:{code:number|null;signal:NodeJS.Signals|null;stopped:boolean}|undefined,failure:string|undefined;
  try{
    if(saved){
      const {openEvaluationProfile}=await import('./profile.js');
      session=await openEvaluationProfile(saved.profile,saved.maxUsd,{existingOnly:true,parentScope});
      await writeFile(join(evidence,'budget-start.json'),json(await session.auditStatus()),{flag:'wx',mode:0o600});
      effectiveOutputTokens=Math.min(effectiveOutputTokens,session.maxOutputTokens);reasoningEffort=session.reasoningEffort;
      const {createDevelopmentResponsesTransport}=await import('./development-responses-transport.js');
      transport=await createDevelopmentResponsesTransport({session,limits:options.limits,output:join(evidence,'transport'),signal:controller.signal});
    }else transport=await createDevelopmentTransport({provider:options.provider as DevelopmentProvider,limits:options.limits,output:join(evidence,'transport'),signal:controller.signal});
    fixtures['agent-compositor.json']=json(configuration(transport.baseUrl));await writeFile(join(project,'agent-compositor.json'),fixtures['agent-compositor.json']);
    await writeFile(join(evidence,'executed-config.json'),fixtures['agent-compositor.json'],{flag:'wx'});
    await writeFile(join(evidence,'execution-manifest.json'),json({...manifest,configurationSha256:hash(fixtures['agent-compositor.json']),startedAt:new Date().toISOString()}),{flag:'wx'});
    await writeFile(join(evidence,'protected-baseline.json'),json(Object.fromEntries(Object.entries(fixtures).map(([path,text])=>[path,hash(text)]))),{flag:'wx'});
    const gitEnv={...environment,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
    const git=(args:string[])=>exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd:project,env:gitEnv,maxBuffer:4000000,timeout:30000});
    await git(['init','-q']);await git(['add','--','.']);await git(['-c','user.name=Development fixture','-c','user.email=fixture@example.invalid','commit','-q','--no-gpg-sign','-m','Frozen development baseline']);
    const initial=await developmentInventory(project,['.git','.agent-compositor']);await writeFile(join(evidence,'baseline-files.json'),json(initial),{flag:'wx'});
    const version=await exec(binary.path,['--version'],{env:environment,timeout:10000,maxBuffer:64000});
    if(!/^compositor \d+\.\d+\.\d+/u.test(version.stdout.trim()))throw Error('The selected executable is not the Compositor CLI');
    const argv=['--cwd',project,'--model',options.provider.model,'--max-steps',String(maxSteps),'-p',developmentTask.prompt,'--output-format','stream-json'];
    await writeFile(join(evidence,'launch.json'),json({binary:binary.path,argv,environment:'evaluationEnvironment; isolated HOME/AGENT_HOME; only explicit local gate model URL; no inherited credentials/proxy/preload values'}),{flag:'wx'});
    controller.signal.throwIfAborted();
    const child=spawn(binary.path,argv,{cwd:project,env:{...environment,AGENT_HOME:join(home,'.agent-compositor'),AGENT_MODEL:options.provider.model,AGENT_BASE_URL:transport.baseUrl,AGENT_API_KEY:'development-local'},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    const stdout=createWriteStream(join(evidence,'trajectory.jsonl'),{flags:'wx',mode:0o600}),stderr=createWriteStream(join(evidence,'stderr.txt'),{flags:'wx',mode:0o600});
    let logBytes=0,stopped=false,killTimer:ReturnType<typeof setTimeout>|undefined;
    const kill=(signal:NodeJS.Signals)=>{try{if(child.pid)process.kill(process.platform==='win32'?child.pid:-child.pid,signal);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')failure??='Owned actor cleanup failed: '+String(error);}};
    const stop=()=>{if(stopped)return;stopped=true;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),2000);killTimer.unref();};
    controller.signal.addEventListener('abort',stop,{once:true});
    if(controller.signal.aborted)stop();
    const evidenceError=(error:Error)=>{failure='Actor evidence write failed: '+String(error);controller.abort(error);};stdout.on('error',evidenceError);stderr.on('error',evidenceError);
    const timer=setTimeout(()=>{failure='Development wall-clock deadline reached';controller.abort(Error(failure));},options.limits.deadlineMs);timer.unref();
    const pipe=(data:Buffer,stream:typeof stdout)=>{logBytes+=data.length;if(logBytes>32000000){failure='Actor log byte cap exceeded';controller.abort(Error(failure));return;}stream.write(data);};
    child.stdout!.on('data',data=>pipe(data,stdout));child.stderr!.on('data',data=>pipe(data,stderr));
    try{
      const exited=new Promise<typeof actor>((resolveActor,rejectActor)=>{child.once('error',rejectActor);child.once('close',(code,signal)=>resolveActor({code,signal,stopped}));});
      void exited.catch(()=>{});
      try{await writeFile(join(evidence,'actor-start.json'),json({pid:child.pid,startedAt:new Date().toISOString()}),{flag:'wx'});}
      catch(error){evidenceError(error as Error);await exited;throw error;}
      actor=await exited;
    }
    finally{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);controller.signal.removeEventListener('abort',stop);await Promise.all([new Promise<void>(resolveStream=>stdout.end(resolveStream)),new Promise<void>(resolveStream=>stderr.end(resolveStream))]);}
    await writeFile(join(evidence,'actor-exit.json'),json({...actor,observedAt:new Date().toISOString()}),{flag:'wx'});
    if(!actor?.stopped&&!controller.signal.aborted&&'finish' in transport)await transport.finish();
    else await transport.close();
    if(session)await writeFile(join(evidence,'budget-end.json'),json(await session.auditStatus()),{flag:'wx',mode:0o600});
    await git(['add','-N','--','.']);const patch=await git(['diff','--binary','--no-ext-diff']);await writeFile(join(evidence,'authored.patch'),patch.stdout,{flag:'wx'});
    const final=await developmentInventory(project,['.git','.agent-compositor']);
    const changed=[...new Set([...initial,...final].map(row=>row.path))].filter(path=>{
      const before=initial.find(row=>row.path===path),after=final.find(row=>row.path===path);return before?.sha256!==after?.sha256||before?.mode!==after?.mode;
    }).sort();
    const outOfScope=changed.filter(path=>!path.startsWith('plugins/project-checks/'));
    await writeFile(join(evidence,'final-files.json'),json(final),{flag:'wx'});
    const events=(await readFile(join(evidence,'trajectory.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const grade=await gradeDevelopmentPlugin({project,home,output:join(evidence,'independent-grade'),fixtures,events},{signal:controller.signal});
    const candidate=await developmentInventory(join(project,'plugins','project-checks'));
    const finalBinary=await inspectDevelopmentBinary(options.binary,options.binarySha256);
    if(finalBinary.renderer.sha256!==binary.renderer.sha256)throw Error('Installed renderer changed during development');
    for(const name of toolingNames)if(hash(await readFile(new URL(name,import.meta.url)))!==tooling[name])throw Error('Evaluator source changed during development: '+name);
    await exec('tar',['-czf',join(evidence,'authored-plugin.tar.gz'),'-C',project,'plugins/project-checks'],{env:environment,timeout:30000,maxBuffer:64000});
    if(actor?.stopped)failure??=String(controller.signal.reason??'Owned actor stopped');
    const accounting=transport.snapshot(),ok=actor?.code===0&&!actor.stopped&&!failure&&!accounting.halted&&outOfScope.length===0&&grade.ok;
    const report={ok,prepared:true,authoringExecuted:true,actor,error:failure,task:developmentTask.id,project,changed,outOfScope,grade,transport:accounting,
      candidate:{files:candidate,contentDigest:developmentContentDigest(candidate),archive:'evidence/authored-plugin.tar.gz',archiveSha256:hash(await readFile(join(evidence,'authored-plugin.tar.gz')))},
      scope:'Installed CLI authoring plus independent SDK behavior. No public release, packaged lifecycle, physical terminal or broad1.0 claim.'};
    await writeFile(join(output,'report.json'),json(report),{flag:'wx'});return report;
  }catch(error){
    failure??=session?session.sanitizeError(error):saved?'Saved profile initialization or preparation failed':String(error);
    try{await transport?.close();}catch(cleanup){failure+='; transport cleanup failed: '+(session?session.sanitizeError(cleanup):saved?'Saved profile cleanup failed':String(cleanup));}
    if(session)try{await writeFile(join(evidence,'budget-end.json'),json(await session.auditStatus()),{flag:'wx',mode:0o600});}
    catch(audit){if((audit as NodeJS.ErrnoException).code!=='EEXIST')failure+='; final budget audit failed: '+session.sanitizeError(audit);}
    const report={ok:false,prepared:true,authoringExecuted:!!actor,actor,error:failure,project,transport:transport?.snapshot(),scope:'Incomplete attempt; all workspace/log/transport evidence retained'};await writeFile(join(output,'report.json'),json(report),{flag:'wx'});return report;
  }
  finally{options.signal?.removeEventListener('abort',abort);await transport?.close();}
}

export async function developmentOptions(args:string[]):Promise<DevelopmentOptions>{
  const values=new Map<string,string>(),flags=new Set(['--run','--prepare']);
  const allowed=new Set(['--binary','--binary-sha256','--output','--provider','--base-url','--model','--profile','--max-usd','--run','--prepare','--provider-access-note','--limits']);
  for(let i=0;i<args.length;i++){
    const key=args[i];if(!allowed.has(key))throw Error('Unknown development option: '+key);if(values.has(key))throw Error('Duplicate development option: '+key);
    if(flags.has(key)){values.set(key,'true');continue;}
    const value=args[++i];if(!value||value.startsWith('--'))throw Error('Missing '+key);values.set(key,value);
  }
  const get=(name:string)=>{const value=values.get(name);if(!value)throw Error('Missing '+name);return value;};
  if(args.includes('--run')===args.includes('--prepare'))throw Error('Choose exactly --prepare or --run');
  const kind=get('--provider');let provider:DevelopmentOptions['provider'];
  if(kind==='saved-openai-profile'){
    if(values.has('--base-url'))throw Error('Saved profiles do not accept --base-url');
    provider={kind,profile:get('--profile'),model:get('--model') as 'gpt-6.1-sol',maxUsd:Number(get('--max-usd'))};
  }else{
    if(values.has('--profile')||values.has('--max-usd'))throw Error('Local providers do not accept saved-profile budget flags');
    provider={kind:kind as DevelopmentProvider['kind'],baseUrl:get('--base-url'),model:get('--model')};
  }
  validateDevelopmentSource(provider);
  const limits=values.has('--limits')?JSON.parse(await readFile(get('--limits'),'utf8')):developmentLimits;validateDevelopmentLimits(limits);
  return{binary:get('--binary'),binarySha256:get('--binary-sha256'),output:get('--output'),provider,limits,execute:values.has('--run'),providerAccessNote:values.get('--provider-access-note')};
}

if(import.meta.main){
  const options=await developmentOptions(process.argv.slice(2));
  const stop=new AbortController(),cancel=()=>stop.abort(Error('Operator stopped development'));process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try{const report=await runDevelopment({...options,signal:stop.signal});console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
  finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
