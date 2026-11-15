import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {createOpenTuiFinder} from './opentui-finder.mjs';
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-agent-drafts'),timeout=20000;
const report={ok:false,checks:[],screenshots:[],errors:[]};let server,serverExit,browser,page,launch;
await mkdir(output,{recursive:true});
async function observe(read,accept,reason){let value;const end=Date.now()+timeout;while(Date.now()<end){value=await read().catch(()=>undefined);if(value!==undefined&&accept(value))return value;await delay(25);}throw Error(reason+': '+JSON.stringify(value));}
try{
 const runtime=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtime,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_CHILD:'1',VISUAL_OPENTUI_AGENT_DRAFTS:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off'},stdio:['ignore','pipe','inherit']});
 serverExit=new Promise(done=>server.once('close',done));
 const url=await new Promise((done,fail)=>{let value='';const timer=setTimeout(()=>fail(Error('Bench startup timed out')),30000);server.once('error',fail);serverExit.then(code=>fail(Error('Bench exited '+code)));server.stdout.on('data',chunk=>{value+=chunk;const match=value.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(url);
 const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
 const wait=value=>page.waitForFunction(value=>!visual.terminal.modes?.synchronizedOutputMode&&visual.text().includes(value),value);
 const absent=value=>page.waitForFunction(value=>!visual.text().includes(value),value);
 const finder=createOpenTuiFinder({page,key,wait,absent});
 const json=path=>readFile(path,'utf8').then(JSON.parse);
 launch=await observe(()=>json(join(output,'opentui-app-launch.json')),value=>Boolean(value.child),'Actual child fixture');
 async function command(value){await key('Alt+0');await wait('Main · focused');await key('Alt+w');await wait('WINDOW MODE');if(!(await screen()).includes('WINDOW MODE · Zoomed'))await key('f');await wait('WINDOW MODE · Zoomed');await key('Escape');await finder.normal();await key('End');await key('Control+u');await page.keyboard.type(value);await wait(value);await key('Enter');}
 async function pick(label){await finder.pick(label);await wait(label+' · focused');}
 async function capture(name){
  await page.evaluate(()=>new Promise(done=>{const sub=visual.terminal.onRender(()=>{sub.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
  const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(output,name+'.png')});
  const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await writeFile(join(output,name+'.txt'),after.text);
  assert.deepEqual(after,before,'Screenshot must capture one stable terminal frame');report.screenshots.push(name+'.png');
 }
 await wait('Main · focused');
 await command('/child-proof managed-create');await observe(()=>json(launch.child.managed),value=>Boolean(value.first),'First actual agent');
 await command('/child-proof managed-create-last');const ids=await observe(()=>json(launch.child.managed),value=>Boolean(value.first&&value.last),'Two actual agents');
 await pick('Managed proof');await key('Tab');await page.keyboard.type('OPENTUI_FIRST_DRAFT');await wait('OPENTUI_FIRST_DRAFT');
 await pick('Managed shutdown proof');await key('Tab');await page.keyboard.type('OPENTUI_SECOND_DRAFT');await wait('OPENTUI_SECOND_DRAFT');
 const file=id=>join(launch.state,'agent-drafts',createHash('sha256').update(id).digest('hex')+'.json');
 await observe(()=>Promise.all([ids.first,ids.last].map(id=>json(file(id)))),values=>values[0]==='OPENTUI_FIRST_DRAFT'&&values[1]==='OPENTUI_SECOND_DRAFT','Both private drafts persisted');
 await capture('01-two-drafts');
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(value=>visual.generation>value,generation);await wait('Alt+W Arrange');
 await pick('Managed proof');await wait('OPENTUI_FIRST_DRAFT');assert.ok(!(await screen()).includes('OPENTUI_SECOND_DRAFT'));await capture('02-first-restored');
 await pick('Managed shutdown proof');await wait('OPENTUI_SECOND_DRAFT');assert.ok(!(await screen()).includes('OPENTUI_FIRST_DRAFT'));await capture('03-second-restored');
 await command('/child-proof repaint');await pick('Repaint proof');await key('Tab');await page.keyboard.type('OPENTUI_REPAINT_FIELD');await wait('OPENTUI_REPAINT_FIELD');
 await pick('Managed proof');await observe(()=>json(launch.child.managed+'.repaint'),value=>value==='OPENTUI_REPAINT_FIELD','Repainting producer receives exact latest field');
 await pick('Repaint proof');await wait('OPENTUI_REPAINT_FIELD');await capture('04-repainting-field');
 await key('End');await key('Control+u');await page.keyboard.type('REPAINT_ENTER_PROOF');await wait('REPAINT_ENTER_PROOF');await key('Enter');await observe(()=>json(launch.child.managed+'.submitted'),value=>value==='REPAINT_ENTER_PROOF','Submit waits for the last repaint input');
 await pick('Managed proof');await key('Tab');await key('End');await key('Control+u');await page.keyboard.type('REPLY_ENTER_PROOF');await wait('REPLY_ENTER_PROOF');await key('Enter');await wait('REPLY_ENTER_DONE');await capture('05-reply-enter');
 const receipt=await json(join(output,'opentui-app-launch.json'));assert.equal(receipt.launches.length,2);assert.ok(receipt.launches[1].command.includes('--resume'));
 const http=(await readFile(join(output,'app-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),completions=http.filter(row=>row.kind==='completion');assert.equal(completions.length,1);assert.equal(completions[0].body.messages.filter(message=>message.role==='user').at(-1).content,'REPLY_ENTER_PROOF');
 report.checks.push('Actual OpenTUI creates two managed agents and writes independent Reply fields through native input','Both private draft files survive process replacement and the resumed UI restores each agent without cross-contamination','Repainting producer receives the entire rapid edit before the window changes','Enter waits for the final delayed input and submits the exact value','Enter submits exactly one Reply through the isolated loopback provider');report.ok=true;
}catch(error){report.errors.push(String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
