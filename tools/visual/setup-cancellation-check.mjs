import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const output=resolve(process.env.VISUAL_OUTPUT??'dist/setup-cancellation'),native=process.env.VISUAL_ONBOARDING_OPENTUI==='1';
const report={ok:false,renderer:native?'opentui':'ink',checks:[],screenshots:[],errors:[]};let server,browser,page;
await mkdir(output,{recursive:true});
try{
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...process.env,VISUAL_ONBOARDING:'1',VISUAL_ONBOARDING_CANCEL:'1',VISUAL_OUTPUT:output},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Setup bench startup timed out')),15000);server.once('exit',code=>{clearTimeout(timer);fail(Error('Bench exited '+code));});server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)/);if(match){clearTimeout(timer);done(match[1]);}});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1400,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=value=>page.waitForFunction(value=>visual.text().includes(value),value,{timeout:20000});
 const click=async(label,windowTitle)=>{await wait(label);const point=await page.evaluate(({label,windowTitle})=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(label)&&(!windowTitle||line.includes(windowTitle))),col=lines[row].indexOf(label)+1,rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};},{label,windowTitle});await page.mouse.click(point.x,point.y);};
 const readLog=async()=>readFile(join(output,'setup-cancel-requests.jsonl'),'utf8').then(text=>text.trim().split('\n').filter(Boolean).map(JSON.parse));
 const observe=async(predicate,description)=>{const end=Date.now()+20000;let value;while(Date.now()<end){value=await readLog();if(predicate(value))return value;await delay(30);}throw Error(description+': '+JSON.stringify(value));};
 await wait('Get started');await click('Choose recommended tools');await wait('Choose your work');if(native){await wait('Choose your work · Form');await page.keyboard.press('Alt+Enter');}else await click('Continue');
 await wait('Choose optional tools');await click('Test reports');await click(native?'Install and enable':'Install and enable selected');
 await observe(rows=>rows.some(row=>row.name==='project-checks'),'First selected archive was not requested');await wait('Get started');await click('Get started');await wait('[x]');await wait('Get started · Working');
 await page.screenshot({path:join(output,'01-install-pending.png')});report.screenshots.push('01-install-pending.png');
 const keyboard=native||process.env.VISUAL_SETUP_CANCEL_KEY==='1';
 if(keyboard){await page.keyboard.press('Control+c');}else {await click('[x]','Get started');await page.waitForFunction(()=>!visual.text().includes('Choose recommended tools'),undefined,{timeout:20000});}
 await observe(rows=>rows.some(row=>row.aborted),'The held archive request did not receive cancellation');
 if(keyboard){if(native)await page.waitForFunction(()=>!visual.text().includes('Choose optional tools')&&visual.text().includes('Get started · focused'),undefined,{timeout:20000});await click('[x]','Get started');await page.waitForFunction(()=>!visual.text().includes('Choose recommended tools'),undefined,{timeout:20000});}
 await page.keyboard.press(native?'Alt+0':'Alt+i');await page.keyboard.type('/setup');await wait('/setup');await page.keyboard.press('Enter');await wait('Choose recommended tools');
 const rows=await readLog();assert.deepEqual(rows.filter(row=>row.name).map(row=>row.name),['project-checks']);
 const identity=JSON.parse(await readFile(join(output,'onboarding-identity.json'),'utf8'));
 const selection=await readFile(join(identity.state,'extensions-state.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {};throw error;});
 assert.ok(!selection.installed?.['project-checks']);assert.ok(!selection.installed?.['test-reports']);assert.ok(!selection.enabled?.includes('project-checks'));assert.ok(!selection.enabled?.includes('test-reports'));
 assert.equal(JSON.parse(await readFile(join(output,'onboarding-transport.json'),'utf8')).requests,0);
 await page.screenshot({path:join(output,'02-guide-reopened.png')});report.screenshots.push('02-guide-reopened.png');
 report.checks.push('The actual setup view cancels its held archive request','No later selected plugin is installed or enabled','The guide can reopen without a model request');report.ok=true;
}catch(error){report.errors.push(String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{await browser?.close();if(server&&server.exitCode===null){const ended=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await ended;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
