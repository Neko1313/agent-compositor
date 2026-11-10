import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-settings');
await mkdir(output,{recursive:true});
let server,browser,page;const report={checks:[],screenshots:[],errors:[]};
try{
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...process.env,VISUAL_OUTPUT:output},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Bench startup timed out')),15000);server.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/VISUAL_URL=(http\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});server.once('exit',code=>{clearTimeout(timer);reject(Error(`Bench exited ${code}`));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
 const wait=text=>page.waitForFunction(text=>window.visual?.text().includes(text),text,{timeout:15000});
 const click=async(text,last=false)=>{await wait(text);const p=await page.evaluate(({text,last})=>{const lines=visual.text().split('\n');const row=last?lines.findLastIndex(l=>l.includes(text)):lines.findIndex(l=>l.includes(text));const col=lines[row].indexOf(text)+1;const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};},{text,last});await page.mouse.click(p.x,p.y);};
 const focus=()=>page.evaluate(()=>{const lines=visual.text().split('\n'),i=lines.findIndex(l=>/^│ › /.test(l));return lines.slice(Math.max(0,i-1),i+1).join('\n');});
 const tabs=async(n)=>{for(let i=0;i<n;i++){const before=await focus();await page.keyboard.press('Tab');try{await page.waitForFunction(before=>{const lines=visual.text().split('\n'),i=lines.findIndex(l=>/^│ › /.test(l));return lines.slice(Math.max(0,i-1),i+1).join('\n')!==before;},before,{timeout:5000});}catch(e){throw Error('Tab focus stalled: '+JSON.stringify({before,after:await focus()}));}}};
 const toggle=async()=>{const before=await focus();await page.keyboard.press('Space');await page.waitForFunction(before=>{const lines=visual.text().split('\n'),i=lines.findIndex(l=>/^│ › /.test(l));return lines.slice(Math.max(0,i-1),i+1).join('\n')!==before;},before);};
 const replace=async(value)=>{await page.keyboard.press('Control+a');await page.keyboard.type(value);await wait(value);};
 const secret=async(value)=>{await page.keyboard.type(value);await wait('•'.repeat(value.length));};
 const shot=async(name)=>{await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);};
 await wait('0/3 complete');await page.evaluate(()=>visual.terminal.resize(140,40));await page.waitForFunction(()=>visual.text().split('\n')[38]?.includes('[Settings]'));
 await click('[Settings]');await wait('Models & providers');await page.keyboard.press('Alt+f');await page.waitForFunction(()=>visual.text().split('\n')[1]?.includes('Models & providers'));await shot('01-providers.png');await click('[ Add provider ]');await wait('Add provider');
 // Choose the compatible preset with real terminal keystrokes.
 for(let i=0;i<4;i++){await page.keyboard.press('ArrowRight');await wait(['OpenAI','Anthropic','Gemini','Compatible API / gateway'][i]);}await tabs(1);await page.keyboard.press('Enter');await wait('New provider connection');
 await replace('visual-provider');await tabs(2);await replace('http://127.0.0.1:4567/v1');await tabs(1);await replace('visual-model');await tabs(1);await secret('fake-visual-api-key');
 await shot('02-masked-key.png');if((await page.evaluate(()=>visual.text())).includes('fake-visual-api-key'))throw Error('Unmasked key');
 await tabs(7);await page.keyboard.press('Enter');await wait('Active: visual-provider · visual-model');
 report.checks.push('Settings toolbar opens providers; native keyboard form saves a profile with masked API key');
 await click('[ Reasoning: provider default ]',true);await wait('Reasoning effort · visual-provider');
 for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');await wait('› ‹ High ›');
 await tabs(2);await page.keyboard.press('Enter');await wait('Reasoning: high');await shot('02b-reasoning-high.png');
 report.checks.push('Reasoning effort can be selected separately and applies to the active profile');
 await click('[ Network proxy ]');await wait('Configure network proxy');
 await toggle();await tabs(1);await replace('http://127.0.0.1:7890');await tabs(1);await replace('visual-user');await tabs(1);await secret('fake-visual-proxy-password');await shot('03-proxy-password.png');
 await tabs(3);await toggle();await tabs(3);await page.keyboard.press('Enter');await wait('Proxy enabled');await wait('Tools: direct');await shot('04-proxy-saved.png');
 report.checks.push('Native proxy form saves endpoint, authentication, models/tools switches and project scope');
 const generation=await page.evaluate(()=>visual.generation);await page.click('#restart');await page.waitForFunction(g=>visual.generation>g&&visual.frames>0,generation);await wait('[Settings]');await click('[Settings]');await wait('Active: visual-provider · visual-model');await page.keyboard.press('Alt+f');await page.waitForFunction(()=>visual.text().split('\n')[1]?.includes('Models & providers'));
 await wait('Reasoning: high');await click('[ Edit connection ]',true);await wait('Edit provider · visual-provider');await replace('cancelled-profile');await page.keyboard.press('Escape');await wait('Active: visual-provider · visual-model');
 await click('[ Reasoning: high ]',true);await wait('Reasoning effort · visual-provider');for(let i=0;i<5;i++)await page.keyboard.press('ArrowLeft');await wait('› ‹ Provider default ›');await tabs(2);await page.keyboard.press('Enter');await wait('Reasoning: provider default');
 report.checks.push('Restart preserves reasoning effort and selecting Provider default clears it');
 await click('[ Network proxy ]');await wait('Configure network proxy');await wait('http://127.0.0.1:7890/');await wait('visual-user');await wait('A password is configured. Blank keeps it.');await wait('› [x] Enabled');await page.keyboard.press('Escape');await wait('Models & providers');await shot('05-restored.png');
 report.checks.push('Restart restores provider/model and proxy; Escape cancels editing without changing active profile');
 const ansi=await readFile(resolve(output,'terminal.ansi'),'utf8');for(const secret of ['fake-visual-api-key','fake-visual-proxy-password'])if(ansi.includes(secret))throw Error('Secret leaked to terminal output');
 if(report.errors.length)throw Error(report.errors.join('\n'));report.ok=true;
}catch(error){report.ok=false;report.errors.push(String(error));process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});if(page)await writeFile(resolve(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
