import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-main-draft'),timeout=20000;
const report={ok:false,checks:[],screenshots:[],errors:[]};let server,serverExit,browser,page;
await mkdir(output,{recursive:true});
async function observe(read,accept,reason){let value;const end=Date.now()+timeout;while(Date.now()<end){value=await read().catch(()=>undefined);if(value!==undefined&&accept(value))return value;await delay(25);}throw Error(reason+': '+JSON.stringify(value));}
try{
 const runtime=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI','VISUAL_EXECUTABLE'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtime,VISUAL_OPENTUI_APP:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off',...(process.env.VISUAL_DRAFT_SCENARIO==='kill'?{VISUAL_OPENTUI_PROCESS_KILL:'1'}:{})},stdio:['ignore','pipe','inherit']});serverExit=new Promise(done=>server.once('close',done));
 const url=await new Promise((done,fail)=>{let value='';const timer=setTimeout(()=>fail(Error('Bench startup timed out')),30000);server.once('error',fail);serverExit.then(code=>fail(Error('Bench exited '+code)));server.stdout.on('data',chunk=>{value+=chunk;const match=value.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>report.errors.push(error.message));let ptyExit;
 const [socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);socket.on('framereceived',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='exit')ptyExit=value.code;}catch{}});
 const wait=value=>page.waitForFunction(value=>!visual.terminal.modes?.synchronizedOutputMode&&visual.text().includes(value),value);
 const json=path=>readFile(path,'utf8').then(JSON.parse),key=value=>page.keyboard.press(value);
 async function clickText(value){const point=await page.evaluate(value=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(value)),col=lines[row]?.indexOf(value);if(row<0||col===undefined)return;
  const rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};},value);
  assert.ok(point,'Clickable text must be visible: '+value);await page.mouse.click(point.x,point.y);}

 const http=async()=>{const text=await readFile(join(output,'app-http.jsonl'),'utf8').catch(()=> '');return text.trim()?text.trim().split('\n').map(JSON.parse):[];};
 await wait('Message Main…');const launch=await observe(()=>json(join(output,'opentui-app-launch.json')),value=>Boolean(value.state),'app launch');
 report.mode=launch.mode;let rendererPath;
 if(process.env.VISUAL_EXECUTABLE){const executable=resolve(process.env.VISUAL_EXECUTABLE),sha256=createHash('sha256').update(await readFile(executable)).digest('hex');
  assert.equal(launch.executable,executable);assert.equal(launch.sha256,sha256);
  rendererPath=join(dirname(executable),'node_modules','@agent-compositor','renderer-opentui','index.js');
  report.executable={path:executable,sha256,rendererSha256:createHash('sha256').update(await readFile(rendererPath)).digest('hex')};}
 const verifyRenderer=async()=>{if(rendererPath)assert.equal(createHash('sha256').update(await readFile(rendererPath)).digest('hex'),report.executable.rendererSha256);};

 const scenario=process.env.VISUAL_DRAFT_SCENARIO??'normal';
 if(scenario==='rapid'){
  const saved=async()=>{const directory=join(launch.state,'main-drafts-v3');return Promise.all((await readdir(directory)).filter(name=>name.endsWith('.json')).map(name=>json(join(directory,name))));};
  const leaves=records=>{const latest=new Map();for(const record of records){const prior=latest.get(record.owner);if(!prior||prior.revision<record.revision)latest.set(record.owner,record);}
   const current=[...latest.values()],parents=new Set(current.flatMap(record=>record.parents));return current.filter(record=>!parents.has(`${record.owner}:${record.revision}`));};
  await page.keyboard.type('RAPID_SENT');await key('Enter');await page.keyboard.type('_LATER');
  await observe(http,rows=>rows.filter(row=>row.kind==='completion').length===1,'first explicit submission');
  const kept=await observe(saved,records=>leaves(records).some(record=>record.text.includes('_LATER')),'later text saved');
  const retained=leaves(kept).find(record=>record.text.includes('_LATER')).text;
  assert.equal((await http()).filter(row=>row.kind==='completion')[0].body.messages.filter(message=>message.role==='user').at(-1).content,'RAPID_SENT');
  const generation=await page.evaluate(()=>visual.generation);await page.click('#restart');await page.waitForFunction(value=>visual.generation>value,generation);await wait(retained);await verifyRenderer();
  assert.equal((await http()).filter(row=>row.kind==='completion').length,1);
  await page.locator('#terminal').screenshot({path:join(output,'rapid-restored.png')});report.screenshots.push('rapid-restored.png');
  report.scenario=scenario;report.checks.push('Immediate Enter submits the exact earlier text once while later typing is saved and restored separately');report.ok=true;
 }else{
 let expected=scenario==='review'||scenario==='review_mouse'?'REVIEW_PRIVATE':scenario==='conflict'||scenario==='conflict_mouse'?'CONFLICT_ONE':scenario==='conflict_many'?'CONFLICT_10':'RECOVER_MAIN_DRAFT';
 const saved=async()=>{const directory=join(launch.state,'main-drafts-v3');return Promise.all((await readdir(directory)).filter(name=>name.endsWith('.json')).map(name=>json(join(directory,name))));};
 if(scenario==='normal'||scenario==='kill'||scenario==='quit'){
  await page.keyboard.type(expected);await wait(expected);
  if(scenario==='quit'){await key('Control+c');await observe(()=>Promise.resolve(ptyExit),value=>value===0,'clean application exit');}
  await observe(saved,records=>records.some(record=>record.text===expected),'private draft saved');
 }else{
  const sessions=await observe(()=>readdir(join(launch.state,'sessions')),files=>files.some(name=>name.endsWith('.jsonl')),'session journal');
  const session=sessions.find(name=>name.endsWith('.jsonl')).slice(0,-6),prefix=createHash('sha256').update(session).digest('hex');
  const directory=join(launch.state,'main-drafts-v3');await mkdir(directory,{recursive:true,mode:0o700});
  for(const text of scenario==='conflict'||scenario==='conflict_mouse'?['CONFLICT_ONE','CONFLICT_TWO']:scenario==='conflict_many'?Array.from({length:12},(_,index)=>`CONFLICT_${String(index).padStart(2,'0')}`):[expected]){
   const owner=randomUUID(),record={version:2,owner,revision:1,parents:[],text,...(scenario==='review'||scenario==='review_mouse'?{intentId:randomUUID()}:{})};
   await writeFile(join(directory,`${prefix}.${owner}.1.json`),JSON.stringify(record),{mode:0o600});
  }
 }
 assert.equal((await http()).filter(row=>row.kind==='completion').length,0);
 const generation=await page.evaluate(()=>visual.generation);
 if(scenario==='kill'){await page.evaluate(()=>visual.crashRestart());const receipt=await observe(()=>json(join(output,'crash-receipt.json')),value=>value.signal==='SIGKILL','crash receipt');assert.equal(receipt.bridgeExitCode,137);}
 else await page.click('#restart');
 await page.waitForFunction(value=>visual.generation>value,generation);await verifyRenderer();
 if(scenario==='review'||scenario==='review_mouse'){await wait('may already have been sent');await page.locator('#terminal').screenshot({path:join(output,'review.png')});report.screenshots.push('review.png');if(scenario==='review_mouse')await clickText('may already have been sent');else await key('Control+r');await wait(expected);}
 else if(scenario==='conflict'||scenario==='conflict_mouse'||scenario==='conflict_many'){
  await wait('Conflicting drafts');if(scenario==='conflict_many'){await key('Control+n');await page.waitForFunction(()=>{const text=visual.text();return text.includes('1. draft: CONFLICT_')&&text.includes('3. draft: CONFLICT_')&&!text.includes('4. draft: CONFLICT_');});const pageText=await page.evaluate(()=>visual.text());expected=pageText.match(/1\. draft: (CONFLICT_\d\d)/)?.[1];assert.ok(expected,'Second page must show a variant');}await wait(expected);await page.locator('#terminal').screenshot({path:join(output,'conflict.png')});report.screenshots.push('conflict.png');
  const screen=await page.evaluate(()=>visual.text()),match=screen.match(new RegExp('([1-9])\\. draft: '+expected));assert.ok(match,'Choice for the conflict must be visible');
  if(scenario==='conflict_mouse')await clickText(match[1]+'. draft: '+expected);else await key(match[1]);
  await wait('›'+match[1]+'.');assert.equal((await http()).filter(row=>row.kind==='completion').length,0);
  await page.locator('#terminal').screenshot({path:join(output,'preview.png')});report.screenshots.push('preview.png');
  if(scenario==='conflict_mouse'){await wait('[Choose previewed draft]');await clickText('[Choose previewed draft]');}else await key('Enter');await page.waitForFunction(()=>!visual.text().includes('Conflicting drafts'));await wait(expected);
 }
 else await wait(expected);
 assert.equal((await http()).filter(row=>row.kind==='completion').length,0);await page.locator('#terminal').screenshot({path:join(output,'restored.png')});report.screenshots.push('restored.png');
 await key('Enter');await observe(http,rows=>rows.filter(row=>row.kind==='completion').length===1,'explicit submission');
 await observe(saved,records=>{
  const latest=new Map();for(const record of records){const prior=latest.get(record.owner);if(!prior||prior.revision<record.revision)latest.set(record.owner,record);}
  const current=[...latest.values()],parents=new Set(current.flatMap(record=>record.parents));
  return current.filter(record=>!parents.has(`${record.owner}:${record.revision}`)).every(record=>record.text==='');
 },'draft clearing');
 const completions=(await http()).filter(row=>row.kind==='completion');assert.equal(completions.length,1);
 assert.equal(completions[0].body.messages.filter(message=>message.role==='user').at(-1).content,expected);
 report.scenario=scenario;
 if(scenario==='normal'||scenario==='kill'||scenario==='quit')report.checks.push(scenario==='kill'?'A saved Main draft survives SIGKILL and is restored without a model call':scenario==='quit'?'A normal Ctrl+C exit saves the pending draft before restart':'A private Main draft is saved and restored after process replacement without a model call');
 else if(scenario==='review'||scenario==='review_mouse')report.checks.push('An ambiguous saved input requires explicit review and is not sent on restart');
 else report.checks.push('Conflicting saved versions require preview and an explicit choice without a model call');
 report.checks.push('An explicit Enter sends the restored text exactly once and clears its live version');report.ok=true;
 }
}catch(error){report.errors.push(String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
