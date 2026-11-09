// Composer attachment lifecycle through the real PTY, including compiled builds.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-ghost-lifecycle');
await mkdir(output,{recursive:true});
const report={executable:process.env.VISUAL_EXECUTABLE??'source fixture',ok:false,checks:[],screenshots:[],errors:[]};
let server,browser,page;
try {
 const {NO_COLOR,...visualEnv}=process.env; // This scenario explicitly verifies motion.
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...visualEnv,VISUAL_OUTPUT:output,VISUAL_GRAPHICS:'off'},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('PTY server startup timed out')),15000);let text='';
  server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  server.once('exit',code=>{clearTimeout(timer);reject(Error(`PTY server exited ${code}`));});
 });
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1200,height:850}});page.on('pageerror',error=>report.errors.push(String(error)));
 await page.goto(url);
 const waitText=text=>page.waitForFunction(text=>visual.text().includes(text),text,{timeout:15000});
 async function click(col,row){const p=await page.evaluate(({col,row})=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};},{col,row});await page.mouse.click(p.x,p.y);return p;}
 async function locate(text){return page.evaluate(text=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(text));if(row<0)throw Error(`Missing terminal text: ${text}`);return{row,col:lines[row].indexOf(text)};},text);}
 async function clickText(text){const p=await locate(text);return click(p.col+1,p.row);}
 async function shot(name){await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);}
 async function command(text){await clickText('›');await page.keyboard.type(text);await waitText(`› ${text}`);await page.keyboard.press('Enter');}
 const art=()=>page.evaluate(()=>{const lines=visual.text().split('\n'),start=lines.findIndex(l=>l.includes('Message ·'));return lines.slice(start+1,start+5).map(l=>l.slice(0,20)).join('\n');});
 await waitText('Message · Ready');await waitText('█••█');
 if(await page.evaluate(()=>visual.text().includes('Ghost')||visual.graphics.active!==0))throw Error('Mascot created a separate pane or raster');
 await shot('00-composer-wisp.png');
 const first=await art();await page.waitForFunction(first=>{const lines=visual.text().split('\n'),start=lines.findIndex(l=>l.includes('Message ·'));return lines.slice(start+1,start+5).map(l=>l.slice(0,20)).join('\n')!==first;},first);
 report.checks.push('Supplied Unicode frames animate inside Message without a mascot window or graphics protocol');
 await command('/mascot pause');await waitText('paused');
 const paused=await art();await page.waitForTimeout(600);
 if(await art()!==paused)throw Error('Paused frame advanced');
 await shot('01-composer-paused.png');
 await command('/mascot pet');await waitText('Done!');await shot('02-composer-done.png');
 await waitText('Message · Ready');
 await clickText('›');await page.keyboard.type('Keep this draft while resizing');await waitText('Keep this draft while resizing');
 await page.evaluate(()=>visual.terminal.resize(48,18));await waitText('Keep this draft while resizing');
 await page.waitForFunction(()=>!visual.text().includes('█••█')&&visual.text().includes('Message · Ready'));
 await shot('03-compact-status.png');
 await page.evaluate(()=>visual.terminal.resize(100,30));await waitText('█••█');await waitText('Keep this draft while resizing');
 for(const _ of 'Keep this draft while resizing')await page.keyboard.press('Backspace');await page.waitForFunction(()=>!visual.text().includes('Keep this draft while resizing'));
 await command('/mascot off');await page.waitForFunction(()=>!visual.text().includes('Message ·'));
 await shot('04-disabled.png');
 await command('/mascot on');await waitText('█••█');
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(g=>visual.generation>g,generation);await waitText('Message · Ready');await waitText('paused');
 await command('/mascot resume');await page.waitForFunction(()=>!visual.text().includes('paused'));
 await shot('05-restored.png');
 report.checks.push('Pause freezes frames, pet flashes done, narrow mode retains status and draft, off restores input space, preferences survive restart');
 report.ok=true;
} catch(error){report.errors.push(String(error));process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const end=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await end;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
