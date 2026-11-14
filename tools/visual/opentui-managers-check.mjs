import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parse as parseJsonc} from 'jsonc-parser';
import {chromium} from 'playwright';
import {createOpenTuiFinder} from './opentui-finder.mjs';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-managers');
const timeout=20_000,draft='MANAGER_MAIN_DRAFT_47',plugin='local-flow-probe',todo='plugin-todos-tasks';
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
let server,serverExit,browser,page,launch,ptyExit;
await mkdir(output,{recursive:true});for(const file of ['failure.png','failure.txt'])await rm(join(output,file),{force:true});
const json=file=>readFile(file,'utf8').then(JSON.parse);
const hash=value=>createHash('sha256').update(value).digest('hex');
async function observe(read,predicate,reason){let value;const end=Date.now()+timeout;while(Date.now()<end){
  value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);
}throw Error(reason+'; latest='+JSON.stringify(value));}
const leaves=node=>!node?[]:node.surface?[node.surface]:node.children.flatMap(leaves);
try{
  const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_MANAGERS:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off',
    ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
  serverExit=new Promise(done=>server.once('close',done));
  const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Manager bench startup timed out')),timeout);
    server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Manager bench exited '+code));});
    server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});
  });
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>report.errors.push(error.message));
  const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);
  socket.on('framereceived',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='exit')ptyExit=value.code;}catch{}});
  const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
  const wait=value=>page.waitForFunction(value=>window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
  const absent=value=>page.waitForFunction(value=>!window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal retained '+JSON.stringify(value),{cause:error});});
  async function type(value){await page.keyboard.type(value);await wait(value);}
  async function tab(count=1){for(let index=0;index<count;index++){
    const before=await page.evaluate(()=>visual.frames);await key('Tab');await page.waitForFunction(before=>visual.frames>before,before);
  }}
  async function replace(value){await key('End');await key('Control+u');await type(value);}
  let pointerAttempt=0;
  async function click(label,{top=false,pane,button=false,footer=false}={}){
    const attempt=++pointerAttempt;
    const point=await page.waitForFunction(({label,top,pane,button,footer,attempt})=>{
      if(visual.terminal.modes.synchronizedOutputMode){delete window.__managerPointer;return;}
      const lines=visual.text().split('\n');let bounds;
      if(pane)for(const[y,line]of lines.entries()){
        const at=line.indexOf('─ '+pane+' ');if(at<0)continue;
        const x=line.lastIndexOf('┌',at),right=line.indexOf('┐',at);if(x<0||right<0)continue;
        const bottom=lines.findIndex((row,index)=>index>y&&row[x]==='└'&&row[right]==='┘');
        if(bottom>y){bounds={x,right,y,bottom};break;}
      }
      if(pane&&!bounds)return;
      const header=lines.findIndex(line=>/┌[─ ]/.test(line));
      for(const[row,line]of lines.entries()){
        if(top&&(header<0||row>=header)||footer&&row<lines.length-2||bounds&&(row<=bounds.y||row>=bounds.bottom||button&&row<bounds.bottom-6))continue;
        const start=bounds?.x??0,end=bounds?bounds.right+1:line.length;
        const at=line.slice(start,end).indexOf(label);if(at<0)continue;
        const col=start+at+Math.min(1,label.length-1),rect=document.querySelector('.xterm-screen').getBoundingClientRect();
        const painted=bounds?lines.slice(bounds.y,bounds.bottom+1).map(line=>line.slice(bounds.x,bounds.right+1)).join('\n'):lines.join('\n');
        const signature=JSON.stringify([row,col,visual.terminal.cols,visual.terminal.rows,rect.x,rect.y,rect.width,rect.height,visual.frames,painted]);
        const previous=window.__managerPointer;
        if(previous?.attempt!==attempt||previous.signature!==signature){window.__managerPointer={attempt,signature,count:1};return;}
        if(++previous.count<3)return;
        return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};
      }
    },{label,top,pane,button,footer,attempt},{polling:'raf'});const value=await point.jsonValue();await page.mouse.click(value.x,value.y);
  }
  async function paneText(label){return (await page.waitForFunction(label=>{
    const lines=visual.text().split('\n');for(const[y,line]of lines.entries()){
      const at=line.indexOf('─ '+label+' ');if(at<0)continue;const x=line.lastIndexOf('┌',at),right=line.indexOf('┐',at);if(x<0||right<0)continue;
      const bottom=lines.findIndex((row,index)=>index>y&&row[x]==='└'&&row[right]==='┘');
      if(bottom>y)return lines.slice(y,bottom+1).map(row=>row.slice(x,right+1)).join('\n');
    }
  },label)).jsonValue();}
  const waitMain=value=>observe(()=>paneText('Main'),text=>text.replace(/[│┌┐└┘─]/g,' ').replace(/\s+/g,' ').includes(value),
    'Main must display '+value);
  async function pendingMainDraft(){await page.waitForFunction(draft=>{
    if(visual.terminal.modes.synchronizedOutputMode)return;
    const lines=visual.text().split('\n');
    for(const[y,line]of lines.entries()){
      const at=line.indexOf('─ Main · focused ');if(at<0)continue;
      const x=line.lastIndexOf('┌',at),right=line.indexOf('┐',at);if(x<0||right<0)continue;
      const bottom=lines.findIndex((row,index)=>index>y&&row[x]==='└'&&row[right]==='┘');if(bottom<=y)continue;
      const body=lines.slice(y+1,bottom).map(row=>row.slice(x+1,right)),footer=body.at(-1)??'';
      return footer.includes('Alt+I answer or draft')&&footer.includes('Stop')&&body.some(row=>row.includes(draft))&&body.some(row=>row.includes('Edit answer'));
    }
  },draft);}
  async function formButton(title,label){await click(label,{pane:title,button:true});}
  async function capture(name){
    const attempts=[];
    for(let attempt=0;attempt<2;attempt++){
      await page.evaluate(()=>new Promise(done=>{const subscription=visual.terminal.onRender(()=>{subscription.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
      const before=await page.evaluate(()=>({text:visual.text(),frames:visual.frames}));
      await page.locator('#terminal').screenshot({path:join(output,name+'.png')});
      const after=await page.evaluate(()=>({text:visual.text(),frames:visual.frames}));
      const stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});
      await writeFile(join(output,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(output,name+'.txt'),after.text);
      if(stable){report.screenshots.push(name+'.png');return;}
      if(attempt===0){
        await copyFile(join(output,name+'.png'),join(output,name+'.attempt1.png'));
        await page.evaluate(()=>{window.__managerCaptureQuiet={frames:visual.frames,text:visual.text(),since:performance.now()};});
        await page.waitForFunction(()=>{
          const previous=window.__managerCaptureQuiet,frames=visual.frames,text=visual.text(),now=performance.now();
          if(previous.frames!==frames||previous.text!==text){window.__managerCaptureQuiet={frames,text,since:now};return false;}
          return now-previous.since>=150;
        },undefined,{polling:'raf',timeout:5000});
      }
    }
    throw Error('Terminal changed during both screenshot attempts: '+name);
  }
  const layout=()=>json(join(launch.state,'layout.json'));
  const traces=async()=>{const text=await readFile(join(output,'app-http.jsonl'),'utf8');return text.trim()?text.trim().split('\n').map(JSON.parse):[];};
  const completions=async()=>(await traces()).filter(row=>row.kind==='completion');
  const location=(value,id)=>value.windows.spaces.find(space=>leaves(space.tree).includes(id))?.id;
  const exists=file=>stat(file).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
  async function main(){await key('Alt+0');await wait('─ Main · focused');}
  async function command(value){await main();await replace(value);await key('Enter');}
  async function focusTab(label){await click(label,{top:true});}
  const {pick:findWindow}=createOpenTuiFinder({page,key,wait,absent});
  async function setZoom(enabled){
    await key('Alt+w');await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
    if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');
    await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));
    await observe(layout,value=>value.windows.fullscreen===enabled,'Arrange zoom must update real saved layout');
    await key('Escape');await absent('WINDOW MODE');}
  async function zoom(){await wait(' · Form');await setZoom(true);}
  async function unzoom(){await setZoom(false);}
  async function field(title,label){const lines=(await paneText(title)).split('\n'),index=lines.findIndex(line=>line.includes(label));
    assert.ok(index>=0,'Visible field required: '+label);return lines[index+1].replace(/[│]/g,'').trim();}
  async function select(title,label,value){for(let index=0;index<12;index++){
    if(await field(title,label)===value)return;const before=await page.evaluate(()=>visual.frames);await key('ArrowRight');await page.waitForFunction(before=>visual.frames>before,before);
  }throw Error('Selection did not reach '+label+'='+value);}
  async function noUnexpectedModelRequests(count){assert.equal((await completions()).length,count,'UI actions must not create or answer model requests');}
  async function noListenerWarnings(){
    const ansi=await readFile(join(output,'terminal.ansi'),'utf8');
    assert.ok(!/MaxListenersExceededWarning|Possible EventEmitter memory leak detected/.test(ansi),
      'Resident native panes must not emit raw listener-budget warnings into the terminal');
  }

  await wait('Message Main…');launch=await json(join(output,'opentui-app-launch.json'));assert.ok(launch.managers);
  assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);
  if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');
    report.executable={path:launch.executable,sha256:launch.sha256};report.renderer={path:renderer,sha256:hash(await readFile(renderer))};}
  await page.evaluate(()=>visual.terminal.resize(180,50));
  await command('/windows');await wait('Search window or command…');await key('Escape');await absent('Search window or command…');await noUnexpectedModelRequests(0);
  await command('/todos');await wait('0/3 complete');await absent('Todos · Working');
  await command('/proxy status');await wait('Proxy disabled');await absent('Network proxy · Working');await focusTab('Network proxy');await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await absent('WINDOW MODE');
  await observe(layout,value=>value.registered.includes('plugin-network-proxy-network')&&location(value,'plugin-network-proxy-network')===undefined,'Network proxy must be deliberately closed before reload');
  await command('/plugins');await wait('Browse marketplace');await absent('Extensions · Working');
  await main();await type('APP_QUESTION');await key('Enter');await wait('MAIN_QUESTION: choose deployment');
  await click('Edit answer');await click('[ ] Production');await wait('[x] Production');await click('Draft');await type(draft);
  await focusTab('Extensions');await click('Browse marketplace');await wait('Plugin marketplaces');
  await click('Add marketplace');await wait('Add marketplace · Form');await zoom();await paneText('Add marketplace');await type(launch.managers.catalogRoot);
  await noListenerWarnings();
  await formButton('Add marketplace','Add marketplace');await absent('Add marketplace · Form');await wait('Refreshed local-flow');
  await click('All marketplaces');await wait('local-flow · project');await click('local-flow · project');await wait('Choose a plugin to install.');
  await click('local-flow-probe  v1.0.0');await wait('Install local-flow-probe@local-flow · Form');await zoom();await paneText('Install local-flow-probe@local-flow');
  await formButton('Install local-flow-probe@local-flow','Install inactive');await wait('Installed local-flow-probe');
  await wait('Inactive until you explicitly enable it.');
  const installed=await observe(()=>json(launch.managers.extensionState),value=>value.installed?.[plugin]?.version==='1.0.0','Actual install must write the lock');
  assert.ok(installed.disabled.includes(plugin));assert.equal((await json(launch.managers.manifest)).version,'1.0.0');
  assert.equal(await exists(launch.managers.receipt),false,'Inactive plugin must not run its hooks');await noUnexpectedModelRequests(1);
  await capture('01-installed-inactive');
  report.checks.push('Actual /windows stays host-owned; /plugins Browse redirects to the canonical marketplace, registers an offline catalog and installs its exact package inactive while Main waits');

  await click('Enable installed plugin');await wait('Manage local-flow-probe · Form');await zoom();await paneText('Manage local-flow-probe');
  assert.equal(await field('Manage local-flow-probe','Action'),'enable');
  await formButton('Manage local-flow-probe','Apply');await wait('Enabled local-flow-probe');
  const enabled=await json(launch.managers.extensionState);assert.ok(enabled.enabled.includes(plugin));assert.ok(!enabled.disabled.includes(plugin));
  await unzoom();await click('Apply plugin changes');await waitMain('Plugin reload queued until current operations finish');
  assert.equal(await exists(launch.managers.receipt),false,'Queued reload must wait for the unresolved Main question');await noUnexpectedModelRequests(1);
  await unzoom();await main();await pendingMainDraft();await click('Edit answer',{pane:'Main'});await wait('[x] Production');await click('Draft');
  await capture('02-enabled-reload-pending');
  report.checks.push('Enable installed plugin opens the canonical extension management form; explicit Apply saves activation and queues reload without settling Main or executing the new plugin');

  await focusTab('Extensions');await click('Arrange plugin windows');await wait('Arrange plugin windows');await zoom();
  const title='Arrange plugin windows';await select(title,'Plugin window','Todos · todos');await tab();await select(title,'Placement','sidebar');
  await tab();await select(title,'Workspace','Workspace 2');await tab();await replace('0.25');await tab();await select(title,'Neighbor','Main');
  await tab();if((await field(title,'Focus the placed window')).includes('Enabled'))await key('Space');
  await formButton(title,'Apply');
  await observe(layout,value=>location(value,todo)===2,'Apply must relocate Todos to workspace 2');
  assert.equal(await exists(launch.managers.placement),false,'Apply must not persist a project placement rule');
  await observe(layout,value=>!value.windows.fullscreen,'A fresh Apply form must leave the settled form zoom');await zoom();await wait('Applied for this run.');await tab(2);await select(title,'Workspace','Workspace 3');await tab();await replace('0.4');
  await formButton(title,'Save rule');
  const savedRule=await observe(()=>readFile(launch.managers.placement,'utf8').then(parseJsonc),value=>value.ui?.rules?.some(rule=>rule.match.plugin==='todos'&&rule.workspace===3),'Save must write the canonical placement rule');
  const rule=savedRule.ui.rules.find(rule=>rule.match.plugin==='todos'&&rule.match.surface==='tasks');
  assert.deepEqual(rule,{site:'sidebar',workspace:3,size:.4,relativeTo:'session',focus:false,match:{plugin:'todos',surface:'tasks'}});
  await observe(layout,value=>location(value,todo)===3,'Saved rule must also relocate the actual pane');
  const beforeCancel=await readFile(launch.managers.placement,'utf8');
  await observe(layout,value=>!value.windows.fullscreen,'A fresh Save form must leave the settled form zoom');await zoom();await wait('Rule saved. Placement applied.');await tab(2);await select(title,'Workspace','Workspace 4');await capture('03-placement-private');
  await formButton(title,'Cancel');await absent('Arrange plugin windows · Form');
  assert.equal(await readFile(launch.managers.placement,'utf8'),beforeCancel);assert.equal(location(await layout(),todo),3);
  await unzoom();await main();await wait(draft);await click('Edit answer');await wait('[x] Production');await noUnexpectedModelRequests(1);
  report.checks.push('Private placement Apply changes only this run, Save writes and applies the canonical per-plugin rule, and Cancel discards a later edit while Main draft and chosen answer remain intact');

  await key('Alt+Enter');await waitMain('APP_ANSWER_RECEIVED: Production; model=app-start');
  const loaded=await observe(()=>json(launch.managers.receipt),value=>value.version==='1.0.0','Queued reload must finish after Main answer');
  await wait('LOCAL_FLOW_PROBE_LOADED');await wait('Reloaded ');await main();await wait(draft);
  assert.equal((await completions()).length,2);assert.equal(location(await layout(),todo),3);
  assert.ok((await layout()).registered.includes('plugin-network-proxy-network'));assert.equal(location(await layout(),'plugin-network-proxy-network'),undefined);
  await capture('04-reloaded-after-question');
  await key('End');await key('Control+u');await wait('Message Main…');await type('APP_RESTORED');await key('Enter');await wait('APP_RESTORED: Production retained');await wait('Main · Ready');
  assert.equal((await completions()).length,3);
  report.checks.push('Answering Main explicitly drains the queued reload, executes the installed plugin hooks and preserves the deliberately closed same-owner proxy pane; the original conversation continues with its chosen answer');

  await unzoom();await main();const beforeRestart=await layout();await writeFile(join(output,'before-restart-layout.json'),JSON.stringify(beforeRestart,null,2));
  const generation=await page.evaluate(()=>visual.generation);await page.click('#restart');
  await page.waitForFunction(generation=>visual.generation>generation&&visual.frames>0&&visual.text().includes('Main'),generation);
  await wait('LOCAL_FLOW_PROBE_LOADED');await findWindow('Todos');await wait('0/3 complete');
  const restored=await observe(layout,value=>value.windows.workspace===3&&location(value,todo)===3,'Saved rule must restore Todos on workspace 3');
  assert.ok(restored.registered.includes('plugin-network-proxy-network'));assert.equal(location(restored,'plugin-network-proxy-network'),undefined);
  assert.deepEqual(parseJsonc(await readFile(launch.managers.placement,'utf8')).ui.rules,savedRule.ui.rules);
  const nextLoaded=await json(launch.managers.receipt);assert.equal(nextLoaded.sessionId,loaded.sessionId);
  await capture('05-restored-placement-workspace-three');
  await main();await wait('APP_RESTORED: Production retained');await type('APP_RESTORED');await key('Enter');await wait('Main · Ready');
  await observe(completions,rows=>rows.length===4,'Resumed Main must use the actual configured provider');
  await capture('06-restored-main-conversation');
  await writeFile(join(output,'restored-layout.json'),JSON.stringify(restored,null,2));await writeFile(join(output,'installed-state.json'),JSON.stringify(await json(launch.managers.extensionState),null,2));
  report.loadedReceipt=nextLoaded;report.savedRule=rule;
  report.checks.push('Actual CLI restart resumes the same session, loads the explicitly enabled package and restores its saved placement rule; Todos opens on workspace 3 and Main retains the previous answer');
  await noListenerWarnings();
  await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');report.ptyExitCode=ptyExit;
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
  if(launch)for(const[file,name]of [[join(launch.state,'layout.json'),'failure-layout.json'],[launch.managers.extensionState,'failure-extension-state.json'],[launch.managers.placement,'failure-placement.jsonc']])
    await readFile(file).then(data=>writeFile(join(output,name),data)).catch(()=>{});
}finally{await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
