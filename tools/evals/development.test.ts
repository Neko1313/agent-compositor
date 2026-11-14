import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {stripTypeScriptTypes} from 'node:module';
import {prepareDevelopmentTask,developmentTask} from './development-task.js';
import {developmentInventory,developmentContentDigest,gradeDevelopmentPlugin} from './development-grade.js';
import {runDevelopment,developmentLimits,inspectDevelopmentBinary} from './development.js';
import {buildApp} from '../../packages/app/src/build.js';
import {evaluationEnvironment,evaluationEnvironmentOverlay} from './environment.js';

const roots:string[]=[];afterEach(async()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function root(){const path=await mkdtemp(join(tmpdir(),'development-test-'));roots.push(path);return path;}
async function fixture(){const base=await root(),project=join(base,'project'),home=join(base,'home');await mkdir(project);await mkdir(home);return{base,project,home,fixtures:await prepareDevelopmentTask(project)};}
async function reference(project:string){
  const target=join(project,'plugins','project-checks'),source=new URL('../../plugins/project-checks/',import.meta.url);
  // The trusted reference is installed only by this test, outside any authoring
  // run. prepareDevelopmentTask never reads or copies it.
  for(const file of ['tools','hooks','settings'])await writeFile(join(target,file+'.js'),stripTypeScriptTypes(await readFile(new URL(file+'.ts',source),'utf8')));
  const manifest=JSON.parse(await readFile(new URL('plugin.json',source),'utf8'));manifest.main='hooks.js';manifest.version='0.1.0';await writeFile(join(target,'plugin.json'),JSON.stringify(manifest));
  for(const file of ['README.md','CHANGELOG.md','plugin.test.json'])await writeFile(join(target,file),await readFile(new URL(file,source)));
}
async function verifiedEvents(f:Awaited<ReturnType<typeof fixture>>){
  const events:any[]=[],app=await buildApp({cwd:f.project,env:{HOME:f.home},agentHub:false,provider:{name:'no-model-verification',async *complete(){throw Error('No model permitted');}},fixedConfig:{enabledPlugins:[],agent:{tools:['exec'],builtinTools:['exec'],skills:false,projectContext:false,fileReferences:false},permissions:{rules:[{tool:'exec',command:'node checks.mjs',decision:'allow'}]},compaction:{enabled:false}}});
  try{const core=app.createCore(async()=>false);core.subscribe(event=>events.push(event));core.host.registerPlugin({name:'verification-env',version:'1.0.0',trust:'trusted'},{'service.shell.exec':(event,$)=>$.next({...event,env:{...event.env,...evaluationEnvironmentOverlay(f.home,f.base)}})});expect((await core.invokeTool('exec',{command:'node checks.mjs'})).ok).toBe(true);return events;}
  finally{await app.close();}
}
it('prepares only the blank useful-plugin contract and rejects absent behavior without a model',async()=>{
  const f=await fixture(),files=await developmentInventory(f.project);
  expect(files.some(row=>row.path.startsWith('plugins/project-checks/'))).toBe(false);
  expect(files.some(row=>/grader|reference|solution/i.test(row.path))).toBe(false);
  const actual=await promisify(execFile)(process.execPath,['project-checks.mjs'],{cwd:f.project,env:evaluationEnvironment(f.home,f.base)});expect(actual.stdout).toContain('ORIGINAL_PROJECT_CHECKS_PASSED');
  const bad=await gradeDevelopmentPlugin({...f,output:join(f.base,'grade'),events:[]});expect(bad.ok).toBe(false);expect(bad.modelRequests).toBe(0);
  expect(await readFile(join(f.project,'user-draft.md'),'utf8')).toBe(developmentTask.files['user-draft.md']);
});
it('independently grades a useful reference, actual SDK npm effects and owned cancellation with zero model calls',async()=>{
  vi.stubEnv('DEVELOPMENT_PARENT_SENTINEL','must-not-reach-sdk-process');
  const f=await fixture();await reference(f.project);const events=await verifiedEvents(f);
  const result=await gradeDevelopmentPlugin({...f,output:join(f.base,'grade'),events});
  expect(result.checks.filter(check=>!check.ok)).toEqual([]);expect(result.ok).toBe(true);expect(result.modelRequests).toBe(0);
  expect(result.checks).toEqual(expect.arrayContaining([{name:'actual SDK npm execution',ok:true},{name:'cancel settles/reaps its actual worker',ok:true},{name:'close preserves unrelated SDK worker',ok:true}]));
  expect(result.receipts.some(row=>(row as any).phase==='actual SDK-owned npm process')).toBe(true);
},15000);
it('rejects a plausible always-success plugin and never treats public checks as sufficient',async()=>{
  const f=await fixture();await reference(f.project);
  await writeFile(join(f.project,'plugins/project-checks/tools.js'),"export default [{name:'project_check',description:'A structurally valid but dishonest plugin',describe:a=>a.action==='list'?{tool:'project_check',readOnly:true}:{tool:'project_check',readOnly:false,command:['npm','run','--',a.name]},parameters:{type:'object',properties:{action:{type:'string',enum:['list','run']},name:{type:'string'}},required:['action'],additionalProperties:false},execute:async()=>({ok:true,data:{scripts:[],stdout:'FAKE_PASS',stderr:'',exitCode:0,truncated:false}})}];\n");
  const events=await verifiedEvents(f),result=await gradeDevelopmentPlugin({...f,output:join(f.base,'grade'),events});
  expect(result.ok).toBe(false);expect(result.checks).toContainEqual({name:'actual SDK npm execution',ok:false});expect(result.modelRequests).toBe(0);
},15000);
it('binds agent verification to exact final candidate bytes and ignores only host metadata in project inventories',async()=>{
  const f=await fixture();await reference(f.project);const events=await verifiedEvents(f);
  const before=developmentContentDigest(await developmentInventory(join(f.project,'plugins/project-checks')));
  await writeFile(join(f.project,'plugins/project-checks/new-test.mjs'),'// added after verification\n');
  const after=developmentContentDigest(await developmentInventory(join(f.project,'plugins/project-checks')));expect(after).not.toBe(before);
  await mkdir(join(f.project,'.git'));await writeFile(join(f.project,'.git','index'),'host metadata');await mkdir(join(f.project,'.agent-compositor'));await writeFile(join(f.project,'.agent-compositor','session.json'),'runtime metadata');
  const inventory=await developmentInventory(f.project,['.git','.agent-compositor']);expect(inventory.some(row=>row.path.startsWith('.git/')||row.path.startsWith('.agent-compositor/'))).toBe(false);
  const result=await gradeDevelopmentPlugin({...f,output:join(f.base,'grade'),events});expect(result.ok).toBe(false);expect(result.checks).toContainEqual({name:'agent executed verification successfully',ok:false});
},15000);
it('requires a pinned native package and prepares retained artifacts without starting a transport or actor',async()=>{
  const base=await root(),bundle=join(base,'bundle');await mkdir(join(bundle,'node_modules','@agent-compositor','renderer-opentui'),{recursive:true});
  const binary=join(bundle,'compositor'),bytes=Buffer.from('\x7fELFsynthetic-preparation-fixture');await writeFile(binary,bytes,{mode:0o755});await writeFile(join(bundle,'VERSION'),'v0.8.0');await writeFile(join(bundle,'node_modules','@agent-compositor','renderer-opentui','index.js'),'// fixture');
  const binarySha256=createHash('sha256').update(bytes).digest('hex'),output=join(base,'attempt');
  const report=await runDevelopment({binary,binarySha256,output,provider:{kind:'ollama',baseUrl:'http://127.0.0.1:1/v1',model:'no-inference'},limits:developmentLimits});
  expect(report).toMatchObject({ok:true,prepared:true,authoringExecuted:false,modelRequests:0});
  expect(JSON.parse(await readFile(join(output,'evidence','manifest.json'),'utf8')).actor).toBe('installed-compositor-cli');
  await expect(runDevelopment({binary,binarySha256,output,provider:{kind:'ollama',baseUrl:'http://127.0.0.1:1/v1',model:'no-inference'},limits:developmentLimits})).rejects.toThrow();
  await expect(inspectDevelopmentBinary(binary,'0'.repeat(64))).rejects.toThrow('identity');
  await expect(runDevelopment({binary,binarySha256,output:join(base,'live'),provider:{kind:'ollama',baseUrl:'http://127.0.0.1:1/v1',model:'no-inference'},limits:developmentLimits,execute:true})).rejects.toThrow('provider-access');
});

it.each(['deadline','operator abort','unabortable Cancel'] as const)('gracefully closes real SDK workers on grader %s without touching an external neighbor',async mode=>{
  const f=await fixture();await reference(f.project);
  const output=join(f.base,'grade'),held=join(f.base,'held.json'),hook=join(f.project,'plugins/project-checks/hooks.js');
  const original=(await readFile(hook,'utf8')).replace('export default {','const originalHooks = {');
  await writeFile(hook,original+`\nimport {writeFile as checkpoint} from 'node:fs/promises';
export default {...originalHooks,'ui.press':async function(event,$){
  if(event.site==='plugin-project-checks-main'&&event.key==='cancel'){
    await checkpoint(${JSON.stringify(held)},JSON.stringify({pid:process.pid,key:event.key}));
    ${mode==='unabortable Cancel'?'await new Promise(()=>{});':'return;'} // The SDK process remains owned even when Cancel forgets or never settles.
  }
  return originalHooks['ui.press'].call(this,event,$);
}};\n`);
  const external=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const externalExit=new Promise<void>(done=>external.once('close',()=>done()));
  await new Promise<void>((done,fail)=>{external.once('spawn',done);external.once('error',fail);});
  const alive=(pid:number)=>{try{process.kill(pid,0);return pid>0;}catch{return false;}};
  const pid=async(name:string)=>Number(await readFile(join(output,'caller',name+'.pid'),'utf8').catch(()=>''));
  const until=async(read:()=>Promise<boolean>|boolean)=>{const end=Date.now()+8000;while(Date.now()<end){if(await read())return;await new Promise(done=>setTimeout(done,10));}throw Error('Actual SDK worker/cleanup checkpoint not reached');};
  const group=async(value:number)=>Number((await promisify(execFile)('ps',['-p',String(value),'-o','pgid='])).stdout.trim());
  const groupAlive=(value:number)=>{try{process.kill(-value,0);return value>0;}catch{return false;}};
  const abort=new AbortController();let worker=0,neighbor=0,workerGroup=0,neighborGroup=0;
  try{
    const pending=gradeDevelopmentPlugin({...f,output,events:[]},{deadlineMs:mode==='deadline'?5000:15000,shutdownGraceMs:3000,signal:abort.signal});
    void pending.catch(()=>{});
    await until(async()=>!!await readFile(held,'utf8').catch(()=>''));
    const receipt=JSON.parse(await readFile(held,'utf8')) as {pid:number;key:string};
    worker=await pid('slow');neighbor=await pid('neighbor');
    workerGroup=await group(worker);neighborGroup=await group(neighbor);
    expect(receipt.key).toBe('cancel');expect(worker).toBeGreaterThan(0);expect(neighbor).toBeGreaterThan(0);
    expect(alive(worker)).toBe(true);expect(alive(neighbor)).toBe(true);expect(alive(external.pid!)).toBe(true);
    expect(workerGroup).toBeGreaterThan(1);expect(neighborGroup).toBeGreaterThan(1);expect(groupAlive(workerGroup)).toBe(true);expect(groupAlive(neighborGroup)).toBe(true);
    if(mode!=='deadline')abort.abort(Error('Test operator stop after actual owned-worker receipts'));
    const result=await pending;
    expect(result.ok).toBe(false);expect(result.modelRequests).toBe(0);
    expect(result.runner).toMatchObject({pid:receipt.pid,exitCode:1,forced:false,stopReason:mode==='deadline'?'SDK grader deadline reached':'Operator aborted SDK grading'});
    expect(JSON.parse(await readFile(join(output,'result.json'),'utf8')).cleanup).toEqual({applicationClosed:true,signal:'SIGTERM'});
    await until(()=>!alive(worker)&&!alive(neighbor)&&!groupAlive(workerGroup)&&!groupAlive(neighborGroup));
    expect(alive(receipt.pid)).toBe(false);expect(alive(external.pid!)).toBe(true);
  }finally{
    abort.abort();
    // Regression failures still clean only the PID-tagged owned workers.
    for(const owned of [workerGroup,neighborGroup])if(owned>1&&groupAlive(owned))try{process.kill(-owned,'SIGKILL');}catch{}
    external.kill('SIGTERM');await externalExit;
  }
},20000);
