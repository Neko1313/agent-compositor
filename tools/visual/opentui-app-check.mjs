import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'../..');
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-app');
const timeout=20_000;
const secret='SYNTHETIC_UI_KEY_47',proxySecret='SYNTHETIC_PROXY_KEY_47',bootSecret='SYNTHETIC_BOOT_KEY_47';
const draft='KEEP_MAIN_DRAFT_47';
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
const hash=value=>createHash('sha256').update(value).digest('hex');
let server,serverExit,browser,page,launch,ptyExit;
await mkdir(output,{recursive:true});
for(const name of ['failure.png','failure.txt'])await rm(join(output,name),{force:true});
const json=file=>readFile(file,'utf8').then(JSON.parse);
async function observe(read,predicate,reason){
  const end=Date.now()+timeout;let value;
  while(Date.now()<end){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}
  throw Error(reason+'; latest='+JSON.stringify(value));
}
try{
  const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off',
    ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
  serverExit=new Promise(done=>server.once('close',done));
  const url=await new Promise((done,fail)=>{
    let text='';const timer=setTimeout(()=>fail(Error('Actual-app bench startup timed out')),timeout);
    server.on('error',error=>{clearTimeout(timer);fail(error);});
    serverExit.then(code=>{clearTimeout(timer);fail(Error('Actual-app bench exited '+code));});
    server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});
  });
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);
  page.on('pageerror',error=>report.errors.push(error.message));
  const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);
  socket.on('framereceived',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='exit')ptyExit=value.code;}catch{}});
  const key=value=>page.keyboard.press(value);
  const screen=()=>page.evaluate(()=>visual.text());
  const wait=value=>page.waitForFunction(value=>window.visual?.text().includes(value),value)
    .catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
  const absent=value=>page.waitForFunction(value=>!window.visual?.text().includes(value),value)
    .catch(error=>{throw Error('Terminal retained '+JSON.stringify(value),{cause:error});});
  const waitPane=(label,value)=>page.waitForFunction(({label,value})=>{
    const lines=visual.text().split('\n');
    for(const[y,line]of lines.entries()){
      const at=line.indexOf('─ '+label+' ');if(at<0)continue;
      const x=line.lastIndexOf('┌',at),right=line.indexOf('┐',at);if(x<0||right<0)continue;
      const bottom=lines.findIndex((row,index)=>index>y&&row[x]==='└'&&row[right]==='┘');
      if(bottom>y&&lines.slice(y,bottom+1).map(row=>row.slice(x,right+1)).join('\n').includes(value))return true;
    }
  },{label,value}).catch(error=>{throw Error('Pane '+JSON.stringify(label)+' missing '+JSON.stringify(value),{cause:error});});
  async function type(value){await page.keyboard.type(value);await wait(value);}
  async function tab(count=1){for(let index=0;index<count;index++){
    const before=await page.evaluate(()=>visual.frames);await key('Tab');
    await page.waitForFunction(before=>visual.frames>before,before);
  }}
  async function replace(value){await key('End');await key('Control+u');await type(value);}
  let pointerAttempt=0;
  async function click(label,{last=false,top=false}={}){
    const attempt=++pointerAttempt;
    const point=await page.waitForFunction(({label,last,top,attempt})=>{
      const lines=visual.text().split('\n');
      const chromeEnd=lines.findIndex(line=>/┌[─ ]/.test(line));
      const rows=lines.flatMap((line,row)=>line.includes(label)&&(!top||chromeEnd>=0&&row<chromeEnd)?[row]:[]);
      const row=last?rows.at(-1):rows[0];if(row===undefined){delete window.__appPointer;return;}
      const col=lines[row].indexOf(label)+Math.min(1,label.length-1);
      const rect=document.querySelector('.xterm-screen').getBoundingClientRect();
      const signature=[row,col,visual.terminal.cols,visual.terminal.rows,rect.x,rect.y,rect.width,rect.height].join(':');
      const previous=window.__appPointer;
      if(previous?.attempt!==attempt||previous.signature!==signature){window.__appPointer={attempt,signature,count:1};return;}
      if(++previous.count<3)return;
      return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};
    },{label,last,top,attempt},{polling:'raf'});
    const p=await point.jsonValue();await page.mouse.click(p.x,p.y);
  }
  async function capture(name){
    const attempts=[];
    for(let attempt=0;attempt<2;attempt++){
      await page.evaluate(()=>new Promise(done=>{const subscription=visual.terminal.onRender(()=>{subscription.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
      const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));
      await page.locator('#terminal').screenshot({path:join(output,name+'.png')});
      const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));
      const stable=before.frames===after.frames&&before.text===after.text;
      attempts.push({before,after,stable});
      await writeFile(join(output,name+'.capture.json'),JSON.stringify({attempts},null,2));
      await writeFile(join(output,name+'.txt'),after.text);
      if(stable){report.screenshots.push(name+'.png');return;}
      if(attempt===0){
        await copyFile(join(output,name+'.png'),join(output,name+'.attempt1.png'));
        await page.evaluate(()=>{window.__appCaptureQuiet={frames:visual.frames,text:visual.text(),since:performance.now()};});
        await page.waitForFunction(()=>{
          const previous=window.__appCaptureQuiet,frames=visual.frames,text=visual.text(),now=performance.now();
          if(previous.frames!==frames||previous.text!==text){window.__appCaptureQuiet={frames,text,since:now};return false;}
          return now-previous.since>=150;
        },undefined,{polling:'raf',timeout:5000});
      }
    }
    throw Error('Terminal changed during both screenshot attempts: '+name);
  }
  const layout=()=>json(join(launch.state,'layout.json'));
  const profiles=()=>json(join(launch.state,'providers.json'));
  const model=()=>json(join(launch.state,'model.json'));
  const traces=async()=>{const text=await readFile(join(output,'app-http.jsonl'),'utf8');return text.trim()?text.trim().split('\n').map(JSON.parse):[];};
  const completions=async()=>(await traces()).filter(row=>row.kind==='completion');
  const sessionFiles=async()=>(await readdir(join(launch.state,'sessions'))).filter(file=>file.endsWith('.jsonl'));
  const events=async()=>{const rows=await Promise.all((await sessionFiles()).map(async file=>(await readFile(join(launch.state,'sessions',file),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)));return rows.flat();};
  async function main(){await key('Alt+0');await page.waitForFunction(()=>visual.text().includes('─ Main · focused'));}
  async function submit(value){await main();await wait('Message Main…');await type(value);await key('Enter');}
  async function command(value){await main();await replace(value);await key('Enter');}
  async function setZoom(enabled){
    await key('Alt+w');await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
    if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');
    await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));
    await observe(layout,value=>value.windows.fullscreen===enabled,'Arrange zoom must update real saved layout');
    await key('Escape');await absent('WINDOW MODE');}
  async function zoom(){await setZoom(true);}
  async function unzoom(){await setZoom(false);}
  async function focusTab(label){await click(label,{top:true});}
  async function privateChannels(){
    const ansi=await readFile(join(output,'terminal.ansi'),'utf8');
    const bodies=JSON.stringify((await traces()).map(row=>row.body));
    const journals=(await Promise.all((await sessionFiles()).map(file=>readFile(join(launch.state,'sessions',file),'utf8')))).join('\n');
    const ordinary=JSON.stringify(await profiles());
    for(const value of [secret,proxySecret,bootSecret])for(const[channel,text]of Object.entries({terminalOutput:ansi,providerBodies:bodies,sessionJournals:journals,profileSettings:ordinary}))
      assert.ok(!text.includes(value),'Synthetic secret leaked to '+channel);
    report.privacy={terminalOutput:true,providerBodies:true,sessionJournals:true,profileSettings:true,inputLogExcluded:'The diagnostic keyboard log intentionally contains only synthetic test tokens'};
  }

  await wait('Message Main…');
  launch=await json(join(output,'opentui-app-launch.json'));
  assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);
  const launchArgs=launch.launches[0].command.slice(-4);
  assert.deepEqual(launchArgs.slice(0,3),['--renderer','opentui','--cwd']);
  assert.equal(await realpath(launchArgs[3]),await realpath(launch.cwd));
  if(launch.executable){
    assert.equal(hash(await readFile(launch.executable)),launch.sha256);report.executable={path:launch.executable,sha256:launch.sha256};
    const directory=dirname(launch.executable),files=[];
    async function inventory(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=join(directory,entry.name);if(entry.isDirectory())await inventory(path);else files.push(path);
    }}
    await inventory(directory);files.sort();
    await writeFile(join(output,'artifact-files.json'),JSON.stringify(files.map(path=>relative(directory,path)),null,2));
    const renderer=join(directory,'node_modules/@agent-compositor/renderer-opentui/index.js');
    report.artifact={root:directory,inventory:'artifact-files.json',fileCount:files.length,
      renderer:{path:renderer,sha256:hash(await readFile(renderer))},
      nativeLibraries:await Promise.all(files.filter(path=>/libopentui.*\.(?:so|dylib|dll)$/.test(path)).map(async path=>({path,sha256:hash(await readFile(path))}))),
      ...(process.env.VISUAL_ARCHIVE?{archive:resolve(process.env.VISUAL_ARCHIVE)}:{})};
    assert.ok(report.artifact.nativeLibraries.length,'Relocated archive must contain native renderer libraries');
  }
  await page.evaluate(()=>visual.terminal.resize(180,50));
  await command('/todos');await wait('─ Todos · focused');await wait('0/3 complete');await absent('Todos · Working');
  await command('/settings');await wait('Models & providers');await wait('Active: bootstrap · app-start');await absent('Models & providers · Working');
  await main();await submit('APP_QUESTION');await wait('MAIN_QUESTION: choose deployment');
  await click('Edit answer');await click('[ ] Production');await wait('[x] Production');
  await click('Draft');await type(draft);
  assert.equal((await completions()).length,1);
  report.checks.push('Actual CLI and configured ProviderRouter issue a loopback ask_user request; Main retains an explicit selected answer and independent unsent draft');

  await focusTab('Models & providers');await click('[ Add provider ]');await waitPane('Add provider','Continue');
  const standaloneForm=await page.evaluate(()=>{
    const lines=visual.text().split('\n');
    for(const[y,line]of lines.entries()){
      const at=line.indexOf('─ Add provider ');if(at<0)continue;
      const x=line.lastIndexOf('┌',at),right=line.indexOf('┐',at);if(x<0||right<0)continue;
      const bottom=lines.findIndex((row,index)=>index>y&&row[x]==='└'&&row[right]==='┘');
      if(bottom>y)return lines.slice(y,bottom+1).map(row=>row.slice(x,right+1)).join('\n');
    }
  });
  assert.ok(standaloneForm?.includes('Continue')&&standaloneForm.includes('Cancel'),'Standalone form retains its declared actions');
  assert.ok(!/\bDraft\b/.test(standaloneForm),'Standalone form must not expose the inactive host Draft toggle');
  await capture('01-independent-form-and-main');
  assert.ok((await screen()).includes('MAIN_QUESTION: choose deployment'),'Main question remains visible beside the private UI form');
  await zoom();
  for(const choice of ['OpenAI','Anthropic','Gemini','Compatible API / gateway']){await key('ArrowRight');await wait(choice);}
  await click('Continue');await wait('New provider connection');
  await replace('ui-profile');await tab(2);await replace(launch.baseUrl);await tab();await replace('app-alpha');await tab();
  await page.keyboard.type(secret);await wait('*'.repeat(secret.length));
  await capture('02-private-provider-key');
  await click('Test & discover models');await wait('Available models');
  await key('ArrowRight');await waitPane('Available models','app-beta');await click('Use selected model');
  await wait('New provider connection');await wait('Connection tested. Save to apply this profile.');
  await click('Save profile');await wait('Active: ui-profile · app-beta');await absent('Models & providers · Working');
  const saved=await observe(profiles,value=>value.profiles?.['ui-profile']?.model==='app-beta','UI profile must be stored');
  assert.equal(saved.profiles['ui-profile'].baseUrl,launch.baseUrl);
  const credentials=await json(join(launch.home,'credentials.json'));
  assert.equal(credentials['ui-profile'].accessToken,secret);
  assert.equal((await stat(join(launch.home,'credentials.json'))).mode&0o777,0o600);
  const discovery=(await traces()).filter(row=>row.kind==='models');
  assert.ok(discovery.some(row=>row.credential==='ui'),'Discovery must receive the pending private key');
  assert.equal((await completions()).length,1,'Settings forms/discovery must not answer Main or create model requests');
  report.checks.push('Generic UI surfaces add a provider, discover and choose a model, save its private key and activate the stored profile while Main remains pending');

  await click('[ Edit connection ]',{last:true});await wait('Edit provider · ui-profile');
  await replace('discarded-profile');await key('Escape');await absent('Edit provider · ui-profile');await wait('Active: ui-profile · app-beta');
  assert.ok(!(await profiles()).profiles['discarded-profile']);
  await click('[ Edit connection ]',{last:true});await wait('Edit provider · ui-profile');
  await tab(6);await replace('512');await click('Save profile');await absent('Edit provider · ui-profile');
  await observe(profiles,value=>value.profiles['ui-profile'].maxOutputTokens===512,'Actual profile edit must persist the output limit');
  await wait('Active: ui-profile · app-beta');
  await click('[ Discover / choose models ]',{last:true});await wait('Available models');
  await key('ArrowLeft');await waitPane('Available models','app-alpha');await click('Use selected model');
  await absent('Available models');await wait('Active: ui-profile · app-alpha');
  assert.deepEqual(await model(),{profile:'ui-profile',model:'app-alpha'});
  await click('[ Discover / choose models ]',{last:true});await wait('Available models');
  // Discovery starts at the profile's configured default (beta), while alpha
  // above is a separately persisted model selection on that same connection.
  await waitPane('Available models','app-beta');await click('Use selected model');
  await absent('Available models');await wait('Active: ui-profile · app-beta');
  assert.deepEqual(await model(),{profile:'ui-profile',model:'app-beta'});
  await capture('03-profile-discovery-selected');
  report.checks.push('Edit cancellation preserves the connection, a saved edit changes its output limit, and actual discover/use actions switch the persisted model twice without completing the question');

  await click('[ Network proxy ]');await wait('Configure network proxy');
  await key('Space');await wait('[x] Enabled');await tab();await replace('http://127.0.0.1:7890');await tab();await replace('fixture-user');await tab();
  await page.keyboard.type(proxySecret);await wait('*'.repeat(proxySecret.length));
  await tab(3);await key('Space');await wait('[ ] Disabled');
  await capture('04-private-proxy-form');await click('Save and apply');
  await wait('Proxy enabled');await wait('Tools: direct');
  const proxy=await json(join(launch.state,'proxy.json'));
  assert.equal(proxy.enabled,true);assert.equal(proxy.models,true);assert.equal(proxy.tools,false);
  assert.equal(new URL(proxy.url).password,proxySecret);assert.ok(proxy.noProxy.includes('127.0.0.1'));
  assert.equal((await completions()).length,1);
  if((await layout()).windows.fullscreen)await unzoom();
  await main();await wait(draft);await click('Edit answer');await wait('[x] Production');
  await capture('05-question-and-draft-retained');
  assert.equal((await events()).filter(event=>event.type==='tool.result'&&event.tool==='ask_user').length,0);
  await key('Alt+Enter');await wait('APP_ANSWER_RECEIVED: Production; model=app-beta');
  await wait(draft);
  const continuation=await observe(completions,rows=>rows.length===2,'Explicit answer must produce one actual continuation');
  assert.equal(continuation[1].model,'app-beta');assert.equal(continuation[1].credential,'ui');
  assert.equal(continuation[1].body.max_tokens,512);
  assert.equal(continuation[1].authorizationHash,hash('Bearer '+secret));
  assert.ok(continuation[1].body.messages.some(message=>message.role==='tool'&&String(message.content).includes('Production')));
  await privateChannels();
  report.checks.push('Proxy settings remain private and preserve loopback bypass; only explicit Main submission sends the selected answer using the newly selected model and private header');

  await main();await key('End');await key('Control+u');await wait('Message Main…');
  await submit('APP_HOLD');await wait('APP_MODEL_HELD');
  await focusTab('Models & providers');await click('[ Edit connection ]',{last:true});await wait('Edit provider · ui-profile');
  await main();await key('Control+x');await absent('Main · Running');
  await focusTab('Edit provider · ui-profile');await wait('A key is configured. Blank keeps it.');
  await key('Escape');await absent('Edit provider · ui-profile');await wait('Active: ui-profile · app-beta');
  await observe(traces,rows=>rows.some(row=>row.kind==='hold-aborted'),'Ctrl+X must cancel actual held HTTP request');
  report.checks.push('A real HTTP stream stays active while another UI form opens; interrupting Main leaves that independently owned form available to cancel');

  await focusTab('Todos');await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await absent('WINDOW MODE');
  const closedTodos=await observe(layout,value=>!Object.keys(value.windows.spaces.reduce((all,space)=>{
    const visit=node=>{if(node?.surface)all[node.surface]=space.id;else node?.children?.forEach(visit);};visit(space.tree);return all;},{})).some(id=>id.includes('todos')),'Todos must remain closed');
  assert.ok(closedTodos.registered.some(id=>id.includes('todos')));
  const mainSplit=value=>{
    const find=node=>{if(!node||node.surface)return;const child=node.children.find(child=>JSON.stringify(child).includes('"session"'));return child?find(child)??node:undefined;};
    return find(value.windows.spaces.find(space=>space.id===value.windows.workspace)?.tree);
  };
  await main();const previousRatio=mainSplit(await layout()).ratio;await key('Alt+w');await wait('WINDOW MODE');await key('+');
  await observe(layout,value=>mainSplit(value)?.ratio!==previousRatio,'Real layout must retain the adjusted nearest-split ratio');
  await key('Escape');await absent('WINDOW MODE');const beforeRestart=await layout();
  await writeFile(join(output,'before-restart-layout.json'),JSON.stringify(beforeRestart,null,2));
  const generation=await page.evaluate(()=>visual.generation);await page.click('#restart');
  await page.waitForFunction(generation=>visual.generation>generation&&visual.frames>0&&visual.text().includes('Message Main…'),generation);
  await wait('APP_ANSWER_RECEIVED: Production; model=app-beta');
  await command('/settings');await wait('Active: ui-profile · app-beta');await absent('Models & providers · Working');
  await command('/proxy status');await wait('Proxy enabled');await wait('Tools: direct');await absent('Network proxy · Working');await main();
  const restored=await observe(layout,value=>JSON.stringify(value.windows)===JSON.stringify(beforeRestart.windows),'Restart must restore exact tree, ratio, workspace, focus and closed pane state');
  assert.deepEqual([...restored.registered].sort(),[...beforeRestart.registered].sort());
  const nextLaunch=await json(join(output,'opentui-app-launch.json'));
  assert.equal(nextLaunch.launches.length,2);assert.ok(nextLaunch.launches[1].command.includes('--resume'));
  const sessionId=nextLaunch.launches[1].command.at(-1);
  assert.equal((await sessionFiles()).length,1);report.sessionId=sessionId;
  await submit('APP_RESTORED');await wait('APP_RESTORED: Production retained');
  await wait('Main · Ready');
  const finalRequests=await completions();
  assert.equal(finalRequests.length,4);assert.equal(finalRequests.at(-1).model,'app-beta');assert.equal(finalRequests.at(-1).credential,'ui');
  assert.equal(finalRequests.at(-1).authorizationHash,hash('Bearer '+secret));
  await capture('06-restored-session-profile-layout');await privateChannels();
  await writeFile(join(output,'session-events.json'),JSON.stringify(await events(),null,2));
  await writeFile(join(output,'restored-layout.json'),JSON.stringify(restored,null,2));
  report.checks.push('Actual CLI --resume restores the same session, selected model/private credential and exact window layout; closed Todos stays closed and the next HTTP request retains the earlier chosen answer');
  await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');
  report.ptyExitCode=ptyExit;assert.equal(report.errors.length,0);report.ok=true;
}catch(error){
  report.errors.push(String(error));
  if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
  if(launch)for(const name of ['layout.json','providers.json','model.json'])await readFile(join(launch.state,name)).then(data=>writeFile(join(output,'failure-'+name),data)).catch(()=>{});
}finally{
  await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
}
