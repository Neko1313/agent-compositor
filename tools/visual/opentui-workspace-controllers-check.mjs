import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parse as parseJsonc} from 'jsonc-parser';
import {chromium} from 'playwright';
import {createOpenTuiFinder} from './opentui-finder.mjs';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-workspace-controllers');
const timeout=20_000,draft='WORKSPACE_PRIVATE_DRAFT_47',query='PRIVATE_窗_47',finderPrivate='PRIVATE_FINDER_QUERY_47',token='SYNTHETIC_WORKSPACE_TOKEN_47';
const hash=value=>createHash('sha256').update(value).digest('hex');
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
const json=file=>readFile(file,'utf8').then(JSON.parse),exists=file=>readFile(file).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
async function observe(read,predicate,reason){const end=Date.now()+timeout;let value;
  while(Date.now()<end){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}throw Error(reason+'; latest='+JSON.stringify(value));}
let server,serverExit,browser,page,launch,ptyExit;
await mkdir(output,{recursive:true});
try{
  const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_WORKSPACE_CONTROLLERS:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off',
    ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
  serverExit=new Promise(done=>server.once('close',done));
  const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Workspace controller bench startup timed out')),timeout);
    server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Workspace controller bench exited '+code));});
    server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});
  });
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>report.errors.push(error.message));
  const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);socket.on('framereceived',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='exit')ptyExit=value.code;}catch{}});
  const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
  const wait=value=>page.waitForFunction(value=>window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
  const absent=value=>page.waitForFunction(value=>!window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal retained '+JSON.stringify(value),{cause:error});});
  const paste=value=>page.evaluate(data=>socket.send(JSON.stringify({type:'input',data})), '\x1b[200~'+value+'\x1b[201~');
  async function normal(main=false){await page.waitForFunction(main=>{const t=visual.terminal,text=visual.text(),toolbar=t.buffer.active.getLine(t.buffer.active.viewportY+1)?.translateToString(true)??'';
    return t.modes?.synchronizedOutputMode!==true&&toolbar.includes(t.cols>=42?'Alt+W Arrange':'Arrange')&&!text.includes('WINDOW MODE')&&!text.includes('windows · ↑↓ select · Enter open')&&(!main||text.includes('─ Main · focused'));},main);}
  async function main(){await key('Alt+0');await normal(true);}
  async function command(value){await main();await key('End');await key('Control+u');await paste(value);await wait(value);await key('Enter');}
  const finder=createOpenTuiFinder({page,key,wait,absent});
  async function setZoom(enabled){await key('Alt+w');await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
    if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));await key('Escape');await normal();if(enabled)await wait('Zoomed · Alt+W f tiles');}
  async function resize(columns,rows=50){await page.evaluate(({columns,rows})=>visual.terminal.resize(columns,rows),{columns,rows});await page.waitForFunction(({columns,rows})=>{const t=visual.terminal,b=t.buffer.active;
    return t.cols===columns&&t.rows===rows&&t.modes?.synchronizedOutputMode!==true&&b.getLine(b.viewportY+3)?.getCell(columns-1)?.getChars()==='┐'&&b.getLine(b.viewportY+rows-2)?.getCell(columns-1)?.getChars()==='┘';},{columns,rows});}
  let pointerAttempt=0;
  async function click(label,index=1){const attempt=++pointerAttempt,handle=await page.waitForFunction(({label,index,attempt})=>{
    const t=visual.terminal,b=t.buffer.active;if(t.modes?.synchronizedOutputMode===true){delete window.__workspacePointer;return;}
    for(let row=0;row<t.rows;row++){const cells=Array.from({length:t.cols},(_,col)=>b.getLine(b.viewportY+row)?.getCell(col)?.getChars()??''),offset=cells.join('').indexOf(label);if(offset<0)continue;
      let text='',col=0;while(col<cells.length&&text.length<offset){text+=cells[col];col++;}col+=index;const rect=document.querySelector('.xterm-screen').getBoundingClientRect();
      const signature=JSON.stringify([row,col,t.cols,t.rows,rect.x,rect.y,rect.width,rect.height,visual.frames,visual.text()]),previous=window.__workspacePointer;
      if(previous?.attempt!==attempt||previous.signature!==signature){window.__workspacePointer={attempt,signature,count:1};return;}if(++previous.count<3)return;
      return{x:rect.x+(col+.5)*rect.width/t.cols,y:rect.y+(row+.5)*rect.height/t.rows};}
  },{label,index,attempt},{polling:'raf'});const point=await handle.jsonValue();await page.mouse.click(point.x,point.y);}
  async function selectedRow(label){const value=await page.waitForFunction(label=>{
    const t=visual.terminal,b=t.buffer.active;if(t.modes?.synchronizedOutputMode===true)return;
    for(let row=0;row<t.rows;row++){const cells=Array.from({length:t.cols},(_,col)=>b.getLine(b.viewportY+row)?.getCell(col)?.getChars()??''),offset=cells.join('').indexOf(label);if(offset<0)continue;
      let text='',col=0;while(col<cells.length&&text.length<offset){text+=cells[col];col++;}const cell=b.getLine(b.viewportY+row).getCell(col);
      if(cell.getFgColor()!==0x171a20||cell.getBgColor()!==0xa6dfd4||!cell.isBold())return;
      return{row,fg:cell.getFgColor(),bg:cell.getBgColor(),bold:Boolean(cell.isBold())};}
  },label);return value.jsonValue();}
  async function capture(name){const attempts=[];for(let attempt=0;attempt<2;attempt++){
    await page.evaluate(()=>new Promise(done=>{const sub=visual.terminal.onRender(()=>{sub.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
    const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(output,name+'.png')});const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));
    const stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});await writeFile(join(output,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(output,name+'.txt'),after.text);
    if(stable){report.screenshots.push(name+'.png');return;}if(!attempt){await copyFile(join(output,name+'.png'),join(output,name+'.attempt1.png'));await page.evaluate(()=>{window.__workspaceQuiet={frames:visual.frames,text:visual.text(),since:performance.now()};});
      await page.waitForFunction(()=>{const old=window.__workspaceQuiet,frames=visual.frames,text=visual.text(),now=performance.now();if(old.frames!==frames||old.text!==text){window.__workspaceQuiet={frames,text,since:now};return false;}return now-old.since>=150;},undefined,{polling:'raf',timeout:5000});}
  }throw Error('Terminal changed during both screenshot attempts: '+name);}
  const trace=async()=>(await readFile(launch.workspaceControllers.trace,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const observer=async()=>(await readFile(launch.workspaceControllers.events,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const completions=async()=>(await readFile(join(output,'app-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.kind==='completion');
  const layout=()=>json(join(launch.state,'layout.json')),leaves=node=>!node?[]:node.surface?[node.surface]:node.children.flatMap(leaves);
  const location=(value,id)=>{const space=value.windows.spaces.find(space=>leaves(space.tree).includes(id));return space?String(space.id):undefined;};
  const selectedTrace=(kind,event='created')=>observe(trace,rows=>rows.some(row=>row.kind===kind&&row.event===event),'Expected '+kind+' '+event).then(rows=>rows.findLast(row=>row.kind===kind&&row.event===event));
  async function history(){await finder.pick('Chat history');await setZoom(true);await wait('CUSTOM HISTORY');}
  async function placement(){await finder.pick('Plugins · placement');await setZoom(true);await wait('CUSTOM PLACEMENT');}
  async function historyQuery(value){await key('End');await key('Control+u');if(value)await paste(value);await wait('Search: '+value);await observe(trace,rows=>rows.some(row=>row.event==='listed'&&row.query===value),'History list must acknowledge the exact query');}
  async function controls(){await finder.pick('Workspace controls');await setZoom(true);}
  async function retainedMain(){await main();await setZoom(true);await wait(draft);await paste('X');await wait('WXORKSPACE_PRIVATE_DRAFT_47');await key('Backspace');await wait(draft);}
  async function pendingMain(){await retainedMain();await key('Alt+i');await wait('[x] Production');await key('Alt+i');assert.equal((await completions()).length,1);}
  async function rule(){return readFile(launch.workspaceControllers.placement,'utf8').then(parseJsonc);}
  async function eventWhere(predicate,reason){return observe(trace,rows=>rows.some(predicate),reason).then(rows=>rows.findLast(predicate));}

  await wait('Message Main…');launch=await json(join(output,'opentui-app-launch.json'));assert.ok(launch.workspaceControllers);const fixture=launch.workspaceControllers;
  assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);assert.equal(await page.evaluate(()=>visual.terminal.unicode.activeVersion),'11');
  const args=launch.launches[0].command.slice(-4);assert.deepEqual(args.slice(0,3),['--renderer','opentui','--cwd']);assert.equal(await realpath(args[3]),await realpath(launch.cwd));
  if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);report.executable={path:launch.executable,sha256:launch.sha256};const file=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');report.renderer={path:file,sha256:hash(await readFile(file))};}
  await resize(180);await main();await setZoom(true);await command('/history');await wait('CUSTOM HISTORY');const initialHistory=await selectedTrace('history');report.selectedRow=await selectedRow('Selected: Workspace seed');
  await command('/placement');await wait('CUSTOM PLACEMENT');const initialPlacement=await selectedTrace('placement');
  await main();await setZoom(true);await command('APP_QUESTION');await wait('MAIN_QUESTION: choose deployment');await key('Alt+i');await key('ArrowDown');await key('Space');await wait('[x] Production');await key('Alt+i');
  await paste(draft);await wait(draft);await key('Home');await key('ArrowRight');
  await history();await historyQuery(query);await key('Home');await key('ArrowRight');await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await normal();await pendingMain();
  await history();assert.equal((await trace()).filter(row=>row.event==='created'&&row.kind==='history').length,1);await paste('X');await wait('Search: PXRIVATE_窗_47');await key('Backspace');await wait('Search: '+query);
  await resize(38,30);await wait('CUSTOM HISTORY');assert.equal(await page.evaluate(()=>visual.terminal.buffer.active.getLine(visual.terminal.buffer.active.viewportY)?.getCell(29)?.getChars()),'9');
  await key('F2');await page.waitForFunction(()=>{const t=visual.terminal,text=visual.text();return t.modes?.synchronizedOutputMode!==true&&text.includes('─ Windows ')
    &&text.includes('Search window or command…')&&text.includes('11 windows ·')&&text.includes('WINDOWS · Esc cancel');});
  await key('Escape');await normal();await wait('Search: '+query);await paste('Y');await wait('Search: PYRIVATE_窗_47');await key('Backspace');await wait('Search: '+query);await capture('01-narrow-private-history');await resize(180);await capture('01-private-history-query');await pendingMain();
  report.checks.push('Selected history lists while Main waits, owns its private Unicode query/cursor across hide/reopen and38-column F2 navigation, and leaves Production plus the independent Main draft unchanged');

  await history();await historyQuery('');await click('Private note');await wait('Workspace private note');await setZoom(true);await key('Tab');await paste(token);await wait('*'.repeat(token.length));
  await placement();await click('CUSTOM PLACEMENT',1);await eventWhere(row=>row.event==='input'&&row.id===initialPlacement.id&&row.input==='mouse'&&row.action==='press'&&row.row===2&&row.col===2,'Placement raw mouse must retain the full-frame origin convention');
  await click('Target alpha');const inventory=await eventWhere(row=>row.event==='inventory'&&row.id===initialPlacement.id,'Placement must receive actual windows/anchors');
  assert.ok(inventory.windows.some(window=>window.id===fixture.ids.alpha&&window.plugin===fixture.requester&&window.surface==='alpha'));assert.ok(inventory.anchors.includes('session'));
  await click('Apply workspace 2');await observe(layout,value=>location(value,fixture.ids.alpha)==='2','Actual Apply must relocate alpha toWS2');assert.equal(await exists(fixture.placement),false);
  await click('Save workspace 3');await wait('Rule saved');const savedRule=await observe(rule,value=>value.ui?.rules?.some(rule=>rule.match.plugin===fixture.requester&&rule.match.surface==='alpha'),'Save must persist the canonical identity rule');
  const expectedRule={site:'sidebar',workspace:3,size:.4,relativeTo:'session',focus:false,match:{plugin:fixture.requester,surface:'alpha'}};assert.deepEqual(savedRule.ui.rules.find(rule=>rule.match.surface==='alpha'),expectedRule);
  await observe(layout,value=>location(value,fixture.ids.alpha)==='3','Save must relocate alpha toWS3');await setZoom(false);await capture('02-private-placement-tiled');
  await finder.pick('Workspace private note');await setZoom(true);await wait('*'.repeat(token.length));await capture('02-history-native-private-form');await key('Alt+Enter');
  const note=await eventWhere(row=>row.event==='private-form'&&row.action==='note','History private note must settle its current input');assert.equal(note.tokenHash,hash(token));assert.equal(note.tokenLength,token.length);assert.equal(note.name,'PRIVATE_NOTE_47');await pendingMain();
  report.checks.push('Real selected placement windows/anchors support transient Apply and canonical Save across workspaces while a native private history form and Main question remain independent; the form token resolves only to its caller hash');

  await placement();const beforeInvalid=(await layout()).windows,beforeInvalidRule=await rule();await click('Invalid workspace');await wait('Rejected placement');await eventWhere(row=>row.event==='apply'&&row.placement.workspace===10&&!row.ok,'Invalid workspace must fail');assert.deepEqual((await layout()).windows,beforeInvalid);assert.deepEqual(await rule(),beforeInvalidRule);
  await click('Invalid neighbor');await eventWhere(row=>row.event==='apply'&&row.placement.relativeTo===fixture.ids.alpha&&!row.ok,'Self-neighbor must fail');assert.deepEqual((await layout()).windows,beforeInvalid);
  await click('Target beta');await controls();await click('Observer positive action');await observe(()=>json(fixture.observerAction),value=>value===true,'Ordinary observer control must run');await click('Remove beta');await observe(()=>json(fixture.removedBeta),value=>value===true,'The public SDK must remove beta');
  await placement();await click('Apply removed target');await eventWhere(row=>row.event==='apply'&&row.target===fixture.ids.beta&&!row.ok,'Removed identity must reject apply');assert.equal(location(await layout(),fixture.ids.beta),undefined);
  await click('Target alpha');await click('Delayed focus apply');await eventWhere(row=>row.event==='late-apply-started'&&row.action==='delayed','The admitted apply must wait for its completion gate');await main();await key('F2');await wait(finder.marker);await finder.query(finderPrivate,0);
  await writeFile(fixture.gates['placement-focus'],'release\n');await eventWhere(row=>row.event==='apply'&&row.placement.workspace===4&&row.ok,'The current apply may move its own target after navigation');await finder.state(finderPrivate,0);
  const passive=await observe(layout,value=>location(value,fixture.ids.alpha)==='4','Late Apply must move alpha but preserve current Main context');assert.equal(passive.windows.workspace,1);assert.equal(passive.windows.focused,'session');await capture('03-late-apply-preserves-finder');await key('Escape');await normal(true);await pendingMain();
  await placement();await click('Save workspace 3');await observe(layout,value=>location(value,fixture.ids.alpha)==='3','Restore the exact saved placement before later restart');assert.deepEqual((await rule()).ui.rules,savedRule.ui.rules);await pendingMain();
  report.checks.push('Invalid workspace/self-neighbor and a removed source cannot mutate layout/rules; a previously admitted delayed Apply may relocate its target but cannot steal newer Main/Finder focus or private query/cursor');

  await history();await historyQuery('');await click('Delayed old control');await eventWhere(row=>row.event==='late-control-started'&&row.id===initialHistory.id,'The old history input must hold');await key('Control+c');await main();await normal(true);
  await eventWhere(row=>row.event==='disposed'&&row.id===initialHistory.id,'Ctrl+C must dispose only the focused history controller');await key('F2');await wait(finder.marker);await finder.query('Chat history',1);await key('Escape');await normal(true);
  await writeFile(fixture.gates['history-late'],'release\n');const stale=await eventWhere(row=>row.event==='late-control-returned'&&row.id===initialHistory.id,'The cancelled old callback must finish with a revoked capability');assert.equal(stale.allowed,false);assert.equal(stale.aborted,true);await pendingMain();
  await history();const nextHistory=await selectedTrace('history');assert.notEqual(nextHistory.id,initialHistory.id);await pendingMain();await key('Alt+i');await wait('[x] Production');await key('Alt+Enter');await wait('APP_ANSWER_RECEIVED: Production');await wait('Main · Ready');await wait(draft);await capture('04-cancelled-history-main-intact');assert.equal((await completions()).length,2);
  report.checks.push('Ctrl+C closes the focused busy history lease immediately, revokes its delayed control/resume result and leaves Main suspended until an explicit Production answer; reopening creates a fresh selected lease');

  await history();await historyQuery('Workspace seed');await click('Selected: Workspace seed');await click('Rename selected');await wait('Workspace rename');await setZoom(true);await key('End');await key('Control+u');await paste('Workspace renamed seed');await key('Tab');await paste(token);await wait('*'.repeat(token.length));await key('Alt+Enter');
  await eventWhere(row=>row.event==='control'&&row.action==='rename'&&row.args.id===fixture.seedId,'Canonical rename must complete');assert.equal((await json(join(launch.state,'sessions',fixture.seedId+'.meta.json'))).name,'Workspace renamed seed');
  await history();await historyQuery('Workspace');await click('Fork selected');const fork=await eventWhere(row=>row.event==='control'&&row.action==='fork','Canonical fork must return its own metadata');const forkId=fork.value.id;assert.equal(fork.value.parentId,fixture.seedId);assert.equal(fork.value.name,'Workspace fork');
  // The service receipt precedes the controller's refreshed list. Its inserted
  // row moves the action buttons; wait for the actual selected native result.
  await wait('Selected: '+forkId);await selectedRow('Selected: Workspace fork');
  await click('Archive selected');await eventWhere(row=>row.event==='control'&&row.action==='archive'&&row.args.id===forkId,'Archive must target only the fork');assert.equal((await json(join(launch.state,'sessions',forkId+'.meta.json'))).archived,true);
  await page.waitForFunction(id=>{const text=visual.text();return visual.terminal.modes?.synchronizedOutputMode!==true
    &&text.includes('Selected: '+id)&&text.includes('Listed 1')&&!text.includes('Selected: Workspace fork');},forkId);
  await click('Show archived: no');await wait('Workspace fork · archived');await click('Unarchive last');await eventWhere(row=>row.event==='control'&&row.action==='unarchive'&&row.args.id===forkId,'Unarchive must restore the same fork');assert.equal((await json(join(launch.state,'sessions',forkId+'.meta.json'))).archived,false);
  await page.waitForFunction(id=>{const text=visual.text();return visual.terminal.modes?.synchronizedOutputMode!==true
    &&text.includes('Selected: '+id)&&text.includes('Listed 2')&&!text.includes('Workspace fork · archived');},forkId);
  await selectedRow('Selected: Workspace fork');await capture('05-canonical-history-mutations');
  assert.equal((await completions()).length,2);await retainedMain();report.fork={id:forkId,parentId:fork.value.parentId};
  report.checks.push('Selected history uses the canonical intercepted repository controls for private-form rename, fork, archive and unarchive after Main becomes ready; exact persisted metadata and the parked draft/cursor agree');

  await history();await historyQuery('Workspace fork');await click('Resume selected');await wait('WORKSPACE_SEED_HISTORY');await retainedMain();const intent=await json(fixture.resume);assert.equal(intent.id,forkId);
  await command('APP_WORKSPACE_RESUMED');await wait('WORKSPACE_RESUMED: seed context retained');await wait('Main · Ready');const resumedBody=(await completions()).at(-1).body;assert.ok(resumedBody.messages.some(message=>message.role==='user'&&message.content==='WORKSPACE_SEED_CONTEXT_47'));
  assert.equal((await completions()).length,3);await capture('06-selected-history-resume');report.checks.push('An explicit selected history resume transfers Main’s resident draft/cursor to the actual forked Core, whose next configured HTTP model request contains the seeded committed conversation exactly once');

  await finder.pick('Workspace gamma');await setZoom(false);await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await normal();await main();await setZoom(false);
  const beforeRestart=await observe(layout,value=>location(value,fixture.ids.alpha)==='3'&&location(value,fixture.ids.gamma)===undefined&&value.windows.focused==='session','The canonical tree and closed gamma must settle before restart');await writeFile(join(output,'before-restart-layout.json'),JSON.stringify(beforeRestart,null,2));
  const generation=await page.evaluate(()=>visual.generation);await page.click('#restart');await page.waitForFunction(generation=>visual.generation>generation&&visual.frames>0&&visual.text().includes('Main'),generation);await wait('Message Main…');launch=await json(join(output,'opentui-app-launch.json'));
  assert.deepEqual(launch.launches.at(-1).command.slice(-2),['--resume',forkId]);const restored=await observe(layout,value=>JSON.stringify(value.windows)===JSON.stringify(beforeRestart.windows),'Restart must restore the exact saved tree/focus/workspaces/closed window');assert.deepEqual(restored.windows,beforeRestart.windows);assert.deepEqual((await rule()).ui.rules,savedRule.ui.rules);
  await finder.pick('Workspace alpha');await wait('WORKSPACE_ALPHA');await observe(layout,value=>value.windows.workspace===3,'Saved alpha must be visibly on workspace3');await capture('07-restored-workspace-three');await main();await command('APP_WORKSPACE_RESTORED');await wait('WORKSPACE_RESTORED: seed context retained');await wait('Main · Ready');assert.equal((await completions()).length,4);
  report.checks.push('A real process restart resumes the actual selected fork, restores the exact canonical layout/rule and deliberately closed window, and visibly reopens saved placement on workspace3 before continuing committed model context');

  await command('/placement');await wait('CUSTOM PLACEMENT');await setZoom(true);const cancelledPlacement=await selectedTrace('placement');await click('Target alpha');await click('Delayed cancelled apply');await eventWhere(row=>row.event==='late-apply-started'&&row.id===cancelledPlacement.id&&row.action==='cancelled','The final apply must await its isolated gate');await key('Control+c');await main();await normal(true);await eventWhere(row=>row.event==='disposed'&&row.id===cancelledPlacement.id,'Ctrl+C must revoke the pending placement lease');
  await writeFile(fixture.gates['placement-cancel'],'release\n');const cancelled=await eventWhere(row=>row.event==='apply'&&row.id===cancelledPlacement.id&&row.placement.workspace===5,'The closed placement callback must settle');assert.equal(cancelled.ok,false);assert.equal(cancelled.aborted,true);assert.equal(location(await layout(),fixture.ids.alpha),'3');
  await command('/history');await wait('CUSTOM HISTORY');await command('/placement');await wait('CUSTOM PLACEMENT');const creations=(await trace()).filter(row=>row.event==='created').length;
  await controls();await click('Disable workspace provider');await observe(()=>json(fixture.disabled),value=>value.ok===true,'Normal extension policy must disable this provider');await finder.pick('/plugins',1,'Plugins');await setZoom(true);await click('Apply plugin changes');await observe(()=>json(fixture.reloaded),value=>value>=1,'Canonical reload must unload the selected provider');await wait('Reloaded ');
  await command('/history');await wait('History controller failed');await command('/placement');await wait('Selected placement controller is unavailable');await absent('CUSTOM HISTORY');await absent('CUSTOM PLACEMENT');assert.equal((await trace()).filter(row=>row.event==='created').length,creations);
  await finder.pick('Workspace controls');await wait('Remove beta');assert.equal((await completions()).length,4);await capture('08-selected-workspace-unavailable');
  report.checks.push('A cancelled delayed placement cannot apply through an expired capability, and normal provider disable/reload makes both explicit selections fail closed while ordinary windows and F2 navigation remain usable');

  const uiEvents=(await observer()).filter(row=>['ui.press','ui.change','ui.render'].includes(row.type)),publicUi=JSON.stringify(uiEvents),allObserved=JSON.stringify(await observer());
  assert.ok(uiEvents.some(row=>row.type==='ui.press'&&row.event.key==='observer'),'The unrelated observer must have seen the positive ordinary UI action');
  for(const value of [query,'PXRIVATE_窗_47','PYRIVATE_窗_47',finderPrivate,'CUSTOM HISTORY','CUSTOM PLACEMENT','PRIVATE_NOTE_47'])assert.ok(!publicUi.includes(value),'Private frame/input leaked into public UI hooks: '+value);
  assert.ok(allObserved.includes(query),'Deliberately requested list search must retain the canonical service interception payload');assert.ok(!allObserved.includes(token),'Private token leaked into a public service/UI call');
  const files=(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')),journal=(await Promise.all(files.map(name=>readFile(join(launch.state,'sessions',name),'utf8')))).join('\n');
  const http=JSON.stringify((await completions()).map(row=>row.body)),terminal=await readFile(join(output,'terminal.ansi'),'utf8');
  for(const[value,label]of [[terminal,'terminal output'],[http,'provider bodies'],[journal,'session journals']])assert.ok(!value.includes(token),'Private token leaked into '+label);
  for(const[value,label]of [[http,'provider bodies'],[journal,'session journals']])for(const privateText of [draft,query,'PXRIVATE_窗_47','PYRIVATE_窗_47',finderPrivate,'PRIVATE_NOTE_47'])assert.ok(!value.includes(privateText),'Private input leaked into '+label);
  assert.ok(!terminal.includes('MaxListenersExceededWarning'));report.privacy={terminal:true,providerBodies:true,sessionJournals:true,privateUiHooks:true,canonicalServiceSearchPayload:true,inputLogExcluded:'Raw terminal input records synthetic fixture values'};
  await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');report.ptyExitCode=ptyExit;assert.deepEqual(report.errors,[]);assert.equal(report.checks.length,8);report.ok=true;
}catch(error){report.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{
  if(launch)try{for(const file of Object.values(launch.workspaceControllers.gates))await writeFile(file,'cleanup\n');await copyFile(launch.workspaceControllers.trace,join(output,'controller-trace.jsonl'));await copyFile(launch.workspaceControllers.events,join(output,'observer-events.jsonl'));
    for(const name of (await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')||name.endsWith('.meta.json')))await copyFile(join(launch.state,'sessions',name),join(output,'session-'+name));
    if(await exists(launch.workspaceControllers.placement))await copyFile(launch.workspaceControllers.placement,join(output,'placement-config.jsonc'));
  }catch(error){report.ok=false;report.errors.push('Could not preserve isolated workspace diagnostics: '+error);}
  await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
}
