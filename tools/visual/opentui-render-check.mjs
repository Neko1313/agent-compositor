import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {completeJsonLines} from './jsonl.mjs';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-render');
const timeout=20_000,hash=value=>createHash('sha256').update(value).digest('hex');
const draft='RENDER_PRIVATE_A😀窗_47',token='SYNTHETIC_RENDER_PRIVATE_TOKEN_47';
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[],compositions:{}};
const json=file=>readFile(file,'utf8').then(JSON.parse),leaves=node=>node?.surface?[node.surface]:node?.children?.flatMap(leaves)??[];
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
    server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtimeEnv,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_RENDER:'1',VISUAL_OPENTUI_RENDER_COMPOSITION:composition,VISUAL_OUTPUT:directory,AGENT_GRAPHICS:'off',
      ...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
    serverExit=new Promise(done=>server.once('close',done));
    const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Render bench startup timed out')),timeout);
      server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Render bench exited '+code));});
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
    const records=file=>readFile(file,'utf8').then(completeJsonLines);
    const trace=()=>records(launch.render.trace),publicTrace=()=>records(launch.render.publicTrace);
    const completions=async()=>(await records(join(directory,'app-http.jsonl'))).filter(row=>row.kind==='completion');
    const check=text=>result.checks.push(text);
    async function normal(after=-1){await page.waitForFunction(after=>{
      const terminal=visual.terminal,text=visual.text(),toolbar=terminal.buffer.active.getLine(terminal.buffer.active.viewportY+1)?.translateToString(true,0,terminal.cols).trim().replace(/\s+/g,' ');
      const expected=terminal.cols<42?/^Arrange Windows Main$/:/^Alt\+W Arrange (?:F2 Windows|Alt\+W w Windows) Alt\+0 Main$/;
      return visual.frames>after&&terminal.modes?.synchronizedOutputMode!==true&&expected.test(toolbar??'')&&!text.includes('WINDOW MODE')&&!text.includes('windows · ↑↓ select · Enter open');
    },after);}
    async function main(){await key('Alt+0');await normal();await observe(layout,value=>value.windows.focused==='session'||value.views?.some(view=>view.id===value.windows.focused&&view.kind==='session'),'Main focus must acknowledge actual selected window');}
    async function input(text,cursor=text.length){if(composition==='selected'){
      const lease=(await sharedTrace()).findLast(row=>row.event==='editor-created')?.id;assert.ok(lease,'Actual selected editor factory lease');
      await observe(trace,rows=>{const receipt=rows.findLast(row=>row.event==='editor-checkpoint'&&row.lease===lease);
        return receipt?.sha256===hash(text)&&receipt.length===text.length&&receipt.cursor===cursor;},'Exact chosen editor snapshot digest, UTF16 length and cursor');
      const current=await layout(),title=current.windows.focused==='session'?'Main':current.views.find(view=>view.id===current.windows.focused)?.title;assert.ok(title,'Input must belong to an actual focused Main');
      await observe(()=>probe(title),pane=>{
        if(!pane?.header.includes('focused')||!pane.text.includes('COPY CUSTOM INPUT')||!pane.text.includes('Cursor UTF16: '+cursor+' / '+text.length))return false;
        const field=pane.text.split('\n').map(line=>line.trim()).find(line=>line.startsWith('D: ')),exact='D: '+text.slice(0,cursor)+'|'+text.slice(cursor);
        if(field===exact)return true;
        // The original controller deliberately truncates one native text row.
        // Its private digest above checks the full value; the real cells must
        // still show the actual edit/caret and complete Unicode suffix.
        return cursor<=4&&field?.includes('...')&&field.startsWith('D: '+text.slice(0,cursor)+'|')&&field.endsWith(Array.from(text.slice(cursor)).slice(-5).join(''));
      },'Focused original selected field and exact cursor remain visibly truthful');
    }else await page.waitForFunction(nativeComposerInput,text);}
    async function send(text){await main();await key('End');await key('Control+u');await paste(text);await input(text);await key(composition==='selected'?'F2':'Enter');}
    async function capture(name){const attempts=[];for(let attempt=0;attempt<2;attempt++){
      await page.evaluate(()=>new Promise(done=>{const sub=visual.terminal.onRender(()=>{sub.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
      const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(directory,name+'.png')});
      const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()})),stable=before.frames===after.frames&&before.text===after.text;attempts.push({before,after,stable});
      await writeFile(join(directory,name+'.capture.json'),JSON.stringify({attempts},null,2));await writeFile(join(directory,name+'.txt'),after.text);
      if(stable){result.screenshots.push(name+'.png');return;}if(attempt===0){await copyFile(join(directory,name+'.png'),join(directory,name+'.attempt1.png'));await page.waitForFunction(()=>{const now=performance.now(),frames=visual.frames,text=visual.text(),old=window.__renderQuiet;
        if(!old||old.frames!==frames||old.text!==text){window.__renderQuiet={frames,text,at:now};return false;}return now-old.at>=150;},undefined,{polling:'raf',timeout:5000});}
    }throw Error('Terminal changed during both captures: '+name);}
    const probe=(title,label,header=false)=>page.evaluate(paneProbe,{title,label,header});
    // Saved WM state and the unchanged toolbar can precede a complete native
    // frame. Missing panes during synchronized output cannot prove absence.
    async function paneText(title){return(await observe(()=>probe(title),Boolean,'Complete native pane: '+title)).text;}
    async function arrange(){const frames=await page.evaluate(()=>visual.frames);await key('Alt+w');await page.waitForFunction(frames=>visual.frames>frames&&visual.terminal.modes?.synchronizedOutputMode!==true&&visual.text().includes('WINDOW MODE'),frames);}
    async function leave(){const frames=await page.evaluate(()=>visual.frames);await key('Escape');await normal(frames);}
    async function focus(id){const before=await layout(),workspace=before.windows.spaces.find(space=>leaves(space.tree).includes(id))?.id;assert.ok(workspace,'Focus needs a real open identity: '+id);
      await arrange();if(before.windows.workspace!==workspace){await key(String(workspace));await observe(layout,value=>value.windows.workspace===workspace,'Actual workspace change');}
      let current=await layout();const count=leaves(current.windows.spaces.find(space=>space.id===workspace)?.tree).length;
      for(let i=0;current.windows.focused!==id&&i<count;i++){const previous=current.windows.focused;await key('Tab');current=await observe(layout,value=>value.windows.focused!==previous,'Actual focus cycle');}
      assert.equal(current.windows.focused,id);await leave();}
    async function zoom(enabled){await arrange();await page.waitForFunction(()=>/WINDOW MODE · (Zoomed|Tiled)/.test(visual.text()));
      if((await screen()).includes('WINDOW MODE · Zoomed')!==enabled)await key('f');await wait('WINDOW MODE · '+(enabled?'Zoomed':'Tiled'));await leave();}
    async function resize(cols,rows=50){await focus('session');await zoom(true);const frames=await page.evaluate(()=>visual.frames);await page.evaluate(({cols,rows})=>visual.terminal.resize(cols,rows),{cols,rows});
      await page.waitForFunction(({cols,rows,frames})=>{const terminal=visual.terminal,buffer=terminal.buffer.active;
        return terminal.cols===cols&&terminal.rows===rows&&visual.frames>frames&&terminal.modes?.synchronizedOutputMode!==true
          &&['┐','╮','╗'].includes(buffer.getLine(buffer.viewportY+3)?.getCell(cols-1)?.getChars())
          &&['┘','╯','╝'].includes(buffer.getLine(buffer.viewportY+rows-3)?.getCell(cols-1)?.getChars());},{cols,rows,frames});await normal();}
    async function point(x,y){return page.evaluate(({x,y})=>{const rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(x+.5)*rect.width/visual.terminal.cols,y:rect.y+(y+.5)*rect.height/visual.terminal.rows};},{x,y});}
    async function stablePane(title,predicate,reason){let previous,count=0;return observe(async()=>{
      const value=await probe(title);if(!value||!predicate(value)){previous=undefined;count=0;return;}const signature=JSON.stringify([value.left,value.right,value.top,value.bottom,value.header,value.text]);
      if(signature!==previous){previous=signature;count=1;return;}if(++count<3)return;return value;
    },Boolean,reason);}
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
    async function parked(){await focus('session');await key('End');await key('Control+u');await paste(draft);await input(draft);await key('Home');await key('ArrowRight');await input(draft,1);}
    async function verifyDraft(id='session'){await focus(id);await paste('X');await input('RXENDER_PRIVATE_A😀窗_47',2);await key(composition==='selected'?'Backspace':'Control+z');await input(draft,1);}
    const sharedTrace=()=>records(launch.render.shared.trace),selectedTrace=async()=>launch.render.shared.selectedTrace?records(launch.render.shared.selectedTrace):[];
    const plugins=async()=>open('Plugins',(await layout()).registered.includes('plugin-extension-manager-extensions')?'Extensions':'Plugins');
    async function restart(){const generation=await page.evaluate(()=>visual.generation);ptyExit=undefined;await page.locator('#restart').click();await page.waitForFunction(generation=>visual.generation>generation&&visual.frames>0,generation);launch=await json(join(directory,'opentui-app-launch.json'));await normal();}
    async function configure(action){await focus(launch.render.ids.controls);await zoom(true);const count=(await trace()).filter(row=>row.event==='configured').length;
      await click('Render controls','Render '+action);const rows=await observe(trace,rows=>rows.filter(row=>row.event==='configured').length===count+1,'One real render command: '+action);
      const receipt=rows.findLast(row=>row.event==='configured');assert.equal(receipt.action,action);return receipt;}
    async function publicMode(action){const receipt=await configure(action);await focus(launch.render.ids.public);await zoom(true);return receipt;}
    async function release(rows){for(const row of rows)await writeFile(join(launch.render.gateDirectory,row.gate),'release\n');}
    async function releaseSuperseded(receipt){const rows=await trace(),finished=new Set(rows.filter(row=>row.event==='released').map(row=>row.id));
      const superseded=rows.filter(row=>row.event==='held'&&row.version<receipt.version&&!finished.has(row.id));await release(superseded);return superseded;}
    async function currentMarker(title,mode,version){return observe(()=>paneText(title),text=>text.includes('RENDER_'+mode.toUpperCase()+' v'+version),'Current public override: '+title+'/'+mode+'/'+version);}
    async function action(title,label,keyName,{keyboard=false,key:pressed='Enter'}={}){const before=(await trace()).filter(row=>row.event==='action'&&row.action===keyName).length;
      if(keyboard)await key(pressed);else await click(title,label);await observe(trace,rows=>rows.filter(row=>row.event==='action'&&row.action===keyName).length===before+1,'Exactly one public action: '+keyName);}
    async function reload(){await plugins();await zoom(true);const before=await layout(),count=(await trace()).filter(row=>row.event==='observed-reload').length;
      await click('Extensions','Apply plugin changes');const rows=await observe(trace,rows=>rows.filter(row=>row.event==='observed-reload').length>count,'Real reload lifecycle');
      const receipt=rows.findLast(row=>row.event==='observed-reload');await focus('session');await wait('Reloaded '+receipt.plugins.length+' plugins.');
      const after=await layout();for(const space of before.windows.spaces)assert.deepEqual(after.windows.spaces.find(value=>value.id===space.id)?.tree,space.tree);assert.deepEqual(after.views,before.views);
      return receipt;}

    await wait(composition==='selected'?'COPY CUSTOM INPUT':'Message Main…');launch=await json(join(directory,'opentui-app-launch.json'));
    assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);assert.equal(launch.render.composition,composition);
    assert.equal(await page.evaluate(()=>visual.terminal.unicode.activeVersion),'11');
    const first=launch.launches[0].command;assert.deepEqual(first.slice(-4,-1),['--renderer','opentui','--cwd']);assert.equal(await realpath(first.at(-1)),await realpath(launch.cwd));
    if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);result.executable={path:launch.executable,sha256:launch.sha256};
      const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');result.renderer={path:renderer,sha256:hash(await readFile(renderer))};}
    // A real old binary reaches this genuine missing-ui.render oracle before
    // any geometry acknowledgment that depends on the new two-row status.
    await page.evaluate(()=>visual.terminal.resize(180,50));await normal();await send('/theme amber');
    result.amberTheme=await observe(()=>json(launch.render.themeFile),value=>value==='amber','Actual bundled theme saves amber');
    await observe(trace,rows=>rows.some(row=>row.event==='appearance-published'&&row.input.plugin==='ui-theme'&&row.input.appearance?.colors?.accent==='#e5bd85'&&row.input.appearance.colors.selectionText==='#f3f7fa'),'Actual bundled theme publishes its appearance');
    await page.waitForFunction(()=>{const terminal=visual.terminal,buffer=terminal.buffer.active;
      return terminal.modes?.synchronizedOutputMode!==true&&buffer.getLine(buffer.viewportY+terminal.rows-2)?.translateToString(true,0,terminal.cols).includes('Ready · WS ')
        &&buffer.getLine(buffer.viewportY+terminal.rows-1)?.translateToString(true,1,terminal.cols-1).startsWith('amber · ');});
    assert.equal((await completions()).length,0);selection={fg:0xf3f7fa,bg:0x4a3b28};await capture('01-real-theme-status');
    await send('/theme mono');await wait('mono · ');selection={fg:0x101010,bg:0xb8b8b8};await send('/theme slate');
    await observe(()=>json(launch.render.themeFile),value=>value==='slate','Actual theme resets to slate');selection={fg:0x171a20,bg:0xa6dfd4};assert.equal((await completions()).length,0);

    let state=await publicMode('active');await currentMarker('Render public','active',state.version);await wait('Producer query');await absent('OVERRIDE_INPUT_MUST_NOT_APPEAR');
    await focus('session');await currentMarker('Main','active',state.version);await zoom(false);await arrange();await key('n');
    const copied=await observe(layout,value=>value.views.some(view=>view.kind==='session'),'Real Arrange n Main copy');const mainCopy=copied.views.find(view=>view.kind==='session');await leave();
    const firstPane=await observe(()=>probe('Main'),value=>value.text.includes('RENDER_ACTIVE'),'Canonical Main public view');
    const secondPane=await observe(()=>probe(mainCopy.title),value=>value.text.includes('RENDER_ACTIVE'),'Main copy public view');
    assert.notEqual(firstPane.right-firstPane.left,secondPane.right-secondPane.left,'Genuine copies must expose distinct drawable widths');
    const measurements=await observe(publicTrace,rows=>new Set(rows.filter(row=>row.input.site==='conversation').map(row=>row.input.viewport?.columns)).size>=2,'Per-pane public render measurements');
    assert.ok(measurements.every(row=>row.input.surface==='terminal'&&typeof row.input.props.pane==='string'&&Number.isInteger(row.input.viewport?.columns)&&row.input.viewport.columns>0&&Number.isInteger(row.input.viewport?.rows)&&row.input.viewport.rows>0));
    for(const id of ['session',mainCopy.id])assert.ok(measurements.some(row=>row.input.site==='conversation'&&row.input.props.pane===id),'Copy must be independently published: '+id);
    for(const[kind,label]of [['tools','New Tools window'],['help','New Help window']]){await open(label);const view=(await layout()).views.findLast(view=>view.kind===kind);await zoom(true);await currentMarker(view.title,'active',state.version);
      await action(view.title,kind==='tools'?'Tools public action':'Help public action',kind+'-action');await action(view.title,'',kind+'-action',{keyboard:true});
      assert.equal((await trace()).findLast(row=>row.event==='action').site,view.id,'Public copy action retains the original actual pane site');}
    const sites=new Set((await publicTrace()).map(row=>row.input.site));for(const site of ['conversation','tools','help','status','plugin:render-proof/public'])assert.ok(sites.has(site),'Advertised site missing: '+site);
    result.publicSites=[...sites];await focus(launch.render.ids.public);await zoom(true);await capture('02-public-sites-and-viewport');
    const producerProps=(await publicTrace()).findLast(row=>row.input.site==='plugin:render-proof/public').input.props;
    assert.ok(producerProps.lines.some(line=>line.text.startsWith('DEFAULT_PUBLIC')));assert.equal(producerProps.tabs[0].label,'Producer tab');assert.equal(producerProps.table.rows[0].cells[0],'Producer cell');assert.equal(producerProps.raster.alt,'PRODUCER_RASTER_ALT');
    if(composition==='native')check('Real bundled ui-theme renders amber/mono status without model work, and every advertised public site plus differently sized Main copies receives its actual terminal viewport');

    state=await publicMode('hold');await observe(trace,rows=>rows.some(row=>row.event==='held'&&row.version===state.version),'Render hook waits at an external gate');
    assert.ok((await paneText('Render public')).includes('DEFAULT_PUBLIC'),'A held first render leaves the actual producer default working');await capture('03-default-first');
    // An explicit invalidation fills a second slot even if the first native
    // frame already had its final geometry. Further work must remain coalesced.
    state=await publicMode('invalidate');assert.equal(state.mode,'hold');
    const twoHeld=await observe(trace,rows=>rows.filter(row=>row.event==='held').length===2,'Exactly two unresolved actual pane render calls');
    const initialGates=twoHeld.filter(row=>row.event==='held');assert.ok(initialGates.every(row=>row.viewport.columns===176));
    await resize(120,40);await focus(launch.render.ids.public);await zoom(true);
    const resized=await stablePane('Render public',value=>value.header.includes('focused')&&value.right-value.left+1===120&&value.bottom-value.top+1===35&&value.text.includes('DEFAULT_PUBLIC'),'Exact resized default remains visible behind the bounded render calls');
    assert.equal((await trace()).filter(row=>row.event==='held').length,2,'No third unresolved emission may start before capacity is released');
    const exactViewport={columns:resized.right-resized.left-3,rows:resized.bottom-resized.top-4};assert.deepEqual(exactViewport,{columns:116,rows:30});
    await release([initialGates[0]]);
    const latestHeld=await observe(trace,rows=>rows.some(row=>row.event==='held'&&!initialGates.some(old=>old.id===row.id)&&row.version===state.version&&row.viewport.columns===116&&row.viewport.rows===30),'One released obsolete call admits the exact latest resized render');
    const pending=latestHeld.filter(row=>row.event==='held'&&!latestHeld.some(done=>done.event==='released'&&done.id===row.id));assert.equal(pending.length,2);
    result.coalescing={initialUnresolved:2,resizedDefault:{columns:120,rows:40},exactViewport,afterOneReleaseUnresolved:pending.length};
    const held=state;state=await publicMode('active');const superseded=await releaseSuperseded(state);assert.ok(superseded.length>=1);await currentMarker('Render public','active',state.version);
    await observe(trace,rows=>superseded.every(old=>rows.some(row=>row.event==='released'&&row.id===old.id)),'Identified superseded hooks return after the new version is admitted');await currentMarker('Render public','active',state.version);assert.ok(!(await paneText('Render public')).includes('LATE_RENDER'));
    await resize(180,50);await focus(launch.render.ids.public);await zoom(true);
    state=await publicMode('invalid');await observe(trace,rows=>rows.some(row=>row.event==='render-start'&&row.version===state.version),'Invalid terminal tree is returned');
    await observe(()=>paneText('Render public'),text=>text.includes('DEFAULT_PUBLIC'),'Malformed final UiTextView keeps default');
    assert.ok(!(await trace()).some(row=>row.event==='tail'&&row.version===state.version),'Opaque invalid terminal tree must not be reclassified as downstream hook continuation');
    state=await publicMode('throw');await wait('TAIL_THROW v'+state.version);
    state=await publicMode('timeout');await currentMarker('Render public','timeout',state.version);await observe(trace,rows=>rows.some(row=>row.event==='timeout-late'),'Timed-out provider eventually returns');assert.ok(!(await paneText('Render public')).includes('TIMEOUT_LATE'));
    state=await publicMode('guard');await currentMarker('Render public','guard',state.version);const guarded=await observe(trace,rows=>rows.some(row=>row.event==='guarded'&&row.version===state.version),'Async read-only render guard');
    assert.deepEqual(guarded.findLast(row=>row.event==='guarded').blocked,{state:true,notify:true,tool:true,write:true});
    assert.ok(!(await readdir(launch.state)).includes('render-illegal'));assert.equal((await completions()).length,0);
    state=await publicMode('chain');await currentMarker('Render public','chain',state.version);const chain=await trace();const before=chain.findLastIndex(row=>row.event==='chain-before'),after=chain.findLastIndex(row=>row.event==='chain-after');
    assert.ok(before>=0&&after>before);assert.ok(chain.slice(before,after).some(row=>row.event==='render-start'&&row.mode==='chain'));
    const prior=state;state=await publicMode('invalidate');assert.equal(state.mode,'chain');assert.equal(state.version,prior.version+1);await currentMarker('Render public','chain',state.version);
    state=await publicMode('update');await currentMarker('Render public','chain',state.version);await capture('04-chain-invalidation-and-fallback');
    if(composition==='native')check('External gates prove default-first painting and stale-result rejection; opaque invalid final trees retain defaults, thrown/time-limited hooks follow the real chain, async effects stay forbidden, and invalidation/producer updates repaint without model calls');

    // The override introduces these actions; none exists in the producer tree.
    await action('Render public','Override action','override-action');await action('Render public','Public tab','override-tab');await wait('RENDER_RASTER_ALT_47 \\u001b[31m');await wait('RENDER_LITERAL_\\u001b[31m');
    for(let i=0;i<3&&!(await paneText('Render public')).includes('Override detail');i++)await key('PageDown');await observe(()=>paneText('Render public'),text=>text.includes('Override detail'),'Public semantic table details are reachable by actual scrolling');
    await action('Render public','Override detail','override-detail');
    assert.equal((await layout()).windows.focused,launch.render.ids.public);await action('Render public','Public tab','override-tab',{keyboard:true,key:'ArrowLeft'});await action('Render public','Public tab','override-tab',{keyboard:true});assert.equal((await layout()).windows.focused,launch.render.ids.public);
    assert.ok(!(await trace()).some(row=>row.event==='action'&&row.action==='disabled-tab'));
    await click('Render public','Producer query');await paste('PUBLIC_QUERY_47');await observe(trace,rows=>rows.some(row=>row.event==='producer-change'&&row.id==='producer-query'&&row.value==='PUBLIC_QUERY_47'),'Original producer input owns native changes');
    assert.ok(!(await trace()).some(row=>row.event==='producer-change'&&row.id==='must-not-replace-producer'));await absent('OVERRIDE_INPUT_MUST_NOT_APPEAR');
    await focus('session');await parked();await action('Main','Main public action','main-action');await input(draft,1);await verifyDraft(mainCopy.id);
    await resize(38,24);await input(draft,1);await capture('05-narrow-public-view-and-parked-input');await resize(180,50);
    if(composition==='native')check('Render-added rows/tabs/table details route through real pointer and keyboard input, disabled actions stay inert, raster uses its truthful terminal alt fallback, producer input stays native and Main public actions preserve its Unicode composer');
    else check('All public sites, default-first/chain/invalidation and semantic action/table/tab/raster routing work with the configured custom editor without replacing the producer field or taking editor keys');

    await configure('plain');await send('APP_RENDER_PUBLIC');await wait('RENDER_PUBLIC_DONE');assert.equal((await completions()).length,2);
    await send('APP_COPY_QUESTION');await wait(composition==='selected'?'CUSTOM QUESTION':'MAIN_QUESTION: choose deployment');
    if(composition==='native'){await key('Alt+i');await key('ArrowDown');await key('Space');await wait('[x] Production');await key('Alt+i');}
    else{await key('Alt+i');await key('Home');await key('ArrowRight');await paste('X');await wait('Value: QX|value');await key('Backspace');await key('Alt+i');}
    await parked();const editorCount=(await sharedTrace()).filter(row=>row.event==='editor-created').length,questionCount=(await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='question').length;
    await configure('active');await focus(launch.render.ids.controls);await click('Render controls','Render private-tool');
    await observe(trace,rows=>rows.some(row=>row.event==='private-tool-result'&&row.hasExpected),'Independent actual UI tool returns while Main waits');
    await focus('plugin-copy-request-probe-controls');await click('Copy controls','Open private form');const formTitle=composition==='selected'?'Form · copy-request-probe':'Copy private form';await open(formTitle);await zoom(true);
    if(composition==='selected'){await wait('CUSTOM PRIVATE FORM');await key('Home');await key('ArrowRight');await paste('X');await wait('Name: FX|ORMvalue');await key('Backspace');await key('Tab');}
    else{await wait('FORMvalue');await key('Home');await key('ArrowRight');await paste('X');await wait('FXORMvalue');await key('Backspace');await key('Tab');}
    await paste(token);await wait('*'.repeat(token.length));await capture('06-private-form-publication-boundary');await arrange();await key('q');await leave();
    await configure('invalidate');await verifyDraft(mainCopy.id);await open(formTitle);await zoom(true);await wait('*'.repeat(token.length));
    if(composition==='selected'){await wait('Name: F|ORMvalue');await key('F5');}else await key('Alt+Enter');
    const formRows=await observe(sharedTrace,rows=>rows.some(row=>row.event==='form-result'),'Private form caller settles');assert.deepEqual(formRows.findLast(row=>row.event==='form-result').result,{action:'save',name:'FORMvalue',tokenLength:token.length,tokenHash:hash(token)});
    const propsBeforeAnswer=await readFile(launch.render.publicTrace,'utf8');
    for(const secret of ['MAIN_QUESTION','choose deployment','Qvalue','QXvalue','Preview','Production',draft,token,'FORMvalue','FXORMvalue',launch.render.privatePath,launch.render.privateOutput])assert.ok(!propsBeforeAnswer.includes(secret),'Pending private request data reached public render props: '+secret);
    await configure('plain');await focus('session');await zoom(true);await key('Alt+i');if(composition==='selected')await key('F4');else await key('Alt+Enter');await wait('COPY_ANSWER_RECEIVED: Production');await verifyDraft(mainCopy.id);assert.equal((await completions()).length,4);
    assert.equal((await sharedTrace()).filter(row=>row.event==='editor-created').length,editorCount);assert.equal((await selectedTrace()).filter(row=>row.event==='created'&&row.kind==='question').length,questionCount);
    if(composition==='selected'){const rows=await selectedTrace();assert.equal(rows.filter(row=>row.event==='input'&&row.kind==='form'&&row.key==='f5').length,1);assert.equal(rows.filter(row=>row.event==='input'&&row.kind==='question'&&row.key==='f4').length,1);}
    const propsBeforeLifecycle=await readFile(launch.render.publicTrace,'utf8');for(const secret of [draft,token,'FORMvalue','FXORMvalue',launch.render.privatePath,launch.render.privateOutput,'MAIN_QUESTION','choose deployment','Qvalue','QXvalue'])assert.ok(!propsBeforeLifecycle.includes(secret),'Private data reached public render props: '+secret);
    check(composition==='native'?'A held Main answer, native Unicode cursor/undo and an independently hidden private form retain ownership; private UI-tool arguments/output and request/default/answer fields never enter any public render props':
      'One selected editor/question/form lease survives public override updates and hide/reopen, masked values remain private, and only each explicit caller callback settles once');

    // Use the real service and manager reload. The old promise is released only
    // after its owner was unloaded, then the same plugin is freshly enabled.
    state=await publicMode('hold');const unloadHold=state;await observe(trace,rows=>rows.some(row=>row.event==='held'&&row.version===state.version),'Pre-unload render is held');
    await focus(launch.render.ids.controls);await click('Render controls','Render disable-render');await observe(trace,rows=>rows.some(row=>row.event==='extension-result'&&row.action==='disable'),'Canonical extension disable finishes');
    const disabled=await reload();assert.ok(!disabled.plugins.includes(launch.render.painter));await release((await trace()).filter(row=>row.event==='held'&&row.version===unloadHold.version));
    await observe(trace,rows=>rows.some(row=>row.event==='released'&&row.version===unloadHold.version),'Unloaded render returns without repaint');await focus('session');await input(draft,1);assert.ok(!(await screen()).includes('LATE_RENDER'));
    // The observer owns a separate lifecycle command and survives producer unload.
    await focus(launch.render.ids.lifecycle);await click('Render lifecycle','Enable render provider');await observe(trace,rows=>rows.some(row=>row.event==='observer-enable'),'Separate loaded owner enables the provider');
    const enabled=await reload();assert.ok(enabled.plugins.includes(launch.render.painter));state=await publicMode('active');await releaseSuperseded(state);await currentMarker('Render public','active',state.version);await verifyDraft('session');
    await send('/theme amber');selection={fg:0xf3f7fa,bg:0x4a3b28};await wait('amber · ');await parked();await capture('07-reloaded-render-and-checkpoint');
    // Fork/resume uses the regular session-control service, not seeded journals.
    await focus('plugin-copy-request-probe-controls');await click('Copy controls','Fork current conversation');await observe(sharedTrace,rows=>rows.some(row=>row.event==='fork-result'&&row.result?.value?.id),'Actual current-context fork');
    const oldSession=(await json(launch.render.shared.active)).id;state=await publicMode('hold');const resumeHold=state;await observe(trace,rows=>rows.some(row=>row.event==='held'&&row.version===state.version),'Pre-resume render is held');
    const resumeGates=(await trace()).filter(row=>row.event==='held'&&row.version===resumeHold.version);assert.ok(resumeGates.every(row=>row.sessionId===oldSession));
    await focus('plugin-copy-request-probe-controls');await click('Copy controls','Resume fork');await observe(()=>json(launch.render.shared.active),value=>value.id!==oldSession,'Actual Core replacement resumes the fork');
    await release(resumeGates);await observe(trace,rows=>rows.some(row=>row.event==='released'&&resumeGates.some(old=>old.id===row.id)),'Old Core render returns');
    state=await configure('active');await focus(launch.render.ids.public);await zoom(true);await releaseSuperseded(state);await currentMarker('Render public','active',state.version);assert.ok(!(await screen()).includes('LATE_RENDER'));await focus('session');await input(draft,1);
    await focus(mainCopy.id);await arrange();await key('q');await leave();assert.ok(!(await layout()).windows.spaces.some(space=>leaves(space.tree).includes(mainCopy.id)));assert.ok((await layout()).views.some(view=>view.id===mainCopy.id));await focus('session');
    const remainingGates=(await trace()).filter(row=>row.event==='held');await release(remainingGates);
    await observe(trace,rows=>remainingGates.every(held=>rows.some(row=>row.event==='released'&&row.id===held.id)),'Every owned external render gate is released before process restart');
    const beforeRestart=await layout(),activeBefore=await json(launch.render.shared.active);await restart();await observe(layout,value=>JSON.stringify(value.windows)===JSON.stringify(beforeRestart.windows),'Restart restores exact windows, ratios, focus and closed IDs');assert.deepEqual((await layout()).views,beforeRestart.views);assert.equal((await json(launch.render.shared.active)).id,activeBefore.id);
    await focus('session');await wait('amber · ');await configure('plain');await send('APP_RENDER_RESTORED');await wait('RENDER_RESTORED: retained');assert.equal((await completions()).length,5);await capture('08-restarted-public-render');
    const http=JSON.stringify((await completions()).map(row=>row.body)),journals=(await Promise.all((await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')).map(name=>readFile(join(launch.state,'sessions',name),'utf8')))).join('\n');
    const publicEvents=await readFile(launch.render.publicTrace,'utf8'),terminal=await readFile(join(directory,'terminal.ansi'),'utf8');
    for(const[value,label]of [[http,'HTTP'],[journals,'journals'],[publicEvents,'public render props']])for(const secret of [draft,token,'FORMvalue','FXORMvalue'])assert.ok(!value.includes(secret),'Private value leaked to '+label);
    for(const secret of [launch.render.privatePath,launch.render.privateOutput]){assert.ok(!http.includes(secret));assert.ok(!publicEvents.includes(secret));}
    assert.ok(!terminal.includes(token));assert.ok(!/MaxListenersExceededWarning/.test(terminal));result.privacy={privateToken:true,parkedDraftAndForm:true,uiToolPublicBoundary:true,uiOperationJournalAuditNotForbidden:true,inputLogExcluded:true};
    assert.deepEqual(launch.launches.map(row=>row.command[row.command.indexOf('--renderer')+1]),['opentui','opentui']);
    check(composition==='native'?'Actual unload/re-enable, reload, fork/Core resume and process restart fence old render promises, retain draft/checkpoint and exact layout/history, and restore the bundled theme without expanding public data':
      'Selected checkpoints survive destructive reload and Core replacement; old render results cannot cross generations, actual restart restores exact views/tree/theme and committed context');
    await focus('session');await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI exits cleanly');result.ptyExitCode=ptyExit;assert.deepEqual(result.errors,[]);result.ok=true;
  }catch(error){result.errors.push(error instanceof Error?error.stack:String(error));if(page){
    result.nativeFailure=await page.evaluate(()=>({cols:visual.terminal.cols,rows:visual.terminal.rows,synchronizedOutput:visual.terminal.modes?.synchronizedOutputMode})).catch(()=>undefined);
    await writeFile(join(directory,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});}}
  finally{
    if(launch)try{
      for(const row of await readFile(launch.render.trace,'utf8').then(value=>value.trim().split('\n').filter(Boolean).map(JSON.parse)))if(row.event==='held')await writeFile(join(launch.render.gateDirectory,row.gate),'cleanup\n');
      for(const file of Object.values(launch.render.shared.gates))await writeFile(file,'cleanup\n');
      await copyFile(launch.render.trace,join(directory,'fixture-trace.jsonl'));await copyFile(launch.render.publicTrace,join(directory,'public-render-events.jsonl'));await copyFile(launch.render.shared.trace,join(directory,'shared-trace.jsonl'));
      await copyFile(launch.render.themeFile,join(directory,'saved-theme.json'));
      if(launch.render.shared.selectedTrace)await copyFile(launch.render.shared.selectedTrace,join(directory,'selected-trace.jsonl'));
      for(const name of (await readdir(join(launch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')))await copyFile(join(launch.state,'sessions',name),join(directory,'session-'+name));
      await writeFile(join(directory,'final-layout.json'),JSON.stringify(await json(join(launch.state,'layout.json')),null,2));
    }catch(error){result.errors.push('Could not preserve public render diagnostics: '+error);}
    await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}
    await writeFile(join(directory,'report.json'),JSON.stringify(result,null,2)+'\n');report.checks.push(...result.checks);report.screenshots.push(...result.screenshots.map(name=>composition+'/'+name));report.errors.push(...result.errors);
  }
  if(!result.ok)break;
}
report.ok=report.checks.length===8&&report.errors.length===0;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
