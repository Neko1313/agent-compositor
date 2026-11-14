import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-wire'),timeout=20_000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={ok:false,scope:'Public legacy 0.6 source/send API in a real Bun PTY; separate from the production native 0.7 CLI bridge',mode:process.env.VISUAL_RENDERER_MODULE?'archive-module':'source-module',checks:[],screenshots:[],processes:[],errors:[]};
const json=path=>readFile(path,'utf8').then(JSON.parse),records=path=>readFile(path,'utf8').then(value=>value.trim().split('\n').filter(Boolean).map(JSON.parse));
async function observe(read,predicate,reason){const until=Date.now()+timeout;let value;while(Date.now()<until){value=await read().catch(error=>{if(error.code!=='ENOENT')throw error;});if(value!==undefined&&predicate(value))return value;await delay(25);}throw Error(reason+'; latest='+JSON.stringify(value));}
async function cell(page,label){return(await page.waitForFunction(label=>{
 const terminal=visual.terminal,buffer=terminal.buffer.active;if(terminal.modes?.synchronizedOutputMode)return;
 for(let y=0;y<terminal.rows;y++){const line=buffer.getLine(buffer.viewportY+y),text=line?.translateToString(true,0,terminal.cols)??'',x=text.indexOf(label);if(x>=0){const c=line.getCell(x);return{x,y,ch:c.getChars(),fg:c.getFgColor(),bg:c.getBgColor(),bold:Boolean(c.isBold()),italic:Boolean(c.isItalic()),underline:Boolean(c.isUnderline()),inverse:Boolean(c.isInverse())};}}
},label)).jsonValue();}

await mkdir(output,{recursive:true});
assert.equal(await stat(join(output,'report.json')).then(()=>true,()=>false),false,'Use a fresh VISUAL_OUTPUT to preserve previous proof');
assert.ok(!process.env.VISUAL_EXECUTABLE,'Use VISUAL_RENDERER_MODULE for the exact archived API module; executable CLI has its own native suites');
const preflight=spawnSync('bun',['tools/visual/opentui-wire-fixture.mjs','--preflight'],{cwd:root,encoding:'utf8'});assert.equal(preflight.status,0,preflight.stderr);report.preflight=JSON.parse(preflight.stdout);
for(const variant of ['normal','bad-ack','blocked-stop']){
 const directory=join(output,variant);await mkdir(directory,{recursive:true});const result={variant,ok:false,checks:[],screenshots:[],errors:[]};report.processes.push(result);
 let server,serverExit,browser,page,ptyExit;
 try{
  const runtime=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON','LD_LIBRARY_PATH','CI'].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]]]));
  server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...runtime,VISUAL_OPENTUI_WIRE:'1',VISUAL_WIRE_CASE:variant,VISUAL_OUTPUT:directory,AGENT_GRAPHICS:'off',...(process.env.VISUAL_RENDERER_MODULE?{VISUAL_RENDERER_MODULE:resolve(process.env.VISUAL_RENDERER_MODULE)}:{})},stdio:['ignore','pipe','inherit']});
  serverExit=new Promise(done=>server.once('close',done));
  const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Wire bench startup timed out')),timeout);server.on('error',error=>{clearTimeout(timer);fail(error);});serverExit.then(code=>{clearTimeout(timer);fail(Error('Wire bench exited '+code));});server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http\S+)\s/);if(match){clearTimeout(timer);done(match[1]);}});});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1250,height:850}});page.setDefaultTimeout(timeout);page.on('pageerror',error=>result.errors.push(error.message));
  const[socket]=await Promise.all([page.waitForEvent('websocket'),page.goto(url)]);socket.on('framereceived',({payload})=>{try{const message=JSON.parse(String(payload));if(message.type==='exit')ptyExit=message.code;if(message.type==='error')result.errors.push(message.data);}catch{}});
  const wait=text=>page.waitForFunction(text=>!visual.terminal.modes?.synchronizedOutputMode&&visual.text().includes(text),text),key=value=>page.keyboard.press(value);
  const trace=()=>records(join(directory,'wire-trace.jsonl')),out=()=>records(join(directory,'wire-out.jsonl'));
  async function capture(name){await page.evaluate(()=>new Promise(done=>{const sub=visual.terminal.onRender(()=>{sub.dispose();requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));await page.locator('#terminal').screenshot({path:join(directory,name+'.png')});await writeFile(join(directory,name+'.txt'),await page.evaluate(()=>visual.text()));result.screenshots.push(name+'.png');}
  if(variant==='normal'){
   await wait('WIRE_READY_06');const marker=await cell(page,'WIRE_RGB');assert.deepEqual({fg:marker.fg,bg:marker.bg,bold:marker.bold,italic:marker.italic,underline:marker.underline},{fg:0x7dd3fc,bg:0x223344,bold:true,italic:true,underline:true});
   await wait('WIRE_RASTER_FALLBACK');await wait('WIRE_LITERAL:\\u001b\\u202e');await wait('Legacy Main\\u001b\\u202e');assert.deepEqual(await page.evaluate(()=>{const b=visual.terminal.buffer.active,v=b.viewportY;return[b.getLine(v).getCell(0).getChars(),b.getLine(v).getCell(62).getChars(),b.getLine(v+1).translateToString(false,55,61),b.getLine(v+1).translateToString(false,93,99)];}),['╔','╭','[F][x]','      ']);
   const initialOut=await out();assert.deepEqual(initialOut.map(value=>value.type),['hello','hello-ack']);assert.deepEqual(initialOut[1],{type:'hello-ack',ok:true,version:'0.6.0'});assert.ok(!initialOut[0].capabilities.elements.includes('Raster'));
   await capture('01-valid-full-and-fallback');result.checks.push('A validated 0.6 JSONL log paints exact RGB/styles, full-frame chrome/control policy and text raster fallback through the public source/send API');
   await key('n');await observe(trace,rows=>rows.some(row=>row.event==='unflushed'),'Actual n input must issue the unflushed diff');await page.waitForFunction(()=>visual.pointer==='text');assert.ok((await page.evaluate(()=>visual.text())).includes('WIRE_FULL_06'));assert.ok(!(await page.evaluate(()=>visual.text())).includes('WIRE_PENDING_06'));
   await key('f');await wait('WIRE_FLUSHED_06');await wait('SCROLLED_ROW_06');assert.equal((await cell(page,'WIRE_FLUSHED_06')).inverse,true);await capture('02-batched-diff-and-cursor');result.checks.push('Unflushed diff plus invalidate stays unpublished across a real pointer update; the explicit flush applies scroll/set/cursor at the next visible checkpoint');
   await key('F2');await observe(trace,rows=>rows.some(row=>row.event==='focus-side'),'Actual F2 must focus the side surface');await page.waitForFunction(()=>{const b=visual.terminal.buffer.active,v=b.viewportY;return b.getLine(v+1).translateToString(false,55,61)==='      '&&b.getLine(v+1).translateToString(false,93,99)==='[F][x]';});
   const pasted='WIRE_😀窗\nq';await page.evaluate(text=>socket.send(JSON.stringify({type:'input',data:'\x1b[200~'+text+'\x1b[201~'})),pasted);await observe(out,rows=>rows.some(value=>value.type==='input'&&value.surface==='side'&&value.data.kind==='text'&&value.data.paste===true&&value.data.text===pasted),'Exact Unicode paste must retain its marked text and newline');await wait('PASTE:'+JSON.stringify(pasted));
   await key('Enter');await wait('KEY:enter:');const rect=await page.locator('.xterm-screen').boundingBox();assert.ok(rect);await page.mouse.click(rect.x+70.5*rect.width/100,rect.y+9.5*rect.height/30);await wait('MOUSE:release 70,9');
   await observe(out,rows=>rows.some(value=>value.type==='input'&&value.surface==='side'&&value.data.kind==='mouse'&&value.data.col===70&&value.data.row===9&&value.data.action==='press'),'Mouse coordinates must remain terminal-global');
   await key('p');await page.waitForFunction(()=>visual.pointer==='ew-resize');await page.evaluate(()=>visual.terminal.resize(90,28));await observe(trace,rows=>rows.some(row=>row.event==='resize'&&row.columns===90&&row.rows===28),'Actual PTY resize must reach the public numeric viewport callback');await page.waitForFunction(()=>{const b=visual.terminal.buffer.active;return b.getLine(b.viewportY).getCell(55).getChars()==='╭';});await capture('03-focus-input-pointer-resize');result.checks.push('Real F2, Unicode bracketed paste, Enter and global press/release target the focused surface; pointer and PTY resize update without local geometry ownership');
   await key('q');await wait('WIRE_EXIT_OK normal raw=false');
  }else if(variant==='bad-ack'){
   await wait('WIRE_EXIT_EXPECTED_BAD_ACK raw=false');await capture('04-bad-handshake-cleanup');result.checks.push('A negative handshake rejects waitUntilExit and restores the terminal before reporting the expected failure');
  }else{
   await wait('WIRE_READY_06');await key('s');await wait('WIRE_EXIT_OK blocked-stop raw=false');await capture('05-blocked-source-stop');result.checks.push('Explicit stop releases raw mode and the alternate screen while both source pull and iterator.return remain blocked');
  }
  await observe(async()=>ptyExit,value=>value===0,'The owned PTY child must exit naturally with code zero');result.ptyExitCode=ptyExit;
  const identity=await json(join(directory,'wire-identity.json'));assert.equal(identity.mode,report.mode);assert.equal(identity.sha256,sha(await readFile(identity.module)));if(process.env.VISUAL_RENDERER_MODULE)assert.equal(identity.module,resolve(process.env.VISUAL_RENDERER_MODULE));result.identity=identity;
  const rows=await trace(),exits=rows.filter(row=>row.event==='exit');assert.equal(exits.length,1);assert.equal(exits[0].ok,true);assert.equal(exits[0].raw,false);assert.equal(rows.filter(row=>row.event==='iterator-return').length,1);
  const terminal=await readFile(join(directory,'terminal.ansi'),'utf8');assert.ok(terminal.includes('\x1b[?1049h'));assert.ok(terminal.includes('\x1b[?1049l'));assert.ok(!/MaxListenersExceededWarning|WIRE_EXIT_UNEXPECTED/.test(terminal));assert.deepEqual(result.errors,[]);result.ok=true;
 }catch(error){result.errors.push(error instanceof Error?error.stack:String(error));if(page){await writeFile(join(directory,'failure.txt'),await page.evaluate(()=>window.visual?.text()??'').catch(()=>''));await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});}}
 finally{
  await browser?.close();if(server?.exitCode===null){server.kill('SIGTERM');result.serverExitCode=await serverExit;}
  result.evidence={};for(const name of ['wire-identity.json','wire-in.jsonl','wire-out.jsonl','wire-trace.jsonl','terminal.ansi','input.jsonl',...result.screenshots])try{result.evidence[name]=sha(await readFile(join(directory,name)));}catch{}
  await writeFile(join(directory,'report.json'),JSON.stringify(result,null,2)+'\n');report.checks.push(...result.checks);report.screenshots.push(...result.screenshots.map(name=>variant+'/'+name));report.errors.push(...result.errors);
 }
 if(!result.ok)break;
}
report.ok=report.processes.length===3&&report.processes.every(value=>value.ok&&value.ptyExitCode===0&&value.serverExitCode===0)&&report.checks.length===5&&report.screenshots.length===5&&report.errors.length===0;
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
