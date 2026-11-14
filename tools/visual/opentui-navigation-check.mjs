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
  async function finder(query=''){
    await key('F2');await wait(finderMarker);if(!query)return;
    await page.keyboard.type(query);
    // A title in resident tabs is not acknowledgement that Finder painted its
    // new query. Scope this wait to the actual native input under its header.
    await page.waitForFunction(query=>{
      const buffer=visual.terminal.buffer.active,lines=Array.from({length:visual.terminal.rows},(_,y)=>
        Array.from({length:visual.terminal.cols},(_,x)=>buffer.getLine(y+buffer.viewportY)?.getCell(x)?.getChars()??''));
      for(const[y,line]of lines.entries()){
        const title=line.findIndex((_,x)=>Array.from('─ Windows ').every((char,index)=>line[x+index]===char));if(title<0)continue;
        const x=line.lastIndexOf('┌',title),right=line.findIndex((char,index)=>index>title&&char==='┐');
        if(x>=0&&right>x
          &&lines[y+1]?.slice(x+2,right-1).join('').trim()===query)return true;
      }
    },query);
  }
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
  async function noDivider(){await page.waitForFunction(()=>!/[┃━]/u.test(visual.text()));}
  async function targetCue(id,width,hidden=''){
    const value=await observe(layout,value=>value.windows.focused===id,'Saved focus must match the selected split');
    const split=splitFor(currentTree(value),id);assert.ok(split,'The selected pane must have a nearest logical split');
    const child=leaves(split.children[0]).includes(id)?0:1,first=Math.round(split.ratio*100),columns=split.axis==='horizontal';
    const side=columns?(child===0?'left':'right'):(child===0?(width>=88?'top':'up'):(width>=88?'bottom':'down'));
    const label=width>=88?`Target: ${columns?'columns':'rows'} · saved ${first}/${100-first} · + grows ${side}`
      :`Target: ${columns?'cols':'rows'} ${first}/${100-first} · +${side}`;
    await wait(label+(hidden?' · '+hidden:''));return{split,child,label};
  }
  async function noTarget(width){
    const value=await layout();assert.equal(splitFor(currentTree(value),value.windows.focused),undefined);
    await wait((width>=88?'Next split: ':'Next: ')+(value.windows.axis==='vertical'?'rows':width>=88?'columns':'cols')+' · no resize target');await noDivider();
  }
  async function nativeFrame(label,{width,divider=false}={}){
    const marker=({'Navigation controls':'Refresh inventory','Models & providers':'Active: bootstrap','Заметки 窗口':'UNICODE_WINDOW'})[label];
    return(await page.waitForFunction(({label,marker,width,divider})=>{
      // Native cell coordinates retain Unicode continuation columns that text
      // offsets omit. The warm target glyph replaces an existing border cell.
      const buffer=visual.terminal.buffer.active,lines=Array.from({length:visual.terminal.rows},(_,y)=>
        Array.from({length:visual.terminal.cols},(_,x)=>buffer.getLine(y+buffer.viewportY)?.getCell(x)?.getChars()??''));
      function frame(x,y,right){
        const bottom=lines.findIndex((line,index)=>index>y&&['└','┃','━'].includes(line[x])&&['┘','┃','━'].includes(line[right]));
        if(bottom>y)return{x,y,width:right-x+1,height:bottom-y+1};
      }
      function measured(frame){
        if(!frame||(width!==undefined&&frame.width!==width))return;
        if(!divider)return frame;
        const cells=[];for(let y=0;y<lines.length;y++)for(let x=0;x<lines[y].length;x++){
          const char=lines[y][x];if(char!=='┃'&&char!=='━')continue;
          const cell=buffer.getLine(y+buffer.viewportY).getCell(x);
          cells.push({x,y,char,fg:cell.getFgColor(),bg:cell.getBgColor(),bold:Boolean(cell.isBold())});
        }
        return{frame,cells};
      }
      for(const[y,line]of lines.entries())for(let x=0;x<line.length;x++)if(line[x]==='┌'){
        const right=line.findIndex((char,index)=>index>x&&(char==='┐'||char==='┃'));
        if(right>x&&line.slice(x,right+1).join('').includes('─ '+label+' ')){
          const result=measured(frame(x,y,right));if(result)return result;
        }
      }
      // SDK omits the complete focused title when it cannot fit. These bounded
      // fixture bodies remain stable; Main always uses its short visible header.
      if(!marker)return;
      for(const[row,line]of lines.entries()){
        const at=line.findIndex((_,x)=>Array.from(marker).every((char,index)=>line[x+index]===char));if(at<0)continue;
        const x=Math.max(line.lastIndexOf('│',at),line.lastIndexOf('┃',at));
        const right=line.findIndex((char,index)=>index>=at&&(char==='│'||char==='┃'));if(x<0||right<0)continue;
        const top=lines.findLastIndex((line,index)=>index<row&&['┌','┃','━'].includes(line[x])&&['┐','┃','━'].includes(line[right]));
        if(top>=0){const result=measured(frame(x,top,right));if(result)return result;}
      }
    },{label,marker,width,divider})).jsonValue();
  }
  async function selectedDivider(axis,referenceTitle,width){
    // Frame and cue must come from one native buffer read across terminal resize.
    const {frame,cells}=await nativeFrame(referenceTitle,{width,divider:true}),glyph=axis==='horizontal'?'┃':'━';
    const expected=axis==='horizontal'?Array.from({length:frame.height},(_,index)=>({x:frame.x-1,y:frame.y+index}))
      :Array.from({length:frame.width},(_,index)=>({x:frame.x+index,y:frame.y-1}));
    assert.deepEqual(cells.map(({x,y})=>({x,y})),expected,'Only the nearest nested divider may carry the target cue');
    for(const cell of cells)assert.deepEqual({char:cell.char,fg:cell.fg,bg:cell.bg,bold:cell.bold},{char:glyph,fg:0xeac280,bg:0x171a20,bold:true});
    return{frame,x:expected[Math.floor(expected.length/2)].x,y:expected[Math.floor(expected.length/2)].y};
  }
  async function mouseCells(x,y,phase){const point=await page.evaluate(({x,y})=>{
    const rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(x+.5)*rect.width/visual.terminal.cols,y:rect.y+(y+.5)*rect.height/visual.terminal.rows};
  },{x,y});await page.mouse.move(point.x,point.y);if(phase==='down')await page.mouse.down();if(phase==='up')await page.mouse.up();}
  const paneStrip=()=>page.evaluate(()=>{const lines=visual.text().split('\n'),body=lines.findIndex(line=>/┌[─ ]/.test(line));return body>0?lines[body-1]:'';});
  const workspaceLine=()=>page.evaluate(()=>visual.text().split('\n').find(line=>/^\s*WS\s/.test(line))??'');
  async function workspaceClick(id){const attempt=++pointerAttempt;
    const point=await page.waitForFunction(({id,attempt})=>{
      const lines=visual.text().split('\n'),row=lines.findIndex(line=>/^\s*WS\s/.test(line));if(row<0)return;
      const match=new RegExp('\\b'+id+'(?=[* ])').exec(lines[row]);if(!match)return;
      const col=match.index,rect=document.querySelector('.xterm-screen').getBoundingClientRect();
      const signature=[row,col,visual.terminal.cols,visual.terminal.rows,rect.x,rect.y,rect.width,rect.height].join(':'),previous=window.__navigationWorkspace;
      if(previous?.attempt!==attempt||previous.signature!==signature){window.__navigationWorkspace={attempt,signature,count:1};return;}
      if(++previous.count<3)return;return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};
    },{id,attempt},{polling:'raf'});const value=await point.jsonValue();await page.mouse.click(value.x,value.y);
  }

  await wait('Message Main…');launch=await json(join(output,'opentui-app-launch.json'));assert.ok(launch.navigation);
  assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);
  const args=launch.launches[0].command.slice(-4);assert.deepEqual(args.slice(0,3),['--renderer','opentui','--cwd']);assert.equal(await realpath(args[3]),await realpath(launch.cwd));
  if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);report.executable={path:launch.executable,sha256:launch.sha256};
    const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');report.renderer={path:renderer,sha256:hash(await readFile(renderer))};}
  await page.evaluate(()=>visual.terminal.resize(180,50));await command('/nav-panes');await wait('Navigation controls');
  await observe(layout,value=>value.registered.filter(id=>/^plugin-navigation-probe-pane\d+$/.test(id)).length===12,'All12 actual plugin panes must be registered');
  await main();await observe(workspaceLine,line=>['1*','2*','3*'].every(value=>line.includes(value)),'The workspace bar must mark each occupied workspace');
  const initialStrip=await paneStrip();assert.ok(initialStrip.includes('Main')&&initialStrip.includes('Navigation controls')&&initialStrip.includes('Todos'));
  assert.ok(!initialStrip.includes('Nav pane')&&!initialStrip.includes('Заметки'),'The current strip must omit other workspace panes');
  await pick('Navigation controls');await arrange();await key('Shift+Digit2');await key('1');await leave();await main();
  await observe(layout,value=>location(value,'plugin-navigation-probe-control')===2&&value.windows.workspace===1,'Actual Arrange input must move controls to workspace2');
  assert.ok(!(await paneStrip()).includes('Navigation controls'),'Moved panes must leave the current workspace strip');
  await pick('Navigation controls');await observe(layout,value=>value.windows.workspace===2&&value.windows.focused==='plugin-navigation-probe-control','Finder must activate the cross-workspace pane');
  const secondStrip=await paneStrip();assert.ok(secondStrip.includes('Navigation controls')&&!secondStrip.includes('Main')&&!secondStrip.includes('Todos'));
  await capture('00-cross-workspace-controls');await arrange();await key('Shift+Digit1');await key('1');await leave();
  await observe(layout,value=>location(value,'plugin-navigation-probe-control')===1,'Actual Arrange input must restore controls to workspace1');
  await main();await type('NAV_DRAFT_47');await key('Home');await key('ArrowRight');
  const previousContext=(await observe(layout,value=>value.windows.focused==='session','Saved focus must acknowledge the visible Main pane')).windows;
  await finder();await paste('PRIVATE_窗_47');await wait('PRIVATE_窗_47');await wait('No matching windows');
  await key('Home');await key('ArrowRight');await type('_');await wait('P_RIVATE_窗_47');await key('Control+z');await wait('PRIVATE_窗_47');
  await key('Control+u');await type('Заметки 窗口');await wait('WS 3');await capture('01-private-unicode-finder');
  await key('Escape');await absent(finderMarker);
  const returned=await observe(layout,value=>JSON.stringify(value.windows)===JSON.stringify(previousContext),'Finder Escape must restore the exact saved context');assert.deepEqual(returned.windows,previousContext);
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
  assert.ok(!/\bMain\b/.test(await paneStrip()),'The closed Main pane must leave the current workspace strip');
  await finder('Main');await wait('Closed');await capture('02-closed-main-pending');await key('Enter');await absent(finderMarker);
  const reopened=await observe(layout,value=>value.windows.focused==='session'&&value.windows.spaces.flatMap(space=>leaves(space.tree)).filter(id=>id==='session').length===1,'Saved layout must acknowledge the same reopened Main pane');
  assert.deepEqual(await sessionFiles(),originalJournal);assert.equal(reopened.windows.spaces.flatMap(space=>leaves(space.tree)).filter(id=>id==='session').length,1);
  await wait('NAV_PENDING_DRAFT_47');await click('Edit answer');await wait('[x] Production');await click('Draft');await noResult('ask_user');
  report.checks.push('Arrange typing, Enter, pasted q and Ctrl+C cannot settle Main; closing and finding Main reopens the same pending conversation and journal without duplicate panes or lost selected answer');

  await pick('/nav-form');await wait('Navigation private form');await wait('FORMvalue');await key('Home');await key('ArrowRight');await type('_');await wait('F_ORMvalue');
  assert.equal(await observe(()=>json(launch.navigation.formCalls),value=>value===1,'The caller must make one actual private form request'),1);
  await arrange();await paste('q');await key('Control+c');await absent('WINDOW MODE');assert.equal(await exists(launch.navigation.formReceipt),false);

  // Completion gates simulate external work finishing, not a user action or
  // a host/window mutation. Every focus and editor action still crosses the PTY.
  const focusSpec=launch.navigation.focus,focusPrefix='plugin-navigation-probe-focus-';
  const focusBefore=await layout(),focusTrees=[1,3].map(id=>focusBefore.windows.spaces.find(space=>space.id===id)?.tree);
  const release=name=>writeFile(focusSpec.gates[name],'fixture completion\n');
  const published=async mode=>{
    await observe(()=>json(focusSpec.published[mode]),value=>value===true,'The public SDK producer must publish '+mode);
    return observe(layout,value=>location(value,focusPrefix+mode)===6,'The actual published window must be available on workspace6');
  };
  const closeFocus=async title=>{await pick(title);await arrange();await key('q');await leave();};
  // A deliberate slash command replaces the draft. Restore it through native
  // typing before the asynchronous focus-preservation boundary is tested.
  await command('/nav-focus passive');await observe(()=>json(focusSpec.started.passive),Boolean,'The passive launcher must actually start');
  await observe(events,rows=>rows.filter(row=>row.type==='command.operation'&&row.name==='/nav-focus'&&row.phase==='completed').length===1,'The retained passive producer must outlive its completed launcher');
  await main();await type('NAV_PENDING_DRAFT_47');await pick('Navigation private form');await wait('F_ORMvalue');
  await release('passive');await published('passive');assert.equal((await layout()).windows.workspace,1);
  await type('P');await wait('F_PORMvalue');await key('Backspace');await wait('F_ORMvalue');
  assert.equal(await exists(launch.navigation.formReceipt),false);assert.equal(await json(launch.navigation.formCalls),1);await capture('03-passive-publication-keeps-form');

  await pick('Navigation controls');await click('Publish focus true');await wait('FOCUS_PUBLICATION_TRUE');
  await observe(layout,value=>value.windows.focused===focusPrefix+'true'&&value.windows.workspace===6,'A fresh explicit focus=true hint must retain its opt-in behavior');await closeFocus('Explicit focus');
  await pick('Navigation controls');await click('Publish focus false');
  const explicitFalse=await published('false');assert.equal(explicitFalse.windows.workspace,1);assert.equal(explicitFalse.windows.focused,'plugin-navigation-probe-control');
  await click('Publish focus rule-false');
  const ruleFalse=await published('rule-false');assert.equal(ruleFalse.windows.workspace,1);assert.equal(ruleFalse.windows.focused,'plugin-navigation-probe-control');
  await click('Publish focus rule-true');await wait('FOCUS_PUBLICATION_RULE-TRUE');
  await observe(layout,value=>value.windows.focused===focusPrefix+'rule-true'&&value.windows.workspace===6,'A configured focus=true rule must remain an explicit opt-in');await closeFocus('Configured focus');

  // Keep the complete identifier visible before dispatch; zoom is a prior
  // presentation choice, not an additional post-launch intent suppressing focus.
  await main();const priorLateMainFullscreen=(await observe(layout,value=>value.windows.focused==='session'&&value.windows.workspace===1,'Main must own the presentation precondition')).windows.fullscreen;await setZoom(true);
  await command('/nav-focus late-main');await observe(()=>json(focusSpec.started['late-main']),Boolean,'The ordinary late command must start before newer user intent');
  await observe(layout,value=>value.windows.focused==='session'&&value.windows.workspace===1,'The delayed command must leave the already-focused Main visible before the idempotent Main key');await main();await type('NAV_PENDING_DRAFT_47');await key('Home');await key('ArrowRight');await key('Alt+0');
  await release('late-main');const lateMain=await published('late-main');assert.equal(lateMain.windows.focused,'session');assert.equal(lateMain.windows.workspace,1);
  await type('_');await wait('N_AV_PENDING_DRAFT_47');await key('Control+z');await wait('NAV_PENDING_DRAFT_47');
  await observe(events,rows=>rows.filter(row=>row.type==='command.operation'&&row.name==='/nav-focus'&&row.phase==='completed').length===2,'The late Main command must finish after its passive publication');
  await capture('03-late-publication-keeps-main');await setZoom(priorLateMainFullscreen);

  await command('/nav-focus late-mode');await observe(()=>json(focusSpec.started['late-mode']),Boolean,'The second late command must start before navigation intent');
  await main();await type('NAV_PENDING_DRAFT_47');await key('Home');await key('ArrowRight');await arrange();await key('3');
  await observe(layout,value=>value.windows.workspace===3,'The user must switch to the original Unicode workspace');await finder('FOCUS_PRIVATE_47');await key('Home');await key('ArrowRight');
  await release('late-mode');const lateMode=await published('late-mode');assert.equal(lateMode.windows.workspace,3);await wait(finderMarker);
  await type('_');await wait('F_OCUS_PRIVATE_47');await key('Control+z');await wait('FOCUS_PRIVATE_47');await capture('03-late-publication-keeps-finder');
  await key('Escape');await absent(finderMarker);if((await screen()).includes('WINDOW MODE'))await leave();
  await observe(events,rows=>rows.filter(row=>row.type==='command.operation'&&row.name==='/nav-focus'&&row.phase==='completed').length===3,'All actual focus-probe command lifetimes must settle');
  await main();await wait('NAV_PENDING_DRAFT_47');
  const priorLateModeFullscreen=(await observe(layout,value=>value.windows.focused==='session'&&value.windows.workspace===1,'Main must be restored after the completed Finder publication')).windows.fullscreen;
  // Publication and Finder preservation are already proved. Expose the complete
  // identifier to read the unchanged native cursor without a wrapped-text oracle.
  await setZoom(true);await type('_');await wait('N_AV_PENDING_DRAFT_47');await key('Control+z');await wait('NAV_PENDING_DRAFT_47');await setZoom(priorLateModeFullscreen);

  await finder('/nav-retained');await key('Enter');await wait('Opening window…');
  await observe(()=>json(focusSpec.retainedStarted),Boolean,'The selected retained route must really start');
  const retainedPickerState=()=>page.evaluate(()=>{
    const buffer=visual.terminal.buffer.active,lines=Array.from({length:visual.terminal.rows},(_,y)=>
      Array.from({length:visual.terminal.cols},(_,x)=>buffer.getLine(y+buffer.viewportY)?.getCell(x)?.getChars()??''));
    for(const[y,line]of lines.entries()){
      const title=line.findIndex((_,x)=>Array.from('─ Windows ').every((char,index)=>line[x+index]===char));if(title<0)continue;
      const left=line.lastIndexOf('┌',title),right=line.findIndex((char,index)=>index>title&&char==='┐');if(left<0||right<=left)continue;
      const text=row=>lines[row]?.slice(left+1,right).join('').trim()??'';
      const entry=lines[y+3],label=entry?.findIndex((char,x)=>x>left&&x<right&&char==='/');
      return{query:text(y+1),count:text(y+2),entry:text(y+3),
        selected:label>=0&&Boolean(buffer.getLine(y+3+buffer.viewportY)?.getCell(label)?.isBold()),
        opening:lines.slice(y+4,y+22).some((_,index)=>text(y+4+index)==='Opening window…')};
    }
  });
  const retainedSelection=await observe(retainedPickerState,value=>value.query==='/nav-retained'&&value.count==='1 windows · ↑↓ select · Enter open'
    &&value.entry.startsWith('/nav-retained')&&value.selected&&value.opening,'The sole selected Finder destination must remain opening behind its completion gate');
  for(const boundaryKey of ['ArrowUp','ArrowDown','Tab','Enter'])await key(boundaryKey);
  assert.deepEqual(await observe(retainedPickerState,value=>value.query===retainedSelection.query&&value.entry===retainedSelection.entry&&value.selected&&value.opening,
    'Boundary navigation and repeated Enter must preserve the current opening destination'),retainedSelection);
  await release('retained');
  await absent(finderMarker);await wait('RETAINED_PICKER_DESTINATION');
  await observe(layout,value=>value.windows.workspace===6&&value.windows.focused==='plugin-navigation-probe-retained','The unchanged matching Finder attempt must focus its retained destination');
  await observe(()=>json(focusSpec.retainedFinished),Boolean,'The retained route must finish through its public SDK handle');await closeFocus('Retained route');
  for(const title of ['Passive publication','Explicit passive','Configured passive','Late Main publication','Late mode publication'])await closeFocus(title);
  await pick('Navigation private form');await wait('F_ORMvalue');
  const focusRestored=await layout();assert.deepEqual([1,3].map(id=>focusRestored.windows.spaces.find(space=>space.id===id)?.tree),focusTrees);
  assert.equal(focusRestored.windows.axis,focusBefore.windows.axis);assert.equal(await exists(launch.navigation.formReceipt),false);assert.equal(await json(launch.navigation.formCalls),1);await noRequests(1);await noResult('ask_user');
  report.focusPublication={passiveAfterLauncher:true,explicitHints:[true,false],configuredRules:[true,false],idempotentMainIntent:true,
    arrangeFinderWorkspaceIntent:true,mainAndFinderCursor:true,retainedPicker:true,canonicalTreesPreserved:true};

  // An ordinary built-in route and the existing Unicode window provide an
  // isolated two-leaf workspace. No fixture or window-controller mutation is used.
  const models='plugin-model-selector-models',unicode='plugin-navigation-probe-unicode';
  const protectedLayout=await layout(),protectedTrees=[1,3].map(id=>protectedLayout.windows.spaces.find(space=>space.id===id)?.tree);
  await pick('/settings');await wait('Active: bootstrap · app-start');await absent('Models & providers · Working');
  await arrange();await key('Shift+Digit8');await key('8');await leave();
  await observe(layout,value=>location(value,models)===8&&value.windows.workspace===8,'Real Arrange input must move the settings window into workspace8');
  await pick('Заметки');await arrange();await key('Shift+Digit8');await key('8');
  await observe(layout,value=>location(value,unicode)===8&&value.windows.workspace===8&&value.windows.focused===unicode,'Real Arrange input must move the existing Unicode window into workspace8');
  await key('b');
  const pair=await observe(layout,value=>{
    const tree=currentTree(value);return tree?.axis==='horizontal'&&tree.ratio===.5&&JSON.stringify(tree.children?.map(leaves))===JSON.stringify([[models],[unicode]]);
  },'The isolated workspace must contain exactly two ordinary windows in an equal column split');
  const narrowTree=structuredClone(currentTree(pair));
  await page.evaluate(()=>visual.terminal.resize(60,24));await targetCue(unicode,60);await absent('small area');await absent(' · narrow');
  const columnFirst=await nativeFrame('Models & providers',{width:30}),columnSecond=await nativeFrame('Заметки 窗口',{width:30});
  assert.deepEqual({x:columnFirst.x,y:columnFirst.y,width:columnFirst.width+columnSecond.width,height:columnFirst.height},{x:0,y:3,width:60,height:columnSecond.height});
  assert.equal(columnFirst.x+columnFirst.width,columnSecond.x);assert.equal(columnFirst.y,columnSecond.y);assert.ok(columnFirst.width>=24&&columnSecond.width>=24&&columnFirst.height>=6);
  const columnDivider=await selectedDivider('horizontal','Заметки 窗口');await capture('03-readable-60-column-tiles');
  await key('+');await observe(layout,value=>splitFor(currentTree(value),unicode)?.ratio===.45,'Narrow keyboard resize must grow the focused right tile');await targetCue(unicode,60);
  assert.ok((await nativeFrame('Заметки 窗口')).x<columnSecond.x,'The narrow keyboard ratio change must move the actual visible divider');
  await key('-');await observe(layout,value=>splitFor(currentTree(value),unicode)?.ratio===.5,'Narrow keyboard resize must restore the exact saved fraction');await targetCue(unicode,60);
  const heldColumns=await selectedDivider('horizontal','Заметки 窗口');
  await mouseCells(heldColumns.x,heldColumns.y,'down');await wait('Mouse resize · Esc cancel');await absent('Target:');await noDivider();
  assert.deepEqual(await nativeFrame('Заметки 窗口'),columnSecond,'A narrow divider hit must keep viewport geometry while the pointer owns input');
  await mouseCells(heldColumns.x+2,heldColumns.y,'up');
  const pointerRatio=(heldColumns.x+2-columnFirst.x)/60;
  await observe(layout,value=>Math.abs(splitFor(currentTree(value),unicode).ratio-pointerRatio)<1e-9,'The painted narrow column divider must commit the real mouse coordinate');await targetCue(unicode,60);
  const pointerColumns=await selectedDivider('horizontal','Заметки 窗口');await mouseCells(pointerColumns.x,pointerColumns.y,'down');await wait('Mouse resize · Esc cancel');await mouseCells(columnFirst.x+30,pointerColumns.y,'up');
  await observe(layout,value=>splitFor(currentTree(value),unicode)?.ratio===.5,'A second real pointer drag must restore the equal canonical split');await targetCue(unicode,60);assert.deepEqual(currentTree(await layout()),narrowTree);
  await mouseCells(columnFirst.x+2,columnFirst.y+1,'down');await mouseCells(columnFirst.x+2,columnFirst.y+1,'up');
  await observe(layout,value=>value.windows.focused===models,'The first narrow tile must remain independently focusable by its real body hit area');await targetCue(models,60);
  await key('Tab');await observe(layout,value=>value.windows.focused===unicode,'Arrange Tab must return focus to the second narrow tile');
  await key('v');await observe(layout,value=>splitFor(currentTree(value),unicode)?.axis==='vertical','v must create the actual narrow row split');
  await page.evaluate(()=>visual.terminal.resize(38,24));await targetCue(unicode,38);await absent('small');await absent(' · narrow');
  const rowFirst=await nativeFrame('Models & providers',{width:38}),rowSecond=await nativeFrame('Заметки 窗口',{width:38});
  assert.equal(rowFirst.x,rowSecond.x);assert.equal(rowFirst.width,38);assert.equal(rowSecond.width,38);assert.equal(rowFirst.y+rowFirst.height,rowSecond.y);assert.ok(rowFirst.height>=6&&rowSecond.height>=6);
  const rowDivider=await selectedDivider('vertical','Заметки 窗口',38);await capture('03-readable-38-row-tiles');
  await key('+');await observe(layout,value=>splitFor(currentTree(value),unicode)?.ratio===.45,'Narrow row keyboard resize must grow the focused lower tile');await targetCue(unicode,38);
  assert.ok((await nativeFrame('Заметки 窗口')).y<rowSecond.y,'The narrow row keyboard ratio change must move the actual divider');
  await key('-');await observe(layout,value=>splitFor(currentTree(value),unicode)?.ratio===.5,'Row resize must restore the exact saved fraction');await targetCue(unicode,38);
  const cancelRows=await selectedDivider('vertical','Заметки 窗口',38);await mouseCells(cancelRows.x,cancelRows.y,'down');await wait('Mouse resize · Esc cancel');await noDivider();
  await mouseCells(cancelRows.x,cancelRows.y+1);await key('Escape');await mouseCells(cancelRows.x,cancelRows.y+1,'up');
  await absent('Mouse resize');await targetCue(unicode,38);assert.equal(splitFor(currentTree(await layout()),unicode).ratio,.5);assert.deepEqual(await nativeFrame('Заметки 窗口'),rowSecond);
  const narrowRows=structuredClone(currentTree(await layout()));
  await page.evaluate(()=>visual.terminal.resize(38,16));await targetCue(unicode,38,'small');await noDivider();await wait('UNICODE_WINDOW');await absent('Active: bootstrap');
  assert.deepEqual(currentTree(await layout()),narrowRows,'Too little height must project one tile without rewriting the canonical tree or saved ratios');await capture('03-size-limited-38-by-16');
  await key('Tab');await observe(layout,value=>value.windows.focused===models,'The collapsed workspace must allow focus to its other retained window');await targetCue(models,38,'small');await wait('Active: bootstrap');await absent('UNICODE_WINDOW');
  assert.deepEqual(currentTree(await layout()),narrowRows);
  await page.evaluate(()=>visual.terminal.resize(38,24));await targetCue(models,38);await selectedDivider('vertical','Заметки 窗口',38);
  assert.ok((await nativeFrame('Models & providers')).height>=6&&(await nativeFrame('Заметки 窗口')).height>=6);
  await page.evaluate(()=>visual.terminal.resize(180,50));await targetCue(models,180);await selectedDivider('vertical','Заметки 窗口',180);assert.deepEqual(currentTree(await layout()),narrowRows);
  await key('q');await leave();await pick('Заметки');await arrange();await key('b');await key('Shift+Digit3');await key('3');await leave();
  const narrowRestored=await observe(layout,value=>location(value,models)===undefined&&location(value,unicode)===3&&value.windows.axis===protectedLayout.windows.axis,'Public input must close the auxiliary route and restore the original Unicode workspace and next-split direction');
  assert.deepEqual([1,3].map(id=>narrowRestored.windows.spaces.find(space=>space.id===id)?.tree),protectedTrees,'Temporary narrow tiling must leave the original canonical Main and Unicode trees exact');
  assert.equal(await exists(launch.navigation.formReceipt),false);assert.equal(await json(launch.navigation.formCalls),1);await noRequests(1);await noResult('ask_user');
  report.narrowTiling={columns:{width:60,rows:24,frames:[columnFirst,columnSecond],mouseResize:true,keyboardResize:true},
    rows:{width:38,rows:24,frames:[rowFirst,rowSecond],mouseCancel:true,keyboardResize:true},
    fallback:{width:38,rows:16,focusedOnly:true,reason:'size-limited'},canonicalTreePreserved:true,privateFormStillPending:true};
  await main();await wait('NAV_PENDING_DRAFT_47');await pick('Navigation private form');assert.equal(await json(launch.navigation.formCalls),1);
  await type('X');await wait('F_XORMvalue');await capture('03-private-form-return');await key('Alt+Enter');
  const receipt=await observe(()=>json(launch.navigation.formReceipt),value=>value?.action==='save','Only explicit form submission may publish a receipt');assert.equal(receipt.values.name,'F_XORMvalue');
  // The private form can still change Main's geometry after focus returns.
  // Use the native mode key here; the earlier edit/selection path uses real mouse input.
  await main();await wait('NAV_PENDING_DRAFT_47');await waitMain('Edit answer');await key('Alt+i');await wait('[x] Production');
  await key('Alt+i');await wait('NAV_PENDING_DRAFT_47');await key('Alt+i');await wait('[x] Production');
  await key('Alt+Enter');await wait('APP_ANSWER_RECEIVED: Production; model=app-start');
  await noRequests(2);assert.equal((await events()).filter(event=>event.type==='tool.result'&&event.tool==='ask_user').length,1);
  report.checks.push('An independent private form survives Arrange and Main navigation with its exact field cursor/value; only its explicit submit returns values, and only explicit Main submit answers the model');

  await waitMain('Main · Ready');await command('APP_APPROVAL');await wait('Approval required');await wait('Tool: write');await noResult('write');assert.equal(await exists(launch.navigation.approvalFile),false);
  await arrange();await page.keyboard.type('yn');await key('Alt+y');await key('Alt+n');await paste('q');await key('Enter');await absent('WINDOW MODE');
  await wait('Approval required');await noRequests(3);await noResult('write');await arrange();await key('Control+c');await absent('WINDOW MODE');await wait('Approval required');
  await finder('Main');await key('Control+c');await absent(finderMarker);await wait('Approval required');await noResult('write');
  await capture('04-protected-approval');await key('Alt+n');await wait('APP_APPROVAL_SETTLED: denied');await noRequests(4);
  const denied=(await events()).find(event=>event.type==='tool.result'&&event.tool==='write');assert.equal(denied.ok,false);assert.equal(await exists(launch.navigation.approvalFile),false);
  report.checks.push('The ordinary file-write permission remains pending through Arrange/Finder input and Ctrl+C; explicit Alt+N alone denies it and the isolated target file stays absent');

  await finder('/nav-slow');await key('Enter');await wait('Opening window…');await observe(()=>json(launch.navigation.slowStarted),Boolean,'Slow route must really begin');
  await key('Control+u');await type('/nav-fast');await key('Enter');await absent(finderMarker);await wait('CURRENT_SELECTED_ROUTE');await release('slow');
  await observe(()=>json(launch.navigation.slowFinished),Boolean,'Cancelled route producer must finish its bounded late callback');
  assert.equal(location(await layout(),'plugin-navigation-probe-slow'),undefined);assert.ok(!(await screen()).includes('LATE_CANCELLED_ROUTE'));
  await pick('Navigation controls');await click('Refresh inventory');await observe(()=>json(launch.navigation.refreshStarted),Boolean,'Real refresh action must start');
  await finder('Nav pane 12');await wait('WS 2');await observe(()=>json(launch.navigation.refreshFinished),Boolean,'Real refresh must remove its source');await wait('Unavailable');
  await key('Enter');await wait('fresh view from its plugin');
  const removed=await observe(layout,value=>location(value,'plugin-navigation-probe-pane12')===undefined,'Saved layout must acknowledge removal of the unavailable pane');assert.equal(location(removed,'plugin-navigation-probe-pane12'),undefined);
  await key('Control+u');await type('Nav pane 11');await key('Enter');await absent(finderMarker);await wait('NAV_REFRESH_COMPLETE');
  await command('/reload');await observe(()=>json(launch.navigation.reloadStarted),Boolean,'Actual plugin reload must begin');await finder('Nav pane 11');
  await observe(()=>json(launch.navigation.ready),value=>value.generation===2,'Actual plugin reload must replace sources');await wait('Nav pane 11 refreshed');
  await key('Enter');await absent(finderMarker);await wait('NAV_GENERATION_2');await noRequests(4);
  report.checks.push('Finder replaces an abandoned slow route with the newly selected owner, refuses a removed source, and follows fresh same-owner sources through an actual plugin reload without model requests');

  const pane='plugin-navigation-probe-pane11';
  await page.evaluate(()=>visual.terminal.resize(75,30));await arrange();await targetCue(pane,75,'small area');await noDivider();await capture('05-size-limited-split-target');await leave();
  await page.evaluate(()=>visual.terminal.resize(48,22));await arrange();await targetCue(pane,48,'small area');await noDivider();await wait('i type');await wait('Esc exit');await capture('05-arrange-48-columns');await leave();
  await page.evaluate(()=>visual.terminal.resize(38,20));await arrange();await targetCue(pane,38,'small');await noDivider();await wait('Esc exit');await wait('i type');await capture('06-arrange-38-columns');await leave();
  const narrowTargets=(await workspaceLine()).match(/\b[1-9](?=[* ])/g);assert.deepEqual(narrowTargets,['1','2','3','4','5','6','7','8','9']);
  await workspaceClick(9);await observe(layout,value=>value.windows.workspace===9,'The ninth workspace mouse target must remain reachable at38 columns');
  await wait('No open windows · F2 Windows');await wait('Empty workspace');await capture('06-empty-workspace-nine-38-columns');
  await arrange();await noTarget(38);await leave();
  await workspaceClick(2);await observe(layout,value=>value.windows.workspace===2,'The occupied second workspace mouse target must restore its panes');await wait('Nav pane 11 refreshed');
  await finder('Заметки');await wait('WS 3');await key('Escape');await absent(finderMarker);await page.evaluate(()=>visual.terminal.resize(180,50));
  await pick('Заметки');await observe(layout,value=>value.windows.workspace===3,'Finder must activate the lone-window workspace');await arrange();await noTarget(180);
  await key('v');await observe(layout,value=>value.windows.axis==='vertical','v must set the next split direction for a lone window');await noTarget(180);
  const loneBefore=(await layout()).windows;await key('+');assert.deepEqual((await layout()).windows,loneBefore);await capture('06-lone-window-next-split');await key('b');await leave();await noDivider();
  await pick('Fast route');await arrange();await key('q');await leave();
  await page.evaluate(()=>visual.terminal.resize(172,50));
  await pick('Nav pane 11');await arrange();await key('Shift+Digit1');await key('1');
  await observe(layout,value=>location(value,pane)===1&&value.windows.workspace===1,'Shift+1 and1 must move/select workspace1');
  const beforeMove=JSON.stringify(currentTree(await layout()));await key('Shift+ArrowLeft');
  const movedTree=await observe(layout,value=>JSON.stringify(currentTree(value))!==beforeMove&&value.windows.focused===pane,'Shift+direction must move the same pane in its nested tree');
  const partner=splitFor(currentTree(movedTree),pane).children[1].surface;assert.ok(partner&&partner!==pane,'The measured fixture target must have two direct pane children');
  const partnerTitle=({'session':'Main','plugin-navigation-probe-control':'Navigation controls'})[partner];assert.ok(partnerTitle,'The sibling must be an actual named fixture window');
  await key('v');await observe(layout,value=>splitFor(currentTree(value),pane)?.axis==='vertical','v must set the nearest nested split to rows');await targetCue(pane,172);await selectedDivider('vertical',partnerTitle);await capture('07-selected-rows-target');
  await key('b');const beforeResize=await observe(layout,value=>splitFor(currentTree(value),pane)?.axis==='horizontal','b must set the nearest nested split to columns');
  const oldRatio=splitFor(currentTree(beforeResize),pane).ratio,child=leaves(splitFor(currentTree(beforeResize),pane).children[0]).includes(pane)?0:1;await key('+');
  const resized=await observe(layout,value=>splitFor(currentTree(value),pane)?.ratio!==oldRatio,'+ must persist a custom nearest-split ratio');
  const customRatio=splitFor(currentTree(resized),pane).ratio;assert.ok(Math.abs(customRatio-oldRatio-(child===0?.05:-.05))<1e-9,'+ must grow the focused logical side');
  const {split}=await targetCue(pane,172);assert.deepEqual(split.children.map(leaves),[[pane],[partner]]);
  const divider=await selectedDivider('horizontal',partnerTitle);await capture('07-selected-columns-target');
  const anchor=await page.evaluate(({x,y})=>visual.text().split('\n')[y].lastIndexOf('┌',x),{x:divider.x,y:divider.frame.y});assert.ok(anchor>=0,'The selected parent must retain its visible outer border');
  const parentWidth=divider.frame.x+divider.frame.width-anchor,restoreX=anchor+parentWidth*customRatio;assert.ok(Number.isInteger(restoreX),'The measured fixture divider must permit exact ratio restoration');
  await mouseCells(divider.x,divider.y,'down');await wait('Mouse resize · Esc cancel');await absent('Target:');await noDivider();
  const heldReference=await nativeFrame(partnerTitle);assert.deepEqual(heldReference,divider.frame,'Starting resize must retain the viewport geometry');
  await mouseCells(divider.x+3,divider.y);await capture('07-active-mouse-resize');await mouseCells(divider.x+3,divider.y,'up');
  await observe(layout,value=>splitFor(currentTree(value),pane)?.ratio!==customRatio,'Dragging the painted divider must commit a real ratio change');await targetCue(pane,172);
  const moved=await selectedDivider('horizontal',partnerTitle);await mouseCells(moved.x,moved.y,'down');await wait('Mouse resize · Esc cancel');await mouseCells(restoreX,moved.y,'up');
  await observe(layout,value=>Math.abs(splitFor(currentTree(value),pane).ratio-customRatio)<1e-9,'A real drag must restore the exact customized ratio');await targetCue(pane,172);await selectedDivider('horizontal',partnerTitle);
  await leave();await noDivider();await pick(partnerTitle);await arrange();
  const other=await targetCue(partner,172);assert.equal(other.child,1);await key('+');
  await observe(layout,value=>Math.abs(splitFor(currentTree(value),partner).ratio-(customRatio-.05))<1e-9,'+ on the opposite child must decrease the first-child saved ratio');await targetCue(partner,172);await selectedDivider('horizontal',partnerTitle);
  await key('-');await observe(layout,value=>Math.abs(splitFor(currentTree(value),partner).ratio-customRatio)<1e-9,'- must restore the original saved ratio from the opposite side');await leave();await noDivider();
  await page.evaluate(()=>visual.terminal.resize(180,50));await main();await setZoom(true);await arrange();await targetCue('session',180,'hidden by zoom');await noDivider();await capture('07-zoomed-split-target');await leave();
  const zoomContext=(await layout()).windows;await finder('Nav pane 11');await key('Escape');await absent(finderMarker);
  await noDivider();
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
  const privateValues=['PRIVATE_窗_47','P_RIVATE_窗_47','BATCH_窗_47','F_XORMvalue','FOCUS_PRIVATE_47','F_OCUS_PRIVATE_47'];
  const modelBodies=JSON.stringify((await traces()).map(row=>row.body)),sessionText=await journal();for(const value of privateValues){assert.ok(!modelBodies.includes(value));assert.ok(!sessionText.includes(value));}
  assert.ok(!/MaxListenersExceededWarning|Possible EventEmitter memory leak detected/.test(await readFile(join(output,'terminal.ansi'),'utf8')));
  report.customRatio=customRatio;report.sessionId=originalJournal[0].slice(0,-6);report.privacy={finderAndFormAbsentFromModel:true,finderAndFormAbsentFromJournal:true,inputLogExcluded:'Raw input records synthetic test queries and form values'};
  report.splitTarget={siblings:[pane,partner],ratio:customRatio,visibleAxes:['rows','columns'],hidden:['size-limited','zoomed'],noTarget:['empty','lone'],mouseResize:true};
  report.checks.push('Arrange identifies the nearest nested split, grows either focused side and accepts a real painted-divider drag; hidden/no-target states and narrow exits remain honest, and exact geometry, closed windows and the original journal survive restart without private Finder/form text entering model requests or history');
  report.checks.push('Readable narrow tiling keeps two windows of at least 24×6 cells in columns at 60×24 and rows at 38×24, supports actual divider pointer/keyboard resize, collapses only below the available minimum and preserves pending Main/form editors plus the canonical tree through widening and restart');
  report.checks.push('Passive first publication and late command completion preserve active form, Main and Finder cursors after newer window intent; explicit hints and configured focus rules remain compatible, and only the unchanged matching retained Finder route opens its destination');
  await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');report.ptyExitCode=ptyExit;assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(output,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
  if(launch)await readFile(join(launch.state,'layout.json')).then(data=>writeFile(join(output,'failure-layout.json'),data)).catch(()=>{});
}finally{
  if(launch?.navigation?.focus)try{
    const receipts={};for(const name of await readdir(launch.navigation.state))if(/^(focus-|retained-|slow-).*\.json$/.test(name))receipts[name]=await json(join(launch.navigation.state,name));
    await writeFile(join(output,'focus-receipts.json'),JSON.stringify(receipts,null,2));
  }catch(error){report.ok=false;report.errors.push('Could not preserve focus fixture receipts: '+error);}
  await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
}
