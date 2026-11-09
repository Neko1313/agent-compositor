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
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...visualEnv,VISUAL_OUTPUT:output,VISUAL_GRAPHICS:'kitty'},stdio:['ignore','pipe','inherit']});
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
 await waitText('Message · Ready');
 await page.waitForFunction(()=>visual.graphics.active===1&&visual.graphics.stats.lastWidth>0);
 if(await page.evaluate(()=>visual.text().includes('Ghost')&&visual.text().split('\n').some(l=>l.includes('Ghost')&&l.includes('[F]'))))throw Error('Mascot created a separate pane');
 report.sourcePixels=await page.evaluate(()=>({width:visual.graphics.stats.lastWidth,height:visual.graphics.stats.lastHeight}));
 await shot('00-composer-ghost.png');
 const first=await page.evaluate(()=>visual.graphics.stats.lastImage);
 await page.waitForFunction(first=>visual.graphics.stats.lastImage!==first,first);
 report.checks.push('Full-resolution source frames reach the composer via actual PTY graphics; no block sprite or separate window');
 if(process.env.VISUAL_MASCOT_GIF){
  report.playback=await page.evaluate(()=>new Promise(resolve=>{
   const start=performance.now();let last=visual.graphics.stats.lastImage,changes=0;
   const sample=()=>{const image=visual.graphics.stats.lastImage;if(image!==last){changes++;last=image;}const elapsed=performance.now()-start;if(elapsed>=2000)resolve({changes,elapsedMs:elapsed,observedFrameChangesPerSecond:changes*1000/elapsed});else requestAnimationFrame(sample);};requestAnimationFrame(sample);
  }));
  if(process.env.VISUAL_EXPECT_MIN_FPS&&report.playback.observedFrameChangesPerSecond<Number(process.env.VISUAL_EXPECT_MIN_FPS))throw Error('Native GIF playback below the explicit test threshold');
 }

 await command('/mascot pause');await waitText('paused');
 const paused=await page.evaluate(()=>visual.graphics.stats.lastImage);await page.waitForTimeout(600);
 if(await page.evaluate(()=>visual.graphics.stats.lastImage)!==paused)throw Error('Paused frame advanced');
 await shot('01-composer-paused.png');
 await command('/mascot pet');await waitText('Done!');await shot('02-composer-done.png');
 await waitText('Message · Ready');
 await clickText('›');await page.keyboard.type('Keep this draft while resizing');await waitText('Keep this draft while resizing');
 await page.evaluate(()=>visual.terminal.resize(48,18));await waitText('Keep this draft while resizing');
 await page.waitForFunction(()=>visual.graphics.active===0&&visual.text().includes('Message · Ready'));
 await shot('03-compact-status.png');
 await page.evaluate(()=>visual.terminal.resize(100,30));await page.waitForFunction(()=>visual.graphics.active===1);await waitText('Keep this draft while resizing');
 for(const _ of 'Keep this draft while resizing')await page.keyboard.press('Backspace');await page.waitForFunction(()=>!visual.text().includes('Keep this draft while resizing'));
 await command('/mascot off');await page.waitForFunction(()=>!visual.text().includes('Message ·'));
 await shot('04-disabled.png');
 await command('/mascot on');await page.waitForFunction(()=>visual.graphics.active===1);
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(g=>visual.generation>g,generation);await waitText('Message · Ready');await waitText('paused');
 await command('/mascot resume');await page.waitForFunction(()=>!visual.text().includes('paused'));
 await shot('05-restored.png');
 report.checks.push('Pause freezes source time, pet selects done, narrow mode removes native images and preserves draft, off restores input space, preferences survive restart');
 report.ok=true;
} catch(error){report.errors.push(String(error));process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const end=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await end;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
