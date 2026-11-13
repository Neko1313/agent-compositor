import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-navigation');
const timeout=20_000,hash=value=>createHash('sha256').update(value).digest('hex');
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
const leaves=node=>node?.surface?[node.surface]:node?.children?.flatMap(leaves)??[];
const splitFor=(node,id)=>!node||node.surface?undefined:node.children.some(child=>child.surface===id)?node:
  node.children.map(child=>splitFor(child,id)).find(Boolean);
let server,serverExit,browser,page,launch,ptyExit;
await mkdir(output,{recursive:true});for(const name of ['failure.png','failure.txt'])await rm(join(output,name),{force:true});
const json=file=>readFile(file,'utf8').then(JSON.parse);
async function observe(read,predicate,reason){const end=Date.now()+timeout;let value;
  while(Date.now()<end){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}
  throw Error(reason+'; latest='+JSON.stringify(value));
}
try{
  const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_NAVIGATION:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off',
    ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
  serverExit=new Promise(done=>server.once('close',done));
  const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Navigation bench startup timed out')),timeout);
    server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Navigation bench exited '+code));});
    server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});
  });
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>report.errors.push(error.message));
  const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);
  socket.on('framereceived',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='exit')ptyExit=value.code;}catch{}});
  const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
  const wait=value=>page.waitForFunction(value=>{
    const text=window.visual?.text()??'';return(value==='windows · ↑↓ select · Enter open'?text.replace(/[│]/g,' ').replace(/\s+/g,' '):text).includes(value);
  },value).catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
  const absent=value=>page.waitForFunction(value=>{
    const text=window.visual?.text()??'';return!(value==='windows · ↑↓ select · Enter open'?text.replace(/[│]/g,' ').replace(/\s+/g,' '):text).includes(value);
  },value).catch(error=>{throw Error('Terminal retained '+JSON.stringify(value),{cause:error});});
  async function type(value){await page.keyboard.type(value);await wait(value);}
  async function replace(value){await key('End');await key('Control+u');await type(value);}
  const layout=()=>json(join(launch.state,'layout.json'));
  const currentTree=value=>value.windows.spaces.find(space=>space.id===value.windows.workspace)?.tree;
  const location=(value,id)=>value.windows.spaces.find(space=>leaves(space.tree).includes(id))?.id;
  const traces=async()=>{const text=await readFile(join(output,'app-http.jsonl'),'utf8');return text.trim()?text.trim().split('\n').map(JSON.parse):[];};
  const completions=async()=>(await traces()).filter(row=>row.kind==='completion');
  const sessionFiles=async()=>(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl'));
  const journal=async()=>(await Promise.all((await sessionFiles()).map(name=>readFile(join(launch.state,'sessions',name),'utf8')))).join('\n');
  const events=async()=>(await journal()).trim().split('\n').filter(Boolean).map(JSON.parse);
  const exists=file=>stat(file).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
  const finderMarker='windows · ↑↓ select · Enter open';
  async function main(){await key('Alt+0');await wait('─ Main · focused');}
  async function command(value){await main();await replace(value);await key('Enter');}
  async function finder(query=''){await key('F2');await wait(finderMarker);if(query)await type(query);}
  async function pick(query){await finder(query);await key('Enter');await absent(finderMarker);}
  async function arrange(){await key('Alt+w');await wait('WINDOW MODE');}
  async function leave(){await key('Escape');await absent('WINDOW MODE');}
  async function setZoom(enabled){
    await key('Alt+w');await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
    if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');
    await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));
    await observe(layout,value=>value.windows.fullscreen===enabled,'Arrange zoom must update real saved layout');await leave();
  }
  const waitMain=value=>page.waitForFunction(value=>{
    const lines=visual.text().split('\n');for(const[y,line]of lines.entries()){
      const at=line.indexOf('─ Main ');if(at<0)continue;const x=line.lastIndexOf('┌',at),right=line.indexOf('┐',at);if(x<0||right<0)continue;
      const bottom=lines.findIndex((row,index)=>index>y&&row[x]==='└'&&row[right]==='┘');
      if(bottom>y&&lines.slice(y,bottom+1).map(row=>row.slice(x,right+1)).join(' ').replace(/[│]/g,' ').replace(/\s+/g,' ').includes(value))return true;
    }
  },value).catch(error=>{throw Error('Main pane missing '+JSON.stringify(value),{cause:error});});
  // A terminal protocol chunk exercises parser batching, never host/controller APIs.
  async function rawInput(data){await page.evaluate(data=>socket.send(JSON.stringify({type:'input',data})),data);}
  async function paste(value){await rawInput('\x1b[200~'+value+'\x1b[201~');}
  let pointerAttempt=0;
  async function click(label){const attempt=++pointerAttempt;
    const point=await page.waitForFunction(({label,attempt})=>{
      const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(label));if(row<0){delete window.__navigationPointer;return;}
      const col=lines[row].indexOf(label)+Math.min(1,label.length-1),rect=document.querySelector('.xterm-screen').getBoundingClientRect();
      const signature=[row,col,visual.terminal.cols,visual.terminal.rows,rect.x,rect.y,rect.width,rect.height].join(':'),previous=window.__navigationPointer;
      if(previous?.attempt!==attempt||previous.signature!==signature){window.__navigationPointer={attempt,signature,count:1};return;}
      if(++previous.count<3)return;
      return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};
    },{label,attempt},{polling:'raf'});const value=await point.jsonValue();await page.mouse.click(value.x,value.y);
  }
  async function capture(name){const attempts=[];
    for(let attempt=0;attempt<2;attempt++){
      await page.evaluate(()=>new Promise(done=>{const subscription=visual.terminal.onRender(()=>{subscription.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
      const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(output,name+'.png')});
      const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()})),stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});
      await writeFile(join(output,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(output,name+'.txt'),after.text);
      if(stable){report.screenshots.push(name+'.png');return;}
      if(attempt===0){await copyFile(join(output,name+'.png'),join(output,name+'.attempt1.png'));
        await page.evaluate(()=>{window.__navigationQuiet={frames:visual.frames,text:visual.text(),since:performance.now()};});
        await page.waitForFunction(()=>{const previous=window.__navigationQuiet,frames=visual.frames,text=visual.text(),now=performance.now();
          if(previous.frames!==frames||previous.text!==text){window.__navigationQuiet={frames,text,since:now};return false;}return now-previous.since>=150;
        },undefined,{polling:'raf',timeout:5000});}
    }throw Error('Terminal changed during both screenshot attempts: '+name);
  }
  async function noRequests(count){assert.equal((await completions()).length,count,'Window operations must not issue/settle model work');}
  async function noResult(tool){assert.equal((await events()).filter(event=>event.type==='tool.result'&&event.tool===tool).length,0);}

  await wait('Message Main…');launch=await json(join(output,'opentui-app-launch.json'));assert.ok(launch.navigation);
  assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);
  const args=launch.launches[0].command.slice(-4);assert.deepEqual(args.slice(0,3),['--renderer','opentui','--cwd']);assert.equal(await realpath(args[3]),await realpath(launch.cwd));
  if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);report.executable={path:launch.executable,sha256:launch.sha256};
    const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');report.renderer={path:renderer,sha256:hash(await readFile(renderer))};}
  await page.evaluate(()=>visual.terminal.resize(180,50));await command('/nav-panes');await wait('Navigation controls');
  await observe(layout,value=>value.registered.filter(id=>/^plugin-navigation-probe-pane\d+$/.test(id)).length===12,'All12 actual plugin panes must be registered');
  await main();await type('NAV_DRAFT_47');await key('Home');await key('ArrowRight');
  const previousContext=(await layout()).windows;
  await finder();await paste('PRIVATE_窗_47');await wait('PRIVATE_窗_47');await wait('No matching windows');
  await key('Home');await key('ArrowRight');await type('_');await wait('P_RIVATE_窗_47');await key('Control+z');await wait('PRIVATE_窗_47');
  await key('Control+u');await type('Заметки 窗口');await wait('WS 3');await capture('01-private-unicode-finder');
  await key('Escape');await absent(finderMarker);assert.deepEqual((await layout()).windows,previousContext);
  await type('_');await wait('N_AV_DRAFT_47');await key('Control+z');await wait('NAV_DRAFT_47');
  await key('End');await key('Control+u');
  const batch='/windows\r\x1b[200~BATCH_窗_47\x1b[201~';await rawInput(batch);await wait(finderMarker);await wait('BATCH_窗_47');await noRequests(0);
  await key('Escape');await absent(finderMarker);await wait('Message Main…');
  const recorded=(await readFile(join(output,'input.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(recorded.some(row=>row.data===batch));
  report.checks.push('Stable Main/Finder keys work with12 resident panes; private Unicode/native editing and a batched command+paste preserve Main draft, cursor, undo and exact return context without model work');

  await type('APP_QUESTION');await key('Enter');await wait('MAIN_QUESTION: choose deployment');await click('Edit answer');await click('[ ] Production');await wait('[x] Production');
  await click('Draft');await type('NAV_PENDING_DRAFT_47');
  await arrange();await page.keyboard.type('yn');await key('Enter');await absent('WINDOW MODE');await noRequests(1);await noResult('ask_user');
  await arrange();const beforePaste=JSON.stringify((await layout()).windows);await paste('q');await key('Control+c');await absent('WINDOW MODE');
  assert.equal(JSON.stringify((await layout()).windows),beforePaste);await wait('Main · Question');await wait('MAIN_QUESTION: choose deployment');await noRequests(1);await noResult('ask_user');
  const originalJournal=await sessionFiles();assert.equal(originalJournal.length,1);
  await arrange();await key('q');await leave();await observe(layout,value=>!value.windows.spaces.some(space=>leaves(space.tree).includes('session')),'Arrange q must close Main');
  await finder('Main');await wait('Closed');await capture('02-closed-main-pending');await key('Enter');await absent(finderMarker);
  assert.deepEqual(await sessionFiles(),originalJournal);assert.equal((await layout()).windows.spaces.flatMap(space=>leaves(space.tree)).filter(id=>id==='session').length,1);
  await wait('NAV_PENDING_DRAFT_47');await click('Edit answer');await wait('[x] Production');await click('Draft');await noResult('ask_user');
  report.checks.push('Arrange typing, Enter, pasted q and Ctrl+C cannot settle Main; closing and finding Main reopens the same pending conversation and journal without duplicate panes or lost selected answer');

  await pick('/nav-form');await wait('Navigation private form');await wait('FORMvalue');await key('Home');await key('ArrowRight');await type('_');await wait('F_ORMvalue');
  const formId=(await layout()).windows.focused;await arrange();await paste('q');await key('Control+c');await absent('WINDOW MODE');assert.equal(await exists(launch.navigation.formReceipt),false);
  await main();await wait('NAV_PENDING_DRAFT_47');await pick('Navigation private form');assert.equal((await layout()).windows.focused,formId);
  await type('X');await wait('F_XORMvalue');await capture('03-private-form-return');await key('Alt+Enter');
  const receipt=await observe(()=>json(launch.navigation.formReceipt),value=>value?.action==='save','Only explicit form submission may publish a receipt');assert.equal(receipt.values.name,'F_XORMvalue');
  await main();await wait('NAV_PENDING_DRAFT_47');await click('Edit answer');await wait('[x] Production');await key('Alt+Enter');await wait('APP_ANSWER_RECEIVED: Production; model=app-start');
  await noRequests(2);assert.equal((await events()).filter(event=>event.type==='tool.result'&&event.tool==='ask_user').length,1);
  report.checks.push('An independent private form survives Arrange and Main navigation with its exact field cursor/value; only its explicit submit returns values, and only explicit Main submit answers the model');

  await command('APP_APPROVAL');await wait('Approval required');await wait('Tool: write');await noResult('write');assert.equal(await exists(launch.navigation.approvalFile),false);
  await arrange();await page.keyboard.type('yn');await key('Alt+y');await key('Alt+n');await paste('q');await key('Enter');await absent('WINDOW MODE');
  await wait('Approval required');await noRequests(3);await noResult('write');await arrange();await key('Control+c');await absent('WINDOW MODE');await wait('Approval required');
  await finder('Main');await key('Control+c');await absent(finderMarker);await wait('Approval required');await noResult('write');
  await capture('04-protected-approval');await key('Alt+n');await wait('APP_APPROVAL_SETTLED: denied');await noRequests(4);
  const denied=(await events()).find(event=>event.type==='tool.result'&&event.tool==='write');assert.equal(denied.ok,false);assert.equal(await exists(launch.navigation.approvalFile),false);
  report.checks.push('The ordinary file-write permission remains pending through Arrange/Finder input and Ctrl+C; explicit Alt+N alone denies it and the isolated target file stays absent');

  await finder('/nav-slow');await key('Enter');await wait('Opening window…');await observe(()=>json(launch.navigation.slowStarted),Boolean,'Slow route must really begin');
  await key('Control+u');await type('/nav-fast');await key('Enter');await absent(finderMarker);await wait('CURRENT_SELECTED_ROUTE');
  await observe(()=>json(launch.navigation.slowFinished),Boolean,'Cancelled route producer must finish its bounded late callback');
  assert.equal(location(await layout(),'plugin-navigation-probe-slow'),undefined);assert.ok(!(await screen()).includes('LATE_CANCELLED_ROUTE'));
  await pick('Navigation controls');await click('Refresh inventory');await observe(()=>json(launch.navigation.refreshStarted),Boolean,'Real refresh action must start');
  await finder('Nav pane 12');await wait('WS 2');await observe(()=>json(launch.navigation.refreshFinished),Boolean,'Real refresh must remove its source');await wait('Unavailable');
  await key('Enter');await wait('fresh view from its plugin');assert.equal(location(await layout(),'plugin-navigation-probe-pane12'),undefined);
  await key('Control+u');await type('Nav pane 11');await key('Enter');await absent(finderMarker);await wait('NAV_REFRESH_COMPLETE');
  await command('/reload');await observe(()=>json(launch.navigation.reloadStarted),Boolean,'Actual plugin reload must begin');await finder('Nav pane 11');
  await observe(()=>json(launch.navigation.ready),value=>value.generation===2,'Actual plugin reload must replace sources');await wait('Nav pane 11 refreshed');
  await key('Enter');await absent(finderMarker);await wait('NAV_GENERATION_2');await noRequests(4);
  report.checks.push('Finder replaces an abandoned slow route with the newly selected owner, refuses a removed source, and follows fresh same-owner sources through an actual plugin reload without model requests');

  await page.evaluate(()=>visual.terminal.resize(48,22));await arrange();await wait('i type');await wait('Esc exit');await capture('05-arrange-48-columns');await leave();
  await page.evaluate(()=>visual.terminal.resize(38,20));await arrange();await wait('Esc exit');await wait('i type');await capture('06-arrange-38-columns');await leave();
  await finder('Заметки');await wait('WS 3');await key('Escape');await absent(finderMarker);await page.evaluate(()=>visual.terminal.resize(180,50));
  await pick('Nav pane 11');await arrange();await key('Shift+Digit1');await key('1');
  const pane='plugin-navigation-probe-pane11';await observe(layout,value=>location(value,pane)===1&&value.windows.workspace===1,'Shift+1 and1 must move/select workspace1');
  const beforeMove=JSON.stringify(currentTree(await layout()));await key('Shift+ArrowLeft');
  await observe(layout,value=>JSON.stringify(currentTree(value))!==beforeMove&&value.windows.focused===pane,'Shift+direction must move the same pane in its nested tree');
  await key('v');await observe(layout,value=>splitFor(currentTree(value),pane)?.axis==='vertical','v must set the nearest nested split to rows');
  await key('b');const beforeResize=await observe(layout,value=>splitFor(currentTree(value),pane)?.axis==='horizontal','b must set the nearest nested split to columns');
  const oldRatio=splitFor(currentTree(beforeResize),pane).ratio;await key('+');
  const resized=await observe(layout,value=>splitFor(currentTree(value),pane)?.ratio!==oldRatio,'+ must persist a custom nearest-split ratio');
  const customRatio=splitFor(currentTree(resized),pane).ratio;await leave();
  await pick('Fast route');await arrange();await key('q');await leave();await main();await setZoom(true);
  const zoomContext=(await layout()).windows;await finder('Nav pane 11');await key('Escape');await absent(finderMarker);
  assert.deepEqual((await layout()).windows,zoomContext);await setZoom(false);
  const beforeRestart=await observe(layout,value=>!value.windows.fullscreen,'Restart reference must leave fullscreen');await writeFile(join(output,'before-restart-layout.json'),JSON.stringify(beforeRestart,null,2));
  assert.ok(JSON.stringify(beforeRestart.windows).includes(String(customRatio)),'Nested custom ratio must remain before restart');
  const generation=await page.evaluate(()=>visual.generation);await page.click('#restart');
  await page.waitForFunction(generation=>visual.generation>generation&&visual.frames>0&&visual.text().includes('Main'),generation);
  await observe(()=>json(launch.navigation.ready),value=>value.generation===3,'Restart must load the same plugin state');await main();
  const restored=await observe(layout,value=>JSON.stringify(value.windows)===JSON.stringify(beforeRestart.windows),'Restart must restore the exact nested tree, ratio, focus,workspace and closed windows');
  assert.equal(location(restored,'plugin-navigation-probe-fast'),undefined);assert.deepEqual(await sessionFiles(),originalJournal);
  await waitMain('APP_APPROVAL_SETTLED: denied');await command('APP_RESTORED');await waitMain('APP_RESTORED: Production retained');await wait('Main · Ready');await noRequests(5);
  await capture('07-restored-navigation-layout');await writeFile(join(output,'restored-layout.json'),JSON.stringify(restored,null,2));
  const privateValues=['PRIVATE_窗_47','P_RIVATE_窗_47','BATCH_窗_47','F_XORMvalue'];
  const modelBodies=JSON.stringify((await traces()).map(row=>row.body)),sessionText=await journal();for(const value of privateValues){assert.ok(!modelBodies.includes(value));assert.ok(!sessionText.includes(value));}
  assert.ok(!/MaxListenersExceededWarning|Possible EventEmitter memory leak detected/.test(await readFile(join(output,'terminal.ansi'),'utf8')));
  report.customRatio=customRatio;report.sessionId=originalJournal[0].slice(0,-6);report.privacy={finderAndFormAbsentFromModel:true,finderAndFormAbsentFromJournal:true,inputLogExcluded:'Raw input records synthetic test queries and form values'};
  report.checks.push('Arrange exits remain visible at48/38 columns; actual nested geometry, custom ratio, closed window and original journal survive restart with private Finder/form text absent from model requests and session history');
  await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');report.ptyExitCode=ptyExit;assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
  if(launch)await readFile(join(launch.state,'layout.json')).then(data=>writeFile(join(output,'failure-layout.json'),data)).catch(()=>{});
}finally{await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
