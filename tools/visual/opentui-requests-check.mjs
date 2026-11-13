import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-requests');
const timeout=20_000,draft='REQUEST_MAIN_DRAFT_47',secret='SYNTHETIC_PRIVATE_REQUEST_TOKEN_47',hash=value=>createHash('sha256').update(value).digest('hex');
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
let server,serverExit,browser,page,launch,ptyExit;
await mkdir(output,{recursive:true});for(const name of ['failure.png','failure.txt'])await rm(join(output,name),{force:true});
const json=file=>readFile(file,'utf8').then(JSON.parse);
async function observe(read,predicate,reason){const end=Date.now()+timeout;let value;
  while(Date.now()<end){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}
  throw Error(reason+'; latest='+JSON.stringify(value));
}
try{
  const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_REQUESTS:'1',VISUAL_OUTPUT:output,AGENT_GRAPHICS:'off',
    ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
  serverExit=new Promise(done=>server.once('close',done));
  const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Requests bench startup timed out')),timeout);
    server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Requests bench exited '+code));});
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
  async function finderQuery(value,count){
    await page.keyboard.type(value);
    await page.waitForFunction(({value,count})=>{
      const lines=visual.text().split('\n');
      for(const[row,line]of lines.entries()){
        const title=line.indexOf('─ Windows ');if(title<0)continue;
        const left=line.lastIndexOf('┌',title),right=line.indexOf('┐',title);if(left<0||right<0)continue;
        if(lines[row+1]?.slice(left+1,right).trim()!==value)return false;
        return count===undefined||lines[row+2]?.slice(left+1,right).trim()===count+' windows · ↑↓ select · Enter open';
      }
      return false;
    },{value,count}).catch(error=>{throw Error('Finder did not show exact query '+JSON.stringify(value)+(count===undefined?'':' with '+count+' results'),{cause:error});});
  }
  async function main(){await key('Alt+0');await wait('─ Main · focused');}
  async function command(value){await main();await key('End');await key('Control+u');await type(value);await key('Enter');}
  async function pick(query){await key('F2');await wait('windows · ↑↓ select · Enter open');await finderQuery(query);await key('Enter');await absent('windows · ↑↓ select · Enter open');}
  const sessionFiles=async()=>(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl'));
  const events=async()=>(await Promise.all((await sessionFiles()).map(async name=>(await readFile(join(launch.state,'sessions',name),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)))).flat();
  const completions=async()=>(await readFile(join(output,'app-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.kind==='completion');
  async function noModelWork(){assert.equal((await completions()).length,1);}
  async function questionPending(){await noModelWork();assert.equal((await events()).filter(event=>event.type==='tool.result'&&event.callId==='app-main-question').length,0);}
  let pointerAttempt=0;
  async function click(label,also){const attempt=++pointerAttempt;
    const point=await page.waitForFunction(({label,also,attempt})=>{
      const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(label)&&(!also||line.includes(also)));if(row<0){delete window.__requestsPointer;return;}
      const col=lines[row].indexOf(label)+Math.min(1,label.length-1),rect=document.querySelector('.xterm-screen').getBoundingClientRect();
      const signature=[row,col,visual.terminal.cols,visual.terminal.rows,rect.x,rect.y,rect.width,rect.height].join(':'),previous=window.__requestsPointer;
      if(previous?.attempt!==attempt||previous.signature!==signature){window.__requestsPointer={attempt,signature,count:1};return;}
      if(++previous.count<3)return;return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};
    },{label,also,attempt},{polling:'raf'});const value=await point.jsonValue();await page.mouse.click(value.x,value.y);
  }
  async function capture(name){const attempts=[];for(let attempt=0;attempt<2;attempt++){
    await page.evaluate(()=>new Promise(done=>{const subscription=visual.terminal.onRender(()=>{subscription.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
    const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(output,name+'.png')});
    const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()})),stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});
    await writeFile(join(output,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(output,name+'.txt'),after.text);
    if(stable){report.screenshots.push(name+'.png');return;}
    if(attempt===0){await copyFile(join(output,name+'.png'),join(output,name+'.attempt1.png'));await page.evaluate(()=>{window.__requestsQuiet={frames:visual.frames,text:visual.text(),since:performance.now()};});
      await page.waitForFunction(()=>{const previous=window.__requestsQuiet,frames=visual.frames,text=visual.text(),now=performance.now();
        if(previous.frames!==frames||previous.text!==text){window.__requestsQuiet={frames,text,since:now};return false;}return now-previous.since>=150;
      },undefined,{polling:'raf',timeout:5000});}
  }throw Error('Terminal changed during both screenshot attempts: '+name);}

  const exists=file=>readFile(file).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
  const finderMarker='windows · ↑↓ select · Enter open';
  async function setZoom(enabled){
    // Transient request windows are intentionally absent from persisted layout.
    await key('Alt+w');await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
    if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');
    await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));await key('Escape');await absent('WINDOW MODE');
  }
  async function request(text,title='Questions · request-probe'){
    await pick(title);
    // Same-owner questions deliberately have public generic titles. Inspect real
    // focused content rather than indexing private question text in Finder.
    for(let index=0;index<10;index++){
      await setZoom(true);if((await screen()).includes(text))return;
      // Browser/OS Alt+Tab may arrive at the PTY as bare Tab. Arrange owns
      // native Tab explicitly, so enumerate resident windows through that mode.
      await key('Alt+w');await wait('WINDOW MODE');await key('Tab');await key('Escape');await absent('WINDOW MODE');
    }
    throw Error('No focused request window contains '+text);
  }
  async function closedRequest(text){
    await key('F2');await wait(finderMarker);await finderQuery('Questions · request-probe',2);
    await click('Questions · request-probe','Closed');await absent(finderMarker);await setZoom(true);await wait(text);
  }
  async function start(mode){await pick('Request controls');await setZoom(true);await click('Start '+mode);}
  async function retainedMain(){
    await main();await setZoom(true);await wait(draft);await wait('Edit answer');await key('Alt+i');await wait('[x] Production');await key('Alt+i');await wait(draft);await questionPending();
  }
  async function noReceipt(mode){assert.equal(await exists(launch.requests.receipts[mode]),false);}
  async function receipt(mode,predicate=()=>true){return observe(()=>json(launch.requests.receipts[mode]),predicate,'Private caller '+mode+' must receive its own result');}
  async function once(mode){assert.equal(await json(launch.requests.calls[mode]),1);}

  await wait('Message Main…');launch=await json(join(output,'opentui-app-launch.json'));assert.ok(launch.requests);
  assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);
  const args=launch.launches[0].command.slice(-4);assert.deepEqual(args.slice(0,3),['--renderer','opentui','--cwd']);assert.equal(await realpath(args[3]),await realpath(launch.cwd));
  if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);report.executable={path:launch.executable,sha256:launch.sha256};
    const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');report.renderer={path:renderer,sha256:hash(await readFile(renderer))};}
  await page.evaluate(()=>visual.terminal.resize(180,50));await command('APP_QUESTION');await wait('MAIN_QUESTION: choose deployment');
  await click('Edit answer');await click('[ ] Production');await wait('[x] Production');await click('Draft');

  // The manifest has no UI route and the command publishes no view. Its first
  // ordinary builtin exec request must create an independent approval immediately.
  await command('/request-probe approval-allow');await wait('Approval · request-probe');await wait('Approval required');
  assert.equal(await exists(launch.requests.effects.allow),false);await noReceipt('approval-allow');
  await main();await type(draft);await key('Alt+y');assert.equal(await exists(launch.requests.effects.allow),false);await questionPending();
  await key('F2');await wait(finderMarker);await type('Approval · request-probe');await key('Alt+y');await noReceipt('approval-allow');assert.equal(await exists(launch.requests.effects.allow),false);await key('Escape');await absent(finderMarker);
  await request('request-worker.sh allow','Approval · request-probe');await key('Enter');await noReceipt('approval-allow');
  await capture('01-independent-command-approval');await click('Allow once');
  const allowed=await receipt('approval-allow',value=>value.ok&&value.value?.ok===true);await once('approval-allow');
  assert.equal(await readFile(launch.requests.effects.allow,'utf8'),'allow\n');
  await retainedMain();await key('Alt+y');assert.equal(await readFile(launch.requests.effects.allow,'utf8'),'allow\n');
  await start('approval-deny');await request('request-worker.sh deny','Approval · request-probe');
  assert.equal(await exists(launch.requests.effects.deny),false);await key('Alt+n');
  const denied=await receipt('approval-deny',value=>value.ok&&value.value?.ok===false);await once('approval-deny');
  assert.equal(await exists(launch.requests.effects.deny),false);await retainedMain();
  report.checks.push('An ordinary immediate command without UI metadata creates its own real exec approval while Main waits; hidden/default keys cannot allow it, explicit Allow once writes exactly once and Deny has no file effect');

  await start('question-a');await request('UI_QUESTION_A');await key('Enter');await wait('[x] Local');await noReceipt('question-a');
  await click('[ ] Remote');await wait('[x] Remote');
  await start('question-b');await request('UI_QUESTION_B');await noReceipt('question-a');await noReceipt('question-b');await capture('02-pending-concurrent-questions');await retainedMain();
  await request('UI_QUESTION_A');await wait('[x] Remote');await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await absent('WINDOW MODE');
  await retainedMain();await closedRequest('UI_QUESTION_A');await wait('[x] Remote');await once('question-a');
  await key('Tab');await type('Alabel');await key('Home');await key('ArrowRight');await key('ArrowRight');
  await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await absent('WINDOW MODE');
  await closedRequest('UI_QUESTION_A');await type('X');await wait('AlXabel');await key('Control+c');
  const cancelledA=await receipt('question-a',value=>value.ok&&value.value?.ok===false);await once('question-a');
  await request('UI_QUESTION_B');await click('[ ] Remote');await wait('[x] Remote');await key('Alt+Enter');
  assert.deepEqual(await receipt('question-b'),{ok:true,value:'Remote'});await once('question-b');await retainedMain();
  await capture('02-concurrent-questions-main-retained');
  report.checks.push('Builtin and direct same-owner questions coexist independently; hiding/reopening preserves the selected answer and native custom-field cursor, Ctrl+C cancels only A and only explicit submission answers B');

  await start('questionnaire');await request('UI_CHECKS: choose checks');await key('Alt+Enter');await wait('Complete each question with an allowed answer');await noReceipt('questionnaire');
  await click('[ ] Unit');await click('[ ] Browser');await key('Tab');await type('Load tests');
  await key('Control+n');await wait('UI_OWNER: name the owner');await key('Alt+Enter');await wait('Complete each question with an allowed answer');await noReceipt('questionnaire');
  await type('Owner');await capture('02-questionnaire-validation-and-draft');await key('Home');await key('ArrowRight');await key('ArrowRight');
  await key('Control+p');await wait('[x] Unit');await wait('[x] Browser');await wait('Load tests');
  await key('Control+n');await wait('Owner');await key('End');await type('X');await wait('OwnerX');await key('Alt+Enter');
  const questionnaire=await receipt('questionnaire',value=>value.ok&&value.value?.ok===true);await once('questionnaire');
  assert.deepEqual(questionnaire.value.output,{answers:[{id:'checks',selected:['Unit','Browser'],text:'Load tests'},{id:'owner',selected:[],text:'OwnerX'}]});
  await retainedMain();report.checks.push('An independent builtin questionnaire enforces complete answers and preserves multiple choices, custom text and free-field draft through Back/Next before returning the exact structured result');

  await start('form');await request('Private label','UI private token');assert.ok(!(await screen()).includes('Draft'));await key('Home');for(let index=0;index<4;index++)await key('ArrowRight');await type('_');
  await key('Alt+Enter');await wait('Complete the form with valid fields and an offered action');await noReceipt('form');await type('V');await wait('FORM_Vvalue');
  await key('Tab');await page.keyboard.type(secret);await wait('*'.repeat(secret.length));await key('Enter');await noReceipt('form');
  assert.ok(!(await screen()).includes(secret));await key('Shift+Tab');
  await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await absent('WINDOW MODE');
  await retainedMain();await pick('UI private token');await setZoom(true);await wait('FORM_Vvalue');await type('X');await wait('FORM_VXvalue');await once('form');
  await capture('03-private-form-resumed');await retainedMain();
  report.checks.push('An independent private form has no draft toggle, Enter does not submit a field, and hiding/reopening retains native field cursor and masked password without completing Main');

  // These two actual immediate commands intentionally replace the editor with
  // their slash text; restore the known draft before testing isolation again.
  await command('/request-probe background-before');await observe(()=>json(launch.requests.launchers['background-before']),value=>value===true,'The first explicit background launcher must settle');
  await observe(()=>json(launch.requests.requested['background-before']),value=>value===true,'The before-settlement retained request must start');
  await observe(events,rows=>rows.filter(row=>row.type==='command.operation'&&row.plugin==='request-probe'&&row.phase==='completed').length===2,'The before-request launcher command must complete while its retained question waits');
  await wait('─ Main · focused');await absent('BACKGROUND_BEFORE');await main();await type(draft);await noReceipt('background-before');
  await command('/request-probe background-after');await observe(()=>json(launch.requests.launchers['background-after']),value=>value===true,'The second explicit background launcher must settle');
  await observe(events,rows=>rows.filter(row=>row.type==='command.operation'&&row.plugin==='request-probe'&&row.phase==='completed').length===3,'The retained after-handle launcher must complete before a later public action starts its request');
  assert.equal(await exists(launch.requests.requested['background-after']),false);await main();await type(draft);
  await start('background-after-trigger');
  await observe(()=>json(launch.requests.requested['background-after']),value=>value===true,'The after-settlement retained request must start');
  await wait('─ Request controls · focused');await noReceipt('background-after');await noReceipt('form');await capture('04-background-requests-passive-focus');await retainedMain();
  await key('Control+x');await absent('Main · Question');await wait('Main · Ready');await wait(draft);await noModelWork();
  await request('BACKGROUND_BEFORE');await noReceipt('background-after');await key('Escape');
  const backgroundBefore=await receipt('background-before',value=>value.ok===false);await once('background-before');
  await request('BACKGROUND_AFTER');await click('[ ] Keep');await wait('[x] Keep');await key('Alt+Enter');
  assert.deepEqual(await receipt('background-after'),{ok:true,value:'Keep'});await once('background-after');await noReceipt('form');
  await capture('04-independent-background-lifetimes');
  report.checks.push('Explicit retained requests started before and after launcher settlement do not steal focus and remain independent of Main Ctrl+X; cancelling one leaves the other and the private form pending');

  await pick('UI private token');await setZoom(true);await wait('FORM_VXvalue');await wait('*'.repeat(secret.length));await key('Alt+Enter');
  const form=await receipt('form');assert.deepEqual(form,{ok:true,action:'save',name:'FORM_VXvalue',tokenLength:secret.length,tokenHash:hash(secret)});await once('form');
  const rows=await events(),toolCalls=rows.filter(event=>event.type==='tool.call'&&['exec','ask_user','ask_questions'].includes(event.tool));
  assert.equal(toolCalls.filter(event=>event.tool==='exec').length,2);assert.equal(toolCalls.filter(event=>event.tool==='ask_user').length,2);assert.equal(toolCalls.filter(event=>event.tool==='ask_questions').length,1);
  for(const call of toolCalls)assert.ok(rows.some(event=>event.type==='tool.result'&&event.callId===call.callId));
  await main();await wait(draft);await capture('05-all-independent-requests-settled');await noModelWork();
  const journal=(await Promise.all((await sessionFiles()).map(name=>readFile(join(launch.state,'sessions',name),'utf8')))).join('\n');
  for(const[value,label]of [[await readFile(join(output,'terminal.ansi'),'utf8'),'terminal'],[JSON.stringify((await completions()).map(row=>row.body)),'provider bodies'],[journal,'session journals']])assert.ok(!value.includes(secret),'Private token leaked to '+label);
  assert.equal(await readFile(launch.requests.effects.allow,'utf8'),'allow\n');assert.equal(await exists(launch.requests.effects.deny),false);
  await writeFile(join(output,'request-events.json'),JSON.stringify(rows.filter(event=>['command.operation','tool.operation','tool.call','tool.result','turn.interrupted'].includes(event.type)),null,2));
  await command('/reload');await observe(()=>json(launch.requests.reloaded),value=>value===true,'Reload must finish once all independent requests settle');await wait('Reloaded ');await noModelWork();
  report.results={allowed,denied,cancelledA,questionnaire,backgroundBefore,form};report.privacy={terminalOutput:true,providerBodies:true,sessionJournals:true,inputLogExcluded:'Raw keystrokes contain only the synthetic test token'};
  report.checks.push('Only the form caller receives its private hashed receipt; the token is absent from terminal/model/journal, exact tool IDs settle once, normal denial stays intact and real reload confirms quiescence');
  await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');report.ptyExitCode=ptyExit;assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{
  if(launch)try{
    const receipts={};for(const[name,file]of Object.entries(launch.requests.receipts)){
      try{receipts[name]=await json(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    await writeFile(join(output,'fixture-receipts.json'),JSON.stringify(receipts,null,2));
    const sessions=await readdir(join(launch.state,'sessions')).catch(error=>{if(error.code!=='ENOENT')throw error;return[];});
    for(const name of sessions.filter(name=>name.endsWith('.jsonl')))await copyFile(join(launch.state,'sessions',name),join(output,'session-'+name));
  }catch(error){report.ok=false;report.errors.push('Could not preserve isolated request diagnostics: '+error);}
  await browser?.close();
  if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
}
