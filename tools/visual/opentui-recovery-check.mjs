import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,rm,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-recovery');await mkdir(output,{recursive:true});
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};let server,browser,page,gate;
try{
 const env=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...env,VISUAL_OPENTUI_APP:'1',...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{}),...(process.env.VISUAL_OPENTUI_RECOVERY_INTERRUPT?{VISUAL_OPENTUI_RECOVERY_INTERRUPT:'1'}:{}),...(process.env.VISUAL_OPENTUI_PROCESS_KILL?{VISUAL_OPENTUI_PROCESS_KILL:'1'}:{}),VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off'},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Server timeout')),20000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});server.once('exit',code=>fail(Error('Server exit '+code)));});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=text=>page.waitForFunction(value=>visual.text().includes(value),text,{timeout:20000});
 const shot=async name=>{await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);};
 const main=async()=>{await page.keyboard.press('Alt+0');await wait('Main · focused');};
 const send=async(text,key='Enter')=>{await main();await page.keyboard.type(text);await wait(text);await page.keyboard.press(key);};
 await wait('Message Main');await send('APP_HOLD');await wait('APP_MODEL_HELD');await send('APP_RESTORED',process.env.VISUAL_OPENTUI_QUEUE?'Enter':'Tab');await wait(process.env.VISUAL_OPENTUI_QUEUE?'Queued: APP_RESTORED':'Steering queued: APP_RESTORED');await shot('00-accepted-before-restart.png');
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
 if(process.env.VISUAL_OPENTUI_RECOVERY_CURRENT){
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
