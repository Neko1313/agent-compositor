import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-controllers');
const timeout=20_000,draft='CONTROLLER_MAIN_DRAFT_47',defaultToken='SYNTHETIC_CONTROLLER_DEFAULT_47',suffix='_PRIVATE_KEY_47';
const hash=value=>createHash('sha256').update(value).digest('hex');
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
let server,serverExit,browser,page,launch,ptyExit;
await mkdir(output,{recursive:true});for(const name of ['failure.png','failure.txt'])await rm(join(output,name),{force:true});
const json=file=>readFile(file,'utf8').then(JSON.parse);
const exists=file=>readFile(file).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
async function observe(read,predicate,reason){const end=Date.now()+timeout;let value;
  while(Date.now()<end){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}
  throw Error(reason+'; latest='+JSON.stringify(value));
}
try{
  const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_CONTROLLERS:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off',
    ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
  serverExit=new Promise(done=>server.once('close',done));
  const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Controllers bench startup timed out')),timeout);
    server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Controllers bench exited '+code));});
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
  // This sends a real terminal paste packet, never a controller or AppUI action.
  async function paste(value){await page.evaluate(data=>socket.send(JSON.stringify({type:'input',data})), '\x1b[200~'+value+'\x1b[201~');}
  async function main(){await key('Alt+0');await wait('─ Main · focused');}
  async function command(value){await main();await key('End');await key('Control+u');await type(value);await key('Enter');}
  const finderMarker='windows · ↑↓ select · Enter open';
  async function finderQuery(value){await page.keyboard.type(value);await page.waitForFunction(value=>{
    const terminal=visual.terminal,buffer=terminal.buffer.active;
    for(let row=0;row<terminal.rows-2;row++){
      const cells=Array.from({length:terminal.cols},(_,col)=>buffer.getLine(buffer.viewportY+row)?.getCell(col)?.getChars()??'');
      const title=cells.join('').indexOf('─ Windows ');if(title<0)continue;
      const left=cells.lastIndexOf('┌'),right=cells.indexOf('┐',left);if(left<0||right<0)continue;
      const query=Array.from({length:right-left-1},(_,col)=>buffer.getLine(buffer.viewportY+row+1)?.getCell(left+1+col)?.getChars()??'').join('').trim();
      if(query===value)return true;
    }
    return false;
  },value);}
  async function pick(value){await key('F2');await wait(finderMarker);await finderQuery(value);await key('Enter');await absent(finderMarker);}
  async function setZoom(enabled){await key('Alt+w');await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
    if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');
    await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));await key('Escape');await absent('WINDOW MODE');
  }
  let pointerAttempt=0;
  async function click(label,index=1){const attempt=++pointerAttempt;
    const point=await page.waitForFunction(({label,index,attempt})=>{
      const terminal=visual.terminal,buffer=terminal.buffer.active;
      for(let row=0;row<terminal.rows;row++){
        const cells=Array.from({length:terminal.cols},(_,col)=>buffer.getLine(buffer.viewportY+row)?.getCell(col)?.getChars()??'');
        const line=cells.join(''),offset=line.indexOf(label);if(offset<0)continue;
        let text='',col=0;while(col<cells.length&&text.length<offset){text+=cells[col];col++;}col+=index;
        const rect=document.querySelector('.xterm-screen').getBoundingClientRect(),signature=[row,col,terminal.cols,terminal.rows,rect.x,rect.y,rect.width,rect.height].join(':'),previous=window.__controllerPointer;
        if(previous?.attempt!==attempt||previous.signature!==signature){window.__controllerPointer={attempt,signature,count:1};return;}
        if(++previous.count<3)return;return{x:rect.x+(col+.5)*rect.width/terminal.cols,y:rect.y+(row+.5)*rect.height/terminal.rows};
      }
    },{label,index,attempt},{polling:'raf'});const value=await point.jsonValue();await page.mouse.click(value.x,value.y);
  }
  async function capture(name){const attempts=[];for(let attempt=0;attempt<2;attempt++){
    await page.evaluate(()=>new Promise(done=>{const subscription=visual.terminal.onRender(()=>{subscription.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
    const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(output,name+'.png')});
    const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()})),stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});
    await writeFile(join(output,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(output,name+'.txt'),after.text);
    if(stable){report.screenshots.push(name+'.png');return;}
    if(attempt===0){await copyFile(join(output,name+'.png'),join(output,name+'.attempt1.png'));await page.evaluate(()=>{window.__controllerQuiet={frames:visual.frames,text:visual.text(),since:performance.now()};});
      await page.waitForFunction(()=>{const previous=window.__controllerQuiet,frames=visual.frames,text=visual.text(),now=performance.now();
        if(previous.frames!==frames||previous.text!==text){window.__controllerQuiet={frames,text,since:now};return false;}return now-previous.since>=150;
      },undefined,{polling:'raf',timeout:5000});}
  }throw Error('Terminal changed during both screenshot attempts: '+name);}
  const trace=async()=>{const text=await readFile(launch.controllers.trace,'utf8');return text.trim()?text.trim().split('\n').map(JSON.parse):[];};
  const completions=async()=>(await readFile(join(output,'app-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.kind==='completion');
  const sessionFiles=async()=>(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl'));
  const events=async()=>(await Promise.all((await sessionFiles()).map(async name=>(await readFile(join(launch.state,'sessions',name),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)))).flat();
  async function noModelWork(){assert.equal((await completions()).length,1);assert.equal((await events()).filter(row=>row.type==='tool.result'&&row.callId==='app-main-question').length,0);}
  async function noReceipt(mode){assert.equal(await exists(launch.controllers.receipts[mode]),false);}
  async function receipt(mode,predicate=()=>true){return observe(()=>json(launch.controllers.receipts[mode]),predicate,'Private caller '+mode+' must receive its own result');}
  async function once(mode){assert.equal(await json(launch.controllers.calls[mode]),1);}
  async function created(title){return observe(trace,rows=>rows.some(row=>row.event==='created'&&row.title===title),'Selected controller must be created for '+title).then(rows=>rows.findLast(row=>row.event==='created'&&row.title===title));}
  async function retainedMain(){await main();await setZoom(true);await wait(draft);await type('_');await wait('C_ONTROLLER_MAIN_DRAFT_47');await key('Control+z');await wait(draft);await noModelWork();}
  async function request(text,title='Questions · controller-request-probe'){
    await pick(title);
    for(let index=0;index<10;index++){
      await setZoom(true);if((await screen()).includes(text))return;
      await key('Alt+w');await wait('WINDOW MODE');await key('Tab');await key('Escape');await absent('WINDOW MODE');
    }
    throw Error('No focused request window contains '+text);
  }
  async function start(mode){await pick('Controller controls');await setZoom(true);await click('Start '+mode);}
  async function richCells(){const value=await page.evaluate(()=>{
    const terminal=visual.terminal,buffer=terminal.buffer.active;
    for(let row=0;row<terminal.rows;row++){
      const cells=Array.from({length:terminal.cols},(_,col)=>{const cell=buffer.getLine(buffer.viewportY+row)?.getCell(col);return{col,ch:cell?.getChars(),width:cell?.getWidth(),fg:cell?.getFgColor(),bg:cell?.getBgColor(),bold:Boolean(cell?.isBold())};});
      if(cells.map(cell=>cell.ch).join('').includes('RICH 窗口'))return cells.filter(cell=>'RICH窗口'.includes(cell.ch)&&cell.ch);
    }
  });assert.ok(value?.length);const first=value.find(cell=>cell.ch==='R');assert.equal(first.fg,0xeac280);assert.equal(first.bg,0x171a20);assert.equal(first.bold,true);
    assert.equal(value.find(cell=>cell.ch==='窗').width,2);assert.equal(value.find(cell=>cell.ch==='口').width,2);assert.ok(!(await screen()).includes('CELL_FALLBACK_MUST_NOT_RENDER'));return value;
  }

  await wait('Message Main…');launch=await json(join(output,'opentui-app-launch.json'));assert.ok(launch.controllers);
  assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);
  const args=launch.launches[0].command.slice(-4);assert.deepEqual(args.slice(0,3),['--renderer','opentui','--cwd']);assert.equal(await realpath(args[3]),await realpath(launch.cwd));
  if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);report.executable={path:launch.executable,sha256:launch.sha256};
    const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');report.renderer={path:renderer,sha256:hash(await readFile(renderer))};}
  await page.evaluate(()=>visual.terminal.resize(180,50));await main();await setZoom(true);await command('APP_QUESTION');await wait('Main · Question');await wait('Alt+I answer');
  await type(draft);await key('Home');await key('ArrowRight');await key('F4');await noModelWork();
  await key('Alt+i');await wait('CUSTOM QUESTION');const mainController=await created('MAIN_QUESTION: choose deployment');
  await key('Home');await key('ArrowRight');await type('M');await wait('Value: QM|value');report.richCells=await richCells();
  await key('Alt+i');await wait(draft);await retainedMain();
  assert.equal((await trace()).filter(row=>row.id===mainController.id&&row.event==='input'&&row.key==='f4').length,0);
  await capture('01-selected-main-answer-and-draft');
  report.checks.push('Only explicit Main answer mode routes function keys to the selected question controller; the native editor retains its independent draft/cursor and the validated rich frame preserves bold colors and CJK cell widths');

  for(const[mode,keyName]of [['approval-malformed','F4'],['approval-deny','F3'],['approval-allow','F5']]){
    await start(mode);await request('CUSTOM APPROVAL','Approval · controller-request-probe');const approval=await created('exec');
    await noReceipt(mode);assert.equal(await exists(launch.controllers.effects[mode.slice(9)]),false);
    if(mode==='approval-allow'){
      await retainedMain();await key('F5');await noReceipt(mode);assert.equal(await exists(launch.controllers.effects.allow),false);
      await key('F2');await wait(finderMarker);await finderQuery('Approval');await key('F5');await noReceipt(mode);await key('Escape');await absent(finderMarker);
      await request('CUSTOM APPROVAL','Approval · controller-request-probe');assert.equal((await trace()).filter(row=>row.event==='created'&&row.id===approval.id).length,1);await capture('02-selected-approval');
    }
    await key(keyName);const result=await receipt(mode,value=>value.ok&&value.value?.ok===(mode==='approval-allow'));await once(mode);
    if(mode==='approval-allow')assert.equal(await readFile(launch.controllers.effects.allow,'utf8'),'allow\n');else assert.equal(await exists(launch.controllers.effects[mode.slice(9)]),false);
    report[mode]=result;await retainedMain();
  }
  assert.equal(await readFile(launch.controllers.effects.allow,'utf8'),'allow\n');
  report.checks.push('The actual exec policy invokes selected approvals in independent windows: malformed F4 and explicit F3 deny without effects, while focused F5 allows exactly once and hidden/Finder keys cannot approve');

  await start('question-a');await request('CONTROLLER_QUESTION_A');const questionA=await created('CONTROLLER_QUESTION_A');
  await key('Home');await key('ArrowRight');await paste('_PASTE');await wait('Value: Q_PASTE|value');await click('Value: ',9);await type('M');await wait('Value: Q_M|PASTEvalue');
  await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await absent('WINDOW MODE');await retainedMain();
  await request('CONTROLLER_QUESTION_A');await wait('Value: Q_M|PASTEvalue');assert.equal((await trace()).filter(row=>row.event==='created'&&row.title==='CONTROLLER_QUESTION_A').length,1);
  const inputRows=(await trace()).filter(row=>row.id===questionA.id&&row.event==='input');assert.ok(inputRows.some(row=>row.input==='text'&&row.paste));assert.ok(inputRows.some(row=>row.input==='mouse'&&row.action==='press'&&row.row===3&&row.col===9));
  await start('question-b');await request('CONTROLLER_QUESTION_B');const questionB=await created('CONTROLLER_QUESTION_B');await noReceipt('question-a');
  await type('A');await wait('Query: A');await observe(trace,rows=>rows.some(row=>row.id===questionB.id&&row.event==='semantic-started'),'The first native semantic change must await its fixture gate');
  await type('B');await wait('Query: AB');await writeFile(launch.controllers.gates.semantic,'release\n');
  await observe(trace,rows=>rows.some(row=>row.id===questionB.id&&row.event==='semantic-applied'&&row.change===1),'The first semantic input acknowledgement must arrive');
  await observe(trace,rows=>rows.some(row=>row.id===questionB.id&&row.event==='semantic-held'&&row.change===2),'The second semantic change must wait while the first frame is acknowledged');
  await wait('Applied chars: 1');await wait('Query: AB');
  report.semanticInput={heldFirstAck:await page.evaluate(()=>visual.text().split('\n').filter(row=>row.includes('Query: ')||row.includes('Applied chars: ')).map(row=>row.replace(/\s+/g,' ').trim()))};
  await type('C');await wait('Query: ABC');await writeFile(launch.controllers.gates.semanticSecond,'release\n');
  await observe(trace,rows=>rows.some(row=>row.id===questionB.id&&row.event==='semantic-applied'&&row.length===3),'The final native semantic change must preserve all three characters');await wait('Applied chars: 3');await wait('Query: ABC');
  report.semanticInput.final=await page.evaluate(()=>visual.text().split('\n').filter(row=>row.includes('Query: ')||row.includes('Applied chars: ')).map(row=>row.replace(/\s+/g,' ').trim()));
  await capture('02-native-semantic-input-async-ack');await key('F4');assert.deepEqual(await receipt('question-b'),{ok:true,value:'Remote'});await once('question-b');
  await request('CONTROLLER_QUESTION_A');await key('Control+c');assert.equal((await receipt('question-a')).value.ok,false);await once('question-a');
  await start('questionnaire');await request('Controller questionnaire');await key('F4');const questionnaire=await receipt('questionnaire');
  assert.deepEqual(questionnaire.value.output,{answers:[{id:'checks',selected:['Unit','Browser'],text:'Load tests'},{id:'owner',selected:[],text:'Controller owner'}]});await once('questionnaire');await retainedMain();
  report.checks.push('Selected questions/questionnaire settle only their own caller; raw paste/local mouse and hide/reopen retain custom state, while native semantic editing preserves ABC through a delayed first acknowledgement and Ctrl+C cancels only the chosen request');

  await start('form');await request('Request: Controller private form','Form · controller-request-probe');const form=await created('Controller private form');
  assert.ok(!(await screen()).includes('Draft'));assert.ok(!(await screen()).includes(defaultToken));await wait('Token: '+'*'.repeat(defaultToken.length));
  await click('Name: ',10);await paste('_P');await wait('Name: FORM_P|value');await key('Tab');await paste(suffix);await wait('Token: '+'*'.repeat((defaultToken+suffix).length));await key('Tab');
  await key('Enter');await noReceipt('form');await key('F4');await noReceipt('form');await wait('CUSTOM PRIVATE FORM');
  await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await absent('WINDOW MODE');await retainedMain();
  await request('Request: Controller private form','Form · controller-request-probe');await type('X');await wait('Name: FORM_PX|value');
  assert.equal((await trace()).filter(row=>row.event==='created'&&row.title==='Controller private form').length,1);await capture('03-selected-private-form-resumed');await richCells();
  await key('F5');const savedForm=await receipt('form');assert.deepEqual(savedForm,{ok:true,value:{action:'save',name:'FORM_PXvalue',tokenLength:(defaultToken+suffix).length,tokenHash:hash(defaultToken+suffix)}});await once('form');
  assert.ok((await trace()).some(row=>row.id===form.id&&row.event==='disposed'));await retainedMain();
  report.checks.push('Selected form rendering masks both a private text default and pasted token; invalid output and Enter cannot submit, local mouse/paste cursor and lease survive hiding, and only F5 gives the private caller its hashed result');

  await start('form-async-save');await request('Request: Controller private form-async-save','Form · controller-request-probe');const asyncForm=await created('Controller private form-async-save');
  await key('F5');await key('F5');await observe(trace,rows=>rows.some(row=>row.id===asyncForm.id&&row.event==='async-started'),'The selected handler must begin its real async input');
  await retainedMain();await key('F2');await wait(finderMarker);await finderQuery('PRIVATE_CONTROLLER_FINDER_47');await wait('No matching windows');await writeFile(launch.controllers.gates.save,'release\n');
  const asyncSaved=await receipt('form-async-save');assert.equal(asyncSaved.value.action,'save');await once('form-async-save');await wait('PRIVATE_CONTROLLER_FINDER_47');await wait('No matching windows');await capture('04-async-reply-keeps-newer-finder');
  await key('Escape');await absent(finderMarker);await retainedMain();assert.equal((await trace()).filter(row=>row.id===asyncForm.id&&row.event==='async-returned').length,1);
  report.checks.push('A serialized admitted async selected-form response settles its exact private caller after focus changes, without stealing the newer Main/Finder context or applying a second queued F5');

  await start('form-async-cancel');await request('Request: Controller private form-async-cancel','Form · controller-request-probe');const cancelledForm=await created('Controller private form-async-cancel');
  await key('F5');await observe(trace,rows=>rows.some(row=>row.id===cancelledForm.id&&row.event==='async-started'),'The cancellable selected handler must start');await key('Control+c');
  assert.deepEqual(await receipt('form-async-cancel'),{ok:true,value:{cancelled:true}});await once('form-async-cancel');await retainedMain();
  await key('Alt+i');await wait('Value: QM|value');await key('F4');await wait('APP_ANSWER_RECEIVED: Production');await wait('Main · Ready');await wait(draft);
  assert.equal((await completions()).length,2);assert.ok((await completions())[1].body.messages.some(message=>message.role==='tool'&&message.content.includes('Production')));
  // The method was captured in ordinary session.start scope. Invoking it from
  // this later button must keep the form in Main's FIFO rather than its UI op.
  await start('main-form');await main();await setZoom(true);await wait('Request: Controller private main-form');await wait('Main · Form');
  const mainFormController=await created('Controller private main-form');await noReceipt('main-form');await wait(draft);
  await type('_');await wait('C_ONTROLLER_MAIN_DRAFT_47');await key('Control+z');await wait(draft);
  await key('End');await key('Control+u');await type('APP_MAIN_FORM_PROBE');await key('Enter');
  await wait('APP_MAIN_FORM_PROBE_DONE');await observe(events,rows=>rows.filter(row=>row.type==='turn.complete').length===2,'The ordinary model turn must complete while Main keeps its selected form');
  assert.equal((await completions()).length,3);assert.equal((await completions())[2].body.messages.filter(message=>message.role==='user').at(-1).content,'APP_MAIN_FORM_PROBE');
  await wait('Request: Controller private main-form');await noReceipt('main-form');assert.equal((await trace()).filter(row=>row.event==='created'&&row.title==='Controller private main-form').length,1);
  assert.equal((await trace()).filter(row=>row.id===mainFormController.id&&row.event==='disposed').length,0);
  await type(draft);await key('Home');await key('ArrowRight');await capture('04-idle-main-form-allows-model-turn');await key('Alt+i');await wait('Alt+I draft');await key('F5');
  const mainForm=await receipt('main-form');assert.deepEqual(mainForm,{ok:true,value:{action:'save',name:'FORMvalue',tokenLength:defaultToken.length,tokenHash:hash(defaultToken)}});await once('main-form');
  await wait('Main · Ready');await wait(draft);await type('_');await wait('C_ONTROLLER_MAIN_DRAFT_47');await key('Control+z');await wait(draft);
  await start('disable-provider');assert.equal((await receipt('disable-provider')).value.ok,true);await once('disable-provider');
  await command('/reload');await observe(()=>json(launch.controllers.reloaded),value=>value===true,'The public disable/reload must unload the selected provider');await wait('Reloaded ');
  await writeFile(launch.controllers.gates.cancel,'release\n');await observe(trace,rows=>rows.some(row=>row.id===cancelledForm.id&&row.event==='async-returned'&&row.aborted===true),'The stale async producer must finish only after cancellation/unload');
  assert.deepEqual(await receipt('form-async-cancel'),{ok:true,value:{cancelled:true}});
  const formCreations=(await trace()).filter(row=>row.event==='created'&&row.kind==='form').length;
  await command('/controller-probe form');await observe(()=>json(launch.controllers.calls.form),value=>value===2,'A new private request must reach the unavailable explicit selection');
  await receipt('form',value=>value.ok===true&&value.value?.cancelled===true);assert.equal((await trace()).filter(row=>row.event==='created'&&row.kind==='form').length,formCreations);await absent('CUSTOM PRIVATE FORM');
  await main();await type(draft);await capture('05-unloaded-controller-fails-closed');
  const journal=(await Promise.all((await sessionFiles()).map(name=>readFile(join(launch.state,'sessions',name),'utf8')))).join('\n');
  for(const[value,label]of [[await readFile(join(output,'terminal.ansi'),'utf8'),'terminal'],[JSON.stringify((await completions()).map(row=>row.body)),'provider bodies'],[journal,'session journals']])
    for(const token of [defaultToken,suffix,defaultToken+suffix])assert.ok(!value.includes(token),'Private token leaked to '+label);
  for(const[value,label]of [[JSON.stringify((await completions()).map(row=>row.body)),'provider bodies'],[journal,'session journals']])
    for(const text of ['FORMvalue','FORM_PXvalue','PRIVATE_CONTROLLER_FINDER_47'])assert.ok(!value.includes(text),'Private form/Finder value leaked to '+label);
  assert.equal((await completions()).length,3);assert.ok(!journal.includes(draft));assert.ok(!JSON.stringify((await completions()).map(row=>row.body)).includes(draft));
  report.privateForm=savedForm;report.asyncForm=asyncSaved;report.mainForm={result:mainForm,modelTurnWhilePending:true,sameLease:true};report.privacy={terminalOutput:true,providerBodies:true,sessionJournals:true,privateFormAndFinder:true,inputLogExcluded:'Raw input records synthetic fixture tokens'};
  report.checks.push('An idle Main selected form survives a real ordinary model turn and retains its separate draft/cursor; cancel/unload rejects stale replies and future unavailable selection fails closed, while explicit F4 alone answers Main and private values stay out of model/journal');
  await writeFile(join(output,'controller-events.json'),JSON.stringify((await events()).filter(row=>['command.operation','tool.operation','tool.call','tool.result'].includes(row.type)),null,2));
  await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');report.ptyExitCode=ptyExit;assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{
  if(launch)try{
    for(const file of Object.values(launch.controllers.gates))await writeFile(file,'cleanup\n');
    const receipts={};for(const[name,file]of Object.entries(launch.controllers.receipts))try{receipts[name]=await json(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    await writeFile(join(output,'fixture-receipts.json'),JSON.stringify(receipts,null,2));await copyFile(launch.controllers.trace,join(output,'controller-trace.jsonl'));
    for(const name of (await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')))await copyFile(join(launch.state,'sessions',name),join(output,'session-'+name));
  }catch(error){report.ok=false;report.errors.push('Could not preserve isolated controller diagnostics: '+error);}
  await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
}
