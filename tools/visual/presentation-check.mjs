import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-presentation');await mkdir(output,{recursive:true});
let server,browser,page;const report={checks:[],screenshots:[],errors:[],mode:process.env.VISUAL_EXECUTABLE?'binary':'source',pointer:'off (GNOME/VTE fallback)'};
try{
  server=spawn('bun',['tools/visual/server.mjs'],{env:{...process.env,VISUAL_OUTPUT:output,VISUAL_POINTER:'off',VISUAL_MARKDOWN:'1'},stdio:['ignore','pipe','inherit']});
  const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Server timeout')),15000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});server.once('exit',code=>{clearTimeout(timer);fail(Error('Server exit '+code));});});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
  page=await browser.newPage({viewport:{width:1400,height:1100}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
  const wait=text=>page.waitForFunction(text=>window.visual?.text().includes(text),text,{timeout:15000});
  await wait('What would you like');await page.evaluate(()=>visual.terminal.resize(100,40));
  const point=async(col,row)=>page.evaluate(({col,row})=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};},{col,row});
  const hover=await point(5,1);await page.mouse.move(hover.x,hover.y);await wait('[F]');
  const inputRow=await page.evaluate(()=>visual.text().split('\n').findIndex(s=>s.includes('Describe your task')));const inputPoint=await point(5,inputRow);await page.mouse.click(inputPoint.x,inputPoint.y);
  await page.keyboard.type('Show markdown');await wait('Show markdown');await page.keyboard.press('Enter');await wait('Markdown verified');await wait('Quoted evidence');await wait('notify-done: turn complete');
  const snapshot=await page.evaluate(()=>{const b=visual.terminal.buffer.active,lines=[];let bold=false,italic=false;for(let row=0;row<visual.terminal.rows;row++){const line=b.getLine(row);lines.push(line?.translateToString(true)??'');for(let col=0;col<visual.terminal.cols;col++){const c=line?.getCell(col);if(c?.getChars()?.trim()){bold ||=!!c.isBold();italic ||=!!c.isItalic();}}}return{text:lines.join('\n'),bold,italic,pointer:visual.pointer};});
  for(const [name,ok]of Object.entries({heading:snapshot.text.includes('Markdown verified')&&!snapshot.text.includes('# Markdown'),lists:snapshot.text.includes('• First item'),table:snapshot.text.includes('Markdown')&&snapshot.text.includes('passed')&&snapshot.text.includes('│'),literalCode:snapshot.text.includes('"**literal**"'),bold:snapshot.bold,italic:snapshot.italic})){if(!ok)throw Error('Missing '+name);report.checks.push(name);}
  await page.screenshot({path:resolve(output,'01-markdown.png')});report.screenshots.push('01-markdown.png');
  const border=await point(2,1);await page.mouse.move(border.x,border.y);await page.waitForFunction(()=>!!visual.terminal.buffer.active.getLine(1)?.getCell(2)?.isBold());report.checks.push('native-independent title hover highlight');await page.screenshot({path:resolve(output,'02-hover.png')});report.screenshots.push('02-hover.png');
  // Exercise layout/reflow through the actual terminal resize event.
  const before=await page.evaluate(()=>visual.frames);await page.evaluate(()=>visual.terminal.resize(60,40));await page.waitForFunction(before=>visual.frames>before+1&&visual.text().includes('Markdown verified')&&visual.text().includes('Quoted evidence'),before,{timeout:15000});await page.screenshot({path:resolve(output,'03-narrow.png')});report.screenshots.push('03-narrow.png');
  const ansi=await readFile(resolve(output,'terminal.ansi'),'utf8');if(ansi.includes('\x1b]22;'))throw Error('Unsupported pointer sequence emitted');report.checks.push('no unsupported OSC22 for VTE fallback');
  await writeFile(resolve(output,'screen.txt'),snapshot.text);
}catch(error){report.errors.push(String(error));if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}report.ok=!report.errors.length;await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
