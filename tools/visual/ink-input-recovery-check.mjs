import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-ink-input-recovery'),timeout=20000;
const missing=process.env.VISUAL_RECOVERY_MISSING==='1';
const report={ok:false,checks:[],screenshots:[],errors:[]};let server,serverExit,browser,page;
await mkdir(output,{recursive:true});const temp=await mkdtemp(join(tmpdir(),'ink-input-recovery-')),plugin=join(temp,'input-recovery-proof'),evidence=join(output,'evidence.json');await mkdir(plugin);
await writeFile(join(plugin,'plugin.json'),JSON.stringify({name:'input-recovery-proof',version:'1.0.0',trust:'trusted',main:'hooks.js',commands:[{name:'/recover-proof',description:'Recovery proof',ui:{site:'main'}}]}));
await writeFile(join(plugin,'hooks.js'),`import {writeFileSync} from 'node:fs';const evidence=${JSON.stringify(evidence)};
export default {
 'ui.press':async(event,$)=>{if(event.site!=='plugin-input-recovery-proof-main')return;
   if(event.key==='command:/recover-proof')return $.ui.view('main','Recovery proof',{input:{id:'first',label:'Reply',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]},{site:'split',focus:true});
   if(event.key==='send'){await new Promise(done=>setTimeout(done,250));if(${missing}){await $.ui.view('main','Recovery proof',{lines:[{text:'FIELD MISSING'}]});setTimeout(()=>void $.ui.view('main','Recovery proof',{input:{id:'next',label:'Reply',value:'SERVER_VALUE',submitAction:'send'},lines:[{text:'Send',action:'send'}]}),1200);return;}return $.ui.view('main','Recovery proof',{input:{id:'next',label:'Reply',value:'SERVER_VALUE',submitAction:'send'},lines:[{text:'Send',action:'send'}]});}},
 'ui.change':event=>{if(event.site==='plugin-input-recovery-proof-main')writeFileSync(evidence,JSON.stringify({id:event.id,value:event.value}));},
};`);
async function observe(read,accept,reason){let value;const end=Date.now()+timeout;while(Date.now()<end){value=await read().catch(()=>undefined);if(value!==undefined&&accept(value))return value;await delay(25);}throw Error(reason+': '+JSON.stringify(value));}
try{
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...process.env,VISUAL_CERT_PLUGIN:'input-recovery-proof',VISUAL_PLUGIN_DIR:plugin,VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off'},stdio:['ignore','pipe','inherit']});serverExit=new Promise(done=>server.once('close',done));
 const url=await new Promise((done,fail)=>{let value='';const timer=setTimeout(()=>fail(Error('Bench startup timed out')),30000);server.once('error',fail);serverExit.then(code=>fail(Error('Bench exited '+code)));server.stdout.on('data',chunk=>{value+=chunk;const match=value.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1400,height:1100}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=value=>page.waitForFunction(value=>visual.text().includes(value),value),screen=()=>page.evaluate(()=>visual.text());
 async function capture(name){await page.evaluate(()=>new Promise(done=>{const sub=visual.terminal.onRender(()=>{sub.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(output,name+'.png')});const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));assert.deepEqual(after,before);await writeFile(join(output,name+'.txt'),after.text);report.screenshots.push(name+'.png');}
 await wait('Describe your task');await page.keyboard.type('/recover-proof');await wait('› /recover-proof');await page.keyboard.press('Enter');await wait('Recovery proof');await wait('Reply:');
 await page.keyboard.press('Alt+f');await wait('FULLSCREEN');await page.keyboard.type('INK_FIRST');await wait('INK_FIRST');await page.keyboard.press('Enter');await page.keyboard.type('_LATER');
 if(missing){await wait('Waiting for an input to restore');await capture('00-missing');}
 await wait('Restore queued input');await wait('SERVER_VALUE');
 assert.ok(!(await screen()).includes('INK_FIRST_LATER'));await capture('01-conflict');await page.keyboard.press('Control+r');
 await observe(()=>readFile(evidence,'utf8').then(JSON.parse),value=>value.id==='next'&&value.value==='INK_FIRST_LATER','Restored value reaches actual plugin');await wait('INK_FIRST_LATER');await page.waitForFunction(()=>!visual.text().includes('Restore queued input'));await capture('02-recovered');
 report.checks.push(missing?'Actual Ink retains later input while the field is absent':'Actual Ink preserves later input beside a conflicting producer value','Ctrl+R explicitly restores the exact input without a model request');report.ok=true;
}catch(error){report.errors.push(String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}await rm(temp,{recursive:true,force:true});await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
