import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {createOpenTuiFinder} from './opentui-finder.mjs';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-editor');
const timeout=20_000,hash=text=>createHash('sha256').update(text).digest('hex');
const draft='EDITOR_PRIVATE_DRAFT_47',token='SYNTHETIC_EDITOR_PRIVATE_TOKEN_47',unicode='A😀窗éZ';
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[],compositions:{}};
const json=file=>readFile(file,'utf8').then(JSON.parse);
const exists=file=>readFile(file).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
async function observe(read,predicate,reason){const deadline=Date.now()+timeout;let value;
  while(Date.now()<deadline){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}
  throw Error(reason+'; latest='+JSON.stringify(value));
}
await mkdir(output,{recursive:true});
for(const composition of ['native','selected']){
  const directory=join(output,composition),result={ok:false,checks:[],screenshots:[],errors:[]};await mkdir(directory,{recursive:true});report.compositions[composition]=result;
  let server,serverExit,browser,page,launch,ptyExit;
  try{
    const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
    server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_EDITOR:'1',VISUAL_OPENTUI_EDITOR_COMPOSITION:composition,VISUAL_OUTPUT:directory,AGENT_GRAPHICS:'off',
      ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
    serverExit=new Promise(done=>server.once('close',done));
    const url=await new Promise((done,fail)=>{let text='';const deadline=setTimeout(()=>fail(Error('Editor bench startup timed out')),timeout);
      server.on('error',error=>{clearTimeout(deadline);fail(error);});serverExit.then(code=>{clearTimeout(deadline);fail(Error('Editor bench exited '+code));});
      server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(deadline);done(match[1]);}});
    });
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
    page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>result.errors.push(error.message));
    const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);
    socket.on('framereceived',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='exit')ptyExit=value.code;}catch{}});
    const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
    const wait=value=>page.waitForFunction(value=>window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
    const absent=value=>page.waitForFunction(value=>!window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal retained '+JSON.stringify(value),{cause:error});});
    const raw=data=>page.evaluate(data=>socket.send(JSON.stringify({type:'input',data})),data);
    const paste=value=>raw('\x1b[200~'+value+'\x1b[201~');
    async function normal(main=false){await page.waitForFunction(main=>{
      const terminal=visual.terminal,text=visual.text(),toolbar=terminal.buffer.active.getLine(terminal.buffer.active.viewportY+1)?.translateToString(true)??'';
      return terminal.modes?.synchronizedOutputMode!==true&&toolbar.includes('Alt+W Arrange')&&!text.includes('WINDOW MODE')&&!text.includes('windows · ↑↓ select · Enter open')&&(!main||text.includes('─ Main · focused'));
    },main);}
    async function main(){await key('Alt+0');await normal(true);}
    async function openFinder(){await key('Alt+w');await wait('WINDOW MODE');await key('w');}
    const finder=createOpenTuiFinder({page,key,wait,absent,open:openFinder});
    async function setZoom(enabled){await key('Alt+w');await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
      if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));await key('Escape');await normal();if(enabled)await wait('Zoomed · Alt+W f tiles');}
    async function editor(text,cursor=text.length){await wait('CUSTOM INPUT');await wait('Draft: '+text.slice(0,cursor).replaceAll('\n','↵')+'|'+text.slice(cursor).replaceAll('\n','↵'));await wait('Cursor UTF16: '+cursor+' / '+text.length);}
    async function replace(text){await main();await key('Control+u');if(text)await paste(text);await editor(text);}
    async function send(text,keyName='F2'){await replace(text);await key(keyName);}
    let pointerAttempt=0;
    async function click(label,index=1){const attempt=++pointerAttempt;
      const handle=await page.waitForFunction(({label,index,attempt})=>{
        const terminal=visual.terminal,buffer=terminal.buffer.active;if(terminal.modes?.synchronizedOutputMode===true)return;
        for(let row=0;row<terminal.rows;row++){
          const cells=Array.from({length:terminal.cols},(_,col)=>buffer.getLine(buffer.viewportY+row)?.getCell(col)?.getChars()??'');
          const offset=cells.join('').indexOf(label);if(offset<0)continue;let text='',col=0;while(col<cells.length&&text.length<offset){text+=cells[col];col++;}col+=index;
          const rect=document.querySelector('.xterm-screen').getBoundingClientRect(),signature=JSON.stringify([row,col,terminal.cols,terminal.rows,rect.x,rect.y,rect.width,rect.height,cells.join('')]),previous=window.__editorPointer;
          if(previous?.attempt!==attempt||previous.signature!==signature){window.__editorPointer={attempt,signature,count:1};return;}if(++previous.count<3)return;
          return{x:rect.x+(col+.5)*rect.width/terminal.cols,y:rect.y+(row+.5)*rect.height/terminal.rows};
        }
      },{label,index,attempt},{polling:'raf'});const value=await handle.jsonValue();await page.mouse.click(value.x,value.y);
    }
    async function capture(name){const attempts=[];for(let attempt=0;attempt<2;attempt++){
      await page.evaluate(()=>new Promise(done=>{const subscription=visual.terminal.onRender(()=>{subscription.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
      const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(directory,name+'.png')});
      const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()})),stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});
      await writeFile(join(directory,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(directory,name+'.txt'),after.text);
      if(stable){result.screenshots.push(name+'.png');return;}if(attempt===0){await copyFile(join(directory,name+'.png'),join(directory,name+'.attempt1.png'));
        await page.evaluate(()=>{window.__editorQuiet={frames:visual.frames,text:visual.text(),since:performance.now()};});await page.waitForFunction(()=>{const previous=window.__editorQuiet,frames=visual.frames,text=visual.text(),now=performance.now();
          if(previous.frames!==frames||previous.text!==text){window.__editorQuiet={frames,text,since:now};return false;}return now-previous.since>=150;
        },undefined,{polling:'raf',timeout:5000});}
    }throw Error('Terminal changed during both screenshot attempts: '+name);}
    const trace=async()=>{const value=await readFile(launch.editor.trace,'utf8');return value.trim().split('\n').filter(Boolean).map(JSON.parse);};
    const completions=async()=>(await readFile(join(directory,'app-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.kind==='completion');
    const sessionFiles=async()=>(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl'));
    const journal=async()=>(await Promise.all((await sessionFiles()).map(name=>readFile(join(launch.state,'sessions',name),'utf8')))).join('\n');
    const receipt=mode=>observe(()=>json(launch.editor.receipts[mode]),()=>true,'Caller receipt '+mode);
    const calls=mode=>json(launch.editor.calls[mode]);
    async function start(mode){await finder.pick('Editor controls');await setZoom(true);await click('Start '+mode);}
    async function reload(){const before=await json(launch.editor.reloaded).catch(error=>{if(error.code!=='ENOENT')throw error;return 0;});
      await finder.pick('Plugins');await setZoom(true);await click('Apply plugin changes');await observe(()=>json(launch.editor.reloaded),value=>value>before,'Canonical plugin reload must finish');await wait('Reloaded ');}
    async function retained(){await main();await setZoom(true);await editor(draft,1);await paste('X');await editor('EXDITOR_PRIVATE_DRAFT_47',2);await key('Backspace');await editor(draft,1);}
    async function answerMain(){await main();await key('Alt+i');if(composition==='selected'){await wait('CUSTOM QUESTION');await key('F4');}
      else{await wait('MAIN_QUESTION: choose deployment');await wait('[x] Production');await key('Alt+Enter');}
      await wait('APP_ANSWER_RECEIVED: Production');await wait('Main · Ready');}
    async function parkQuestion(){await send('APP_QUESTION');await wait('Main · Question');
      if(composition==='native'){await wait('Edit answer');await key('Alt+i');await key('ArrowDown');await key('Space');await wait('[x] Production');await key('Alt+i');}
      await replace(draft);await key('Home');await key('ArrowRight');await editor(draft,1);}

    await wait('CUSTOM INPUT');launch=await json(join(directory,'opentui-app-launch.json'));assert.equal(launch.editor.composition,composition);
    assert.equal(await page.evaluate(()=>visual.terminal.unicode.activeVersion),'11');
    assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);
    const args=launch.launches[0].command.slice(-4);assert.deepEqual(args.slice(0,3),['--renderer','opentui','--cwd']);assert.equal(await realpath(args[3]),await realpath(launch.cwd));
    if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);result.executable={path:launch.executable,sha256:launch.sha256};
      const file=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');result.renderer={path:file,sha256:hash(await readFile(file))};}
    await page.evaluate(()=>visual.terminal.resize(180,50));await page.waitForFunction(()=>{const t=visual.terminal,b=t.buffer.active;
      return t.cols===180&&t.rows===50&&t.modes?.synchronizedOutputMode!==true&&b.getLine(b.viewportY+3)?.getCell(179)?.getChars()==='┐'&&b.getLine(b.viewportY+48)?.getCell(179)?.getChars()==='┘';});
    await main();await setZoom(true);await editor('');await wait('viewport 7');await wait('F9 history scroll');await wait('F2 sends · Enter inserts a line');

    if(composition==='native'){
      await paste('APP_EDITOR_MULTILINE');await editor('APP_EDITOR_MULTILINE');await key('Enter');await editor('APP_EDITOR_MULTILINE\n');
      assert.equal((await completions()).length,0);await paste(unicode);await key('Home');
      for(let i=0;i<'APP_EDITOR_MULTILINE\n'.length;i++)await key('ArrowRight');await key('ArrowRight');await key('ArrowRight');
      await editor('APP_EDITOR_MULTILINE\n'+unicode,'APP_EDITOR_MULTILINE\n'.length+3);await paste('X');
      const multiline='APP_EDITOR_MULTILINE\nA😀X窗éZ';await editor(multiline,'APP_EDITOR_MULTILINE\n'.length+4);
      await key('F6');await wait('evidence true');const caps=(await trace()).findLast(row=>row.event==='capabilities');assert.ok(caps.commands.includes('/editor-probe'));assert.ok(caps.files.some(file=>file.includes('editor-evidence.txt')));
      await capture('01-unicode-custom-editor');await click('Draft: APP_EDITOR_MULTILINE',8);await editor(multiline,1);
      assert.ok((await trace()).some(row=>row.event==='input'&&row.kind==='mouse'&&row.action==='press'&&row.row===1&&row.col===8));
      await key('F2');await wait('Accepted');await wait('EDITOR_DONE: APP_EDITOR_MULTILINE / A😀X窗éZ');await wait('Main · Ready');await editor('');
      assert.equal((await completions())[0].body.messages.filter(message=>message.role==='user').at(-1).content,multiline);
      await send('APP_EDITOR_HOLD');await observe(completions,rows=>rows.some(row=>row.body.messages.at(-1)?.content==='APP_EDITOR_HOLD'),'Real provider request must be held');
      await send('APP_EDITOR_QUEUE');await wait('Queued');await editor('');await send('APP_EDITOR_STEER','F3');await wait('Queued');await editor('');
      await replace(draft);await key('Home');await key('ArrowRight');await writeFile(launch.editor.gates.model,'release\n');
      await wait('EDITOR_DONE: APP_EDITOR_QUEUE');await wait('Main · Ready');await editor(draft,1);
      const bodies=(await completions()).map(row=>row.body);assert.equal(bodies.filter(body=>body.messages.at(-1)?.content==='APP_EDITOR_QUEUE').length,1);
      assert.ok(bodies.some(body=>body.messages.some(message=>message.role==='user'&&message.content==='APP_EDITOR_STEER')));
      await send('APP_EDITOR_DROP');await wait('Accepted');await wait('Main · Ready');await editor('');const afterDrop=(await completions()).length;
      await send('APP_EDITOR_ERROR');await wait('Accepted');await wait('EDITOR_ACCEPTED_PROVIDER_FAILURE');await wait('Main · Ready');await editor('');
      assert.equal((await completions()).length,afterDrop+1);await capture('02-admitted-busy-input');
      result.checks.push('The documented F2 submits exact Unicode/multiline text while Enter inserts a line; private UTF-16 cursor and real command/file capabilities work, busy submit/steer queue once, and accepted hook/provider failures do not restore consumed text');
    }

    await parkQuestion();const questionRequests=(await completions()).length;
    await key('Alt+i');await key('F2');await wait(finder.marker);await finder.query('Editor controls',1);await key('Escape');await normal(true);await key('Alt+i');await editor(draft,1);
    await start('question');await finder.pick('Questions · editor-request-probe');await setZoom(true);await wait('EDITOR_PRIVATE_QUESTION');
    await key('F2');await wait(finder.marker);await key('Escape');await normal();
    if(composition==='selected'){await wait('CUSTOM QUESTION');await key('F4');}
    else{await key('ArrowDown');await key('Space');await wait('[x] Remote');await key('Alt+Enter');}
    assert.deepEqual(await receipt('question'),{ok:true,value:'Remote'});assert.equal(await calls('question'),1);await retained();
    const formTitle=composition==='selected'?'Form · editor-request-probe':'Editor private form';
    await start('form');await finder.pick(formTitle);await setZoom(true);
    if(composition==='selected'){
      await wait('CUSTOM PRIVATE FORM');await key('Home');await key('ArrowRight');await paste('X');await wait('Name: FX|ORMvalue');await key('Tab');await paste(token);await wait('Token: '+'*'.repeat(token.length));
    }else{
      await wait('Editor private form');await key('Home');await key('ArrowRight');await paste('X');await wait('FXORMvalue');await key('Tab');await paste(token);await wait('*'.repeat(token.length));
    }
    await capture('03-'+composition+'-private-form');await setZoom(false);await capture('03-'+composition+'-tiled-workspace');await setZoom(true);
    await key('F2');await wait(finder.marker);await key('Escape');await normal();
    assert.equal(await exists(launch.editor.receipts.form),false);await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await normal();
    await retained();assert.equal((await completions()).length,questionRequests);await finder.pick(formTitle);await setZoom(true);
    if(composition==='selected'){await wait('Name: FX|ORMvalue');await wait('Token: '+'*'.repeat(token.length));await key('F5');}
    else{await wait('FXORMvalue');await wait('*'.repeat(token.length));await key('Alt+Enter');}
    assert.deepEqual((await receipt('form')).value,{action:'save',name:'FXORMvalue',tokenLength:token.length,tokenHash:hash(token)});assert.equal(await calls('form'),1);
    await retained();await main();await key('Alt+i');await key('F2');await wait(finder.marker);await key('Escape');await normal(true);
    assert.equal((await completions()).length,questionRequests);await key('Alt+i');await editor(draft,1);
    await answerMain();await editor(draft,1);assert.equal((await completions()).length,questionRequests+1);await capture('04-'+composition+'-ownership');
    result.checks.push(composition==='native'
      ?'Native Main question and independent private form park the custom draft/cursor; F2 opens Windows outside Draft, hide/reopen retains private fields, and only explicit answers reach model/caller'
      :'Selected F4/F5 private request controllers retain their own keys and masked form state while custom F2 belongs only to Main Draft; Finder and answer navigation preserve the parked UTF-16 cursor');

    if(composition==='native'){
      const before=(await trace()).findLast(row=>row.event==='created');await reload();await main();await setZoom(true);await editor(draft,1);
      const after=(await trace()).findLast(row=>row.event==='created');assert.notEqual(after.id,before.id);assert.deepEqual({hash:after.hash,length:after.length,cursor:after.cursor},{hash:hash(draft),length:draft.length,cursor:1});
      assert.deepEqual((await trace()).find(row=>row.event==='disposed'&&row.id===before.id),{...((await trace()).find(row=>row.event==='disposed'&&row.id===before.id)),length:0,cursor:0});
      // Open the canonical history once before parking a delayed editor input;
      // afterward Finder restores this existing public source without replacing
      // the checkpoint under test with a deliberately typed slash command.
      await send('/history');await wait('Editor resumed conversation');await replace(draft);await key('Home');await key('ArrowRight');await editor(draft,1);
      await key('F8');await observe(trace,rows=>rows.some(row=>row.id===after.id&&row.event==='late-started'),'Old editor must hold its delayed intent');
      const requestsBeforeResume=(await completions()).length;await finder.pick('Chat history');await setZoom(true);await wait('Editor resumed conversation');await click('Editor resumed conversation');await click('Resume selected chat');
      await wait('EDITOR_RESUME_HISTORY');await main();await editor(draft,1);const resumed=(await trace()).findLast(row=>row.event==='created');assert.equal(resumed.sessionId,launch.editor.resumeId);
      assert.deepEqual({hash:resumed.hash,length:resumed.length,cursor:resumed.cursor},{hash:hash(draft),length:draft.length,cursor:1});
      await writeFile(launch.editor.gates.late,'release\n');const late=await observe(trace,rows=>rows.some(row=>row.event==='late-returned'&&row.id===after.id),'Old async editor must finish after generation replacement');
      assert.deepEqual(late.find(row=>row.event==='late-returned'&&row.id===after.id),{...late.find(row=>row.event==='late-returned'&&row.id===after.id),aborted:true,commands:false,files:false});
      assert.equal((await completions()).length,requestsBeforeResume);await editor(draft,1);await wait('EDITOR_RESUME_HISTORY');
      const beforeScroll=(await screen()).match(/EDITOR_HISTORY_\d+/g)?.map(value=>Number(value.slice(-2)));assert.ok(beforeScroll?.length);
      const firstOlder='EDITOR_HISTORY_'+String(Math.min(...beforeScroll)-1).padStart(2,'0');await key('F9');await normal(true);await wait(firstOlder);await absent('EDITOR_RESUME_HISTORY');
      result.historyScroll={firstPreviouslyVisible:Math.min(...beforeScroll),olderVisible:firstOlder,rows:3};await editor(draft,1);
      await key('Shift+F9');await normal(true);await wait('EDITOR_RESUME_HISTORY');await editor(draft,1);
      await send('APP_EDITOR_RESUMED');await wait('EDITOR_DONE: APP_EDITOR_RESUMED');await wait('Main · Ready');
      assert.ok((await completions()).at(-1).body.messages.some(message=>message.content==='Historical editor context'));await capture('05-reload-resume-checkpoint');
      result.checks.push('Canonical plugin reload snapshots before destructive dispose; real history resume transfers the private draft/cursor into the new Core generation, revokes old commands/files and ignores a gated late submit');
    }else{
      for(let i=1;i<=4;i++){await start('hold-'+i);await observe(()=>json(launch.editor.started['hold-'+i]),value=>value===true,'Held operation '+i+' must be admitted');}
      const rejected='/editor-probe hold-5';await replace(rejected);await key('Home');await key('ArrowRight');await editor(rejected,1);
      const old=(await trace()).findLast(row=>row.event==='created');
      // One real PTY chunk admits the submit and following text before the
      // asynchronous receipt/recovery can repaint a replacement editor lease.
      await raw('\x1bOQ\x1b[200~X\x1b[201~');await wait('Not sent · draft restored');await editor('/Xeditor-probe hold-5',2);
      const recovered=(await trace()).findLast(row=>row.event==='created');assert.notEqual(recovered.id,old.id);assert.deepEqual({hash:recovered.hash,length:recovered.length,cursor:recovered.cursor},{hash:hash(rejected),length:rejected.length,cursor:1});
      assert.equal(await exists(launch.editor.calls['hold-5']),false);await paste('Y');await editor('/XYeditor-probe hold-5',3);await capture('05-visible-pre-admission-recovery');
      for(let i=1;i<=4;i++)await writeFile(launch.editor.gates['hold-'+i],'release\n');for(let i=1;i<=4;i++){assert.deepEqual((await receipt('hold-'+i)).value,{released:true});assert.equal(await calls('hold-'+i),1);}
      result.checks.push('Four real foreground UI operations cause a genuine fifth-command pre-admission rejection; the visibly recreated editor restores exact text/cursor and replays already admitted following input once');
      await replace(draft);await key('Home');await key('ArrowRight');const oldRequests=(await completions()).length;
      await start('disable-editor');assert.equal((await receipt('disable-editor')).value.ok,true);await reload();await main();await wait('Selected editor is unavailable');
      await key('F2');await wait(finder.marker);await finder.query('Editor controls',1);await key('Escape');await normal(true);await paste('UNAVAILABLE_EDITOR_MUST_NOT_SEND');await key('Enter');
      await key('F2');await wait(finder.marker);await finder.query('Editor controls',1);await key('Escape');await normal(true);
      assert.equal((await completions()).length,oldRequests);await absent('UNAVAILABLE_EDITOR_MUST_NOT_SEND');await capture('06-editor-unload-fails-closed');
      result.checks.push('Disabling the selected editor through the normal extension policy and canonical reload fails closed without native draft fallback; F2 navigation remains available and no hidden input reaches the model');
    }
    const http=JSON.stringify((await completions()).map(row=>row.body)),log=await journal(),terminal=await readFile(join(directory,'terminal.ansi'),'utf8');
    for(const[value,label]of [[terminal,'terminal output'],[http,'provider bodies'],[log,'session journals']])assert.ok(!value.includes(token),'Private token leaked to '+label);
    for(const[value,label]of [[http,'provider bodies'],[log,'session journals']])for(const privateText of [draft,'FORMvalue','FXORMvalue','UNAVAILABLE_EDITOR_MUST_NOT_SEND'])assert.ok(!value.includes(privateText),'Private draft/form value leaked to '+label);
    assert.ok(!/MaxListenersExceededWarning/.test(terminal));result.privacy={tokenOutput:true,privateDraftAndFormBodies:true,inputLogExcluded:'Raw keystrokes record synthetic fixture values'};
    await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');result.ptyExitCode=ptyExit;assert.deepEqual(result.errors,[]);result.ok=true;
  }catch(error){result.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(directory,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});}}
  finally{
    if(launch)try{
      for(const file of Object.values(launch.editor.gates))await writeFile(file,'cleanup\n');
      await copyFile(launch.editor.trace,join(directory,'editor-trace.jsonl'));if(launch.editor.selectedTrace)await copyFile(launch.editor.selectedTrace,join(directory,'selected-trace.jsonl'));
      const receipts={};for(const[name,file]of Object.entries(launch.editor.receipts))if(await exists(file))receipts[name]=await json(file);await writeFile(join(directory,'fixture-receipts.json'),JSON.stringify(receipts,null,2));
      for(const name of (await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')))await copyFile(join(launch.state,'sessions',name),join(directory,'session-'+name));
    }catch(error){result.ok=false;result.errors.push('Could not preserve isolated editor diagnostics: '+error);}
    await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}
    await writeFile(join(directory,'report.json'),JSON.stringify(result,null,2)+'\n');report.checks.push(...result.checks);report.screenshots.push(...result.screenshots.map(name=>composition+'/'+name));report.errors.push(...result.errors);
  }
  if(!result.ok)break;
}
report.ok=report.checks.length===6&&report.errors.length===0;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
