import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/setup-load-failure');await mkdir(output,{recursive:true});
const native=process.env.VISUAL_ONBOARDING_OPENTUI==='1';
const report={ok:false,renderer:native?'opentui':'ink',checks:[],screenshots:[],errors:[]};let server,browser,page;
try{
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...process.env,VISUAL_ONBOARDING:'1',VISUAL_OUTPUT:output},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Setup bench startup timeout')),15000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});server.once('exit',code=>{clearTimeout(timer);fail(Error('Bench exited '+code));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1400,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=text=>page.waitForFunction(text=>visual.text().includes(text),text,{timeout:15000});
 const click=async label=>{await wait(label);const point=await page.evaluate(label=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(label)),col=lines[row].indexOf(label)+1,rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};},label);await page.mouse.click(point.x,point.y);};
 const shot=async name=>{await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await page.screenshot({path:join(output,name+'.png')});await writeFile(join(output,name+'.txt'),await page.evaluate(()=>visual.text()));report.screenshots.push(name+'.png');};
 await wait('Get started');await click('Choose recommended tools');await wait('Choose your work');
 if(native){await wait('Choose your work · Form');await page.keyboard.press('Alt+Enter');}else await click('Continue');
 await wait('Choose optional tools');if(native)await click('Install and enable');else{for(let i=0;i<7;i++)await page.keyboard.press('Tab');await page.keyboard.press('Enter');}
 await wait('Apply pending tools: project-checks');
 const identity=JSON.parse(await readFile(join(output,'onboarding-identity.json'),'utf8'));
 const state=JSON.parse(await readFile(join(identity.state,'extensions-state.json'),'utf8'));
 const manifest=join(state.bindings['project-checks'],'plugin.json'),original=await readFile(manifest,'utf8');
 await writeFile(manifest,'{broken');await click('Apply plugin changes ]');await wait('Still pending after reload: project-checks');await shot('failed-reload');
 assert.ok((await page.evaluate(()=>visual.text())).includes('Apply pending tools: project-checks'));report.checks.push('setup.reports-pending-after-failed-reload');
 await writeFile(manifest,original);await click('Apply plugin changes ]');await wait('Tools: 1 suggested plugins active');
 await page.waitForFunction(()=>!visual.text().includes('Still pending after reload'));await shot('recovered-reload');report.checks.push('setup.clears-warning-after-recovery');
 const transport=JSON.parse(await readFile(join(output,'onboarding-transport.json'),'utf8'));assert.equal(transport.requests,0);report.checks.push('setup.no-model-requests');
 assert.equal(report.errors.length,0);report.ok=true;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const ended=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await ended;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
