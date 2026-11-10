import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-workflows');
await mkdir(output,{recursive:true});
let server,browser,page;const report={checks:[],screenshots:[],errors:[]};
try{
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...process.env,VISUAL_OUTPUT:output,VISUAL_HARNESS:'1'},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Bench startup timed out')),15000);server.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/VISUAL_URL=(http\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});server.once('exit',code=>{clearTimeout(timer);reject(Error(`Bench exited ${code}`));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
 const wait=text=>page.waitForFunction(text=>window.visual?.text().includes(text),text,{timeout:15000});
 const click=async(text,last=false)=>{await wait(text);const p=await page.evaluate(({text,last})=>{const lines=visual.text().split('\n');const row=last?lines.findLastIndex(l=>l.includes(text)):lines.findIndex(l=>l.includes(text));const col=lines[row].indexOf(text)+1;const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};},{text,last});await page.mouse.click(p.x,p.y);};
 const focus=()=>page.evaluate(()=>{const lines=visual.text().split('\n'),i=lines.findIndex(l=>/^│ › /.test(l));return lines.slice(Math.max(0,i-1),i+1).join('\n');});
 const tabs=async(n)=>{for(let i=0;i<n;i++){const before=await focus();await page.keyboard.press('Tab');try{await page.waitForFunction(before=>{const lines=visual.text().split('\n'),i=lines.findIndex(l=>/^│ › /.test(l));return lines.slice(Math.max(0,i-1),i+1).join('\n')!==before;},before,{timeout:5000});}catch(e){throw Error('Tab focus stalled: '+JSON.stringify({before,after:await focus()}));}}};
 const replace=async(value)=>{await page.keyboard.press('Control+a');await page.keyboard.type(value);await wait(value);};
 const secret=async(value)=>{await page.keyboard.type(value);await wait('•'.repeat(value.length));};
 const shot=async(name)=>{await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);};
 await wait('0/3 complete');await page.evaluate(()=>visual.terminal.resize(140,40));await page.waitForFunction(()=>visual.text().split('\n')[38]?.includes('[Settings]'));
 const submit=async(command)=>{await click('Describe your task');await page.keyboard.type(command);await wait('› '+command);await page.keyboard.press('Enter');};
 await submit('/workflow-proof');await wait('Dynamic workflows');await click('Workflows');await page.keyboard.press('Alt+f');await page.waitForFunction(()=>visual.text().split('\n')[1]?.includes('Workflows'));await wait('Inspect tests · running');await shot('01-running.png');
 await click('[ Pause scheduling ]');await wait('Repository audit proof · paused');await shot('02-paused.png');
 await submit('/workflow-release');await click('Workflows');await wait('Inspect tests · completed');await wait('Inspect source · completed');await wait('Verify combined result · pending');
 await click('[ Resume workflow ]');await wait('Repository audit proof · completed');await click('Verify combined result · completed');await wait('Combined verification complete');await shot('03-completed.png');
 report.checks.push('Actual workflow tool dynamically expands two parallel workers; mouse pause prevents the downstream stage from starting; resume joins results and exposes detail');
 await page.keyboard.press('Alt+f');await wait('Workflow completion delivered to main agent');await shot('03b-parent-wake.png');report.checks.push('Terminal workflow completion automatically wakes the originating parent agent');
 const generation=await page.evaluate(()=>visual.generation);await page.click('#restart');await page.waitForFunction(g=>visual.generation>g&&visual.frames>0,generation);await wait('Repository audit proof · completed');await shot('04-restored.png');
 await page.keyboard.press('Alt+s');
 await submit('Explain the current status');await wait('Main session remains responsive');await wait('ctx ');await page.waitForFunction(()=>visual.text().split('\n')[38]?.includes('Ready'));await shot('05-context.png');
 report.checks.push('Restart restores completed stages; foreground input remains usable and displays context occupancy');
 if(report.errors.length)throw Error(report.errors.join('\n'));report.ok=true;
}catch(error){report.ok=false;report.errors.push(String(error));process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});if(page)await writeFile(resolve(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
