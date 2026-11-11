import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-performance');
await mkdir(output,{recursive:true});
const {NO_COLOR,...motionEnv}=process.env;
let server,browser,page;const report={checks:[],screenshots:[],phases:{},snapshots:{},errors:[]};
try{
 server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env:{...((process.argv.includes('--motion')||process.argv.includes('--vte'))?motionEnv:process.env),VISUAL_OUTPUT:output,VISUAL_PERFORMANCE:'1',...(process.argv.includes('--vte')?{VISUAL_PERFORMANCE_MOTION:'1',VISUAL_POINTER:'off',VISUAL_GRAPHICS:'off',AGENT_GRAPHICS:'auto'}:process.argv.includes('--motion')?{VISUAL_PERFORMANCE_MOTION:'1',VISUAL_GRAPHICS:'kitty',AGENT_GRAPHICS:'kitty'}:{AGENT_GRAPHICS:'off'})},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Bench startup timed out')),15000);server.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/VISUAL_URL=(http\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});server.once('exit',code=>{clearTimeout(timer);reject(Error(`Bench exited ${code}`));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1800,height:1400}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
 const wait=text=>page.waitForFunction(text=>visual.text().includes(text),text,{timeout:60000});
 const shot=async name=>{await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);};
 const type=async value=>{let prefix='';for(const ch of value){prefix+=ch;await page.evaluate(expected=>visual.metrics.expectInput(expected),prefix);await page.keyboard.type(ch);await page.waitForFunction(()=>!visual.metrics.report().pendingInput,null,{timeout:15000});}};
 const phase=async(name,run)=>{await page.evaluate(()=>visual.metrics.start());try{await run();}finally{report.phases[name]=await page.evaluate(()=>visual.metrics.stop());}};
 await wait('0/3 complete');await wait('Describe a task');
 const p=await page.evaluate(()=>{const lines=visual.text().split('\n'),row=lines.findLastIndex(l=>l.includes('›')),col=lines[row].indexOf('›')+2;const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};});await page.mouse.click(p.x,p.y);
 await phase('idle-input',()=>type('idle_latency'));await shot('01-idle-input.png');
 for(const _ of 'idle_latency')await page.keyboard.press('Backspace');await page.waitForFunction(()=>visual.text().includes('› ▏Describe'));await page.keyboard.type('PERF LONG');await page.keyboard.press('Enter');
 // A fresh draft remains user input throughout the provider stream.
 await phase('streaming-input',async()=>{await type('stream_latency');await wait('PERFORMANCE_STREAM_FINISHED');await wait((process.argv.includes('--motion')||process.argv.includes('--vte'))?'Message · Ready':'Ready');});
 await shot('02-streamed.png');
 for(const _ of 'stream_latency')await page.keyboard.press('Backspace');await page.waitForFunction(()=>visual.text().includes('› ▏Describe'));
 await phase('history-input',()=>type('history_latency'));await shot('03-history-input.png');
 await phase('hover',async()=>{for(let i=0;i<20;i++){const target=i%2?{col:1,row:28,shape:'pointer'}:{col:8,row:1,shape:'grab'};await page.evaluate(target=>visual.metrics.expectPointer(target.pointerShape,{row:1,col:8,bold:target.shape==='grab'}),{...target,pointerShape:process.argv.includes('--vte')?undefined:target.shape});const p=await page.evaluate(({col,row})=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};},target);await page.mouse.move(p.x,p.y);await page.waitForFunction(()=>!visual.metrics.report().pendingPointer);}});
 await phase('resize',async()=>{let seed=42;for(let i=0;i<8;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const cols=60+seed%80,rows=28+(seed>>>8)%14;const before=await page.evaluate(()=>visual.frames);await page.evaluate(({cols,rows})=>visual.terminal.resize(cols,rows),{cols,rows});await page.waitForFunction(before=>visual.frames>before&&visual.text().split('\n').at(-2)?.includes('[Settings]'),before);await wait('history_latency');await page.waitForFunction(()=>{const lines=visual.text().split('\n'),bottom=lines.at(-3);return lines[0]?.[0]==='┌'&&lines[0]?.at(-1)==='┐'&&bottom?.[0]==='└'&&bottom?.at(-1)==='┘';});await page.evaluate(()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Terminal cells did not stabilize')),10000);let previous='',equal=0;const sample=()=>{const current=JSON.stringify(visual.metrics.snapshot());equal=current===previous?equal+1:0;previous=current;if(equal>=3){clearTimeout(timer);resolve();}else requestAnimationFrame(sample);};requestAnimationFrame(sample);}));report.snapshots[`${cols}x${rows}`]=await page.evaluate(()=>visual.metrics.snapshot());}});
 await shot('04-resized.png');report.checks.push('Real PTY keyboard echo during idle, streaming and long-history workloads; seeded resize preserves draft');
 for(const [name,metrics]of Object.entries(report.phases)){
  if(metrics.pendingPointer)throw Error(name+': pointer observation never completed');
  if(metrics.pendingInput)throw Error(name+': input never reached a paint');
  if(!process.argv.includes('--baseline')&&(metrics.emptyPaints||name!=='resize'&&metrics.eraseScrollback))throw Error(name+': unexpected empty paint or scrollback clear');
  if(!process.argv.includes('--baseline')&&Math.max(metrics.inputToPaintMs.max,metrics.pointerRoundTripMs.max,metrics.hoverToPaintMs.max)>1000)throw Error(name+': input-to-paint exceeded 1000 ms');
 }
 if(process.argv.includes('--motion')&&Object.values(report.phases).reduce((n,p)=>n+p.imageChanges,0)<4)throw Error('Animation workload did not produce visible image changes');
 const index=process.argv.indexOf('--compare');if(index>=0){const baseline=JSON.parse(await readFile(resolve(process.argv[index+1]),'utf8'));if(JSON.stringify(baseline.snapshots)!==JSON.stringify(report.snapshots))throw Error('Screen cells/styles differ from baseline after seeded resize');report.checks.push('All seeded terminal cell/style snapshots match the baseline renderer');}
 if(report.errors.length)throw Error(report.errors.join('\n'));report.ok=true;
}catch(error){report.ok=false;report.errors.push(String(error));process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});if(page)await writeFile(resolve(output,'failure.txt'),await page.evaluate(()=>visual.text()).catch(()=>''));}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,snapshots:Object.keys(report.snapshots)},null,2));}
