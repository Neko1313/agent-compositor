import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve,join,dirname } from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-workflows');
await mkdir(output,{recursive:true});
let server,browser,page;const report={mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
try{
 if(process.env.VISUAL_EXECUTABLE)report.executable={path:resolve(process.env.VISUAL_EXECUTABLE),sha256:createHash('sha256').update(await readFile(process.env.VISUAL_EXECUTABLE)).digest('hex')};
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...process.env,VISUAL_OUTPUT:output,VISUAL_HARNESS:'1',VISUAL_IDENTITY_PLUGIN:'workflows'},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Bench startup timed out')),15000);server.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/VISUAL_URL=(http\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});server.once('exit',code=>{clearTimeout(timer);reject(Error(`Bench exited ${code}`));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
 const wait=text=>page.waitForFunction(text=>window.visual?.text().includes(text),text,{timeout:15000});
 const click=async(text,last=false)=>{await wait(text);const p=await page.evaluate(({text,last})=>{const lines=visual.text().split('\n');const row=last?lines.findLastIndex(l=>l.includes(text)):lines.findIndex(l=>l.includes(text));const col=lines[row].indexOf(text)+1;const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};},{text,last});await page.mouse.click(p.x,p.y);};
 const focus=()=>page.evaluate(()=>{const lines=visual.text().split('\n'),i=lines.findIndex(l=>/^│ › /.test(l));return lines.slice(Math.max(0,i-1),i+1).join('\n');});
 const tabs=async(n)=>{for(let i=0;i<n;i++){const before=await focus();await page.keyboard.press('Tab');try{await page.waitForFunction(before=>{const lines=visual.text().split('\n'),i=lines.findIndex(l=>/^│ › /.test(l));return lines.slice(Math.max(0,i-1),i+1).join('\n')!==before;},before,{timeout:5000});}catch(e){throw Error('Tab focus stalled: '+JSON.stringify({before,after:await focus()}));}}};
 const replace=async(value)=>{await page.keyboard.press('Control+a');await page.keyboard.type(value);await wait(value);};
 const secret=async(value)=>{await page.keyboard.type(value);await wait('•'.repeat(value.length));};
 const shot=async(name)=>{
  await page.evaluate(()=>new Promise((done,fail)=>{const timer=setTimeout(()=>{subscription.dispose();fail(Error('Terminal paint timeout'));},5000);const subscription=visual.terminal.onRender(()=>{subscription.dispose();clearTimeout(timer);requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
  await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);
 };
 await wait('0/3 complete');await page.evaluate(()=>visual.terminal.resize(140,40));await page.waitForFunction(()=>visual.text().split('\n')[38]?.includes('[Settings]'));
 let loaded;
 if(process.env.VISUAL_EXECUTABLE){
  const launch=JSON.parse(await readFile(join(output,'fixture-launch.json'),'utf8'));
  loaded={...JSON.parse(await readFile(join(launch.cwd,'native-fixture-identity.json'),'utf8')),cwd:launch.cwd,state:launch.state};
  assert.equal(loaded.directory,join(dirname(resolve(process.env.VISUAL_EXECUTABLE)),'plugins/workflows'));
  const manifest=JSON.parse(await readFile(join(loaded.directory,'plugin.json'),'utf8'));assert.equal(loaded.version,manifest.version);
  report.loaded={...loaded,hooksSha256:createHash('sha256').update(await readFile(join(loaded.directory,'hooks.js'))).digest('hex')};
  await writeFile(join(output,'fixture-identity.json'),JSON.stringify(loaded,null,2));
 }else loaded=JSON.parse(await readFile(resolve(output,'fixture-identity.json'),'utf8'));
 assert.equal(loaded.plugin,'workflows');if(process.env.VISUAL_PLUGIN_DIR)assert.equal(loaded.directory,resolve(process.env.VISUAL_PLUGIN_DIR));
 const submit=async(command)=>{await click('Describe your task');await page.keyboard.type(command);await wait('› '+command);await page.keyboard.press('Enter');};
 const stageState=(title,state)=>page.waitForFunction(({title,state})=>visual.text().split('\n').some(line=>line.includes(title)&&line.includes(state)),{title,state});
 await submit('/workflow-proof');await wait('Dynamic workflows');await click('Workflows');await page.keyboard.press('Alt+f');await page.waitForFunction(()=>visual.text().split('\n')[1]?.includes('Workflows'));
 await wait('Progress');await click('+ Repository audit proof');await click('[ Inspect stages ]');await stageState('Inspect tests','running');await shot('01-running.png');
 await click('[ Pause scheduling ]');await wait('Repository audit proof · paused');await shot('02-paused.png');
 await click('[x]');await page.waitForFunction(()=>!visual.text().split('\n').some(line=>line.includes('│ Workflows')));
 await submit('/workflow-release');
 const until=Date.now()+15000;let workersSettled=false;
 while(Date.now()<until){
  const directory=join(loaded.state,'workflows','runs');
  for(const file of await readdir(directory).catch(()=>[])){
   if(!file.endsWith('.json'))continue;const run=JSON.parse(await readFile(join(directory,file),'utf8'));
   const workers=run.stages.filter(stage=>['Inspect tests','Inspect source'].includes(stage.title));
   if(run.title==='Repository audit proof'&&run.status==='paused'&&workers.length===2&&workers.every(stage=>stage.status==='completed'))workersSettled=true;
  }
  if(workersSettled)break;await new Promise(done=>setTimeout(done,20));
 }
 assert.ok(workersSettled,'Workers must finish while their workflow view is closed');
 assert.equal(await page.evaluate(()=>visual.text().split('\n').some(line=>line.includes('│ Workflows'))),false,'Background updates must not reopen the workflow view');
 await shot('02a-closed-after-workers.png');report.checks.push('workflow.closed-during-update');
 await submit('/workflows');await wait('Dynamic workflows');await click('Workflows');
 if(!await page.evaluate(()=>visual.text().includes('FULLSCREEN')))await page.keyboard.press('Alt+f');
 await stageState('Inspect tests','completed');await stageState('Inspect source','completed');await stageState('Verify combined result','pending');
 await click('[ Resume workflow ]');await wait('Repository audit proof · completed');await click('+ Verify combined result');await wait('Combined verification complete');await shot('03-completed.png');
 report.checks.push('Actual workflow tool dynamically expands two parallel workers; mouse pause prevents the downstream stage from starting; resume joins results and exposes detail');
 report.checks.push('workflow.expand-join','workflow.pause-resume','workflow.result-detail');
 await click('[ All runs ]');await click('[Running (0)]');await wait('No runs match this view');await page.keyboard.press('ArrowLeft');await wait('[ Inspect stages ]');await page.keyboard.press('ArrowRight');await wait('No runs match this view');await click('[All (1)]');await wait('[ Inspect stages ]');
 for(let index=0;index<5;index++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!visual.text().includes('[ Inspect stages ]'));
 await page.evaluate(()=>visual.terminal.resize(48,18));await wait('State: completed');await wait('[Attention (0)]');await shot('03a-narrow.png');
 await page.evaluate(()=>visual.terminal.resize(140,40));await page.waitForFunction(()=>visual.text().split('\n').some(line=>line.includes('Workflow')&&line.includes('Progress')));
 report.checks.push('Workflow table supports keyboard expansion, state filters and labeled narrow fields');
 report.checks.push('workflow.table.keyboard','workflow.table.filter','workflow.table.narrow','workflow.tabs.keyboard','workflow.tabs.pointer');
 await page.keyboard.press('Alt+f');await wait('Workflow completion delivered to main agent');await shot('03b-parent-wake.png');report.checks.push('Terminal workflow completion automatically wakes the originating parent agent');
 const generation=await page.evaluate(()=>visual.generation);await page.click('#restart');await page.waitForFunction(g=>visual.generation>g&&visual.frames>0,generation);await stageState('Repository audit proof','completed');await shot('04-restored.png');
 await page.keyboard.press('Alt+s');
 await submit('Explain the current status');await wait('Main session remains responsive');await wait('ctx ');await page.waitForFunction(()=>visual.text().split('\n')[38]?.includes('Ready'));await shot('05-context.png');
 report.checks.push('Restart restores completed stages; foreground input remains usable and displays context occupancy');
 if(process.env.VISUAL_EXECUTABLE){
  report.transport=JSON.parse(await readFile(join(output,'workflow-transport.json'),'utf8'));
  assert.deepEqual([...report.transport.requests].sort(),['discover','worker','worker','verify','completion','foreground'].sort());assert.equal(report.transport.paidRequests,0);
  report.checks.push('native.workflow-bundle','native.bounded-transport');
 }
 if(report.errors.length)throw Error(report.errors.join('\n'));report.ok=true;
}catch(error){report.ok=false;report.errors.push(String(error));process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});if(page)await writeFile(resolve(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
