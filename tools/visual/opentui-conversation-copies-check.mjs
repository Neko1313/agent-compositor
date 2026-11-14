import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {createOpenTuiFinder} from './opentui-finder.mjs';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-conversation-copies');
const timeout=20_000,hash=text=>createHash('sha256').update(text).digest('hex');
const draft='COPY_PRIVATE_A😀窗_47',token='SYNTHETIC_COPY_PRIVATE_TOKEN_47';
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[],compositions:{}};
const json=file=>readFile(file,'utf8').then(JSON.parse),leaves=node=>node?.surface?[node.surface]:node?.children?.flatMap(leaves)??[];
const location=(value,id)=>value.windows.spaces.find(space=>leaves(space.tree).includes(id))?.id;
const exists=file=>readFile(file).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
async function observe(read,predicate,reason){const end=Date.now()+timeout;let value;
  while(Date.now()<end){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}
  throw Error(reason+'; latest='+JSON.stringify(value));
}
function nativeFocusedHistory(){
  const terminal=visual.terminal,buffer=terminal.buffer.active;if(terminal.modes?.synchronizedOutputMode===true)return;
  const rows=Array.from({length:terminal.rows},(_,y)=>Array.from({length:terminal.cols},(_,x)=>buffer.getLine(buffer.viewportY+y)?.getCell(x)?.getChars()??''));
  for(let top=0;top<rows.length;top++){
    const focused=rows[top].findIndex((_,x)=>Array.from(' · focused ').every((ch,index)=>rows[top][x+index]===ch));if(focused<0)continue;
    const left=rows[top].lastIndexOf('┌',focused),right=rows[top].findIndex((ch,x)=>x>focused&&ch==='┐');if(left<0||right<=left)continue;
    const bottom=rows.findIndex((row,y)=>y>top&&row[left]==='└'&&row[right]==='┘');if(bottom<0)continue;
    const dock=rows.findIndex((row,y)=>y>top&&y<bottom&&/─ Main · (?:Ready|Running|Draft)\b/.test(row.slice(left+1,right).join('')));
    if(dock<0)return;
    return rows.slice(top+1,dock).map(row=>row.slice(left+1,right).join('').trimEnd()).join('\n');
  }
}
// Read only actual native cells: a narrow textarea can wrap the exact fixture text.
function nativeComposerInput(text){
  const terminal=visual.terminal,buffer=terminal.buffer.active;if(terminal.modes?.synchronizedOutputMode===true)return false;
  const rows=Array.from({length:terminal.rows},(_,y)=>Array.from({length:terminal.cols},(_,x)=>buffer.getLine(buffer.viewportY+y)?.getCell(x)?.getChars()??''));
  for(let top=0;top<rows.length;top++){
    const focused=rows[top].findIndex((_,x)=>Array.from(' · focused ').every((ch,index)=>rows[top][x+index]===ch));if(focused<0)continue;
    const left=rows[top].lastIndexOf('┌',focused),right=rows[top].findIndex((ch,x)=>x>focused&&ch==='┐');if(left<0||right<=left)continue;
    const bottom=rows.findIndex((row,y)=>y>top&&row[left]==='└'&&row[right]==='┘');if(bottom<0)continue;
    for(let header=top+1;header<bottom;header++){
      if(!/─ Main · (?:Ready|Running|Draft)\b/.test(rows[header].slice(left+1,right).join('')))continue;
      const first=rows[header+1],send=first.findIndex((_,x)=>x>left&&x<right&&Array.from('Send').every((ch,index)=>first[x+index]===ch));
      // The Send text has one cell of button padding and one gap before it.
      const start=left+2,end=send-2;if(send<0||end<=start)return false;
      // The last body row is the host shortcut footer, outside the textarea.
      const value=rows.slice(header+1,bottom-1).map(row=>row.slice(start,end).join('').trimEnd()).join('');
      return text?value===text:value==='Message Main…';
    }
  }
  return false;
}
await mkdir(output,{recursive:true});
for(const composition of ['native','selected']){
  const directory=join(output,composition),result={ok:false,checks:[],screenshots:[],errors:[]};await mkdir(directory,{recursive:true});report.compositions[composition]=result;
  let server,serverExit,browser,page,launch,ptyExit,renderer='ink';
  try{
    const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
    server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_CONVERSATION_COPIES:'1',VISUAL_OPENTUI_COPY_COMPOSITION:composition,VISUAL_OUTPUT:directory,AGENT_GRAPHICS:'off',
      ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
    serverExit=new Promise(done=>server.once('close',done));
    const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Copy bench startup timed out')),timeout);
      server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Copy bench exited '+code));});
      server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});
    });
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
    page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>result.errors.push(error.message));
    const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);
    socket.on('framereceived',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='exit')ptyExit=value.code;}catch{}});
    const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
    const wait=value=>page.waitForFunction(value=>window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
    const absent=value=>page.waitForFunction(value=>!window.visual?.text().includes(value),value).catch(error=>{throw Error('Terminal retained '+JSON.stringify(value),{cause:error});});
    const raw=data=>page.evaluate(data=>socket.send(JSON.stringify({type:'input',data})),data),paste=value=>raw('\x1b[200~'+value+'\x1b[201~');
    const layout=()=>json(join(launch.state,'layout.json')),trace=async()=>{const value=await readFile(launch.conversationCopies.trace,'utf8');return value.trim().split('\n').filter(Boolean).map(JSON.parse);};
    const selectedTrace=async()=>{const file=launch.conversationCopies.selectedTrace;if(!file)return[];const value=await readFile(file,'utf8');return value.trim().split('\n').filter(Boolean).map(JSON.parse);};
    const completions=async()=>(await readFile(join(directory,'app-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.kind==='completion');
    const sessions=async()=>(await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl'));
    const journal=async()=>(await Promise.all((await sessions()).map(name=>readFile(join(launch.state,'sessions',name),'utf8')))).join('\n');
    const check=text=>result.checks.push(text);
    const historyHas=(text,present=true)=>observe(()=>page.evaluate(nativeFocusedHistory),value=>value.includes(text)===present,'Focused Main history '+(present?'missing ':'retained ')+text);
    async function normal(){await page.waitForFunction(renderer=>{const t=visual.terminal,text=visual.text();return t.modes?.synchronizedOutputMode!==true&&!text.includes('WINDOW MODE')
      &&(renderer==='ink'?text.includes('[Arrange]'):text.includes('Alt+W Arrange'))&&!text.includes('windows · ↑↓ select · Enter open')&&!text.includes('Find:');},renderer);}
    async function arrange(){await key('Alt+w');await wait('WINDOW MODE');}
    async function leave(){await key('Escape');await normal();}
    async function openFinder(){await arrange();await key('w');}
    const finder=createOpenTuiFinder({page,key,wait,absent,open:openFinder});
    async function setZoom(enabled){await arrange();await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
      if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));await leave();}
    async function focus(id){const saved=await layout(),workspace=location(saved,id);assert.ok(workspace,'Focus requires an actual open window: '+id);
      await arrange();if(saved.windows.workspace!==workspace){await key(String(workspace));await observe(layout,value=>value.windows.workspace===workspace,'Actual workspace switch');}
      let current=await layout();const count=leaves(current.windows.spaces.find(space=>space.id===workspace)?.tree).length;
      for(let i=0;current.windows.focused!==id&&i<count;i++){const previous=current.windows.focused;await key('Tab');current=await observe(layout,value=>value.windows.focused!==previous,'Actual content focus cycle');}
      assert.equal(current.windows.focused,id);await leave();}
    async function main(){const before=await layout(),isMain=id=>id==='session'||before.views.some(view=>view.id===id&&view.kind==='session');
      const retained=isMain(before.windows.focused)&&location(before,before.windows.focused)!==undefined?before.windows.focused:undefined;
      await key('Alt+0');await normal();const after=await observe(layout,value=>isMain(value.windows.focused)&&location(value,value.windows.focused)!==undefined,'Alt0 must focus an existing Main window');
      if(retained)assert.equal(after.windows.focused,retained,'Alt0 on a focused Main copy is idempotent');}
    async function input(text,cursor=text.length){if(composition==='selected'){
      await wait('COPY CUSTOM INPUT');await wait('D: '+text.slice(0,cursor).replaceAll('\n','↵')+'|'+text.slice(cursor).replaceAll('\n','↵'));await wait('Cursor UTF16: '+cursor+' / '+text.length);
    }else if(renderer==='ink')await wait(text);else await page.waitForFunction(nativeComposerInput,text);}
    async function replace(text){if(renderer==='ink')await key('Alt+i');else await main();await key('End');await key('Control+u');if(text)await paste(text);await input(text);}
    async function send(text){await replace(text);await key(composition==='selected'?'F2':'Enter');}
    async function parked(){await replace(draft);await key('Home');await key('ArrowRight');await input(draft,1);}
    async function verifyParked(id){await focus(id);await paste('X');await input('CXOPY_PRIVATE_A😀窗_47',2);if(composition==='selected')await key('Backspace');else await key('Control+z');await input(draft,1);}
    let pointerAttempt=0;
    async function click(label,index=1){const attempt=++pointerAttempt;const point=await page.waitForFunction(({label,index,attempt})=>{
      const t=visual.terminal,b=t.buffer.active;if(t.modes?.synchronizedOutputMode===true)return;
      for(let row=0;row<t.rows;row++){const cells=Array.from({length:t.cols},(_,col)=>b.getLine(b.viewportY+row)?.getCell(col)?.getChars()??''),offset=cells.join('').indexOf(label);if(offset<0)continue;
        let text='',col=0;while(col<cells.length&&text.length<offset){text+=cells[col];col++;}col+=index;
        const rect=document.querySelector('.xterm-screen').getBoundingClientRect(),signature=JSON.stringify([row,col,t.cols,t.rows,rect.x,rect.y,rect.width,rect.height,cells]),old=window.__copyPointer;
        if(old?.attempt!==attempt||old.signature!==signature){window.__copyPointer={attempt,signature,count:1};return;}if(++old.count<3)return;
        return{x:rect.x+(col+.5)*rect.width/t.cols,y:rect.y+(row+.5)*rect.height/t.rows};}
    },{label,index,attempt},{polling:'raf'});const value=await point.jsonValue();await page.mouse.click(value.x,value.y);}
    async function capture(name){const attempts=[];for(let attempt=0;attempt<2;attempt++){
      await page.evaluate(()=>new Promise(done=>{const sub=visual.terminal.onRender(()=>{sub.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
      const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(directory,name+'.png')});
      const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()})),stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});
      await writeFile(join(directory,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(directory,name+'.txt'),after.text);
      if(stable){result.screenshots.push(name+'.png');return;}if(attempt===0){await copyFile(join(directory,name+'.png'),join(directory,name+'.attempt1.png'));await page.waitForFunction(()=>{const now=performance.now(),text=visual.text(),frames=visual.frames,old=window.__copyQuiet;
        if(!old||old.text!==text||old.frames!==frames){window.__copyQuiet={text,frames,at:now};return false;}return now-old.at>=150;},undefined,{polling:'raf',timeout:5000});}
    }throw Error('Terminal changed during both captures: '+name);}
    async function resize(cols,rows){const before=await page.evaluate(()=>visual.frames);await page.evaluate(({cols,rows})=>visual.terminal.resize(cols,rows),{cols,rows});
      await page.waitForFunction(({cols,rows,before})=>{const t=visual.terminal,b=t.buffer.active;return t.cols===cols&&t.rows===rows&&visual.frames>before&&t.modes?.synchronizedOutputMode!==true
        &&Array.from({length:rows},(_,y)=>b.getLine(b.viewportY+y)?.getCell(cols-1)?.getChars()).some(ch=>['┐','┘','│'].includes(ch));},{cols,rows,before});}
    async function restart(){const generation=await page.evaluate(()=>visual.generation);ptyExit=undefined;await page.locator('#restart').click();await page.waitForFunction(generation=>visual.generation>generation&&visual.frames>0,generation);
      renderer='opentui';await normal();launch=await json(join(directory,'opentui-app-launch.json'));assert.equal(launch.launches.at(-1).command.at(-5),'opentui');}
    async function move(workspace){const id=(await layout()).windows.focused;await arrange();await key('Shift+Digit'+workspace);await observe(layout,value=>location(value,id)===workspace,'Move same actual view to workspace '+workspace);await key(String(workspace));await observe(layout,value=>value.windows.workspace===workspace,'Switch to moved view');await leave();}
    async function controls(action){await finder.pick('Copy controls');await setZoom(true);await click(action);}
    async function reload(){const before=(await trace()).filter(row=>row.event==='reloaded').length;await finder.pick('Plugins');await setZoom(true);
      const beforeApply=await observe(layout,value=>location(value,'plugin-extension-manager-extensions')!==undefined,'User-opened Plugins must be saved before reload baseline');await click('Apply plugin changes');
      await observe(trace,rows=>rows.filter(row=>row.event==='reloaded').length>before,'Canonical reload must finish');await wait('Reloaded ');return beforeApply;}
    async function closed(label,count,id){await openFinder();await wait(finder.marker);await finder.query(label);const attempt=++pointerAttempt;
      const point=await page.waitForFunction(({label,count,attempt})=>{
        const t=visual.terminal,b=t.buffer.active;if(t.modes?.synchronizedOutputMode===true)return;
        const row=y=>Array.from({length:t.cols},(_,x)=>b.getLine(b.viewportY+y)?.getCell(x)?.getChars()??'');
        for(let y=0;y<t.rows-2;y++){
          const header=row(y);if(!header.join('').includes('─ Windows '))continue;const left=header.lastIndexOf('┌'),right=header.indexOf('┐',left);
          const content=n=>row(n).slice(left+1,right).join('').trim();
          if(left<0||right<=left||content(y+1)!==label||content(y+2)!==count+' windows · ↑↓ select · Enter open')continue;
          for(let target=y+3;target<t.rows;target++){
            const cells=row(target);if(cells[left]==='└')break;const text=content(target);
            if(!text.endsWith('Closed')||text.replace(/\s{2,}Closed$/,'')!==label)continue;
            const col=cells.findIndex((ch,x)=>x>left&&x<right&&ch!==''&&ch!==' '),rect=document.querySelector('.xterm-screen').getBoundingClientRect();
            const signature=JSON.stringify([target,col,t.cols,t.rows,rect.x,rect.y,rect.width,rect.height,cells]),old=window.__copyClosed;
            if(old?.attempt!==attempt||old.signature!==signature){window.__copyClosed={attempt,signature,count:1};return;}if(++old.count<3)return;
            return{x:rect.x+(col+.5)*rect.width/t.cols,y:rect.y+(target+.5)*rect.height/t.rows};
          }
        }
      },{label,count,attempt},{polling:'raf'});const value=await point.jsonValue();await page.mouse.click(value.x,value.y);
      await absent(finder.marker);await normal();if(id)await observe(layout,value=>value.windows.focused===id,'Finder must reopen the original closed identity');}
    async function answerQuestion(){await key('Alt+i');if(composition==='selected'){await wait('CUSTOM QUESTION');await key('F4');}
      else{await wait('MAIN_QUESTION: choose deployment');await wait('[x] Production');await key('Alt+Enter');}await wait('COPY_ANSWER_RECEIVED: Production');await wait('Main · Ready');}
    async function generationCheckpoint(mainCopy){
      await controls('Fork current conversation');const fork=await observe(()=>json(launch.conversationCopies.fork),value=>typeof value.id==='string','Canonical fork must create a real journal');
      const old=await json(launch.conversationCopies.active);assert.notEqual(fork.id,old.id);await focus(mainCopy);await parked();
      const current=(await trace()).findLast(row=>row.event==='editor-created');
      if(composition==='selected'){await focus(mainCopy);await key('F8');await observe(trace,rows=>rows.some(row=>row.event==='late-started'&&row.id===current.id),'Old editor submit must be held');}
      await controls('Resume fork');await observe(()=>json(launch.conversationCopies.active),value=>value.id===fork.id,'Actual Core must resume fork');await focus(mainCopy);await verifyParked(mainCopy);
      if(composition==='selected'){
        const created=(await trace()).findLast(row=>row.event==='editor-created');assert.notEqual(created.id,current.id);assert.deepEqual({length:created.length,cursor:created.cursor,hash:created.hash},{length:draft.length,cursor:1,hash:hash(draft)});
        const requests=(await completions()).length;await writeFile(launch.conversationCopies.gates.late,'release\n');const rows=await observe(trace,rows=>rows.some(row=>row.event==='late-returned'&&row.id===current.id),'Old editor must finish gated intent');
        const late=rows.find(row=>row.event==='late-returned'&&row.id===current.id);assert.equal(late.aborted,true);assert.equal(late.commands,false);assert.equal((await completions()).length,requests);await input(draft,1);
      }
      await send('APP_COPY_RESTORED');await wait('COPY_DONE: APP_COPY_RESTORED; seed=retained');await wait('Main · Ready');
      const saved=await layout();await writeFile(join(directory,'before-final-restart.json'),JSON.stringify(saved,null,2));await restart();
      await observe(layout,value=>JSON.stringify(value.windows)===JSON.stringify(saved.windows),'Restart must preserve exact canonical windows');assert.deepEqual((await layout()).views,saved.views);
      await wait('COPY_DONE: APP_COPY_RESTORED; seed=retained');assert.equal((await json(launch.conversationCopies.active)).id,fork.id);await capture('08-restarted-copies');
    }

    await wait(composition==='selected'?'COPY CUSTOM INPUT':'Describe your task');launch=await json(join(directory,'opentui-app-launch.json'));
    assert.equal(launch.conversationCopies.composition,composition);assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);
    assert.equal(await page.evaluate(()=>visual.terminal.unicode.activeVersion),'11');const first=launch.launches[0].command;
    assert.deepEqual(first.slice(-4,-1),['--renderer','ink','--cwd']);assert.equal(await realpath(first.at(-1)),await realpath(launch.cwd));
    if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);result.executable={path:launch.executable,sha256:launch.sha256};
      const file=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');result.renderer={path:file,sha256:hash(await readFile(file))};}
    await resize(180,50);await normal();await send('APP_COPY_SEED');await wait('COPY_HISTORY_BOTTOM');
    const createInk=async(keyName,kind)=>{const before=await layout(),ids=new Set(before.views?.map(view=>view.id)??[]);await key(keyName);
      const next=await observe(layout,value=>value.views?.some(view=>!ids.has(view.id)&&view.kind===kind),'Ink must create '+kind+' through real key input');return next.views.find(view=>!ids.has(view.id)&&view.kind===kind).id;};
    const closedCopy=await createInk('Alt+s','session');await move(2);await arrange();await key('q');await observe(layout,value=>location(value,closedCopy)===undefined,'Ink close must hide saved copy');await leave();
    await key('Alt+1');const liveCopy=await createInk('Alt+s','session');await move(3);
    const peerCopy=await createInk('Alt+s','session');const toolsCopy=await createInk('Alt+t','tools');await arrange();await key('+');await leave();
    const helpCopy=await createInk('Alt+/','help');await move(5);
    await key('Alt+1');await send('/chat');await normal();await observe(layout,value=>value.windows.focused==='session','Ink /chat must select actual Main');
    const ink=await layout();assert.equal(location(ink,closedCopy),undefined);assert.equal(location(ink,'tools'),undefined);
    assert.deepEqual(new Set(ink.views.map(view=>view.kind)),new Set(['session','tools','help']));
    const nested=ink.windows.spaces.find(space=>space.id===3)?.tree;assert.deepEqual(new Set(leaves(nested)),new Set([liveCopy,peerCopy,toolsCopy]));
    const ratios=node=>node?.surface?[]:node?[node.ratio,...node.children.flatMap(ratios)]:[];assert.ok(ratios(nested).some(ratio=>Math.abs(ratio-.65)>.001),'Ink must save a genuine nested custom ratio');await writeFile(join(directory,'ink-created-layout.json'),JSON.stringify(ink,null,2));await capture('01-ink-created-views');
    await restart();await observe(layout,value=>JSON.stringify(value.windows)===JSON.stringify(ink.windows),'Configured OpenTUI must preserve exact Ink tree, ratios, workspace and focus');
    assert.deepEqual((await layout()).views,ink.views);await wait('COPY_HISTORY_BOTTOM');await capture('02-migrated-layout');
    const sessionsBefore=await sessions();assert.equal(sessionsBefore.length,1);const httpBefore=(await completions()).length;
    const conversationLabel=ink.views.find(view=>view.id===closedCopy).title;await closed(conversationLabel,ink.views.filter(view=>view.title===conversationLabel).length,closedCopy);assert.equal((await sessions()).length,1);
    await focus(liveCopy);await wait('COPY_HISTORY_BOTTOM');await capture('02-migrated-nested-copies');await focus(toolsCopy);await wait('No tools called yet');await focus(helpCopy);await wait('WINDOW CONTROLS');
    await closed('Tools',3,'tools');await wait('No tools called yet');
    const oldSerial=Math.max(...ink.views.map(view=>Number(view.id.slice(7))));await main();await arrange();await key('n');
    const created=await observe(layout,value=>value.views.some(view=>Number(view.id.slice(7))>oldSerial&&view.kind==='session'),'Arrange n creates next serial Main copy');
    const fresh=created.views.find(view=>Number(view.id.slice(7))>oldSerial&&view.kind==='session').id;assert.equal(fresh,'window-'+(oldSerial+1));await leave();
    for(const[kind,label,workspace]of [['tools','New Tools window',7],['help','New Help window',8]]){
      const before=await layout();await finder.pick(label);const after=await observe(layout,value=>value.views.length===before.views.length+1,'Finder must create '+kind);assert.equal(after.views.at(-1).kind,kind);await move(workspace);
    }
    const count=(await layout()).views.length;await send('/chat');await normal();await send('/chat unexpected');await wait('Usage: /chat');assert.equal((await layout()).views.length,count);
    assert.equal((await completions()).length,httpBefore);assert.equal((await sessions()).length,1);
    if(composition==='native')check('Actual Ink keys create and save every legacy view kind and a closed copy; configured OpenTUI preserves the exact tree/IDs, Finder reopens original copies/canonical Tools, creation advances serial and /chat stays idempotent');

    const factoryCount=(await trace()).filter(row=>row.event==='editor-created').length;await focus(closedCopy);await setZoom(true);await parked();await verifyParked(liveCopy);await verifyParked(fresh);await capture('02-new-main-shared-input');
    if(composition==='selected')assert.equal((await trace()).filter(row=>row.event==='editor-created').length,factoryCount,'Copies must share one selected editor lease');
    await send('APP_COPY_SHARED');await wait('COPY_DONE: APP_COPY_SHARED; seed=retained');await wait('Main · Ready');
    assert.equal((await completions()).filter(row=>row.body.messages.filter(message=>message.role==='user').at(-1)?.content==='APP_COPY_SHARED').length,1);
    if(composition==='native'){
      await focus(closedCopy);await setZoom(true);await historyHas('COPY_HISTORY_BOTTOM');await key('PageUp');await normal();await historyHas('COPY_HISTORY_BOTTOM',false);
      const older=(await page.evaluate(nativeFocusedHistory)).match(/COPY_HISTORY_\d+/g);assert.ok(older?.length);const marker=older[0];await focus(liveCopy);await historyHas('COPY_HISTORY_BOTTOM');await focus(closedCopy);await historyHas(marker);await historyHas('COPY_HISTORY_BOTTOM',false);
      await key('PageDown');await historyHas('COPY_HISTORY_BOTTOM');await parked();await verifyParked(liveCopy);await capture('03-independent-copy-scroll');
      check('Main copies share one native Unicode draft/cursor/undo and exactly one submitted model context while their transcript scroll positions remain independent');
    }else{
      await parked();await verifyParked(liveCopy);await capture('03-one-custom-editor');
      check('Selected composition migrates every saved view and shares one traced UTF-16 editor lease across copies; only the active Draft submits F2 once and committed context remains common');
    }

    await send('APP_COPY_QUESTION');const questionLayout=await layout(),questionPane=questionLayout.windows.focused;
    await wait((questionPane==='session'?'Main':questionLayout.views.find(view=>view.id===questionPane).title)+' · Question');const questionHttp=(await completions()).length;
    const questionCreated=composition==='selected'?(await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='question').length:0;
    if(composition==='native'){await wait('Edit answer');await key('Alt+i');await key('ArrowDown');await key('Space');await wait('[x] Production');await key('Alt+i');}
    await parked();await verifyParked(liveCopy);await focus(closedCopy);await key('Alt+i');await wait(composition==='selected'?'CUSTOM QUESTION':'[x] Production');await key('Alt+i');
    await controls('Open private form');const formTitle=composition==='selected'?'Form · copy-request-probe':'Copy private form';await finder.pick(formTitle);await setZoom(true);
    if(composition==='selected'){await wait('CUSTOM PRIVATE FORM');await key('Home');await key('ArrowRight');await paste('X');await wait('Name: FX|ORMvalue');await key('Backspace');await key('Tab');}
    else{await wait('FORMvalue');await key('Home');await key('ArrowRight');await paste('X');await wait('FXORMvalue');await key('Backspace');await key('Tab');}
    await paste(token);await wait('*'.repeat(token.length));await arrange();await key('q');await leave();await focus(liveCopy);await key('Alt+i');await wait(composition==='selected'?'CUSTOM QUESTION':'[x] Production');await key('Alt+i');
    // Private request IDs are transient and intentionally absent from saved layout.
    // One caller/factory plus the preserved fields/receipt proves this reopen.
    const formFactories=composition==='selected'?(await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='form').length:0;
    await closed(formTitle,1);if(composition==='selected')assert.equal((await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='form').length,formFactories);
    if(composition==='selected'){await wait('CUSTOM PRIVATE FORM');await key('F5');}else await key('Alt+Enter');
    const form=await observe(trace,rows=>rows.some(row=>row.event==='form-result'),'Private form must complete through its real caller');const receipt=form.find(row=>row.event==='form-result').result;
    assert.deepEqual(receipt,{action:'save',name:'FORMvalue',tokenLength:token.length,tokenHash:hash(token)});assert.equal(form.filter(row=>row.event==='called'&&row.mode==='form').length,1);
    await focus(liveCopy);await verifyParked(closedCopy);if(composition==='selected')assert.equal((await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='question').length,questionCreated);
    assert.equal((await completions()).length,questionHttp);await capture('04-pending-main-private-form');await answerQuestion();
    if(composition==='selected'){const rows=await selectedTrace(),request=rows.findLast(row=>row.event==='created'&&row.kind==='question');
      assert.equal(rows.filter(row=>row.event==='input'&&row.id===request.id&&row.key==='f4').length,1,'One question key must reach one lease');
      const formRequest=rows.findLast(row=>row.event==='created'&&row.kind==='form');assert.equal(rows.filter(row=>row.event==='input'&&row.id===formRequest.id&&row.key==='f5').length,1);}
    if(composition==='native')check('A pending Main question keeps its chosen Production answer and parked draft across copies while an independently hidden/reopened private form completes once without entering model context');

    await send('APP_COPY_APPROVAL');await wait(composition==='selected'?'CUSTOM APPROVAL':'Approval required');const approvalHttp=(await completions()).length;
    const approvalCreated=composition==='selected'?(await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='approval').length:0;
    await parked();await focus(liveCopy);if(composition==='selected'){await key('Alt+i');await wait('CUSTOM APPROVAL');await key('F3');}else await key('Alt+n');
    await wait('COPY_APPROVAL_SETTLED: denied');await wait('Main · Ready');assert.equal(await exists(launch.conversationCopies.effect),false);await focus(closedCopy);
    if(composition==='selected')assert.equal((await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='approval').length,approvalCreated);
    assert.equal((await completions()).length,approvalHttp+1);if(composition==='selected'){const rows=await selectedTrace(),request=rows.findLast(row=>row.event==='created'&&row.kind==='approval');assert.equal(rows.filter(row=>row.event==='input'&&row.id===request.id&&row.key==='f3').length,1);}await capture('05-shared-approval-once');
    check(composition==='native'?'Shared Main approval can be denied from another copy exactly once under normal policy; copy navigation never approves it or writes the denied file':
      'Main selected question/approval factories stay singular across copies, while the separate selected private form retains its lease/masked fields and each callback settles once');

    await focus(peerCopy);await arrange();await key('q');await leave();await observe(layout,value=>location(value,peerCopy)===undefined,'A copy must stay closed through later reload/resume/restart');
    await parked();const beforeEditor=(await trace()).findLast(row=>row.event==='editor-created');const beforeReload=await reload();await focus(liveCopy);await input(draft,1);
    assert.deepEqual((await layout()).views,beforeReload.views);for(const space of beforeReload.windows.spaces)assert.deepEqual((await layout()).windows.spaces.find(next=>next.id===space.id)?.tree,space.tree);
    if(composition==='selected'){const after=(await trace()).findLast(row=>row.event==='editor-created');assert.notEqual(after.id,beforeEditor.id);assert.deepEqual({hash:after.hash,length:after.length,cursor:after.cursor},{hash:hash(draft),length:draft.length,cursor:1});}
    await capture('06-reload-shared-draft');await generationCheckpoint(liveCopy);
    check(composition==='native'?'Reload, real fork/resume and process restart preserve every alias/closed identity and canonical tree; the model receives the committed shared history':
      'Reload snapshots the one editor before destructive dispose, real Core replacement transfers draft/cursor and revokes a gated old submit, and restart retains committed history plus exact window identities/tree');

    const http=JSON.stringify((await completions()).map(row=>row.body)),log=await journal(),terminal=await readFile(join(directory,'terminal.ansi'),'utf8'),publicEvents=await readFile(launch.conversationCopies.publicTrace,'utf8');
    for(const[value,label]of [[terminal,'terminal output'],[http,'HTTP'],[log,'journals'],[publicEvents,'public UI hooks']])assert.ok(!value.includes(token),'Private token leaked to '+label);
    for(const[value,label]of [[http,'HTTP'],[log,'journals'],[publicEvents,'public UI hooks']])for(const secret of [draft,'FORMvalue','FXORMvalue'])assert.ok(!value.includes(secret),'Private draft/form value leaked to '+label);
    assert.ok(!/MaxListenersExceededWarning/.test(terminal));result.privacy={privateToken:true,parkedDraftAndForm:true,inputLogExcluded:true};
    launch=await json(join(directory,'opentui-app-launch.json'));assert.deepEqual(launch.launches.map(row=>row.command[row.command.indexOf('--renderer')+1]),['ink','opentui','opentui']);
    await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Final actual CLI must exit cleanly');result.ptyExitCode=ptyExit;assert.deepEqual(result.errors,[]);result.ok=true;
  }catch(error){result.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(directory,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});}}
  finally{
    if(launch)try{
      for(const file of Object.values(launch.conversationCopies.gates))await writeFile(file,'cleanup\n');await copyFile(launch.conversationCopies.trace,join(directory,'fixture-trace.jsonl'));await copyFile(launch.conversationCopies.publicTrace,join(directory,'public-ui-events.jsonl'));
      if(launch.conversationCopies.selectedTrace)await copyFile(launch.conversationCopies.selectedTrace,join(directory,'selected-trace.jsonl'));
      for(const name of (await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')))await copyFile(join(launch.state,'sessions',name),join(directory,'session-'+name));await writeFile(join(directory,'final-layout.json'),JSON.stringify(await json(join(launch.state,'layout.json')),null,2));
    }catch(error){result.ok=false;result.errors.push('Could not preserve isolated copy diagnostics: '+error);}
    await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}
    await writeFile(join(directory,'report.json'),JSON.stringify(result,null,2)+'\n');report.checks.push(...result.checks);report.screenshots.push(...result.screenshots.map(name=>composition+'/'+name));report.errors.push(...result.errors);
  }
  if(!result.ok)break;
}
report.ok=report.checks.length===8&&report.errors.length===0;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
