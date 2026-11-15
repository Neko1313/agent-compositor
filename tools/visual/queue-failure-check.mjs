import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-queue-failure');await mkdir(output,{recursive:true});
const report={ok:false,checks:[],screenshots:[],errors:[]};let server,browser,page;
try{
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...process.env,VISUAL_RECOVERY:'1',...(process.env.VISUAL_INPUT_WRITE_FAIL?{VISUAL_INPUT_WRITE_FAIL:'1'}:{VISUAL_QUEUE_WRITE_FAIL:'1'}),VISUAL_OUTPUT:output},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Server timeout')),15000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});server.once('exit',code=>fail(Error('Server exit '+code)));});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1400,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=text=>page.waitForFunction(value=>visual.text().includes(value),text,{timeout:20000});
 async function send(text){await page.keyboard.press('Alt+i');await page.keyboard.type(text);await page.waitForFunction(value=>visual.text().split('\n').some(line=>line.includes('› '+value)),text);await page.keyboard.press('Enter');}
 async function shot(name){await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);}
 await wait('Describe your task');
 if(!process.env.VISUAL_INPUT_WRITE_FAIL){await send('HOLD_FOR_RECOVERY');await wait('RECOVERY_HOLDING');}
 await send('UNSAVED_FOLLOWUP');await wait('Message was not accepted');
 await page.waitForFunction(()=>visual.text().split('\n').some(line=>line.includes('› UNSAVED_FOLLOWUP')));
 await shot('01-queue-write-failure.png');
 report.checks.push('A rejected input journal write returns the unaccepted message to the Ink editor');report.ok=!report.errors.length;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const end=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await end;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
