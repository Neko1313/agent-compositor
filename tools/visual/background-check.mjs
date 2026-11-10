import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-background');await mkdir(output,{recursive:true});await writeFile(resolve(output,'provider-requests.jsonl'),'');
for(const name of ['failure.png','failure.txt'])await rm(resolve(output,name),{force:true});
let server,browser,page;const report={checks:[],screenshots:[],errors:[]};
try{
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...process.env,VISUAL_OUTPUT:output,VISUAL_BACKGROUND:'1'},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((accept,reject)=>{let data='';const timer=setTimeout(()=>reject(Error('Bench startup timed out')),15000);server.stdout.on('data',chunk=>{data+=chunk;const match=data.match(/VISUAL_URL=(http\S+)/);if(match){clearTimeout(timer);accept(match[1]);}});server.once('exit',code=>{clearTimeout(timer);reject(Error(`Bench exited ${code}`));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=text=>page.waitForFunction(text=>window.visual?.text().includes(text),text,{timeout:15000});
 const focus=async()=>{const point=await page.evaluate(()=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes('Describe your task')),rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+8*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};});await page.mouse.click(point.x,point.y);};
 const send=async text=>{await focus();await page.keyboard.type(text);await wait('› '+text);await page.keyboard.press('Enter');};
 const shot=async name=>{await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);};
 await wait('0/3 complete');await page.evaluate(()=>visual.terminal.resize(140,40));await page.waitForFunction(()=>visual.text().split('\n')[38]?.includes('[Settings]'));
 await send('Begin interrupt proof');await wait('Working');await page.keyboard.press('Control+c');await wait('Interrupted');report.checks.push('Actual PTY Ctrl+C interrupts a busy turn without closing the session');
 await send('Start background proof');await wait('Background is running');await shot('01-background-ready.png');
 await send('Can we keep chatting');await wait('Still talking while the job runs');
 const before=(await readFile(resolve(output,'provider-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);if(before.filter(e=>e.event==='open').length!==4||before.filter(e=>e.event==='closed').length!==4)throw Error('Provider stream remained open or extra polling requests occurred');
 await focus();await page.keyboard.type('Unsent draft stays here');await wait('› Unsent draft stays here');await shot('02-chat-and-draft.png');
 await wait('Background result reviewed: BACKGROUND_FINISHED');await wait('› Unsent draft stays here');await shot('03-completion-preserved-draft.png');
 const after=(await readFile(resolve(output,'provider-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);report.providerRequests=after.filter(e=>e.event==='open').length;if(report.providerRequests!==6)throw Error('Expected launch, chat and one completion/output continuation without polling');
 report.checks.push('A real background shell leaves the model stream closed, foreground chat works, one completion reads its result, and the unsent draft survives');
 if(report.errors.length)throw Error(report.errors.join('\n'));report.ok=true;
}catch(error){report.ok=false;report.errors.push(String(error));process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});if(page)await writeFile(resolve(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await stopped;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
