import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-question-queue');await mkdir(output,{recursive:true});
const report={ok:false,checks:[],screenshots:[],errors:[]};let server,browser,page;
try{
 const env=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...env,VISUAL_OPENTUI_APP:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off'},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Server timeout')),20000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});server.once('exit',code=>fail(Error('Server exit '+code)));});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=text=>page.waitForFunction(value=>visual.text().includes(value),text,{timeout:20000});
 const shot=async name=>{await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);};
 async function click(text){await wait(text);const point=await page.evaluate(value=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(value)),col=lines[row].indexOf(value)+1,r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};},text);await page.mouse.click(point.x,point.y);}
 const receipts=()=>readFile(join(output,'app-http.jsonl'),'utf8').then(text=>text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(item=>item.kind==='completion'));
 await wait('Message Main');await page.keyboard.press('Alt+0');await page.keyboard.type('APP_QUESTION');await wait('APP_QUESTION');await page.keyboard.press('Enter');
 await wait('MAIN_QUESTION: choose deployment');await click('Edit answer');await click('[ ] Production');await wait('[x] Production');await click('Draft');await wait('Enter queue');
 await page.keyboard.type('APP_RESTORED');await wait('APP_RESTORED');await page.keyboard.press('Enter');await wait('Queued: APP_RESTORED');
 if((await receipts()).length!==1)throw Error('Queuing a message answered or advanced the pending question');
 await shot('01-question-and-queued.png');await click('Edit answer');await wait('[x] Production');await page.keyboard.press('Alt+Enter');
 await wait('APP_ANSWER_RECEIVED: Production');await wait('APP_RESTORED: Production retained');await shot('02-answer-and-followup.png');
 const requests=await receipts();if(requests.length!==3)throw Error(`Expected original, answer and queued turns; got ${requests.length}`);
 if(requests[2].body.messages.filter(message=>message.role==='user').at(-1)?.content!=='APP_RESTORED')throw Error('The queued prompt did not reach the next turn');
 report.checks.push('A queued message does not answer a pending question and runs after the explicit selected answer');report.ok=!report.errors.length;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const end=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await end;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
