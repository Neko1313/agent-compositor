import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-cancellation');
const timeout=20_000,draft='CANCEL_MAIN_DRAFT_47',hash=value=>createHash('sha256').update(value).digest('hex');
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
const runFile=promisify(execFile),ownedPids={};
let server,serverExit,browser,page,launch,ptyExit;
await mkdir(output,{recursive:true});for(const name of ['failure.png','failure.txt'])await rm(join(output,name),{force:true});
const json=file=>readFile(file,'utf8').then(JSON.parse);
async function observe(read,predicate,reason){const end=Date.now()+timeout;let value;
  while(Date.now()<end){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}
  throw Error(reason+'; latest='+JSON.stringify(value));
}
async function processInfo(pid){
  try{const result=await runFile('/bin/ps',['-p',String(pid),'-o','stat=','-o','command=']);return result.stdout.trim();}
  catch(error){if(error.code===1)return '';throw error;}
}
async function alive(pid){const value=await processInfo(pid);return Boolean(value)&&!value.startsWith('Z');}
async function pid(name){const value=await observe(()=>readFile(launch.cancellation.pids[name],'utf8'),value=>/^[1-9]\d*\s*$/.test(value),'Actual worker '+name+' must write its own PID');
  const result=Number(value);assert.ok(Number.isSafeInteger(result)&&result>1);assert.ok((await processInfo(result)).includes('cancel-worker.sh '+name));ownedPids[name]=result;return result;}
try{
  const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_CANCELLATION:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off',
    ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
  serverExit=new Promise(done=>server.once('close',done));
  const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Cancellation bench startup timed out')),timeout);
    server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Cancellation bench exited '+code));});
    server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});
  });
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>report.errors.push(error.message));
  const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);
  socket.on('framereceived',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='exit')ptyExit=value.code;}catch{}});
  const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
  const wait=value=>page.waitForFunction(value=>window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
  const absent=value=>page.waitForFunction(value=>!window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal retained '+JSON.stringify(value),{cause:error});});
  async function type(value){await page.keyboard.type(value);await wait(value);}
  async function main(){await key('Alt+0');await wait('─ Main · focused');}
  async function command(value){await main();await key('End');await key('Control+u');await type(value);await key('Enter');}
  async function pick(query){await key('F2');await wait('windows · ↑↓ select · Enter open');await type(query);await key('Enter');await absent('windows · ↑↓ select · Enter open');}
  const sessionFiles=async()=>(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl'));
  const events=async()=>(await Promise.all((await sessionFiles()).map(async name=>(await readFile(join(launch.state,'sessions',name),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)))).flat();
  const completions=async()=>(await readFile(join(output,'app-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.kind==='completion');
  async function noModelWork(){assert.equal((await completions()).length,1);}
  async function questionPending(){await noModelWork();assert.equal((await events()).filter(event=>event.type==='tool.result'&&event.tool==='ask_user').length,0);}
  let pointerAttempt=0;
  async function click(label){const attempt=++pointerAttempt;
    const point=await page.waitForFunction(({label,attempt})=>{
      const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(label));if(row<0){delete window.__cancellationPointer;return;}
      const col=lines[row].indexOf(label)+Math.min(1,label.length-1),rect=document.querySelector('.xterm-screen').getBoundingClientRect();
      const signature=[row,col,visual.terminal.cols,visual.terminal.rows,rect.x,rect.y,rect.width,rect.height].join(':'),previous=window.__cancellationPointer;
      if(previous?.attempt!==attempt||previous.signature!==signature){window.__cancellationPointer={attempt,signature,count:1};return;}
      if(++previous.count<3)return;return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};
    },{label,attempt},{polling:'raf'});const value=await point.jsonValue();await page.mouse.click(value.x,value.y);
  }
  async function capture(name){const attempts=[];for(let attempt=0;attempt<2;attempt++){
    await page.evaluate(()=>new Promise(done=>{const subscription=visual.terminal.onRender(()=>{subscription.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
    const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(output,name+'.png')});
    const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()})),stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});
    await writeFile(join(output,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(output,name+'.txt'),after.text);
    if(stable){report.screenshots.push(name+'.png');return;}
    if(attempt===0){await copyFile(join(output,name+'.png'),join(output,name+'.attempt1.png'));await page.evaluate(()=>{window.__cancellationQuiet={frames:visual.frames,text:visual.text(),since:performance.now()};});
      await page.waitForFunction(()=>{const previous=window.__cancellationQuiet,frames=visual.frames,text=visual.text(),now=performance.now();
        if(previous.frames!==frames||previous.text!==text){window.__cancellationQuiet={frames,text,since:now};return false;}return now-previous.since>=150;
      },undefined,{polling:'raf',timeout:5000});}
  }throw Error('Terminal changed during both screenshot attempts: '+name);}

  await wait('Message Main…');launch=await json(join(output,'opentui-app-launch.json'));assert.ok(launch.cancellation);
  assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);
  const args=launch.launches[0].command.slice(-4);assert.deepEqual(args.slice(0,3),['--renderer','opentui','--cwd']);assert.equal(await realpath(args[3]),await realpath(launch.cwd));
  if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);report.executable={path:launch.executable,sha256:launch.sha256};
    const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');report.renderer={path:renderer,sha256:hash(await readFile(renderer))};}
  await page.evaluate(()=>visual.terminal.resize(180,50));await command('APP_QUESTION');await wait('MAIN_QUESTION: choose deployment');
  await click('Edit answer');await click('[ ] Production');await wait('[x] Production');await click('Draft');
  await command('/cancel-probe denied');await wait('POLICY_DENIED');await absent('Cancel worker DENIED · Working');
  const denied=await observe(()=>json(launch.cancellation.receipts.denied),value=>value.ok===false,'Normal policy must reject the unapproved worker invocation');
  assert.match(denied.error,/denied|permission/i);assert.equal(await readFile(launch.cancellation.pids.denied,'utf8').then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;}),false);
  await questionPending();report.checks.push('The actual configured CLI holds Main ask_user while the plugin immediate command uses normal policy; only exact worker A/B invocations are allowed and the denied variant never starts a process');

  await command('/cancel-probe a');const a=await pid('a');await wait('Cancel worker A · Working');
  await command('/cancel-probe b');const b=await pid('b');assert.notEqual(a,b);await wait('Cancel worker B · Working');assert.equal(await alive(a),true);assert.equal(await alive(b),true);
  await main();await type(draft);await questionPending();await capture('01-independent-workers-and-main');
  await pick('Cancel worker A');await key('Control+c');
  await observe(()=>alive(a),value=>!value,'Cancelling pane A must terminate its actual foreground shell');
  const resultA=await observe(()=>json(launch.cancellation.receipts.a),value=>value.signalAborted===true,'Command A must receive its caller cancellation signal');
  await absent('Cancel worker A · Working');await wait('Cancel worker B · Working');assert.equal(await alive(b),true);
  await main();await wait(draft);await click('Edit answer');await wait('[x] Production');await click('Draft');await questionPending();await capture('02-only-worker-a-cancelled');
  report.checks.push('Two commands from the same plugin own separate live foreground processes; Ctrl+C in pane A kills only PID A, settles its busy source and preserves PID B plus Main selected answer/draft without extra model requests');

  await key('Control+x');await absent('Main · Question');await wait('Main · Ready');await wait(draft);assert.equal(await alive(b),true);await wait('Cancel worker B · Working');await noModelWork();
  await pick('Cancel worker B');await key('Control+c');await observe(()=>alive(b),value=>!value,'Cancelling pane B must terminate its actual foreground shell');
  const resultB=await observe(()=>json(launch.cancellation.receipts.b),value=>value.signalAborted===true,'Command B must receive its own caller cancellation signal');await absent('Cancel worker B · Working');
  const settled=await observe(events,rows=>{
    const commands=rows.filter(event=>event.type==='command.operation'&&event.plugin==='cancellation-probe'),started=commands.filter(event=>event.phase==='started'),done=commands.filter(event=>event.phase==='completed');
    return started.length===3&&done.length===3&&started.every(event=>done.some(result=>result.operationId===event.operationId));
  },'All three actual command operations must settle with their original operation IDs');
  const execCalls=settled.filter(event=>event.type==='tool.call'&&event.tool==='exec');assert.equal(execCalls.length,3);assert.equal(new Set(execCalls.map(event=>event.callId)).size,3);
  for(const call of execCalls)assert.ok(settled.some(event=>event.type==='tool.result'&&event.callId===call.callId));
  await main();await wait(draft);await capture('03-main-interrupted-workers-settled');await noModelWork();
  await command('/reload');await observe(()=>json(launch.cancellation.reloaded),value=>value===true,'Actual reload must finish after all independent Core/host operations settle');await wait('Reloaded ');await noModelWork();
  const calls=await completions();assert.ok(!JSON.stringify(calls.map(row=>row.body)).includes('cancel-worker.sh'));
  await writeFile(join(output,'operation-events.json'),JSON.stringify(settled.filter(event=>['command.operation','tool.operation','tool.call','tool.result','turn.interrupted'].includes(event.type)),null,2));
  report.pids={a,b};report.results={a:resultA,b:resultB,denied};report.operationsSettled=3;
  report.checks.push('Main Ctrl+X leaves worker B alive; pane B Ctrl+C then kills only B, all distinct command/tool IDs settle, busy sources clear, and real reload confirms quiescence before clean exit');
  await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');report.ptyExitCode=ptyExit;assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{
  await browser?.close();
  for(const[name,pid]of Object.entries(ownedPids))if(await alive(pid)&&((await processInfo(pid)).includes('cancel-worker.sh '+name))){process.kill(pid,'SIGKILL');report.errors.push('Cleanup terminated surviving owned worker '+name);report.ok=false;}
  if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
}
