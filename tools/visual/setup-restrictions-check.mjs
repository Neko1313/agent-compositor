import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';

const output=resolve(process.env.VISUAL_OUTPUT??'dist/setup-restrictions');await mkdir(output,{recursive:true});
const native=process.env.VISUAL_ONBOARDING_OPENTUI==='1';
const report={ok:false,renderer:native?'opentui':'ink',checks:[],errors:[]};let server,browser,page;
try{
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...process.env,VISUAL_ONBOARDING:'1',VISUAL_ONBOARDING_BLOCK_CHECKS:'1',VISUAL_OUTPUT:output},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Setup bench startup timeout')),15000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});server.once('exit',code=>{clearTimeout(timer);fail(Error('Bench exited '+code));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1400,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=value=>page.waitForFunction(value=>visual.text().includes(value),value,{timeout:15000});
 const click=async label=>{await wait(label);const point=await page.evaluate(label=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(label)),col=lines[row].indexOf(label)+1,rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};},label);await page.mouse.click(point.x,point.y);};
 await wait('Get started');await click('Choose recommended tools');await wait('Choose your work');if(native)await page.keyboard.press('Alt+Enter');else await click('Continue');
 await wait('Choose optional tools');await wait('disabledPlugins');const initial=(await page.evaluate(()=>visual.text())).split('\n'),field=initial.findIndex(line=>line.includes('Project checks'));assert.ok(field>=0);assert.match(initial.slice(field,field+4).join('\n'),/\[ \] Disabled/);await page.screenshot({path:join(output,'restricted-option.png')});
 await page.keyboard.press('Space');if(native)await page.keyboard.press('Alt+Enter');else{for(let i=0;i<7;i++)await page.keyboard.press('Tab');await page.keyboard.press('Enter');}
 await wait('project-checks:');await wait('disabledPlugins');const identity=JSON.parse(await readFile(join(output,'onboarding-identity.json'),'utf8'));
 const state=await readFile(join(identity.state,'extensions-state.json'),'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return{};throw error;});
 assert.ok(!state.installed?.['project-checks']);assert.ok(!state.enabled?.includes('project-checks'));
 const config=JSON.parse(await readFile(join(identity.cwd,'agent-compositor.json'),'utf8'));assert.ok(config.disabledPlugins.includes('project-checks'));
 const transport=JSON.parse(await readFile(join(output,'onboarding-transport.json'),'utf8'));assert.equal(transport.requests,0);
 await page.screenshot({path:join(output,'restriction-result.png')});report.checks.push('restriction.visible-and-unchecked','restriction.no-install-or-enable','restriction.config-preserved','restriction.no-model-request');
 assert.equal(report.errors.length,0);report.ok=true;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const ended=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await ended;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
