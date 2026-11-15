import {mkdir,readFile,readdir,lstat,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {gradeProject,type EvalCheck} from './grading.js';
import {developmentTask} from './development-task.js';
import {buildApp} from '../../packages/app/src/build.js';
import {evaluationEnvironment,evaluationEnvironmentOverlay} from './environment.js';

export interface DevelopmentFile {path:string;sha256:string;bytes:number;mode:number}
export async function developmentInventory(root:string,ignoreRoot:readonly string[]=[]):Promise<DevelopmentFile[]> {
  const rows:DevelopmentFile[]=[];
  async function visit(directory:string){
    for(const name of (await readdir(directory)).sort()){
      if(directory===root&&ignoreRoot.includes(name))continue;
      const path=join(directory,name),info=await lstat(path);
      if(info.isSymbolicLink())throw Error('Retained artifacts cannot contain symlinks: '+relative(root,path));
      if(info.isDirectory())await visit(path);
      else if(info.isFile()){
        if(info.size>2_000_000||rows.length>=512||rows.reduce((sum,row)=>sum+row.bytes,0)+info.size>16_000_000)throw Error('Authored artifact exceeds its declared file/byte envelope');
        const bytes=await readFile(path);rows.push({path:relative(root,path).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,mode:info.mode&0o777});
      }
      else throw Error('Unsupported retained artifact: '+path);
    }
  }
  await visit(root);return rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export const developmentContentDigest=(rows:DevelopmentFile[])=>createHash('sha256').update(JSON.stringify(rows.map(({path,sha256})=>({path,sha256})))).digest('hex');

/** Independent backend rubric. The authoring actor is the installed executable;
 * this SDK host has a rejecting provider and never borrows the actor's model. */
type DevelopmentGradeInput={project:string;home:string;output:string;fixtures:Record<string,string>;events:any[]};
type GradeLifetime={signal:AbortSignal;own(app:Awaited<ReturnType<typeof buildApp>>):void};
async function gradeInProcess(input:DevelopmentGradeInput,lifetime?:GradeLifetime) {
  lifetime?.signal.throwIfAborted();
  await mkdir(input.output,{recursive:true});
  const checks:EvalCheck[]=[],receipts:unknown[]=[],callerEvents:unknown[]=[],plugin=join(input.project,'plugins',developmentTask.plugin);
  let modelRequests=0,app:Awaited<ReturnType<typeof buildApp>>|undefined;
  const check=(name:string,ok:boolean,detail?:string)=>{lifetime?.signal.throwIfAborted();checks.push({name,ok,...(detail?{detail}:{} )});};
  try{
    const rows=await developmentInventory(plugin),digest=developmentContentDigest(rows);
    checks.push(...await gradeProject({cwd:input.project,home:input.home,temp:input.output,fixtures:input.fixtures,events:input.events,
      expect:{preserve:Object.keys(input.fixtures),originalChecks:['checks.mjs','project-checks.mjs'],verification:developmentTask.marker+':'+digest,verificationCommands:[...developmentTask.commands]}}));
    lifetime?.signal.throwIfAborted();
    for(const file of ['plugin.json','tools.js','hooks.js','README.md','CHANGELOG.md','plugin.test.json'])check('delivered '+file,rows.some(row=>row.path===file));
    const caller=join(input.output,'caller'),home=join(input.output,'caller-home');await mkdir(caller,{recursive:true});await mkdir(home,{recursive:true});
    // Every caller fixture and private rubric remains outside the actor workspace.
    await writeFile(join(caller,'package.json'),JSON.stringify({scripts:{check:'node check.mjs',fail:'node fail.mjs',slow:'node slow.mjs',neighbor:'node neighbor.mjs'}}));
    await writeFile(join(caller,'check.mjs'),"if(process.env.DEVELOPMENT_PARENT_SENTINEL)throw Error('Parent environment leaked');console.log('REAL_SDK_NPM_CHECK');\n");
    await writeFile(join(caller,'fail.mjs'),"console.error('REAL_SDK_NPM_FAILURE');process.exit(7);\n");
    for(const name of ['slow','neighbor'])await writeFile(join(caller,name+'.mjs'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(caller,name+'.pid'))},String(process.pid));setInterval(()=>{},1000);\n`);
    const manifest=JSON.parse(await readFile(join(plugin,'plugin.json'),'utf8'));
    check('public command route',manifest.name==='project-checks'&&manifest.main==='hooks.js'&&manifest.commands?.some((entry:any)=>entry.name==='/checks'&&entry.ui?.site==='main'));
    app=await buildApp({cwd:caller,env:{HOME:home},provider:{name:'development-grader-no-model',async *complete(){modelRequests++;throw Error('The independent plugin grader never admits model requests');}},
      agentHub:false,pluginDirs:[plugin],fixedConfig:{enabledPlugins:['project-checks'],agent:{tools:['project_check'],builtinTools:[],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},
      permissions:{rules:[{tool:'project_check',decision:'allow'}]},compaction:{enabled:false}}});
    lifetime?.own(app);lifetime?.signal.throwIfAborted();
    const loaded=app.pluginErrors.length===0&&app.plugins.some(entry=>entry.manifest.name==='project-checks');
    check('candidate loaded through normal loader',loaded,loaded?undefined:JSON.stringify(app.pluginErrors));
    if(!loaded)throw Error('Candidate plugin did not load; independent grader will not submit a model prompt');
    const core=app.createCore(async()=>false);await core.start();
    core.host.registerPlugin({name:'development-exec-environment',version:'1.0.0',trust:'trusted'},{'service.shell.exec':(event,$)=>$.next({...event,env:{...event.env,...evaluationEnvironmentOverlay(home,input.output)}})});
    const views:unknown[]=[],timeline:{event:string;input:Record<string,unknown>}[]=[];
    core.subscribe(event=>{if(event.kind!=='catalog')return;if(['tool.call','tool.check','tool.result'].includes(event.event))callerEvents.push(event);if(event.event==='ui.surface')views.push(event.input);if(['ui.surface','ui.surfaceRemoved'].includes(event.event))timeline.push({event:event.event,input:event.input});});
    let executions=0,lastExec:any,result={stdout:'CHECK_RESULT',stderr:'',exitCode:0};
    core.host.registerPlugin({name:'development-exec-observer',version:'1.0.0',trust:'trusted'},{'service.exec.run':event=>{executions++;lastExec=event;return{value:result};}});
    let phase='controlled service-result metadata';
    const invoke=async(args:unknown)=>{lifetime?.signal.throwIfAborted();const value=await core.invokeTool('project_check',args);lifetime?.signal.throwIfAborted();receipts.push({phase,args,result:value});return value;};
    const list=await invoke({action:'list'});check('on-demand script list without effects',list.ok&&Array.isArray((list.output as any)?.scripts)&&(list.output as any).scripts.some((row:any)=>row.name==='check')&&executions===0);
    for(const args of [{action:'list',extra:true},{action:'run',name:'missing'},{action:'run',name:'check; injected'},{action:'run',name:7},{action:'other'}])check('reject malformed call '+JSON.stringify(args),!(await invoke(args)).ok&&executions===0);
    core.host.registerPlugin({name:'development-policy-denial',version:'1.0.0',trust:'trusted'},{'tool.check':event=>event.tool==='project_check'?{decision:'deny',reason:'Independent grader refusal'}:undefined});
    check('SDK policy refusal precedes execution',!(await invoke({action:'run',name:'check'})).ok&&executions===0);core.host.unregisterPlugin('development-policy-denial');
    await app.storage.configure('project-checks.json',{maxChars:1000,timeoutMs:700});result={stdout:'x'.repeat(1600),stderr:'diagnostic',exitCode:0};
    const run=await invoke({action:'run',name:'check'}),data=run.output as any;
    check('fixed SDK-owned npm command and scoped limits',run.ok&&lastExec?.plugin==='project-checks'&&lastExec.cmd==='npm'&&JSON.stringify(lastExec.args)==='["run","--","check"]'&&lastExec.timeoutMs===700);
    check('truthful combined-output truncation',data?.exitCode===0&&data.truncated===true&&typeof data.stdout==='string'&&typeof data.stderr==='string'&&data.stdout.length+data.stderr.length<=1000);
    result={stdout:'partial',stderr:'REAL_FAILURE_DETAIL',exitCode:7};const failed=await invoke({action:'run',name:'fail'});
    check('nonzero check remains failure',!failed.ok&&String(failed.error).includes('7')&&String(failed.error).includes('REAL_FAILURE_DETAIL'));
    await app.storage.configure('project-checks.json',{timeoutMs:0});check('invalid settings reject effects',!(await invoke({action:'run',name:'check'})).ok);
    await app.storage.configure('project-checks.json',{maxChars:1000,timeoutMs:700});
    const unrelated=await core.host.emit('prompt.submit',{text:'/checks-other'});check('unrelated prompt passes through',!(unrelated.value as any)?.drop);
    await core.submit('/checks');check('command opens without model',JSON.stringify(views.at(-1)).includes('Project checks')&&modelRequests===0);
    await core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'refresh'});check('refresh reaches the guarded tool',JSON.stringify(views.at(-1)).includes('Run check'));
    result={stdout:'ACTUAL_PANEL_RESULT',stderr:'',exitCode:0};await core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'run:check'});check('panel displays guarded caller result',JSON.stringify(views.at(-1)).includes('ACTUAL_PANEL_RESULT'));
    let forms=0;core.setHumanFormHandler(async()=>{forms++;return{action:'save',values:{maxChars:'1100',timeoutMs:'900',scope:'project'}};});
    await core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'configure'});const settings=await app.storage.config('project-checks.json');
    check('private configuration persists scoped values',forms===1&&settings.maxChars===1100&&settings.timeoutMs===900);
    core.host.unregisterPlugin('development-exec-observer');phase='actual SDK-owned npm process';
    const actual=await invoke({action:'run',name:'check'}),actualOk=actual.ok&&(actual.output as any)?.exitCode===0&&String((actual.output as any)?.stdout).includes('REAL_SDK_NPM_CHECK');
    check('actual SDK npm execution',actualOk,actualOk?undefined:JSON.stringify(actual).slice(0,4096));
    const actualFailure=await invoke({action:'run',name:'fail'});check('actual npm exit7 remains failure',!actualFailure.ok&&String(actualFailure.error).includes('7')&&String(actualFailure.error).includes('REAL_SDK_NPM_FAILURE'));
    await app.storage.configure('project-checks.json',{maxChars:1100,timeoutMs:10000});
    const until=async(read:()=>Promise<boolean>|boolean,required=true)=>{for(let i=0;i<300;i++){lifetime?.signal.throwIfAborted();if(await read())return true;await new Promise(resolve=>setTimeout(resolve,10));}if(required)throw Error('Independent process checkpoint not reached');return false;};
    const pid=async(name:string)=>Number(await readFile(join(caller,name+'.pid'),'utf8').catch(()=>''));
    const alive=(value:number)=>{try{process.kill(value,0);return value>0;}catch{return false;}};
    const neighborController=new AbortController();
    const neighbor=core.invokeUserTool('project_check',{action:'run',name:'neighbor'},{owner:'project-checks',signal:neighborController.signal});
    void neighbor.catch(()=>{});
    try{
      await until(async()=>await pid('neighbor')>0);
      for(const action of ['cancel','close']){
        await core.submit('/checks');await core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'refresh'});
        const work=core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'run:slow'});void work.catch(()=>{});
        await until(async()=>await pid('slow')>0);const worker=await pid('slow');
        const before=timeline.length;await core.host.emit('ui.press',{site:'plugin-project-checks-main',key:action});await work;
        await until(()=>!alive(worker));check(action+' settles/reaps its actual worker',!alive(worker));
        check(action+' preserves unrelated SDK worker',alive(await pid('neighbor')));
        await new Promise<void>(resolve=>setImmediate(resolve));
        if(action==='close'){
          const events=timeline.slice(before),removed=events.findIndex(event=>event.event==='ui.surfaceRemoved'&&event.input.id==='plugin-project-checks-main');
          check('close prevents late settlement from reopening',removed>=0&&!events.slice(removed+1).some(event=>event.event==='ui.surface'&&event.input.id==='plugin-project-checks-main'));
        }
        const {rm}=await import('node:fs/promises');await rm(join(caller,'slow.pid'),{force:true});
      }
    }finally{neighborController.abort();await neighbor;}
    // The npm child can briefly remain as an exited zombie until its parent
    // reaps it. Require the same bounded disappearance used for slow workers.
    await until(async()=>!alive(await pid('neighbor')),false);
    const neighborPid=await pid('neighbor'),neighborAlive=alive(neighborPid);
    const stat=neighborAlive&&process.platform==='linux'?await readFile(`/proc/${neighborPid}/stat`,'utf8').catch(()=>undefined):undefined;
    const state=stat?.match(/^\d+ \(.*\) ([A-Z]) /)?.[1];
    check('neighbor cancellation also reaps its worker',!neighborAlive,neighborAlive?`PID ${neighborPid} remains observable after operation settlement${state?`; Linux process state ${state}`:''}`:undefined);
  }catch(error){lifetime?.signal.throwIfAborted();check('candidate grading completed',false,String(error));}
  finally{await app?.close(lifetime?.signal);}
  check('independent SDK grader uses zero model requests',modelRequests===0);
  return{ok:checks.length>0&&checks.every(check=>check.ok),checks,receipts,callerEvents,modelRequests,networkModelRequests:0,
    scope:'Independent source-SDK plugin behavior grader; installed binary owns authoring. No package certification, physical terminal or complete lifecycle claim.'};
}

/** SDK-owned processes inherit this child's physically sanitized environment;
 * an env field on an unrelated shell event cannot sanitize service.exec.run. */
export interface DevelopmentGradeControl {deadlineMs?:number;shutdownGraceMs?:number;signal?:AbortSignal}
export async function gradeDevelopmentPlugin(input:DevelopmentGradeInput,control:DevelopmentGradeControl={}) {
  const deadlineMs=control.deadlineMs??45000,shutdownGraceMs=control.shutdownGraceMs??2000;
  if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>45000||!Number.isSafeInteger(shutdownGraceMs)||shutdownGraceMs<1||shutdownGraceMs>10000)throw Error('Invalid SDK grader deadline/grace envelope');
  control.signal?.throwIfAborted();
  await mkdir(input.output,{recursive:true});
  const job=join(input.output,'private-job.json'),resultPath=join(input.output,'result.json');
  await writeFile(job,JSON.stringify(input),{flag:'wx',mode:0o600});
  const script=fileURLToPath(import.meta.url),args=process.versions.bun?[script,'--private-development-grade',job]:['--import',import.meta.resolve('tsx'),script,'--private-development-grade',job];
  let code=0,stdout='',stderr='',stopReason:string|undefined,forced=false,exitSignal:NodeJS.Signals|null=null,grace:ReturnType<typeof setTimeout>|undefined,graderPid:number|undefined;
  await new Promise<void>(done=>{
    const child=execFile(process.execPath,args,{env:evaluationEnvironment(input.home,input.output),maxBuffer:1000000},(error,out,err)=>{
      stdout=out;stderr=err;
      if(error){code=typeof error.code==='number'?error.code:-1;exitSignal=error.signal??null;}
      clearTimeout(deadline);if(grace)clearTimeout(grace);control.signal?.removeEventListener('abort',abort);done();
    });
    graderPid=child.pid;
    const stop=(reason:string)=>{if(stopReason)return;stopReason=reason;child.kill('SIGTERM');grace=setTimeout(()=>{forced=true;child.kill('SIGKILL');},shutdownGraceMs);};
    const abort=()=>stop('Operator aborted SDK grading');
    const deadline=setTimeout(()=>stop('SDK grader deadline reached'),deadlineMs);
    control.signal?.addEventListener('abort',abort,{once:true});if(control.signal?.aborted)abort();
  });
  await writeFile(join(input.output,'sdk-stdout.txt'),stdout,{flag:'wx'});await writeFile(join(input.output,'sdk-stderr.txt'),stderr,{flag:'wx'});
  let result:Awaited<ReturnType<typeof gradeInProcess>>;
  try{result=JSON.parse(await readFile(resultPath,'utf8'));}
  catch(error){result={ok:false,checks:[{name:'SDK grader returned a complete result',ok:false,detail:String(error)}],receipts:[],callerEvents:[],modelRequests:0,networkModelRequests:0,scope:'Incomplete private grader; no behavior or process-cleanup pass is established'};}
  return{...result,ok:result.ok&&code===0&&!stopReason,runner:{pid:graderPid,exitCode:code,signal:exitSignal,stopReason,forced,deadlineMs,shutdownGraceMs,
    environment:'Separate evaluationEnvironment child; no inherited credentials/proxies/preloads',
    cleanupLimit:'SIGTERM requests awaited application cleanup; SIGKILL fallback cannot guarantee detached-worker cleanup'}};
}

if(process.argv[2]==='--private-development-grade'){
  // Only this private process entry owns signal listeners; importing the grader
  // never changes its caller's process-wide signal behavior.
  const controller=new AbortController();let app:Awaited<ReturnType<typeof buildApp>>|undefined,received:NodeJS.Signals|undefined;
  let rejectStop!:(error:unknown)=>void;
  const stopped=new Promise<never>((_resolve,reject)=>{rejectStop=reject;});
  void stopped.catch(()=>{});
  const stop=(signal:NodeJS.Signals)=>{if(received)return;received=signal;controller.abort(Error('SDK grader stopped by '+signal));void Promise.resolve(app?.close(controller.signal)).then(()=>rejectStop(controller.signal.reason),rejectStop);};
  const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  try{
    const input=JSON.parse(await readFile(process.argv[3],'utf8')) as DevelopmentGradeInput;
    let result;
    try{
      result=await Promise.race([gradeInProcess(input,{signal:controller.signal,own(value){app=value;}}),stopped]);
      controller.signal.throwIfAborted();
    }catch(error){
      await app?.close(controller.signal);
      result={ok:false,checks:[{name:'SDK grader completed without interruption',ok:false,detail:String(error)}],receipts:[],callerEvents:[],modelRequests:0,networkModelRequests:0,
        cleanup:{applicationClosed:!!app,signal:received},scope:'Interrupted independent SDK grader; application cleanup was awaited, no behavior pass is claimed'};
    }
    await writeFile(join(input.output,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});if(!result.ok)process.exitCode=1;
  }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);}
}
