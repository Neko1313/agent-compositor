import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,rm,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-recovery');await mkdir(output,{recursive:true});
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};let server,browser,page,gate,legacySession;
try{
 if(process.env.VISUAL_RESTART_EXECUTABLE&&(!process.env.VISUAL_EXECUTABLE||!process.env.VISUAL_OPENTUI_RECOVERY_ORDER))throw Error('Cross-version recovery requires two native executables and the mixed-order scenario');
 if(process.env.VISUAL_RESTART_EXECUTABLE&&process.env.VISUAL_OPENTUI_PROCESS_KILL)throw Error('Cross-version recovery and mixed SIGKILL are separate scenarios');
 const env=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...env,VISUAL_OPENTUI_APP:'1',...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{}),...(process.env.VISUAL_RESTART_EXECUTABLE?{VISUAL_RESTART_EXECUTABLE:resolve(process.env.VISUAL_RESTART_EXECUTABLE)}:{}),...(process.env.VISUAL_OPENTUI_RECOVERY_INTERRUPT?{VISUAL_OPENTUI_RECOVERY_INTERRUPT:'1'}:{}),...(process.env.VISUAL_OPENTUI_PROCESS_KILL?{VISUAL_OPENTUI_PROCESS_KILL:'1'}:{}),VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off'},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Server timeout')),20000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});server.once('exit',code=>fail(Error('Server exit '+code)));});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=text=>page.waitForFunction(value=>visual.text().includes(value),text,{timeout:20000});
 const shot=async name=>{await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);};
 const main=async()=>{await page.keyboard.press('Alt+0');await wait('Main · focused');};
 const send=async(text,key='Enter')=>{await main();await page.keyboard.type(text);await wait(text);await page.keyboard.press(key);};
 await wait('Message Main');await send('APP_HOLD');await wait('APP_MODEL_HELD');
 if(process.env.VISUAL_OPENTUI_RECOVERY_ORDER){await send('APP_STEER_FIRST','Tab');await wait('Steering queued: APP_STEER_FIRST');}
 await send('APP_RESTORED',process.env.VISUAL_OPENTUI_QUEUE?'Enter':'Tab');await wait(process.env.VISUAL_OPENTUI_QUEUE?'Queued: APP_RESTORED':'Steering queued: APP_RESTORED');await shot('00-accepted-before-restart.png');
 const launch=JSON.parse(await readFile(join(output,'opentui-app-launch.json'),'utf8'));
 if(process.env.VISUAL_EXECUTABLE){
  const executable=resolve(process.env.VISUAL_EXECUTABLE),sha256=createHash('sha256').update(await readFile(executable)).digest('hex');
  if(launch.executable!==executable||launch.sha256!==sha256)throw Error('The requested native executable was not launched');
  report.executable={path:executable,sha256};
 }
 const deadline=Date.now()+20000;let durable=false;
 while(Date.now()<deadline){const files=await readdir(join(launch.state,'sessions')).catch(()=>[]);for(const name of files.filter(name=>name.endsWith('.jsonl'))){
  const data=await readFile(join(launch.state,'sessions',name),'utf8');if(data.split('\n').some(line=>{try{const event=JSON.parse(line);return event.type===(process.env.VISUAL_OPENTUI_QUEUE?'prompt.queued':'prompt.steer')&&event.text==='APP_RESTORED';}catch{return false;}}))durable=true;
 }if(durable)break;await new Promise(done=>setTimeout(done,25));}
 if(!durable)throw Error('The input notification was not saved to the actual session journal');
 const receipts=()=>readFile(join(output,'app-http.jsonl'),'utf8').then(text=>text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));
 if(process.env.VISUAL_OPENTUI_RECOVERY_ORDER){
  if(!process.env.VISUAL_OPENTUI_QUEUE)throw Error('Mixed recovery order requires a queued message');
  if(!process.env.VISUAL_OPENTUI_PROCESS_KILL){
   await main();await page.keyboard.press('Control+c');await wait('Steering may not have been applied');
   await send('/recover');await wait('1. APP_STEER_FIRST');await wait('2. APP_RESTORED');await shot('01-current-order.png');
  }else{
   const names=(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl'));
   if(names.length!==1)throw Error('Expected one active session journal');
   const rows=(await readFile(join(launch.state,'sessions',names[0]),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
   for(const [type,text] of [['prompt.steer.intent','APP_STEER_FIRST'],['prompt.queue.intent','APP_RESTORED']])
    if(!rows.some(row=>row.type===type&&row.text===text))throw Error('Missing durable intent before SIGKILL: '+text);
  }
  if((await receipts()).filter(item=>item.kind==='completion').length!==1)throw Error('Recovery invoked the model without a retry');
  if(process.env.VISUAL_RESTART_EXECUTABLE){
   const names=(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl'));if(names.length!==1)throw Error('Expected one legacy session journal');legacySession=names[0].slice(0,-6);
   const rows=(await readFile(join(launch.state,'sessions',names[0]),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
   for(const [type,text] of [['prompt.steer.intent','APP_STEER_FIRST'],['prompt.queue.intent','APP_RESTORED']]){
    const event=rows.find(row=>row.type===type&&row.text===text);if(!event||Object.hasOwn(event,'recoveryOrder'))throw Error('Expected a legacy intent without recovery ordering metadata');
   }
  }
  const generation=await page.evaluate(()=>visual.generation);
  if(process.env.VISUAL_OPENTUI_PROCESS_KILL)await page.evaluate(()=>visual.crashRestart());
  else await page.getByRole('button',{name:'Restart session'}).click();
  await page.waitForFunction(g=>visual.generation>g,generation);await wait('recovered message');
  if(process.env.VISUAL_OPENTUI_PROCESS_KILL){const crash=JSON.parse(await readFile(join(output,'crash-receipt.json'),'utf8'));if(crash.signal!=='SIGKILL'||crash.bridgeExitCode!==137)throw Error('Expected actual SIGKILL');report.checks.push('The held CLI was killed with SIGKILL after both mixed input intents were persisted');}
  if(process.env.VISUAL_RESTART_EXECUTABLE){
   const restarted=JSON.parse(await readFile(join(output,'opentui-app-launch.json'),'utf8')),path=resolve(process.env.VISUAL_RESTART_EXECUTABLE);
   const command=restarted.launches[1]?.command,resume=command?.indexOf('--resume');
   if(restarted.launches.length!==2||command?.[0]!==path||resume<0||command[resume+1]!==legacySession)throw Error('The requested replacement did not resume the legacy session');
   report.replacement={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};
   if(report.replacement.sha256===report.executable?.sha256)throw Error('Expected distinct native executables');
  }
  await send('/recover');await wait('1. APP_STEER_FIRST');await wait('2. APP_RESTORED');await shot('02-restored-order.png');
  if((await receipts()).filter(item=>item.kind==='completion').length!==1)throw Error('Restart invoked the model without a retry');
  if(process.env.VISUAL_OPENTUI_PROCESS_KILL){
   await send('/recover retry 1');await wait('APP_STEER_FIRST:');
   const requests=(await receipts()).filter(item=>item.kind==='completion');
   if(requests.length!==2||requests[1].body.messages.filter(message=>message.role==='user').at(-1)?.content!=='APP_STEER_FIRST')throw Error('The selected steering retry did not reach the model exactly once');
   await send('/recover');await wait('1. APP_RESTORED');await shot('03-remaining-after-retry.png');
   if((await receipts()).filter(item=>item.kind==='completion').length!==2)throw Error('Reviewing the remaining queue invoked the model');
   report.checks.push('Explicitly retrying the recovered steering invokes the model once and leaves the queued input reviewable');
  }
  if(process.env.VISUAL_RESTART_EXECUTABLE){
   await main();await page.keyboard.type('APP_HOLD');
   await page.waitForFunction(()=>visual.text().split('\n').slice(-10).some(line=>line.includes('APP_HOLD')));await page.keyboard.press('Enter');
   const until=Date.now()+20000;while((await receipts()).filter(item=>item.kind==='completion').length<2&&Date.now()<until)await new Promise(done=>setTimeout(done,25));
   if((await receipts()).filter(item=>item.kind==='completion').length!==2)throw Error('The post-upgrade held turn did not start');
   await send('AFTER_UPGRADE');await wait('Queued: AFTER_UPGRADE');await main();await page.keyboard.press('Control+c');await wait('Accepted messages are available');
   await send('/recover');await wait('1. APP_STEER_FIRST');await wait('2. APP_RESTORED');await wait('3. AFTER_UPGRADE');await shot('03-mixed-legacy-and-new.png');
   const names=(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl'));if(names.length!==1)throw Error('Expected one upgraded session journal');
   const rows=(await readFile(join(launch.state,'sessions',names[0]),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
   const fresh=rows.find(row=>row.type==='prompt.queue.intent'&&row.text==='AFTER_UPGRADE');if(!fresh||!Number.isSafeInteger(fresh.recoveryOrder)||fresh.recoveryOrder<0)throw Error('Expected new recovery ordering metadata');
   const again=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(g=>visual.generation>g,again);await wait('recovered message');
   await send('/recover');await wait('1. APP_STEER_FIRST');await wait('2. APP_RESTORED');await wait('3. AFTER_UPGRADE');await shot('04-mixed-order-after-restart.png');
   if((await receipts()).filter(item=>item.kind==='completion').length!==2)throw Error('Mixed recovery unexpectedly invoked the model');
   report.checks.push('Legacy and newly ordered messages remain distinct and ordered across two restarts');
  }
  report.checks.push(process.env.VISUAL_OPENTUI_PROCESS_KILL?'Steering and queued input retain their order after SIGKILL without recovery-triggered model requests':'Steering and queued input retain their order before and after restart without recovery-triggered model requests');report.ok=!report.errors.length;
 }else if(process.env.VISUAL_OPENTUI_RECOVERY_CURRENT){
  if(!process.env.VISUAL_OPENTUI_QUEUE)throw Error('Current-session recovery requires a queued message');
  await main();await page.keyboard.press('Control+c');await wait('Accepted messages are available');
  if((await receipts()).filter(item=>item.kind==='completion').length!==1)throw Error('Interrupted queued message invoked the model');
  await send('/recover');await wait('1. APP_RESTORED');await shot('01-current-recovery.png');
  await send('/recover retry 1');await wait('APP_RESTORED:');await shot('02-current-retry.png');
  const requests=(await receipts()).filter(item=>item.kind==='completion');
  if(requests.length!==2||requests[1].body.messages.filter(message=>message.role==='user').at(-1)?.content!=='APP_RESTORED')throw Error('The explicit retry did not reach the model exactly once');
  report.checks.push('An interrupted accepted queued message is reviewable and retried explicitly in the same session');report.ok=!report.errors.length;
 }else{
 const generation=await page.evaluate(()=>visual.generation);
 if(process.env.VISUAL_OPENTUI_PROCESS_KILL)await page.evaluate(()=>visual.crashRestart());
 else await page.getByRole('button',{name:'Restart session'}).click();
 await page.waitForFunction(g=>visual.generation>g,generation);await wait('recovered message');await shot('01-recovered-notice.png');
 if(process.env.VISUAL_OPENTUI_PROCESS_KILL){const crash=JSON.parse(await readFile(join(output,'crash-receipt.json'),'utf8'));if(crash.signal!=='SIGKILL'||crash.bridgeExitCode!==137)throw Error('Expected actual SIGKILL');report.checks.push('The held CLI was killed with SIGKILL after the input was persisted');}
 if((await receipts()).filter(item=>item.kind==='completion').length!==1)throw Error('Recovery sent an unexpected model request');
 await send('/recover');await wait('APP_RESTORED');await shot('02-recovery-list.png');
 if(process.env.VISUAL_OPENTUI_RECOVERY_INTERRUPT){
  await send('APP_HOLD');
  const until=Date.now()+20000;while((await receipts()).filter(item=>item.kind==='completion').length<2&&Date.now()<until)await new Promise(done=>setTimeout(done,25));
  if((await receipts()).filter(item=>item.kind==='completion').length!==2)throw Error('The second held turn did not start');
  gate=join(launch.cwd,'.hold-recovery-write');await writeFile(gate,'hold');await send('/recover retry 1');
  const entered=join(launch.cwd,'.recovery-write-entered'),deadline=Date.now()+20000;
  while(!await access(entered).then(()=>true,()=>false)&&Date.now()<deadline)await new Promise(done=>setTimeout(done,25));
  if(!await access(entered).then(()=>true,()=>false))throw Error('The retry journal gate was not entered');
  await main();await page.keyboard.press('Control+c');await wait('Recovered message was not submitted.');await shot('03-interrupted-retry.png');
  if((await receipts()).filter(item=>item.kind==='completion').length!==2)throw Error('Interrupted retry unexpectedly invoked the model');
  await rm(gate);gate=undefined;await send('/recover');await wait('Recovered messages may have run');await wait('1. APP_RESTORED');
  report.checks.push('Interrupted recovered retry remains reviewable and is not reported as submitted');report.ok=!report.errors.length;
 }else{
 await send('/recover retry 1');await wait('APP_RESTORED:');await shot('03-retried.png');
 const requests=(await receipts()).filter(item=>item.kind==='completion');
 if(requests.length!==2||requests[1].body.messages.filter(message=>message.role==='user').at(-1)?.content!=='APP_RESTORED')throw Error('The selected recovery was not the second model request');
 report.checks.push(`Actual OpenTUI resumes ${process.env.VISUAL_OPENTUI_QUEUE?'a queued message':'unapplied steering'} without a model request, then retries only after explicit user input`);report.ok=!report.errors.length;
 }
 }
}catch(error){report.errors.push(String(error));await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{if(gate)await rm(gate,{force:true});await browser?.close();if(server&&server.exitCode===null){const end=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await end;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
