import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {createOpenTuiFinder} from './opentui-finder.mjs';
import {completeJsonLines} from './jsonl.mjs';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-child'),timeout=20_000;
const draft='CHILD_MAIN_DRAFT_😀窗_47',secret='SYNTHETIC_CHILD_TOKEN_47',note='PRIVATE_CHILD_NOTE_47',hash=value=>createHash('sha256').update(value).digest('hex');
const nativeCases=[
 'Canonical task child questions/questionnaire and nested delegation have distinct private panes with exact request/source/direct-parent/tool labels, instead of borrowing Main input',
 'Five same-alias child questions coexist with a held Main question, its exact Unicode draft and an independent settings operation; hiding/cancelling one child never answers its siblings or Main',
 'Sibling write approvals stay source-bound: hidden keys have no effect, one allow writes only its own exact file once, and one deny produces no file',
 'A real child private form masks its token, retains its request on close/reopen and gives only its own caller the exact private result',
 'Background/detached launchers settle independently; Main Core resume revokes its old delegated requests and application close cancels its final child',
 'A managed pending request survives Main resume, later requests use committed channels, managed form/nested-child labels stay correct and manager/application close revoke remaining forms',
];
const selectedCases=[
 'Canonical task children bind question/questionnaire/approval/form frames to the original selected child factories and preserve independent source leases',
 'Selected same-alias siblings retain hidden/reopened state and cancel independently; Main provider disable/reload preserves the original detached child source lease and handler until its own lifecycle ends',
 'Selected nested delegation retains direct-parent labels and private boundaries; actual Core replacement and shutdown fence old request generations while Main retains its draft',
 'Managed selected requests retain their exact lease across Main resume, later forms/nested children use committed channels, and manager/application close cancels remaining private forms',
];
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[],compositions:{},grading:{native:6,selected:4,total:10}};
const json=path=>readFile(path,'utf8').then(JSON.parse),records=path=>readFile(path,'utf8').then(completeJsonLines);
async function observe(read,predicate,reason){const end=Date.now()+timeout;let value;while(Date.now()<end){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}throw Error(reason+'; latest='+JSON.stringify(value));}
function focusedPane(){
 const terminal=visual.terminal,buffer=terminal.buffer.active;if(terminal.modes?.synchronizedOutputMode)return;
 const rows=Array.from({length:terminal.rows},(_,y)=>Array.from({length:terminal.cols},(_,x)=>buffer.getLine(buffer.viewportY+y)?.getCell(x)?.getChars()??''));
 const pairs={'┌':['┐','└','┘'],'╭':['╮','╰','╯'],'╔':['╗','╚','╝']};
 for(let top=0;top<rows.length;top++){const header=rows[top].join('');if(!header.includes(' · focused '))continue;
  const left=rows[top].findIndex(ch=>pairs[ch]);if(left<0)continue;const ends=pairs[rows[top][left]],right=rows[top].findIndex((ch,x)=>x>left&&ch===ends[0]);if(right<0)continue;
  const bottom=rows.findIndex((row,y)=>y>top&&row[left]===ends[1]&&row[right]===ends[2]);if(bottom<0)continue;
  return{left,right,top,bottom,title:rows[top].slice(left+1,right).join('').replace(/^─ /,'').split(' · focused ')[0],text:rows.slice(top+1,bottom).map(row=>row.slice(left+1,right).join('').trimEnd()).join('\n')};
 }
}
function finderRows({query,count}){
 const terminal=visual.terminal,buffer=terminal.buffer.active;if(terminal.modes?.synchronizedOutputMode)return;
 const chars=y=>Array.from({length:terminal.cols},(_,x)=>buffer.getLine(buffer.viewportY+y)?.getCell(x)?.getChars()??'');
 for(let top=0;top<terminal.rows-4;top++){
  const row=chars(top);if(!row.join('').includes('─ Windows '))continue;const left=row.lastIndexOf('┌'),right=row.indexOf('┐',left);if(left<0||right<0)continue;
  const text=y=>chars(y).slice(left+1,right).join('').trim();if(text(top+1)!==query||text(top+2)!==count+' windows · ↑↓ select · Enter open')return;
  const entries=[];for(let y=top+3;y<terminal.rows;y++){
   const line=chars(y);if(line[left]==='└')break;const value=text(y);if(!value||value.startsWith('Esc cancel')||value==='No matching windows')continue;
   const label=value.replace(/\s{2,}(?:WS [1-9]|Closed|Available|Unavailable)$/,'');const x=line.findIndex((ch,x)=>x>left&&x<right&&ch&&ch!==' '),cell=buffer.getLine(buffer.viewportY+y)?.getCell(x);
   entries.push({label,row:y,selected:cell?.getBgColor()===0xa6dfd4&&cell?.getFgColor()===0x171a20&&Boolean(cell?.isBold())});
  }
  if(entries.length!==count)return;return entries;
 }
}

await mkdir(output,{recursive:true});
for(const composition of ['native','selected']){
 const directory=join(output,composition),descriptions=composition==='native'?nativeCases:selectedCases,passed=new Set(),result={ok:false,checks:[],screenshots:[],errors:[]};report.compositions[composition]=result;await mkdir(directory,{recursive:true});
 let server,serverExit,browser,page,launch,ptyExit;
 try{
  const runtime=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtime,VISUAL_OPENTUI_APP:'1',VISUAL_OPENTUI_CHILD:'1',VISUAL_OPENTUI_CHILD_COMPOSITION:composition,VISUAL_OUTPUT:directory,AGENT_GRAPHICS:'off',...(process.env.VISUAL_EXECUTABLE?{VISUAL_EXECUTABLE:resolve(process.env.VISUAL_EXECUTABLE)}:{})},stdio:['ignore','pipe','inherit']});
  serverExit=new Promise(done=>server.once('close',done));
  const url=await new Promise((done,fail)=>{let value='';const timer=setTimeout(()=>fail(Error('Child bench startup timed out')),30_000);server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Child bench exited '+code));});server.stdout.on('data',chunk=>{value+=chunk;const match=value.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1850,height:1250}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>result.errors.push(error.message));
  const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);socket.on('framereceived',({payload})=>{try{const message=JSON.parse(String(payload));if(message.type==='exit')ptyExit=message.code;}catch{}});
  const key=value=>page.keyboard.press(value),screen=()=>page.evaluate(()=>visual.text());
  const wait=text=>page.waitForFunction(text=>!visual.terminal.modes?.synchronizedOutputMode&&visual.text().includes(text),text),absent=text=>page.waitForFunction(text=>!visual.text().includes(text),text);
  const paste=text=>page.evaluate(text=>socket.send(JSON.stringify({type:'input',data:'\x1b[200~'+text+'\x1b[201~'})),text);
  const finder=createOpenTuiFinder({page,key,wait,absent}),normal=()=>finder.normal();
  const pane=()=>page.evaluate(focusedPane),trace=()=>records(launch.child.trace),http=()=>records(join(directory,'app-http.jsonl'));
  const captures=[];let pointerAttempt=0;
  async function capture(name){
   await page.evaluate(()=>new Promise(done=>{const sub=visual.terminal.onRender(()=>{sub.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
   const before=await page.evaluate(()=>({frames:visual.frames,text:visual.text()}));await page.locator('#terminal').screenshot({path:join(directory,name+'.png')});
   const after=await page.evaluate(()=>({frames:visual.frames,text:visual.text()})),stable=before.frames===after.frames&&before.text===after.text;
   await writeFile(join(directory,name+'.capture.json'),JSON.stringify({before,after,stable},null,2)+'\n');await writeFile(join(directory,name+'.txt'),after.text);assert.equal(stable,true,'Capture must retain one actual frame: '+name);
   result.screenshots.push(name+'.png');captures.push({name,pane:await pane(),sha256:hash(await readFile(join(directory,name+'.png')))});
  }
  async function zoom(){await normal();await key('Alt+w');await wait('WINDOW MODE');if(!(await screen()).includes('WINDOW MODE · Zoomed'))await key('f');await wait('WINDOW MODE · Zoomed');await key('Escape');await normal();}
  async function main(){await key('Alt+0');await normal();await zoom();await observe(pane,value=>value?.title==='Main','Actual focused Main');}
  async function send(text){await main();await key('End');await key('Control+u');await paste(text);await wait(text);await key('Enter');}
  async function click(label){const attempt=++pointerAttempt,focused=await observe(pane,value=>Boolean(value?.title),'Focused actual pane before pointer');
   const point=await page.waitForFunction(({label,focused,attempt})=>{
    const terminal=visual.terminal,buffer=terminal.buffer.active;if(terminal.modes?.synchronizedOutputMode){delete window.__childPointer;return;}
    const header=buffer.getLine(buffer.viewportY+focused.top)?.translateToString(true)??'';if(!header.includes(' · focused ')||!header.includes(focused.title)){delete window.__childPointer;return;}
    for(let y=focused.top+1;y<focused.bottom;y++){
     const cells=Array.from({length:terminal.cols},(_,x)=>buffer.getLine(buffer.viewportY+y)?.getCell(x)?.getChars()??''),text=cells.slice(focused.left+1,focused.right).join(''),offset=text.indexOf(label);if(offset<0)continue;
     let chars='',x=focused.left+1;while(x<focused.right&&chars.length<offset)chars+=cells[x++];
     const rect=document.querySelector('.xterm-screen').getBoundingClientRect(),signature=JSON.stringify([visual.frames,visual.text(),header,focused,x,y,terminal.cols,terminal.rows,rect.x,rect.y,rect.width,rect.height]),previous=window.__childPointer;
     if(previous?.attempt!==attempt||previous.signature!==signature){window.__childPointer={attempt,signature,count:1};return;}
     if(++previous.count<3)return;return{x:rect.x+(x+.5)*rect.width/terminal.cols,y:rect.y+(y+.5)*rect.height/terminal.rows};
    }delete window.__childPointer;
   },{label,focused,attempt},{polling:'raf'});const value=await point.jsonValue();await page.mouse.click(value.x,value.y);
  }
  async function controls(action,label){await finder.pick('Child controls');await zoom();const before=(await trace()).filter(row=>row.event==='control').length;await click(label);await observe(trace,rows=>rows.filter(row=>row.event==='control').length>before&&rows.findLast(row=>row.event==='control').action===action,'Actual child control '+action);}
  async function entries(query,count){await normal();await key('F2');await wait(finder.marker);await page.keyboard.type(query);return(await page.waitForFunction(finderRows,{query,count})).jsonValue();}
  async function choose(query,count=1,index=0){const rows=await entries(query,count);assert.ok(rows[index]);
   const selected=rows.findIndex(row=>row.selected);if(selected<0)await key('ArrowDown');for(let i=Math.max(0,selected);i<index;i++)await key('ArrowDown');for(let i=selected;i>index;i--)await key('ArrowUp');
   await observe(()=>page.evaluate(finderRows,{query,count}),entries=>entries[index]?.selected===true,'Exact actual Finder selection');
   // Read the actual palette again; one Enter opens only the selected visible row.
   const selectedRows=await page.evaluate(finderRows,{query,count});assert.equal(selectedRows[index].selected,true);const prefix=selectedRows[index].label.match(/^(?:Questions|Form|Approval) #[0-9]+/)?.[0];assert.ok(prefix,'Actual selected private request ordinal');await key('Enter');await absent(finder.marker);await normal();await zoom();
   return observe(pane,value=>value?.title.startsWith(prefix+' · '),'Actual focused selected child request '+prefix);}
  async function closePane(){await key('Alt+w');await wait('WINDOW MODE');await key('q');await key('Escape');await normal();}
  function source(title,kind,tool,parent='Main'){
   assert.match(title,new RegExp('^'+kind+' #[0-9]+ · Agent #[0-9]+ '));assert.ok(title.includes(' · Parent '+parent),title);if(tool)assert.ok(title.includes(' · via '+tool),title);
   return title.match(new RegExp('^'+kind+' #[0-9]+'))[0];
  }
  async function question(){const title=(await pane()).title;if(composition==='selected')await key('F4');else{await click('[ ] Remote');await wait('[x] Remote');await key('Alt+Enter');}await absent(title);}
  async function mainAnswer(){await main();await key('Alt+i');if(composition==='selected')await key('F4');else{await click('[ ] Production');await wait('[x] Production');await key('Alt+Enter');}await wait('CHILD_FLOW_DONE APP_CHILD_MAIN_HOLD');}
  async function retained(){await main();await wait(draft);await key('Home');await key('ArrowRight');await page.keyboard.type('X');await wait('CXHILD_MAIN_DRAFT_😀窗_47');await key('Control+z');await wait(draft);}
  async function doneTask(prompt){await wait('CHILD_FLOW_DONE '+prompt);}
  async function canonical(kind){const prompt='APP_CHILD_TASK_'+kind,before=(await http()).filter(row=>row.kind==='completion').length;await send(prompt);
   await observe(trace,rows=>rows.some(row=>row.event==='producer-prompt'&&row.tag==='CHILD_'+kind),'Actual canonical task child Core prompt');
   if(kind!=='FORM')await observe(http,rows=>rows.some(row=>row.kind==='completion'&&row.body.messages?.filter(message=>message.role==='user').at(-1)?.content==='CHILD_'+kind),'Actual canonical task child provider request');
   const request=await choose(kind==='APPROVAL_0'?'Approval #':kind==='FORM'?'Form #':'Questions #');
   if(kind==='NESTED_Q'){const rows=await trace(),outer=rows.find(row=>row.event==='subagent-start'&&row.prompt==='CHILD_NESTED_Q'),producer=rows.find(row=>row.event==='producer-prompt'&&row.tag==='CHILD_NESTED_Q'),leaf=rows.find(row=>row.event==='subagent-start'&&row.prompt==='CHILD_LEAF_Q');assert.ok(outer&&producer&&leaf);assert.equal(leaf.parentSession,producer.sessionId);assert.ok(request.title.includes(' '+outer.agentId+' · via ask_user'));assert.match(request.title,/ · Parent Agent #[0-9]+ /);}else source(request.title,kind==='APPROVAL_0'?'Approval':kind==='FORM'?'Form':'Questions',kind==='APPROVAL_0'?'write':kind==='FORM'?undefined:kind==='QNAIRE'?'ask_questions':'ask_user');
   if(kind==='NESTED_Q')await capture('01-canonical-child-source');
   if(kind==='APPROVAL_0'){if(composition==='selected')await key('F3');else await click('Deny');}
   else if(kind==='FORM')await fillForm(false);
   else if(kind==='QNAIRE'){if(composition==='selected')await key('F4');else{await click('[ ] Unit');await click('[ ] Browser');await key('Tab');await paste('Load tests');await key('Alt+Enter');}}
   else await question();await main();await doneTask(prompt);assert.equal((await http()).filter(row=>row.kind==='completion').length-before,kind==='NESTED_Q'?6:kind==='FORM'?2:4,'Exact canonical task/child model calls');return request;
  }
  async function fillForm(reopen=true){
   const before=(await trace()).filter(row=>row.event==='private-form-result').length,current=await pane(),prefix=current.title.match(/^Form #[0-9]+/)?.[0];assert.ok(prefix,'Private child form title');
   if(composition==='selected'){await wait('CUSTOM PRIVATE FORM');await paste(note);await wait('Name: '+note+'|');await key('Tab');}
   else{await wait('Private name');await paste(note);await wait(note);await key('Tab');}
   await paste(secret);await wait('*'.repeat(secret.length));assert.ok(!(await screen()).includes(secret));
   if(reopen){await closePane();await main();await wait(draft);await choose(prefix);await wait('*'.repeat(secret.length));await wait(note);}
   if(reopen)await capture('04-child-private-form-boundary');
   await key(composition==='selected'?'F5':'Alt+Enter');await observe(trace,rows=>rows.filter(row=>row.event==='private-form-result').slice(before).some(row=>row.value?.action==='save'&&row.value?.name===note&&row.value?.tokenLength===secret.length&&row.value?.tokenHash===hash(secret)),'Exact private form caller receipt');
  }
  await wait('Message Main…');launch=await json(join(directory,'opentui-app-launch.json'));assert.ok(launch.child);assert.equal(launch.providerOverride,false);assert.equal(launch.environmentProviderOverride,false);const cli=launch.launches[0].command.slice(-4);assert.deepEqual(cli.slice(0,3),['--renderer','opentui','--cwd']);assert.equal(await realpath(cli[3]),await realpath(launch.cwd));assert.equal(new URL(launch.baseUrl).hostname,'127.0.0.1');result.launch={cwd:launch.cwd,state:launch.state,baseUrl:launch.baseUrl,mode:launch.mode,providerOverride:false,environmentProviderOverride:false};
  if(launch.executable){assert.equal(hash(await readFile(launch.executable)),launch.sha256);result.executable={path:launch.executable,sha256:launch.sha256};const renderer=join(dirname(launch.executable),'node_modules/@agent-compositor/renderer-opentui/index.js');result.renderer={path:renderer,sha256:hash(await readFile(renderer))};}
  await page.evaluate(()=>visual.terminal.resize(180,50));await page.waitForFunction(()=>{
   const terminal=visual.terminal,buffer=terminal.buffer.active;
   return terminal.cols===180&&terminal.rows===50&&terminal.modes?.synchronizedOutputMode!==true
    &&buffer.getLine(buffer.viewportY+3)?.getCell(179)?.getChars()==='┐'
    &&buffer.getLine(buffer.viewportY+47)?.getCell(179)?.getChars()==='┘'
    &&/(?:Ready|Working|Approval needed|Answer needed) · WS [1-9]/.test(buffer.getLine(buffer.viewportY+48)?.translateToString(true,0,180)??'');
  });await normal();await main();

  await canonical('Q');await canonical('QNAIRE');await canonical('NESTED_Q');
  if(composition==='selected'){await canonical('APPROVAL_0');await canonical('FORM');}
  passed.add(0);

  await send('APP_CHILD_MAIN_HOLD');await wait('Main · Question');await paste(draft);await wait(draft);
  await controls('spawn-five','Start five sibling questions');await observe(trace,rows=>rows.filter(row=>row.event==='producer-prompt'&&row.tag.startsWith('CHILD_SIBLING_Q_')).length===5,'Five actual sibling Core prompts');
  const siblings=await entries('same-alias',5);assert.equal(new Set(siblings.map(row=>row.label.match(/Agent #[0-9]+/)?.[0])).size,5);await key('Escape');await normal();
  await controls('settings','Open independent settings');await finder.pick(composition==='selected'?'Form · child-proof':'Independent child settings');await zoom();await key(composition==='selected'?'F5':'Alt+Enter');await observe(trace,rows=>rows.some(row=>row.event==='settings-result'&&row.value?.values.name==='SETTINGS_OK'),'Settings remains usable beyond four child requests');
  await retained();await capture('02-five-siblings-main-and-settings');let selected=await choose('same-alias',5);const first=source(selected.title,'Questions','ask_user'),cancelTag=selected.text.match(/CHILD_PRIVATE_QUESTION CHILD_(SIBLING_Q_[0-4])/)?.[1];assert.ok(cancelTag,'Focused original question identifies its actual caller');await closePane();await retained();await choose(first);await key('Control+c');
  await observe(trace,rows=>rows.filter(row=>row.event==='child-result'&&row.tag.startsWith('SIBLING_Q_')).length===1,'Only one sibling cancelled');assert.equal((await trace()).find(row=>row.event==='child-result'&&row.tag.startsWith('SIBLING_Q_')).tag,cancelTag,'Only the explicitly focused sibling returns');
  for(let remaining=4;remaining>0;remaining--){await choose('same-alias',remaining);await question();await observe(trace,rows=>rows.filter(row=>row.event==='child-result'&&row.tag.startsWith('SIBLING_Q_')).length===6-remaining,'Exact sibling completion count');}
  await retained();await mainAnswer();
  if(composition==='native')passed.add(1);

  const beforeApprovals=(await trace()).length;await controls('spawn-approvals','Start two sibling approvals');await observe(trace,rows=>rows.slice(beforeApprovals).filter(row=>row.event==='producer-prompt'&&row.tag.startsWith('CHILD_APPROVAL_')).length===2,'Two actual approval producer prompts');
  await main();await key(composition==='selected'?'F5':'Alt+y');assert.equal(await readFile(launch.child.effects.allow).then(()=>true,()=>false),false);assert.equal(await readFile(launch.child.effects.deny).then(()=>true,()=>false),false);
  const approval=await choose('same-alias',2);source(approval.title,'Approval','write');const content=await pane();let effectPath;
  if(composition==='selected'){
   const id=content.text.match(/Lease: ([^\s]+)/)?.[1];assert.ok(id);const bound=await observe(()=>records(launch.child.selectedTrace),rows=>rows.some(row=>row.event==='child-factory-bound'&&row.id===id),'Original selected approval data binding');
   effectPath=bound.find(row=>row.event==='child-factory-bound'&&row.id===id).path;
  }else effectPath=content.text.match(/^[│ ]*Path: (.+?) *│?$/m)?.[1];
  assert.ok([launch.child.effects.allow,launch.child.effects.deny].includes(effectPath),'Exact current absolute approval effect target');const index=effectPath===launch.child.effects.deny?1:0;await capture('03-exact-sibling-approval-effects');
  if(composition==='selected')await key(index===0?'F5':'F3');else await click(index===0?'Allow once':'Deny');
  await choose('same-alias',1);if(composition==='selected')await key(index===0?'F3':'F5');else await click(index===0?'Deny':'Allow once');
  await observe(trace,rows=>rows.filter(row=>row.event==='child-result'&&row.tag.startsWith('APPROVAL_')).length===2,'Approval siblings finish independently');assert.equal(await readFile(launch.child.effects.allow,'utf8'),'CHILD_EFFECT_0\n');assert.equal(await readFile(launch.child.effects.deny).then(()=>true,()=>false),false);
  if(composition==='native')passed.add(2);

  await controls('spawn-form','Start child private form');await choose('Form #');await fillForm();await observe(trace,rows=>rows.some(row=>row.event==='child-result'&&row.tag==='FORM_0'),'Child form returns to its exact caller');await main();if(composition==='native')passed.add(3);

  if(composition==='selected'){
   await controls('detached','Start detached child');await observe(trace,rows=>rows.some(row=>row.event==='launcher-settled'&&row.mode==='detached'),'Detached launcher settles');
   const child=await choose('same-alias',1);await wait('CUSTOM QUESTION');const prefix=child.title.match(/^Questions #[0-9]+/)[0],lease=child.text.match(/Lease: ([^\s]+)/)?.[1];assert.ok(lease);
   await page.keyboard.type('R');await wait('Value: QvalueR|');
   await controls('disable-selected','Disable selected owner');await observe(trace,rows=>rows.some(row=>row.event==='extension-result'&&row.action==='disable-selected'&&row.result?.ok),'Normal extension disable completes');
   await send('/reload');await observe(trace,rows=>rows.some(row=>row.event==='main-reloaded'),'Normal owner reload starts');await main();
   const disabledNotice=await observe(pane,value=>Boolean(value?.text.match(/Reloaded ([0-9]+) plugins\./)),'Actual completed Main reload notice');const disabledCount=Number(disabledNotice.text.match(/Reloaded ([0-9]+) plugins\./)[1]);
   await choose(prefix);await wait('Value: QvalueR|');assert.ok((await pane()).text.includes('Lease: '+lease));assert.equal((await records(launch.child.selectedTrace)).filter(row=>row.event==='created'&&row.id===lease).length,1);await key('F4');
   await observe(()=>records(launch.child.selectedTrace),rows=>rows.some(row=>row.event==='disposed'&&row.id===lease),'Original detached selected source disposes after its own answer');
   await controls('enable-selected','Enable selected owner');await send('/reload');await observe(trace,rows=>rows.filter(row=>row.event==='main-reloaded').length===2,'Normal owner re-enable reload starts');await main();await wait('Reloaded '+(disabledCount+1)+' plugins.');await paste(draft);await wait(draft);passed.add(1);
  }
  for(const mode of ['background','detached']){
   const before=(await trace()).length;await controls(mode,mode==='background'?'Start background child':'Start detached child');await observe(trace,rows=>rows.slice(before).some(row=>row.event==='launcher-settled'&&row.mode===mode),'Independent launcher '+mode);
   await choose('Questions #',1);await question();await observe(trace,rows=>rows.slice(before).some(row=>row.event==='child-result'&&row.mode===mode),'Independent child completion '+mode);
  }
  await send('APP_CHILD_SAVED');await wait('CHILD_SAVED_CONTEXT');await paste(draft);await wait(draft);await controls('detached','Start detached child');await choose('Questions #',1);const oldChild=(await pane()).title;
  const beforeResume=await json(launch.child.active);await controls('resume','Resume current Main');await observe(()=>json(launch.child.active),value=>value.generation>beforeResume.generation,'Actual committed Core replacement');await normal();await entries('same-alias',0);await key('Escape');await normal();assert.ok(!(await screen()).includes(oldChild));await retained();
  await capture('05-source-core-replacement');

  await controls('managed-create','Create managed proof');await observe(trace,rows=>rows.some(row=>row.event==='managed-created'&&row.which==='managed-create'),'Actual persistent manager identity');
  await controls('managed-question','Ask managed first question');await observe(trace,rows=>rows.some(row=>row.event==='producer-prompt'&&row.tag==='MANAGED_QUESTION_FIRST'),'Actual managed Core prompt');
  const managedRecord=(await trace()).findLast(row=>row.event==='managed-created'&&row.which==='managed-create');
  const managedProducer=(await trace()).findLast(row=>row.event==='producer-prompt'&&row.tag==='MANAGED_QUESTION_FIRST');assert.equal(managedProducer.sessionId,managedRecord.record.sessionId);
  const managedRequest=await choose('Questions #',1);assert.match(managedRequest.title,/^Questions #[0-9]+ · Agent #[0-9]+ Managed proof · via ask_user$/);const managedPrefix=managedRequest.title.match(/^Questions #[0-9]+/)[0],managedSource=managedRequest.title.match(/Agent #[0-9]+ Managed proof/)[0],beforeManaged=await json(launch.child.active);
  const leaseBefore=composition==='selected'?(await pane()).text.match(/Lease: ([^\s]+)/)?.[1]:undefined;
  await controls('resume','Resume current Main');await observe(()=>json(launch.child.active),value=>value.generation>beforeManaged.generation,'Main replacement while managed request remains pending');await choose(managedPrefix);if(composition==='selected'){assert.ok(leaseBefore,'Managed selected lease was actually visible');assert.ok((await pane()).text.includes('Lease: '+leaseBefore));}await question();
  await controls('managed-later','Ask managed later question');await observe(http,rows=>rows.some(row=>row.kind==='completion'&&row.body.messages?.at(-1)?.content==='MANAGED_QUESTION_LATER'),'Later managed request reaches bound provider');await choose('Questions #',1);assert.ok((await pane()).title.includes(' · '+managedSource+' · via ask_user'));await question();
  await controls('managed-nested','Start managed nested child');await choose('Questions #',1);const nested=await pane();assert.ok(nested.title.endsWith(' · Parent '+managedSource+' · via ask_user'));await question();
  await controls('managed-form','Open managed private form');await choose('Form #',1);assert.ok((await pane()).title.endsWith(' · '+managedSource+' · Child local form'));await wait(composition==='selected'?'CUSTOM PRIVATE FORM':'Private name');await controls('managed-close','Close managed proof');await observe(trace,rows=>rows.some(row=>row.event==='managed-control'&&row.action==='managed-close'&&row.result?.value?.archived),'Manager archive closes its pending form');await observe(trace,rows=>rows.some(row=>row.event==='private-form-result'&&row.tag==='CHILD_FORM_MANAGED'&&(row.value===null||Boolean(row.error))),'Exact managed archive form cancellation');await entries('Form #',0);await key('Escape');await normal();
  await controls('managed-create-last','Create managed shutdown proof');await controls('managed-last-form','Open managed shutdown form');await choose('Form #',1);await wait(composition==='selected'?'CUSTOM PRIVATE FORM':'Private name');
  await capture('06-managed-lifetimes-and-shutdown');await main();
  const detachedBeforeClose=(await http()).filter(row=>row.kind==='completion'&&row.body.messages?.at(-1)?.content==='CHILD_DETACHED_Q_0').length;
  await controls('detached','Start detached child');
  await observe(http,rows=>rows.filter(row=>row.kind==='completion'&&row.body.messages?.at(-1)?.content==='CHILD_DETACHED_Q_0').length===detachedBeforeClose+1,'Detached child must reach the provider before shutdown');
  await choose('Questions #',1);await wait(composition==='selected'?'CUSTOM QUESTION':'Remote');
  await capture('07-detached-question-before-close');
  await main();await key('Control+c');await observe(async()=>ptyExit,value=>value===0,'Actual CLI application close');result.ptyExitCode=ptyExit;
  await observe(trace,rows=>rows.some(row=>row.event==='private-form-result'&&row.tag==='CHILD_FORM_MANAGED_LAST'&&(row.value===null||Boolean(row.error))),'Application close cancels managed form');
  await observe(trace,rows=>rows.filter(row=>row.event==='child-result'&&row.mode==='detached').length===rows.filter(row=>row.event==='child-launch'&&row.mode==='detached').length,'Application close settles every actual detached caller');
  if(composition==='native'){passed.add(4);passed.add(5);}else{passed.add(2);passed.add(3);}

  const providerTraffic=await readFile(join(directory,'app-http.jsonl'),'utf8'),publicEvents=await readFile(launch.child.publicTrace,'utf8'),terminal=await readFile(join(directory,'terminal.ansi'),'utf8'),sessionDir=join(launch.state,'sessions'),journals=(await Promise.all((await readdir(sessionDir)).filter(name=>name.endsWith('.jsonl')).map(name=>readFile(join(sessionDir,name),'utf8')))).join('\n');
  for(const value of [publicEvents,journals,providerTraffic])for(const privateValue of [draft,secret,note,'QvalueR'])assert.ok(!value.includes(privateValue),'Private child value escaped its boundary');assert.ok(!terminal.includes(secret));assert.ok(!/MaxListenersExceededWarning/.test(terminal));
  const expectedHttp=Object.fromEntries([
   ['APP_CHILD_TASK_Q',2],['CHILD_Q',2],['APP_CHILD_TASK_QNAIRE',2],['CHILD_QNAIRE',2],['APP_CHILD_TASK_NESTED_Q',2],['CHILD_NESTED_Q',2],['CHILD_LEAF_Q',4],
   ['APP_CHILD_MAIN_HOLD',2],...Array.from({length:5},(_,index)=>['CHILD_SIBLING_Q_'+index,2]),['CHILD_APPROVAL_0',composition==='selected'?4:2],['CHILD_APPROVAL_1',2],
   ['CHILD_BACKGROUND_Q_0',2],['CHILD_DETACHED_Q_0',composition==='selected'?6:4],['APP_CHILD_SAVED',1],['MANAGED_QUESTION_FIRST',2],['MANAGED_QUESTION_LATER',2],['MANAGED_NESTED',2],
   ...(composition==='selected'?[['APP_CHILD_TASK_APPROVAL_0',2],['APP_CHILD_TASK_FORM',2]]:[]),
  ]),actualHttp={};for(const row of (await http()).filter(row=>row.kind==='completion')){
   assert.notEqual(row.credential,'unexpected');assert.equal(row.model,'app-start');const prompt=row.body.messages.filter(message=>message.role==='user').at(-1)?.content;
   actualHttp[prompt]=(actualHttp[prompt]??0)+1;
  }assert.deepEqual(actualHttp,expectedHttp,'Exact model-call ledger by actual Core prompt');
  const toolValues={};for(const row of (await http()).filter(row=>row.kind==='completion'&&row.body.messages?.at(-1)?.role==='tool')){
   const prompt=row.body.messages.filter(message=>message.role==='user').at(-1)?.content,content=row.body.messages.at(-1).content;(toolValues[prompt]??=[]).push(content);
  }
  const parsed=prompt=>toolValues[prompt]?.map(text=>JSON.parse(text));
  for(const prompt of ['CHILD_Q','CHILD_LEAF_Q','CHILD_BACKGROUND_Q_0','CHILD_DETACHED_Q_0','MANAGED_QUESTION_FIRST','MANAGED_QUESTION_LATER']){
   const values=parsed(prompt);assert.ok(values?.length,'Actual answered caller '+prompt);for(const value of values)assert.deepEqual(value,{answer:'Remote'},'Exact caller answer '+prompt);
  }
  assert.deepEqual(parsed('APP_CHILD_MAIN_HOLD'),[{answer:'Production'}],'Actual Main model receives only its explicit answer');
  assert.deepEqual(parsed('CHILD_QNAIRE'),[{answers:[{id:'checks',selected:['Unit','Browser'],text:'Load tests'}]}],'Exact actual child questionnaire result');
  const siblingValues=Array.from({length:5},(_,index)=>{const values=toolValues['CHILD_SIBLING_Q_'+index];assert.equal(values?.length,1);return values[0];});
  assert.ok(toolValues['CHILD_'+cancelTag][0].startsWith('Question cancelled'),'Only the explicitly focused Core receives cancellation');assert.equal(siblingValues.filter(text=>text.startsWith('Question cancelled')).length,1,'Exactly one chosen sibling cancellation');for(const text of siblingValues.filter(text=>!text.startsWith('Question cancelled')))assert.deepEqual(JSON.parse(text),{answer:'Remote'});
  for(const [prompt,expected]of [['APP_CHILD_TASK_Q','CHILD_Q'],['APP_CHILD_TASK_QNAIRE','CHILD_QNAIRE'],['CHILD_NESTED_Q','CHILD_LEAF_Q'],['MANAGED_NESTED','CHILD_LEAF_Q']]){
   const values=parsed(prompt);assert.equal(values?.length,1);assert.equal(values[0].output,'CHILD_FLOW_DONE '+expected,'Exact delegated caller result '+prompt);assert.equal(typeof values[0].agentId,'string');
  }
  if(composition==='selected'){
   const rows=await records(launch.child.selectedTrace),created=rows.filter(row=>row.event==='created');assert.equal(created.length,25,'Exact original selected factory creations');assert.equal(new Set(created.map(row=>row.id)).size,25);
   assert.deepEqual(Object.fromEntries(['question','approval','form'].map(kind=>[kind,created.filter(row=>row.kind===kind).length])),{question:17,approval:3,form:5});
   for(const lease of created)assert.equal(rows.filter(row=>row.event==='disposed'&&row.id===lease.id).length,1,'Every original selected source disposes exactly once');result.selectedLeases=created.map(({id,kind,title})=>({id,kind,title}));
  }
  result.decisions={cancelledSibling:cancelTag,toolResults:toolValues,httpByPrompt:actualHttp,expectedHttpByPrompt:expectedHttp,callerResults:(await trace()).filter(row=>['child-result','private-form-result','managed-control','settings-result'].includes(row.event)),expectedNegative:'One sibling cancellation, denied write, resumed delegated requests, manager/archive and application-close form cancellation'};
  result.privacy={publicHooks:true,mainJournals:true,providerTraffic:true,terminalTokenMasked:true,inputLogExcluded:true};result.captures=captures;result.httpCompletions=(await http()).filter(row=>row.kind==='completion').length;result.modelCalls='Isolated loopback scripted provider only';assert.deepEqual(result.errors,[]);
  result.ok=passed.size===descriptions.length;
 }catch(error){result.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(directory,'failure.txt'),await screenSafe(page));await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});}}
 finally{
  if(launch?.child)try{await copyFile(launch.child.trace,join(directory,'fixture-trace.jsonl'));await copyFile(launch.child.publicTrace,join(directory,'public-ui-events.jsonl'));if(launch.child.selectedTrace)await copyFile(launch.child.selectedTrace,join(directory,'selected-trace.jsonl'));await copyFile(launch.child.active,join(directory,'active-core.json'));await copyFile(launch.child.managed,join(directory,'managed.json')).catch(()=>{});const sessions=join(directory,'session-journals');await mkdir(sessions,{recursive:true});for(const name of await readdir(join(launch.state,'sessions')))if(name.endsWith('.jsonl'))await copyFile(join(launch.state,'sessions',name),join(sessions,name));for(const [name,path]of Object.entries(launch.child.effects))await copyFile(path,join(directory,'effect-'+name+'.txt')).catch(error=>{if(error.code!=='ENOENT')throw error;});}catch(error){result.errors.push('Could not preserve child diagnostics: '+error);}
  await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');await serverExit;}if(server)result.serverExitCode=await serverExit;
  result.evidence=await evidence(directory);
  result.checks=descriptions.filter((_,index)=>passed.has(index));await writeFile(join(directory,'report.json'),JSON.stringify(result,null,2)+'\n');report.checks.push(...result.checks);report.screenshots.push(...result.screenshots.map(name=>composition+'/'+name));report.errors.push(...result.errors);
 }
 if(!result.ok)break;
}
report.ok=report.checks.length===10&&Object.values(report.compositions).every(value=>value.ok&&value.ptyExitCode===0&&value.serverExitCode===0)&&report.errors.length===0;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
async function screenSafe(page){return page.evaluate(()=>window.visual?.text()??'').catch(()=>'');}

async function evidence(directory,prefix=''){
 const files=[];for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})){
  const path=join(prefix,entry.name);if(entry.isDirectory())files.push(...await evidence(directory,path));else if(/\.(?:jsonl|json|txt|png|ansi)$/.test(path)&&path!=='report.json'){
   const bytes=await readFile(join(directory,path));files.push({path,bytes:bytes.length,sha256:hash(bytes)});
  }
 }return files.sort((a,b)=>a.path.localeCompare(b.path));
}
