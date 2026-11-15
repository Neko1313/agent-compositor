import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createOpenTuiFinder} from './opentui-finder.mjs';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-resources'),timeout=20000;
const report={ok:false,checks:[],screenshots:[],errors:[]};let server,serverExit,browser,page;
await mkdir(output,{recursive:true});
try{
 const runtime=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI','VISUAL_EXECUTABLE'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtime,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_CHILD:'1',VISUAL_OPENTUI_BTW:'1',VISUAL_OPENTUI_RESOURCES:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off'},stdio:['ignore','pipe','inherit']});
 serverExit=new Promise(done=>server.once('close',done));
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Bench startup timed out')),30000);server.once('error',fail);serverExit.then(code=>fail(Error('Bench exited '+code)));server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
 const wait=value=>page.waitForFunction(value=>!visual.terminal.modes?.synchronizedOutputMode&&visual.text().includes(value),value).catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
 const absent=value=>page.waitForFunction(value=>!visual.text().includes(value),value);
 const finder=createOpenTuiFinder({page,key,wait,absent});
 const launch=JSON.parse(await readFile(join(output,'opentui-app-launch.json'),'utf8'));report.mode=launch.mode;
 if(process.env.VISUAL_EXECUTABLE){assert.equal(launch.executable,resolve(process.env.VISUAL_EXECUTABLE));assert.equal(createHash('sha256').update(await readFile(launch.executable)).digest('hex'),launch.sha256);
  const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js'),plugin=join(dirname(launch.executable),'plugins/resources/hooks.js');
  report.executable={path:launch.executable,sha256:launch.sha256,rendererSha256:createHash('sha256').update(await readFile(renderer)).digest('hex'),pluginSha256:createHash('sha256').update(await readFile(plugin)).digest('hex')};}
 async function command(value){await key('Alt+0');await wait('Main · focused');await key('Alt+w');await wait('WINDOW MODE');if(!(await screen()).includes('WINDOW MODE · Zoomed'))await key('f');await key('Escape');await finder.normal();await key('End');await key('Control+u');await page.keyboard.type(value);await wait(value);await key('Enter');}
 async function click(value){await wait(value);const point=await page.evaluate(value=>{const rows=visual.text().split('\n'),row=rows.findIndex(line=>line.includes(value)),col=rows[row].indexOf(value)+1,rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};},value);await page.mouse.click(point.x,point.y);}
 async function shot(name){await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await page.locator('#terminal').screenshot({path:join(output,name+'.png')});await writeFile(join(output,name+'.txt'),await screen());report.screenshots.push(name+'.png');}
 await wait('Alt+W Arrange');await command('BTW_MAIN_HOLD');await wait('BTW_MAIN_WORKING');await wait('Main · Running');
 await command('/resources');await finder.pick('Resources');await wait('Resources · focused');
 await key('Alt+w');await wait('WINDOW MODE');if(!(await screen()).includes('WINDOW MODE · Zoomed'))await key('f');await key('Escape');await finder.normal();await wait('CPU history (%)');
 await click('System CPU');await wait('System CPU history (%)');await page.waitForFunction(()=>/System CPU: [0-9]+\.[0-9]+%/.test(visual.text()));await shot('01-system-cpu');
 await click('System memory');await wait('System non-free memory history (MiB)');await page.waitForFunction(()=>/System memory: [0-9.]+ \/ [0-9.]+ MiB non-free/.test(visual.text()));await shot('02-system-memory');
 for(let i=0;i<6&&!(await screen()).includes('Send latest sample to agent');i++)await key('PageDown');await click('Send latest sample to agent');await wait('Resource observation queued for the agent.');
 const requests=(await readFile(join(output,'app-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.kind==='completion');assert.equal(requests.length,1);assert.ok((await screen()).includes('Working'));
 await key('Alt+0');await wait('Main · Running');await wait('BTW_MAIN_WORKING');await shot('03-main-still-running');
 assert.deepEqual(report.errors,[]);report.checks.push('System CPU and memory charts use live counters','Explicit system sample is queued while Main remains active','No additional provider request occurs');report.ok=true;
}catch(error){report.errors.push(String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
