import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/workflow-recovery');await mkdir(output,{recursive:true});
let server,browser,page;const report={ok:false,checks:[],screenshots:[],errors:[]};
try{
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...process.env,VISUAL_OUTPUT:output,VISUAL_HARNESS:'1',VISUAL_IDENTITY_PLUGIN:'workflows'},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let out='';const timer=setTimeout(()=>fail(Error('Bench startup timed out')),15000);server.stdout.on('data',chunk=>{out+=chunk;const match=out.match(/VISUAL_URL=(http\S+)/);if(match){clearTimeout(timer);done(match[1]);}});server.once('exit',code=>{clearTimeout(timer);fail(Error('Bench exited '+code));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
 const wait=text=>page.waitForFunction(text=>visual.text().includes(text),text,{timeout:20000});
 const click=async text=>{await wait(text);const p=await page.evaluate(text=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(text)),col=lines[row].indexOf(text)+1,r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};},text);await page.mouse.click(p.x,p.y);};
 const shot=async name=>{await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await page.screenshot({path:join(output,name+'.png')});await writeFile(join(output,name+'.txt'),await page.evaluate(()=>visual.text()));report.screenshots.push(name+'.png');};
 await wait('0/3 complete');await page.evaluate(()=>visual.terminal.resize(140,40));await page.waitForFunction(()=>visual.text().split('\n')[38]?.includes('[Settings]'));
 const loaded=JSON.parse(await readFile(join(output,'fixture-identity.json'),'utf8'));assert.equal(loaded.plugin,'workflows');
 await click('Describe your task');await page.keyboard.type('/workflow-fail-proof');await wait('› /workflow-fail-proof');await page.keyboard.press('Enter');
 await wait('Recovery proof');await click('Workflows');await page.keyboard.press('Alt+f');await wait('Progress');
 await page.waitForFunction(()=>visual.text().split('\n').some(line=>line.includes('Recovery proof')&&line.includes('failed')),undefined,{timeout:20000});
 await click('+ Recovery proof');await click('[ Inspect stages ]');await wait('Open a failed stage and retry it to resume.');
 assert.equal((await page.evaluate(()=>visual.text())).includes('[ Resume workflow ]'),false);await shot('failed-workflow');
 await click('+ Broken discovery');await wait('[ Retry selected stage ]');await shot('failed-stage');await click('[ Retry selected stage ]');
 const deadline=Date.now()+20000;let retried=false;while(Date.now()<deadline){for(const file of await readdir(join(loaded.state,'workflows','runs'))){if(!file.endsWith('.json'))continue;const run=JSON.parse(await readFile(join(loaded.state,'workflows','runs',file),'utf8'));if(run.title==='Recovery proof'&&run.stages[0].attempts>=2&&run.stages[0].status==='failed')retried=true;}if(retried)break;await new Promise(done=>setTimeout(done,50));}
 assert.ok(retried,'The selected stage must actually retry and fail again with the scripted provider');report.checks.push('failed-workflow-has-actionable-retry','retry-runs-selected-stage');assert.equal(report.errors.length,0);report.ok=true;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});if(page)await writeFile(join(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await stopped;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
