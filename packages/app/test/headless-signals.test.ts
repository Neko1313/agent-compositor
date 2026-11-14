import {afterEach,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer,type ServerResponse} from 'node:http';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const entry=fileURLToPath(new URL('../src/bin.ts',import.meta.url));
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error:any){if(error.code==='ESRCH')return false;throw error;}};
const stopped=(child:ChildProcess)=>new Promise<{code:number|null;signal:NodeJS.Signals|null}>((done,fail)=>{
  child.once('error',fail);child.once('close',(code,signal)=>done({code,signal}));
});
function deadline<T>(promise:Promise<T>,milliseconds:number){
  let timer:ReturnType<typeof setTimeout>;
  return Promise.race([promise,new Promise<never>((_done,fail)=>{timer=setTimeout(()=>fail(Error('Actual CLI did not finish within '+milliseconds+'ms')),milliseconds);})]).finally(()=>clearTimeout(timer));
}

async function fixture(mode:'sdk'|'model'|'never'|'cleanup'|'cleanup-never'){
  const cwd=await mkdtemp(join(tmpdir(),'headless-signal-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const directory=join(cwd,'plugins','signal-owner');await mkdir(directory,{recursive:true});
  const worker=(name:string)=>`require('node:fs').writeFileSync(${JSON.stringify(join(cwd,name+'.pid'))},String(process.pid));setInterval(()=>{},1000);`;
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'signal-owner',version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[{name:'/signal-worker',description:'Hold actual owned SDK workers',execution:'immediate'}],
    hookTimeouts:{'command.invoke':300000,'prompt.submit':300000,'session.end':300000}}));
  await writeFile(join(directory,'hooks.js'),`import {existsSync,writeFileSync} from 'node:fs';
${mode==='cleanup'?`process.on('SIGTERM',()=>writeFileSync(${JSON.stringify(join(cwd,'signal-received'))},'SIGTERM'));`:''}
const start=async $=>{void $.background().exec.run(process.execPath,['-e',${JSON.stringify(worker('background'))}],{timeoutMs:60000}).catch(()=>{});
 while(!existsSync(${JSON.stringify(join(cwd,'background.pid'))})){$.signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,5));}};
export default {'command.invoke':async(_,$)=>{await start($);const work=$.exec.run(process.execPath,['-e',${JSON.stringify(worker('foreground'))}],{timeoutMs:60000});void work.catch(()=>{});
 ${mode==='never'?`while(!existsSync(${JSON.stringify(join(cwd,'foreground.pid'))}))await new Promise(resolve=>setTimeout(resolve,5));await new Promise(()=>{});`:'await work;'}},
 'prompt.submit':async(_,$)=>{await start($);}${mode.startsWith('cleanup')?`, 'session.end':async()=>{writeFileSync(${JSON.stringify(join(cwd,'cleanup-entered'))},'entered');${mode==='cleanup-never'?'await new Promise(()=>{});':`while(!existsSync(${JSON.stringify(join(cwd,'cleanup-release'))}))await new Promise(resolve=>setTimeout(resolve,5));`}}`:''}};`);
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['signal-owner'],
    agent:{tools:[],builtinTools:[],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},compaction:{enabled:false}}));
  const responses=new Set<ServerResponse>();let requests=0,connectionClosed=false;
  const server=createServer(async(request,response)=>{
    for await(const _ of request){}requests++;responses.add(response);
    response.on('close',()=>{connectionClosed=true;responses.delete(response);});
    response.writeHead(200,{'content-type':'text/event-stream'});
    response.write('data: '+JSON.stringify({choices:[{delta:{content:'Held current answer'},finish_reason:mode.startsWith('cleanup')?'stop':null}]})+'\n\n');
    if(mode.startsWith('cleanup'))response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  cleanup.push(async()=>{for(const response of responses)response.destroy();await new Promise<void>(done=>server.close(()=>done()));});
  const address=server.address();if(!address||typeof address==='string')throw Error('Expected actual loopback address');
  const neighbor=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}),neighborExit=stopped(neighbor);
  cleanup.push(async()=>{if(neighbor.pid&&alive(neighbor.pid))neighbor.kill('SIGKILL');await neighborExit;});
  const cli=spawn('bun',[entry,'--cwd',cwd,'--prompt',mode==='sdk'||mode==='never'?'/signal-worker':'Hold actual model','--output-format','stream-json'],{
    env:{PATH:process.env.PATH,HOME:cwd,TMPDIR:process.env.TMPDIR??tmpdir(),AGENT_MODEL:'signal-loopback',AGENT_BASE_URL:`http://127.0.0.1:${address.port}/v1`,AGENT_API_KEY:'',AGENT_GRAPHICS:'off'},
    stdio:['ignore','pipe','pipe'],
  }),exit=stopped(cli);
  let stdout='',stderr='';cli.stdout!.on('data',chunk=>{stdout+=chunk;});cli.stderr!.on('data',chunk=>{stderr+=chunk;});
  const pids:number[]=[];
  cleanup.push(async()=>{
    if(cli.pid&&alive(cli.pid))cli.kill('SIGKILL');await exit;
    for(const pid of pids){try{process.kill(-pid,'SIGKILL');}catch{try{process.kill(pid,'SIGKILL');}catch{}}}
  });
  for(const name of mode==='sdk'||mode==='never'?['background','foreground']:['background']){
    let pid=0;await expect.poll(async()=>{pid=await readFile(join(cwd,name+'.pid'),'utf8').then(Number,()=>0);return pid;},{timeout:10000}).toBeGreaterThan(0);
    pids.push(pid);expect(alive(pid)).toBe(true);
  }
  if(mode==='model'||mode.startsWith('cleanup'))await expect.poll(()=>requests,{timeout:10000}).toBe(1);
  return{cwd,cli,exit,pids,neighbor:neighbor.pid!,requests:()=>requests,closed:()=>connectionClosed,stdout:()=>stdout,stderr:()=>stderr};
}

it.skipIf(process.platform==='win32').each([
  ['SIGINT',130,'sdk'],['SIGTERM',143,'sdk'],['SIGINT',130,'model'],['SIGTERM',143,'model'],
  ['SIGINT',130,'never'],['SIGTERM',143,'never'],
] as const)('gracefully stops actual headless %s work with exit %s (%s)',async(signal,code,mode)=>{
  const f=await fixture(mode);const started=Date.now();expect(f.cli.kill(signal)).toBe(true);
  let outcome;try{outcome=await deadline(f.exit,2000);}catch(error){
    if(process.env.HEADLESS_SIGNAL_EVIDENCE){const directory=resolve(process.env.HEADLESS_SIGNAL_EVIDENCE);await mkdir(directory,{recursive:true});
      await writeFile(join(directory,mode+'-'+signal+'.json'),JSON.stringify({signal,mode,error:String(error),pids:f.pids,ownedAlive:f.pids.map(alive),neighborAlive:alive(f.neighbor),stdout:f.stdout(),stderr:f.stderr()},null,2)+'\n',{flag:'wx'});}
    throw error;
  }
  const observation={signal,mode,outcome,pids:f.pids,ownedAlive:f.pids.map(alive),neighborAlive:alive(f.neighbor),stdout:f.stdout(),stderr:f.stderr(),modelRequests:f.requests(),connectionClosed:f.closed(),elapsedMs:Date.now()-started};
  if(process.env.HEADLESS_SIGNAL_EVIDENCE){
    const directory=resolve(process.env.HEADLESS_SIGNAL_EVIDENCE);await mkdir(directory,{recursive:true});
    await writeFile(join(directory,mode+'-'+signal+'.json'),JSON.stringify(observation,null,2)+'\n',{flag:'wx'});
  }
  await expect.poll(()=>f.pids.map(alive),{timeout:2000}).toEqual(f.pids.map(()=>false));
  expect(alive(f.neighbor)).toBe(true);
  expect(outcome).toEqual({code,signal:null});
  const events=f.stdout().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  expect(events.at(-1)).toMatchObject({type:'result',error:'Interrupted by '+signal});
  expect(events.filter(event=>event.type==='result')).toHaveLength(1);
  expect(f.requests()).toBe(mode==='sdk'||mode==='never'?0:1);
  if(mode==='model')await expect.poll(f.closed,{timeout:2000}).toBe(true);
},20000);

it.skipIf(process.platform==='win32').each([['SIGINT',130],['SIGTERM',143]] as const)('cancels never-resolving cleanup on %s without manually releasing it',async(signal,code)=>{
  const f=await fixture('cleanup-never');
  await expect.poll(()=>readFile(join(f.cwd,'cleanup-entered'),'utf8').catch(()=>''),{timeout:10000}).toBe('entered');
  expect(f.cli.kill(signal)).toBe(true);let outcome;
  try{outcome=await deadline(f.exit,2000);}catch(error){
    if(process.env.HEADLESS_SIGNAL_EVIDENCE){const directory=resolve(process.env.HEADLESS_SIGNAL_EVIDENCE);await mkdir(directory,{recursive:true});
      await writeFile(join(directory,'cleanup-never-'+signal+'.json'),JSON.stringify({error:String(error),pids:f.pids,ownedAlive:f.pids.map(alive),neighborAlive:alive(f.neighbor)},null,2)+'\n',{flag:'wx'});}
    throw error;
  }
  const result=JSON.parse(f.stdout().trim().split('\n').at(-1)!);
  expect(outcome).toEqual({code,signal:null});expect(result).toMatchObject({type:'result',error:'Interrupted by '+signal});
  expect(f.pids.map(alive)).toEqual(f.pids.map(()=>false));expect(alive(f.neighbor)).toBe(true);
  if(process.env.HEADLESS_SIGNAL_EVIDENCE){const directory=resolve(process.env.HEADLESS_SIGNAL_EVIDENCE);await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'cleanup-never-'+signal+'.json'),JSON.stringify({outcome,result,pids:f.pids,ownedAlive:f.pids.map(alive),neighborAlive:alive(f.neighbor)},null,2)+'\n',{flag:'wx'});}
},20000);

it.skipIf(process.platform==='win32')('keeps signal ownership and the final result open until normal application cleanup finishes',async()=>{
  const f=await fixture('cleanup');
  await expect.poll(()=>readFile(join(f.cwd,'cleanup-entered'),'utf8').catch(()=>''),{timeout:10000}).toBe('entered');
  expect(f.cli.kill('SIGTERM')).toBe(true);
  await expect.poll(()=>readFile(join(f.cwd,'signal-received'),'utf8').catch(()=>''),{timeout:2000}).toBe('SIGTERM');
  await writeFile(join(f.cwd,'cleanup-release'),'continue');const outcome=await deadline(f.exit,2000);
  const result=JSON.parse(f.stdout().trim().split('\n').at(-1)!);
  if(process.env.HEADLESS_SIGNAL_EVIDENCE){const directory=resolve(process.env.HEADLESS_SIGNAL_EVIDENCE);await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'cleanup-SIGTERM.json'),JSON.stringify({outcome,result,pids:f.pids,ownedAlive:f.pids.map(alive),neighborAlive:alive(f.neighbor)},null,2)+'\n',{flag:'wx'});}
  expect(outcome).toEqual({code:143,signal:null});expect(result).toMatchObject({type:'result',error:'Interrupted by SIGTERM'});
  expect(f.pids.map(alive)).toEqual(f.pids.map(()=>false));expect(alive(f.neighbor)).toBe(true);
},20000);
