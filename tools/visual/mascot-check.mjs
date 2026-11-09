// Native-graphics lifecycle through real terminal input, including compiled builds.
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
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...process.env,VISUAL_OUTPUT:output,VISUAL_GRAPHICS:'kitty'},stdio:['ignore','pipe','inherit']});
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
 async function fullscreen(){await clickText('Ghost');await page.waitForFunction(()=>visual.text().split('\n').some(line=>line.includes('Ghost')&&line.includes('[F]')));const p=await page.evaluate(()=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes('Ghost'));return{row,col:lines[row].indexOf('[F]')};});if(p.col<0)throw Error('Missing Ghost fullscreen control');await click(p.col+1,p.row);}
 async function workspace(number){const p=await page.evaluate(number=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes('[Plugins]'));return{row,col:lines[row].indexOf(String(number))};},number);await click(p.col,p.row);}
 await waitText('Ghost');await waitText('[ Pet Ghost ]');
 await page.waitForFunction(()=>visual.graphics.active===1&&visual.graphics.stats.lastWidth===228);
 const first=await page.evaluate(()=>visual.graphics.stats.lastImage);
 await page.waitForFunction(first=>visual.graphics.stats.lastImage!==first,first);
 report.checks.push('228x228 animated RGBA traversed the actual PTY; frames change without character rasterization');
 await shot('00-native-start.png');
 await command('/mascot pause');await waitText('[ Resume ]');
 const paused=await page.evaluate(()=>visual.graphics.stats.lastImage);
 await page.waitForTimeout(400); // Two source frame deadlines: explicitly test the pause interval.
 if(await page.evaluate(()=>visual.graphics.stats.lastImage)!==paused)throw Error('Paused image advanced');
 await fullscreen();await page.waitForFunction(()=>visual.text().split('\n').find(line=>line.includes('Ghost'))?.startsWith('│ Ghost'));
 await shot('01-native-fullscreen.png');
 await fullscreen();await waitText('Conversation');
 // Move Ghost to workspace 2 by dragging its actual terminal title onto the bar.
 const title=await clickText('Ghost');
 const target=await page.evaluate(()=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes('[Plugins]')),col=lines[row].indexOf('2'),r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};});
 await page.mouse.move(title.x,title.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:10});await page.mouse.up();
 await page.waitForFunction(()=>visual.text().includes('[2]')&&visual.text().includes('Ghost')&&visual.graphics.active===1);
 await workspace(1);
 await page.waitForFunction(()=>!visual.text().includes('Ghost')&&visual.graphics.active===0);
 await shot('02-native-hidden.png');
 await workspace(2);await waitText('Ghost');await page.waitForFunction(()=>visual.graphics.active===1);
 await shot('03-native-workspace-two.png');
 report.checks.push('Native image follows fullscreen and title drag to workspace 2; old placement is removed while hidden');
 const oldRows=await page.evaluate(()=>visual.graphics.stats.lastPlacement.r);
 await page.evaluate(()=>visual.terminal.resize(70,22));
 await page.waitForFunction(oldRows=>{const p=visual.graphics.stats.lastPlacement;return p&&p.r<oldRows&&p.x+p.c<=70&&p.y+p.r<=22&&visual.graphics.active===1&&visual.text().includes('Ghost');},oldRows);
 await shot('04-native-resized.png');
 report.checks.push('Resize updates the emitted image cell rectangle without changing source resolution');
 await command('/mascot off');await page.waitForFunction(()=>!visual.text().includes('Ghost')&&visual.graphics.active===0);
 await shot('05-native-closed.png');
 report.checks.push('Pause holds the frame; disabling the plugin removes its image from the terminal');
 report.errors.push(...await page.evaluate(()=>visual.graphics.stats.errors));
 if(report.errors.length)throw Error(report.errors.join('\n'));
 report.ok=true;
} catch(error){report.errors.push(String(error));process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const end=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await end;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
