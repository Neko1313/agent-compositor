import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-appearance');
const timeout=20_000,hash=value=>createHash('sha256').update(value).digest('hex');
const draft='THEME_PRIVATE_A😀窗_47',token='SYNTHETIC_THEME_PRIVATE_TOKEN_47';
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[],compositions:{}};
const json=file=>readFile(file,'utf8').then(JSON.parse),leaves=node=>node?.surface?[node.surface]:node?.children?.flatMap(leaves)??[];
const rgb=value=>parseInt(value.replace('#',''),16);
async function observe(read,predicate,reason){const end=Date.now()+timeout;let value;
  while(Date.now()<end){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}
  throw Error(reason+'; latest='+JSON.stringify(value));
}

/** Inspect public xterm cells, including all supported native border corners. */
function paneProbe({title,label,header:headerOnly=false}){
  const terminal=visual.terminal,buffer=terminal.buffer.active;if(terminal.modes?.synchronizedOutputMode===true)return;
  const rows=Array.from({length:terminal.rows},(_,y)=>Array.from({length:terminal.cols},(_,x)=>{
    const cell=buffer.getLine(buffer.viewportY+y)?.getCell(x);return{ch:cell?.getChars()??'',fg:cell?.getFgColor(),bg:cell?.getBgColor(),bold:Boolean(cell?.isBold())};
  }));
  const pairs={'┌':['┐','└','┘'],'╭':['╮','╰','╯'],'╔':['╗','╚','╝']};
  for(let top=0;top<rows.length;top++)for(let left=0;left<terminal.cols;left++){
    const ends=pairs[rows[top][left].ch];if(!ends)continue;
    const right=rows[top].findIndex((cell,x)=>x>left&&cell.ch===ends[0]);if(right<0)continue;
    const header=rows[top].slice(left+1,right).map(cell=>cell.ch).join('');
    if(!header.includes(' '+title+' ')&&!header.includes(' '+title+' ·'))continue;
    const bottom=rows.findIndex((row,y)=>y>top&&row[left].ch===ends[1]&&row[right].ch===ends[2]);if(bottom<0)continue;
    const text=rows.slice(top+1,bottom).map(row=>row.slice(left+1,right).map(cell=>cell.ch).join('').trimEnd()).join('\n');
    const value={left,right,top,bottom,header,text,corner:rows[top][left].ch,rows:rows.slice(top,bottom+1).map(row=>row.slice(left,right+1))};
    if(label){
      for(let y=headerOnly?top:top+1;y<(headerOnly?top+1:bottom);y++)for(let x=left+1;x<right;x++)if(Array.from(label).every((ch,index)=>rows[y][x+index]?.ch===ch))return{...value,marker:{x,y,...rows[y][x]}};
      continue;
    }
    return value;
  }
}

/** Reconstruct this fixture's exact scalar value inside the focused native textarea. */
function nativeComposerInput(text){
  const terminal=visual.terminal,buffer=terminal.buffer.active;if(terminal.modes?.synchronizedOutputMode===true)return false;
  const rows=Array.from({length:terminal.rows},(_,y)=>Array.from({length:terminal.cols},(_,x)=>buffer.getLine(buffer.viewportY+y)?.getCell(x)?.getChars()??''));
  const pairs={'┌':['┐','└','┘'],'╭':['╮','╰','╯'],'╔':['╗','╚','╝']};
  for(let top=0;top<rows.length;top++){
    const focused=rows[top].findIndex((_,x)=>Array.from(' · focused ').every((ch,index)=>rows[top][x+index]===ch));if(focused<0)continue;
    let left=focused;while(left>=0&&!pairs[rows[top][left]])left--;if(left<0)continue;
    const ends=pairs[rows[top][left]],right=rows[top].findIndex((ch,x)=>x>focused&&ch===ends[0]);if(right<=left)continue;
    const bottom=rows.findIndex((row,y)=>y>top&&row[left]===ends[1]&&row[right]===ends[2]);if(bottom<0)continue;
    for(let header=top+1;header<bottom;header++){
      if(!/[─═] Main · (?:Ready|Running|Draft)\b/.test(rows[header].slice(left+1,right).join('')))continue;
      const first=rows[header+1],send=first.findIndex((_,x)=>x>left&&x<right&&Array.from('Send').every((ch,index)=>first[x+index]===ch));
      // One button-padding cell and one gap separate Send from the textarea.
      const start=left+2,end=send-2;if(send<0||end<=start)return false;
      const value=rows.slice(header+1,bottom-1).map(row=>row.slice(start,end).join('').trimEnd()).join('');
      return value===(text||'Message Main…');
    }
  }
  return false;
}

await mkdir(output,{recursive:true});
for(const composition of ['native','selected']){
  const directory=join(output,composition),result={ok:false,checks:[],screenshots:[],errors:[]};await mkdir(directory,{recursive:true});report.compositions[composition]=result;
  let server,serverExit,browser,page,launch,ptyExit;
  try{
    const runtimeEnv=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
    server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_APPEARANCE:'1',VISUAL_OPENTUI_APPEARANCE_COMPOSITION:composition,VISUAL_OUTPUT:directory,AGENT_GRAPHICS:'off',
      ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
    serverExit=new Promise(done=>server.once('close',done));
    const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Appearance bench startup timed out')),timeout);
      server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Appearance bench exited '+code));});
      server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});
    });
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
    page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>result.errors.push(error.message));
    const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);
    socket.on('framereceived',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='exit')ptyExit=value.code;}catch{}});
    const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
    const wait=value=>page.waitForFunction(value=>visual.text().includes(value),value).catch(error=>{throw Error('Terminal missing '+JSON.stringify(value),{cause:error});});
    const absent=value=>page.waitForFunction(value=>!visual.text().includes(value),value).catch(error=>{throw Error('Terminal retained '+JSON.stringify(value),{cause:error});});
    const paste=text=>page.evaluate(text=>socket.send(JSON.stringify({type:'input',data:'\x1b[200~'+text+'\x1b[201~'})),text);
    const layout=()=>json(join(launch.state,'layout.json'));
    const records=file=>readFile(file,'utf8').then(value=>value.trim().split('\n').filter(Boolean).map(JSON.parse));
    const trace=()=>records(launch.appearance.trace),publicTrace=()=>records(launch.appearance.publicTrace);
    const completions=async()=>(await records(join(directory,'app-http.jsonl'))).filter(row=>row.kind==='completion');
    const check=text=>result.checks.push(text);
    async function normal(){await page.waitForFunction(()=>{
      const terminal=visual.terminal,text=visual.text(),toolbar=terminal.buffer.active.getLine(terminal.buffer.active.viewportY+1)?.translateToString(true,0,terminal.cols).trim().replace(/\s+/g,' ');
      const expected=terminal.cols<42?/^Arrange Windows Main$/:/^Alt\+W Arrange (?:F2 Windows|Alt\+W w Windows) Alt\+0 Main$/;
      return terminal.modes?.synchronizedOutputMode!==true&&expected.test(toolbar??'')&&!text.includes('WINDOW MODE')&&!text.includes('windows · ↑↓ select · Enter open');
    });}
    async function main(){await key('Alt+0');await normal();await observe(layout,value=>value.windows.focused==='session'||value.views?.some(view=>view.id===value.windows.focused&&view.kind==='session'),'Main focus must acknowledge actual selected window');}
    async function input(text,cursor=text.length){if(composition==='selected'){
      await wait('COPY CUSTOM INPUT');await wait('D: '+text.slice(0,cursor)+'|'+text.slice(cursor));await wait('Cursor UTF16: '+cursor+' / '+text.length);
    }else await page.waitForFunction(nativeComposerInput,text);}
    async function send(text){await main();await key('End');await key('Control+u');await paste(text);await input(text);await key(composition==='selected'?'F2':'Enter');}
    async function color(label,expected){
      await observe(async()=>{const value=await page.evaluate(paneProbe,{title:'Appearance palette',label});return value?{marker:value.marker,header:value.header,corner:value.corner}:undefined;},
        value=>value?.marker?.fg===expected,'Actual native foreground for '+label+' must equal '+expected.toString(16));
    }
    async function capture(name){const attempts=[];for(let attempt=0;attempt<2;attempt++){
      await page.evaluate(()=>new Promise(done=>{const sub=visual.terminal.onRender(()=>{sub.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
      const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(directory,name+'.png')});
      const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()})),stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});
      await writeFile(join(directory,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(directory,name+'.txt'),after.text);
      if(stable){result.screenshots.push(name+'.png');return;}if(attempt===0){await copyFile(join(directory,name+'.png'),join(directory,name+'.attempt1.png'));await page.waitForFunction(()=>{const now=performance.now(),frames=visual.frames,text=visual.text(),old=window.__appearanceQuiet;
        if(!old||old.frames!==frames||old.text!==text){window.__appearanceQuiet={frames,text,at:now};return false;}return now-old.at>=150;},undefined,{polling:'raf',timeout:5000});}
    }throw Error('Terminal changed during both captures: '+name);}
    const probe=(title,label,header=false)=>page.evaluate(paneProbe,{title,label,header});
    async function paneText(title){return(await probe(title))?.text??'';}
    async function arrange(){await key('Alt+w');await wait('WINDOW MODE');}
    async function leave(){await key('Escape');await normal();}
    async function focus(id){const before=await layout(),workspace=before.windows.spaces.find(space=>leaves(space.tree).includes(id))?.id;assert.ok(workspace,'Focus needs a real open identity: '+id);
      await arrange();if(before.windows.workspace!==workspace){await key(String(workspace));await observe(layout,value=>value.windows.workspace===workspace,'Actual workspace change');}
      let current=await layout();const count=leaves(current.windows.spaces.find(space=>space.id===workspace)?.tree).length;
      for(let i=0;current.windows.focused!==id&&i<count;i++){const previous=current.windows.focused;await key('Tab');current=await observe(layout,value=>value.windows.focused!==previous,'Actual focus cycle');}
      assert.equal(current.windows.focused,id);await leave();}
    async function zoom(enabled){await arrange();await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
      if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));await leave();}
    async function resize(cols,rows=50){const frames=await page.evaluate(()=>visual.frames);await page.evaluate(({cols,rows})=>visual.terminal.resize(cols,rows),{cols,rows});
      await page.waitForFunction(({cols,rows,frames})=>{const terminal=visual.terminal,buffer=terminal.buffer.active;return terminal.cols===cols&&terminal.rows===rows&&visual.frames>frames&&terminal.modes?.synchronizedOutputMode!==true
        &&Array.from({length:rows},(_,y)=>buffer.getLine(buffer.viewportY+y)?.getCell(cols-1)?.getChars()).some(ch=>['┐','┘','│','╮','╯','╗','╝','║'].includes(ch));},{cols,rows,frames});}
    async function point(x,y){return page.evaluate(({x,y})=>{const rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(x+.5)*rect.width/visual.terminal.cols,y:rect.y+(y+.5)*rect.height/visual.terminal.rows};},{x,y});}
    async function click(title,label,header=false){let previous,count=0;const target=await observe(async()=>{
      const value=await probe(title,label,header);if(!value?.marker)return;const signature=JSON.stringify([value.marker,value.header,value.text]);
      if(signature!==previous){previous=signature;count=1;return;}if(++count<3)return;return value.marker;
    },Boolean,'Stable native pointer target: '+title+' / '+label);const p=await point(target.x,target.y);await page.mouse.click(p.x,p.y);}
    let selection={fg:0x171a20,bg:0xa6dfd4};
    async function open(query,label=query){await arrange();await key('w');await wait('windows · ↑↓ select · Enter open');await page.keyboard.type(query);
      const read=async selected=>{const value=await probe('Windows');if(!value)return;const body=value.rows.map(row=>row.slice(1,-1).map(cell=>cell.ch).join('').trim());
        if(body[1]!==query||body[2]!=='1 windows · ↑↓ select · Enter open')return;
        const choices=value.rows.slice(3,-1).flatMap(row=>{const text=row.slice(1,-1).map(cell=>cell.ch).join('').trim(),name=text.replace(/\s{2,}(?:WS [1-9]|Closed|Available|Unavailable)$/,'');if(name!==label)return[];
          const cell=row.find(cell=>cell.ch!==''&&cell.ch!==' '&&cell.ch!==row[0].ch);return[{selected:cell?.fg===selection.fg&&cell?.bg===selection.bg&&cell?.bold}];});
        if(choices.length!==1||selected&&!choices[0].selected)return;return choices[0];};
      const choice=await observe(()=>read(false),Boolean,'Exact palette-aware Finder result: '+label);if(!choice.selected)await key('ArrowDown');await observe(()=>read(true),Boolean,'Exact palette-aware Finder selection: '+label);
      await key('Enter');await absent('windows · ↑↓ select · Enter open');await normal();}
    async function publish(owner,keyName,label,{geometry=false}={}){const id=owner==='a'?launch.appearance.ids.controls:launch.appearance.ids.overlay,title=owner==='a'?'Appearance controls':'Appearance overlay';
      await focus(id);const before=await layout(),count=(await trace()).filter(row=>row.event==='published').length;await click(title,label);
      await observe(trace,rows=>rows.filter(row=>row.event==='published').length===count+1,'One actual appearance publication');if(!geometry)assert.deepEqual((await layout()).windows,before.windows,'Appearance must not alter user geometry/focus');
      const last=(await trace()).findLast(row=>row.event==='published');assert.equal(last.owner,owner==='a'?launch.appearance.producerA:launch.appearance.producerB);assert.equal(last.key,keyName);return before;}
    async function paletteField(label,field,expected){await observe(async()=>{const value=await probe('Appearance palette',label);return value?.marker;},value=>value?.[field]===expected,'Palette '+label+' '+field+' must equal '+expected.toString(16));}
    async function allColors(){await focus('session');for(const[name,label]of Object.entries({text:'TEXT',muted:'MUTED',accent:'ACCENT',success:'SUCCESS',warning:'WARNING',danger:'DANGER'}))await color('APPEARANCE_'+label,rgb(launch.appearance.palette[name]));
      await paletteField('APPEARANCE_SELECTED','fg',selection.fg);await paletteField('APPEARANCE_SELECTED','bg',selection.bg);
      const palette=await probe('Appearance palette');assert.equal(palette.rows[1][0].fg,rgb(launch.appearance.palette.border));
      const title=palette.rows[0].find(cell=>cell.ch==='A');assert.equal(title.bg,rgb(launch.appearance.palette.titleBackground));}
    async function parked(){await focus('session');await key('End');await key('Control+u');await paste(draft);await input(draft);await key('Home');await key('ArrowRight');await input(draft,1);}
    async function verifyDraft(id='session'){await focus(id);await paste('X');await input('TXHEME_PRIVATE_A😀窗_47',2);await key(composition==='selected'?'Backspace':'Control+z');await input(draft,1);}
    const sharedTrace=()=>records(launch.appearance.shared.trace),selectedTrace=async()=>launch.appearance.shared.selectedTrace?records(launch.appearance.shared.selectedTrace):[];
    const plugins=async()=>open('Plugins',(await layout()).registered.includes('plugin-extension-manager-extensions')?'Extensions':'Plugins');
    async function reload(nextSelection){await focus('session');await observe(()=>probe('Main'),value=>value.header.includes('focused'),'Main notice must be observed in its real focused pane');
      const previousNotices=(await paneText('Main')).match(/Reloaded \d+ plugins\./g)??[];
      await plugins();await zoom(true);const before=await layout(),count=(await trace()).filter(row=>row.event==='reloaded'&&row.owner===launch.appearance.producerA).length;await click('Extensions','Apply plugin changes');
      const rows=await observe(trace,rows=>rows.filter(row=>row.event==='reloaded'&&row.owner===launch.appearance.producerA).length>count,'Real plugin reload must reach its lifecycle hooks');
      const receipt=rows.findLast(row=>row.event==='reloaded'&&row.owner===launch.appearance.producerA);assert.ok(receipt.plugins?.length);const finalNotice='Reloaded '+receipt.plugins.length+' plugins.';
      assert.ok(!previousNotices.includes(finalNotice),'A stale earlier Main notice cannot acknowledge this reload');
      // The final host notice belongs to Main; the manager can be unpublished
      // during reload on a workspace containing no Main copy.
      await focus('session');await wait(finalNotice);selection=nextSelection;
      const finished=await layout();for(const space of before.windows.spaces)assert.deepEqual(finished.windows.spaces.find(value=>value.id===space.id)?.tree,space.tree);
      assert.deepEqual(finished.views,before.views);await plugins();await zoom(before.windows.fullscreen);
      await normal();assert.deepEqual((await layout()).windows,before.windows);assert.deepEqual((await layout()).views,before.views);
      (result.reloads??=[]).push({previousNotices,finalNotice,plugins:receipt.plugins,exactWindowsRestored:true});return receipt;}
    async function restart(){const generation=await page.evaluate(()=>visual.generation);ptyExit=undefined;await page.locator('#restart').click();await page.waitForFunction(generation=>visual.generation>generation&&visual.frames>0,generation);launch=await json(join(directory,'opentui-app-launch.json'));await normal();}

    await wait(composition==='selected'?'COPY CUSTOM INPUT':'Message Main…');launch=await json(join(directory,'opentui-app-launch.json'));
    assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);assert.equal(launch.appearance.composition,composition);
    assert.equal(await page.evaluate(()=>visual.terminal.unicode.activeVersion),'11');
    const first=launch.launches[0].command;assert.deepEqual(first.slice(-4,-1),['--renderer','opentui','--cwd']);assert.equal(await realpath(first.at(-1)),await realpath(launch.cwd));
    if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);result.executable={path:launch.executable,sha256:launch.sha256};
      const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');result.renderer={path:renderer,sha256:hash(await readFile(renderer))};}
    await page.evaluate(()=>visual.terminal.resize(180,50));await normal();await wait('APPEARANCE_ACCENT');
    const baseline=await page.evaluate(paneProbe,{title:'Appearance palette',label:'APPEARANCE_ACCENT'});assert.equal(baseline.marker.fg,0xa6dfd4,'Incumbent native accent oracle');result.baselineAccent=baseline.marker;
    await capture('01-default');await send('/theme amber');await observe(()=>json(launch.appearance.themeFile),value=>value==='amber','Bundled command must persist its real theme selection');
    await observe(publicTrace,rows=>rows.some(row=>row.event==='service.ui.configure'&&row.input.plugin==='ui-theme'&&row.input.appearance?.colors?.accent==='#e5bd85'&&row.input.appearance.colors.selectionText==='#f3f7fa'),'Bundled command must publish its real appearance contribution and explicit readable selection pair');
    assert.equal((await completions()).length,0,'Theme commands must not invoke the loopback model');
    result.amberPublication={saved:true,published:true,modelRequests:0};await color('APPEARANCE_ACCENT',0xe5bd85);selection={fg:0xf3f7fa,bg:0x4a3b28};await paletteField('APPEARANCE_SELECTED','fg',selection.fg);await paletteField('APPEARANCE_SELECTED','bg',selection.bg);assert.equal((await probe('Main')).corner,'╭');await capture('02-amber');
    await send('/theme mono');await observe(()=>json(launch.appearance.themeFile),value=>value==='mono','Bundled mono must save');await color('APPEARANCE_ACCENT',0xffffff);selection={fg:0x101010,bg:0xb8b8b8};await paletteField('APPEARANCE_SELECTED','fg',selection.fg);await paletteField('APPEARANCE_SELECTED','bg',selection.bg);
    await send('/theme slate');await observe(()=>json(launch.appearance.themeFile),value=>value==='slate','Bundled slate must save');await color('APPEARANCE_ACCENT',0xa6dfd4);selection={fg:0x171a20,bg:0xa6dfd4};assert.equal((await completions()).length,0);
    if(composition==='native')check('Bundled /theme amber, mono and slate use actual dropped commands and saved storage without model requests; portable RGB/named colors, selection contrast and border styles update real native cells');

    await publish('a','all','Apply all appearance A');selection={fg:0xfbf3df,bg:0x455d76};await allColors();assert.ok((await paneText('Main')).includes('APPEARANCE_WELCOME_47'));
    await publish('b','overlay','Apply B overlay');await focus('session');await color('APPEARANCE_ACCENT',0xd7a3ca);await color('APPEARANCE_TEXT',rgb(launch.appearance.palette.text));
    await publish('a','partial','Replace A with partial');selection={fg:0x171a20,bg:0xa6dfd4};await focus('session');await color('APPEARANCE_ACCENT',0xb2d9f1);await color('APPEARANCE_TEXT',0xe6e9ed);assert.ok(!(await paneText('Main')).includes('APPEARANCE_WELCOME_47'));
    await publish('a','null','Remove A contribution');await focus('session');await color('APPEARANCE_ACCENT',0xd7a3ca);
    await publish('b','muted','Replace B with muted');await focus('session');await color('APPEARANCE_ACCENT',0xa6dfd4);await color('APPEARANCE_MUTED',0xb6d7bf);
    await publish('b','null','Remove B contribution');await publish('a','all','Apply all appearance A');selection={fg:0xfbf3df,bg:0x455d76};await allColors();
    await focus(launch.appearance.ids.controls);const invalidCount=(await trace()).filter(row=>row.event==='invalid').length;await click('Appearance controls','Try invalid appearance');const invalid=await observe(trace,rows=>rows.filter(row=>row.event==='invalid').length===invalidCount+1,'Invalid configure must finish safely');assert.equal(invalid.findLast(row=>row.event==='invalid').accepted,false);await allColors();await capture('03-full-appearance');
    if(composition==='native')check('All ten portable appearance colors and empty-conversation presentation apply through owned producers; field precedence, whole-contribution replacement, null and invalid calls preserve inherited defaults and exact WM geometry');

    await focus('session');const beforeHover=await layout();await observe(()=>probe('Appearance palette'),value=>!value.header.includes('[F][x]'),'Unfocused controls follow focus policy');
    let palette=await probe('Appearance palette'),p=await point(palette.left+5,palette.top);await page.mouse.move(p.x,p.y);await observe(()=>probe('Appearance palette'),value=>value.header.includes('[F][x]'),'Title hover exposes canonical controls');assert.equal((await layout()).windows.focused,beforeHover.windows.focused);
    p=await point(10,15);await page.mouse.move(p.x,p.y);await publish('a','double','Apply double always');await focus('session');palette=await observe(()=>probe('Appearance palette'),value=>value.corner==='╔'&&value.header.includes('[F][x]'),'Double/always applies to unfocused title');
    const beforeZoom=await layout();await click('Appearance palette','[F]',true);await observe(layout,value=>value.windows.focused===launch.appearance.ids.palette&&value.windows.fullscreen,'Actual themed F button zooms its own window');
    await click('Appearance palette','[F]',true);await observe(layout,value=>!value.windows.fullscreen,'Actual themed F button restores tiling');await focus(beforeZoom.windows.focused);assert.deepEqual((await layout()).windows,beforeZoom.windows);
    await click('Appearance palette','[x]',true);await observe(layout,value=>!value.windows.spaces.some(space=>leaves(space.tree).includes(launch.appearance.ids.palette)),'Actual themed x button closes only its own view');await open('Appearance palette');
    await publish('a','single','Apply single focus');await focus('session');assert.equal((await probe('Main')).corner,'┌');await arrange();await observe(()=>probe('Appearance palette'),value=>value.header.includes('[F][x]'),'Arrange exposes controls independently of focus');await leave();
    await publish('a','no-hints','Apply hidden hints');await focus(launch.appearance.ids.controls);assert.ok(!(await paneText('Appearance controls')).includes('↑↓ select · Enter activate'));await focus('session');
    if(composition==='native')assert.ok(!(await paneText('Main')).includes('Enter send · Ctrl+J newline'));else await wait('F2 sends · Enter inserts a line');
    await publish('a','tools','Show canonical Tools',{geometry:true});let tools=await layout();assert.ok(tools.windows.spaces.some(space=>leaves(space.tree).includes('tools')));assert.equal(tools.windows.focused,launch.appearance.ids.controls);
    await focus('tools');await arrange();await key('Shift+Digit4');await key('4');await leave();await arrange();await key('t');const toolCopy=await observe(layout,value=>value.views.some(view=>view.kind==='tools'),'Actual new Tools view');const toolCopyId=toolCopy.views.find(view=>view.kind==='tools').id;await leave();
    const movedTools=await publish('a','tools','Show canonical Tools',{geometry:true});tools=await layout();assert.deepEqual(tools.windows,movedTools.windows,'A repeated appearance publication preserves the complete user-moved Tools tree/focus');assert.ok(leaves(tools.windows.spaces.find(space=>space.id===4)?.tree).includes('tools'));
    await publish('a','null','Remove A contribution');selection={fg:0x171a20,bg:0xa6dfd4};assert.ok((await layout()).windows.spaces.some(space=>leaves(space.tree).includes('tools')),'Removing a contribution does not replay a placement request');
    await publish('a','no-tools','Hide canonical Tools',{geometry:true});selection={fg:0xfbf3df,bg:0x455d76};tools=await layout();assert.ok(!tools.windows.spaces.some(space=>leaves(space.tree).includes('tools')));assert.ok(tools.windows.spaces.some(space=>leaves(space.tree).includes(toolCopyId)),'showTools controls only canonical Tools');
    await focus('session');await send('APP_APPEARANCE_TOOL');await wait('APPEARANCE_TOOL_DONE');await zoom(true);await observe(()=>paneText('Main'),value=>value.includes('✓ read'),'Ordinary tool activity appears compactly');assert.ok(!(await paneText('Main')).includes('appearance-tool.txt'));
    await publish('a','details','Show tool details');await focus('session');await zoom(true);await observe(()=>paneText('Main'),value=>value.includes('appearance-tool.txt')&&value.includes('Operator A')&&value.includes('Guide A'),'Presentation labels and opt-in ordinary tool args');
    await publish('a','compact','Hide tool details');await focus('session');await zoom(true);assert.ok(!(await paneText('Main')).includes('appearance-tool.txt'));assert.equal((await completions()).length,2);await capture('04-chrome-and-presentation');
    check(composition==='native'?'Single/round/double chrome and canonical focus/hover/always controls keep actual zoom/close hit targets; hints, labels, compact/details tools and publication-only Tools intent respect user placement':
      'Selected composition consumes all portable colors/chrome/presentation, exact publisher replacement and normal bundled themes while inherited hints and ordinary tool details preserve its configured editor behavior');

    await send('APP_COPY_QUESTION');await wait(composition==='selected'?'CUSTOM QUESTION':'MAIN_QUESTION: choose deployment');
    if(composition==='native'){await key('Alt+i');await key('ArrowDown');await key('Space');await wait('[x] Production');await key('Alt+i');}
    else{await key('Alt+i');await key('Home');await key('ArrowRight');await paste('X');await wait('Value: QX|value');await key('Backspace');await wait('Value: Q|value');await key('Alt+i');}
    const beforeFactories=(await sharedTrace()).filter(row=>row.event==='editor-created').length,questionFactories=(await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='question').length;await parked();
    await arrange();await key('n');const copied=await observe(layout,value=>value.views.some(view=>view.kind==='session'),'Actual new Main window');const mainCopy=copied.views.find(view=>view.kind==='session').id;await leave();await verifyDraft(mainCopy);
    await publish('a','double','Apply double always');await verifyDraft('session');await publish('a','all','Apply all appearance A');await verifyDraft(mainCopy);await zoom(true);await resize(38,24);await verifyDraft(mainCopy);await capture('05-narrow-pending-draft');await resize(180,50);
    await focus('plugin-copy-request-probe-controls');await click('Copy controls','Open private form');const formTitle=composition==='selected'?'Form · copy-request-probe':'Copy private form';await open(formTitle);await zoom(true);
    if(composition==='selected'){await wait('CUSTOM PRIVATE FORM');await key('Home');await key('ArrowRight');await paste('X');await wait('Name: FX|ORMvalue');await key('Backspace');await key('Tab');}
    else{await wait('FORMvalue');await key('Home');await key('ArrowRight');await paste('X');await wait('FXORMvalue');await key('Backspace');await key('Tab');}
    await paste(token);await wait('*'.repeat(token.length));const formFactories=(await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='form').length;
    await arrange();await key('q');await leave();await publish('a','double','Apply double always');await verifyDraft(mainCopy);await open(formTitle);await zoom(true);await wait('*'.repeat(token.length));
    if(composition==='selected'){const rich=await probe(formTitle,'RICH');assert.equal(rich.marker.fg,0xeac280);assert.equal(rich.marker.bg,0x171a20);await wait('Name: F|ORMvalue');await key('F5');}
    else{await wait('FORMvalue');await key('Alt+Enter');}
    const formRows=await observe(sharedTrace,rows=>rows.some(row=>row.event==='form-result'),'Private form must return through its actual caller');assert.deepEqual(formRows.find(row=>row.event==='form-result').result,{action:'save',name:'FORMvalue',tokenLength:token.length,tokenHash:hash(token)});assert.equal(formRows.filter(row=>row.event==='called'&&row.mode==='form').length,1);
    await verifyDraft('session');assert.equal((await completions()).length,3);if(composition==='selected'){
      const selected=await selectedTrace();assert.equal(selected.filter(row=>row.event==='created'&&row.kind==='question').length,questionFactories);assert.equal(selected.filter(row=>row.event==='created'&&row.kind==='form').length,formFactories);assert.equal((await sharedTrace()).filter(row=>row.event==='editor-created').length,beforeFactories);
    }
    await capture('06-pending-main-private-form');await zoom(true);await key('Alt+i');if(composition==='selected'){await wait('CUSTOM QUESTION');await key('F4');}else{await wait('[x] Production');await key('Alt+Enter');}
    await wait('COPY_ANSWER_RECEIVED: Production');await verifyDraft('session');assert.equal((await completions()).length,4);
    if(composition==='selected'){const selected=await selectedTrace();assert.equal(selected.filter(row=>row.event==='input'&&row.kind==='question'&&row.key==='f4').length,1);assert.equal(selected.filter(row=>row.event==='input'&&row.kind==='form'&&row.key==='f5').length,1);}
    check(composition==='native'?'Themed Main copies and38-column zoom preserve one Unicode draft/cursor/undo, selected Production answer and independent hidden private form; only explicit callbacks settle once with no extra model work':
      'Appearance updates preserve one selected editor/question/form lease, exact private UTF-16 input, masked fields and explicit rich-cell colors while the corresponding caller alone settles');

    await focus(mainCopy);await arrange();await key('q');await leave();await publish('a','null','Remove A contribution');selection={fg:0x171a20,bg:0xa6dfd4};await focus('session');await send('/theme amber');await color('APPEARANCE_ACCENT',0xe5bd85);selection={fg:0xf3f7fa,bg:0x4a3b28};await parked();
    await focus(launch.appearance.ids.controls);await click('Appearance controls','Begin late publication');const lateRows=await observe(trace,rows=>rows.some(row=>row.event==='late-started'),'Actual retained API publication must wait for its external gate');const late=lateRows.findLast(row=>row.event==='late-started');
    await click('Appearance controls','Disable bundled theme');const disabled=await observe(trace,rows=>rows.some(row=>row.event==='extension-result'&&row.action==='disable'),'Canonical extension disable service must finish');
    assert.deepEqual(disabled.findLast(row=>row.event==='extension-result'&&row.action==='disable').result.value,{changed:'ui-theme',scope:'project',enabled:false,reloadRequired:true});
    let oldEditor=(await sharedTrace()).findLast(row=>row.event==='editor-created');const disabledReload=await reload({fg:0x171a20,bg:0xa6dfd4});assert.ok(!disabledReload.plugins.includes('ui-theme'));await focus('session');await zoom(false);await color('APPEARANCE_ACCENT',0xa6dfd4);await input(draft,1);
    await writeFile(launch.appearance.lateGate,'release\n');const expired=await observe(trace,rows=>rows.some(row=>row.event==='late-returned'&&row.id===late.id),'Old retained publication must finish');assert.equal(expired.find(row=>row.event==='late-returned'&&row.id===late.id).accepted,false);await color('APPEARANCE_ACCENT',0xa6dfd4);
    if(composition==='selected'){const next=(await sharedTrace()).findLast(row=>row.event==='editor-created');assert.notEqual(next.id,oldEditor.id);assert.deepEqual({hash:next.hash,length:next.length,cursor:next.cursor},{hash:hash(draft),length:draft.length,cursor:1});}
    await focus(launch.appearance.ids.controls);await click('Appearance controls','Enable bundled theme');const enabled=await observe(trace,rows=>rows.some(row=>row.event==='extension-result'&&row.action==='enable'),'Canonical extension enable service must finish');
    assert.deepEqual(enabled.findLast(row=>row.event==='extension-result'&&row.action==='enable').result.value,{changed:'ui-theme',scope:'project',enabled:true,reloadRequired:true});
    const enabledReload=await reload({fg:0xf3f7fa,bg:0x4a3b28});assert.ok(enabledReload.plugins.includes('ui-theme'));await verifyDraft('session');await zoom(false);await color('APPEARANCE_ACCENT',0xe5bd85);assert.equal(await json(launch.appearance.themeFile),'amber');await capture('07-reloaded-theme-and-draft');
    const beforeRestart=await layout(),activeBefore=await json(launch.appearance.shared.active);await restart();await observe(layout,value=>JSON.stringify(value.windows)===JSON.stringify(beforeRestart.windows),'Restart must restore exact actual windows tree');assert.deepEqual((await layout()).views,beforeRestart.views);assert.equal((await json(launch.appearance.shared.active)).id,activeBefore.id);
    await focus('session');await color('APPEARANCE_ACCENT',0xe5bd85);await send('APP_APPEARANCE_RESTORED');await wait('APPEARANCE_RESTORED: retained');assert.equal((await completions()).length,5);await capture('08-restarted-theme');
    const http=JSON.stringify((await completions()).map(row=>row.body)),journals=(await Promise.all((await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')).map(name=>readFile(join(launch.state,'sessions',name),'utf8')))).join('\n');
    const publicEvents=await readFile(launch.appearance.publicTrace,'utf8'),terminal=await readFile(join(directory,'terminal.ansi'),'utf8');
    for(const[value,label]of [[http,'HTTP'],[journals,'journals'],[publicEvents,'public UI hooks']])for(const secret of [draft,token,'FORMvalue','FXORMvalue'])assert.ok(!value.includes(secret),'Private value leaked to '+label);
    assert.ok(!terminal.includes(token));assert.ok(!/MaxListenersExceededWarning/.test(terminal));result.privacy={privateToken:true,parkedDraftAndForm:true,inputLogExcluded:true};
    assert.deepEqual(launch.launches.map(row=>row.command[row.command.indexOf('--renderer')+1]),['opentui','opentui']);
    check(composition==='native'?'Actual plugin disable/unload and re-enable reload the saved bundled theme, revoke a gated old publication and retain draft plus exact closed identities; process restart restores the theme and committed context':
      'Selected editor checkpoints survive destructive reload, expired appearance APIs cannot recolor the new session, and restart retains exact views/tree plus saved theme without exposing private input');
    await focus('session');await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI must exit cleanly');result.ptyExitCode=ptyExit;assert.deepEqual(result.errors,[]);result.ok=true;
  }catch(error){result.errors.push(error instanceof Error?error.stack:String(error));if(page){
    result.nativeFailure=await page.evaluate(()=>{const terminal=window.visual?.terminal,buffer=terminal?.buffer.active,line=buffer?.getLine(buffer.viewportY+1);return terminal?{cols:terminal.cols,rows:terminal.rows,viewportY:buffer.viewportY,synchronizedOutput:terminal.modes?.synchronizedOutputMode,
      toolbarVisible:line?.translateToString(true,0,terminal.cols),toolbarFullBuffer:line?.translateToString(true)}:undefined;}).catch(()=>undefined);
    await writeFile(join(directory,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});}}
  finally{
    if(launch)try{
      await writeFile(launch.appearance.lateGate,'cleanup\n');for(const file of Object.values(launch.appearance.shared.gates))await writeFile(file,'cleanup\n');
      await copyFile(launch.appearance.trace,join(directory,'fixture-trace.jsonl'));await copyFile(launch.appearance.publicTrace,join(directory,'public-ui-events.jsonl'));
      await copyFile(launch.appearance.shared.trace,join(directory,'shared-trace.jsonl'));if(launch.appearance.shared.selectedTrace)await copyFile(launch.appearance.shared.selectedTrace,join(directory,'selected-trace.jsonl'));
      for(const name of (await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')))await copyFile(join(launch.state,'sessions',name),join(directory,'session-'+name));
      await writeFile(join(directory,'final-layout.json'),JSON.stringify(await json(join(launch.state,'layout.json')),null,2));
    }catch(error){result.errors.push('Could not preserve appearance diagnostics: '+error);}
    await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}
    await writeFile(join(directory,'report.json'),JSON.stringify(result,null,2)+'\n');report.checks.push(...result.checks);report.screenshots.push(...result.screenshots.map(name=>composition+'/'+name));report.errors.push(...result.errors);
  }
  if(!result.ok)break;
}
report.ok=report.checks.length===8&&report.errors.length===0;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
