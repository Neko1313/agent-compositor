import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {createOpenTuiFinder} from './opentui-finder.mjs';
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-btw'),timeout=20000;
const report={ok:false,checks:[],screenshots:[],errors:[]};let server,serverExit,browser,page,launch;
await mkdir(output,{recursive:true});
async function observe(read,accept,reason){let value;const end=Date.now()+timeout;while(Date.now()<end){value=await read().catch(()=>undefined);if(value!==undefined&&accept(value))return value;await delay(25);}throw Error(reason+': '+JSON.stringify(value));}
try{
 const runtime=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI','VISUAL_EXECUTABLE'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtime,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_CHILD:'1',VISUAL_OPENTUI_BTW:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off'},stdio:['ignore','pipe','inherit']});
 serverExit=new Promise(done=>server.once('close',done));
 const url=await new Promise((done,fail)=>{let value='';const timer=setTimeout(()=>fail(Error('Bench startup timed out')),30000);server.once('error',fail);serverExit.then(code=>fail(Error('Bench exited '+code)));server.stdout.on('data',chunk=>{value+=chunk;const match=value.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(url);
 const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
 const wait=value=>page.waitForFunction(value=>!visual.terminal.modes?.synchronizedOutputMode&&visual.text().includes(value),value).catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
 const absent=value=>page.waitForFunction(value=>!visual.text().includes(value),value);
 const finder=createOpenTuiFinder({page,key,wait,absent});
 const json=path=>readFile(path,'utf8').then(JSON.parse);
 launch=await observe(()=>json(join(output,'opentui-app-launch.json')),value=>Boolean(value.child),'Actual child fixture');
 report.mode=launch.mode;
 if(process.env.VISUAL_EXECUTABLE){assert.equal(launch.executable,resolve(process.env.VISUAL_EXECUTABLE));assert.equal(createHash('sha256').update(await readFile(launch.executable)).digest('hex'),launch.sha256);report.executable={path:launch.executable,sha256:launch.sha256};}
 async function command(value){await key('Alt+0');await wait('Main · focused');await key('Alt+w');await wait('WINDOW MODE');if(!(await screen()).includes('WINDOW MODE · Zoomed'))await key('f');await wait('WINDOW MODE · Zoomed');await key('Escape');await finder.normal();await key('End');await key('Control+u');await page.keyboard.type(value);await wait(value);await key('Enter');}
 async function pick(label){await finder.pick(label);await wait(label+' · focused');}
 async function capture(name){
  await page.evaluate(()=>new Promise(done=>{const sub=visual.terminal.onRender(()=>{sub.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
  const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(output,name+'.png')});
  const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await writeFile(join(output,name+'.txt'),after.text);
  assert.deepEqual(after,before,'Screenshot must capture one stable terminal frame');report.screenshots.push(name+'.png');
 }
 await wait('Alt+W Arrange');await command('BTW_MAIN_HOLD');await wait('BTW_MAIN_WORKING');await wait('Main · Running');
 await command('/btw BTW_SIDE_QUESTION');await wait('Side conversation');await pick('Side conversation');await wait('BTW_SIDE_ANSWER');
 await capture('01-side-during-main');
 await key('Tab');await page.keyboard.type('BTW_SIDE_FOLLOWUP');await wait('BTW_SIDE_FOLLOWUP');await key('Enter');await wait('BTW_SIDE_FOLLOWUP_ANSWER');
 await key('Alt+0');await wait('Main · focused');await wait('BTW_MAIN_WORKING');await wait('Main · Running');
 await page.keyboard.type('BTW_MAIN_DRAFT');await wait('BTW_MAIN_DRAFT');await pick('Side conversation');await page.keyboard.type('BTW_SIDE_DRAFT');await wait('BTW_SIDE_DRAFT');
 await key('Alt+0');await wait('Main · focused');await wait('BTW_MAIN_DRAFT');await wait('Main · Running');await capture('02-main-draft-retained');
 const draftDirectory=join(launch.state,'agent-drafts');
 await observe(async()=>Promise.all((await readdir(draftDirectory)).filter(name=>name.endsWith('.json')).map(name=>json(join(draftDirectory,name)))),values=>values.includes('BTW_SIDE_DRAFT'),'Side draft must reach durable storage after switching');
 await pick('Side conversation');await wait('BTW_SIDE_DRAFT');await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await finder.normal();
 await key('Alt+0');await wait('Main · focused');await wait('BTW_MAIN_DRAFT');await wait('Main · Running');
 await command('/btw');await pick('Side conversation');await wait('BTW_SIDE_DRAFT');await wait('BTW_SIDE_FOLLOWUP_ANSWER');await capture('03-side-reopened');
 await key('Alt+0');await wait('Main · focused');await key('Control+x');await wait('Main · Ready');
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(value=>visual.generation>value,generation);await wait('Alt+W Arrange');
 await command('/btw');await wait('Side conversation');await pick('Side conversation');await wait('BTW_SIDE_FOLLOWUP_ANSWER');await wait('BTW_SIDE_DRAFT');await capture('04-side-after-restart');
 const http=(await readFile(join(output,'app-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),completions=http.filter(row=>row.kind==='completion');
 assert.equal(completions.length,3);assert.deepEqual(completions.map(row=>row.body.messages.filter(message=>message.role==='user').at(-1).content),['BTW_MAIN_HOLD','BTW_SIDE_QUESTION','BTW_SIDE_FOLLOWUP']);
 report.checks.push('Main remains running while /btw opens and replies','Side follow-up uses its own conversation while Main keeps its draft','Closing and reopening /btw retains the side draft and history','After restart /btw restores the side draft and history','Only the three explicit prompts reached the loopback provider');report.ok=true;
}catch(error){report.errors.push(String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
