import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-ink-background');
await mkdir(output,{recursive:true});
assert.equal(await stat(join(output,'report.json')).then(()=>true,()=>false),false,'Use a fresh VISUAL_OUTPUT');
const report={ok:false,checks:[],screenshots:[],errors:[],colors:{}};
const runtime=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','PYTHON'].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]]]));
let browser;
async function scenario(mode){
 const dir=join(output,mode);await mkdir(dir,{recursive:true});
 const env={...runtime,VISUAL_OUTPUT:dir,AGENT_GRAPHICS:'off',FORCE_COLOR:'3',COLORTERM:'truecolor',TERM:'xterm-256color',...(mode==='auto'?{}:{AGENT_TERMINAL_BACKGROUND:mode})};
 const server=spawn('bun',['tools/visual/server.mjs'],{cwd:root,env,stdio:['ignore','pipe','inherit']});
 const ended=new Promise(resolve=>server.once('close',resolve));let page;
 try{
  const url=await new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(Error('Visual server startup timed out')),15000);server.stdout.on('data',chunk=>{data+=chunk;const match=data.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});server.once('error',error=>{clearTimeout(timer);reject(error);});ended.then(code=>{clearTimeout(timer);reject(Error('Visual server exited '+code));});});
  page=await browser.newPage({viewport:{width:1200,height:850}});page.on('pageerror',error=>report.errors.push(String(error)));await page.goto(url);
  await page.waitForFunction(()=>visual.text().includes('What would you like'),null,{timeout:15000});
  const sample=()=>page.evaluate(()=>{const b=visual.terminal.buffer.active;for(let y=0;y<visual.terminal.rows;y++){const line=b.getLine(b.viewportY+y),x=(line?.translateToString(true)??'').indexOf('What would you like');if(x>=0){const c=line.getCell(x);return{color:c.getFgColor(),rgb:c.isFgRGB()};}}return null;});
  const waitColor=async color=>page.waitForFunction(expected=>{const b=visual.terminal.buffer.active;for(let y=0;y<visual.terminal.rows;y++){const line=b.getLine(b.viewportY+y),x=(line?.translateToString(true)??'').indexOf('What would you like');if(x>=0)return line.getCell(x).getFgColor()===expected;}return false;},color,{timeout:5000});
  const initial=await sample();assert.ok(initial?.rgb,'Expected RGB terminal foreground');report.colors[mode]={initial:initial.color};
  const ansi=await readFile(join(dir,'terminal.ansi'),'utf8');
  if(mode==='auto'){
   assert.ok(ansi.includes('\x1b]11;?\x1b\\'),'Expected an automatic background query');
   await page.evaluate(()=>visual.terminal.input('\x1b]11;rgb:ffff/ffff/ffff\x07'));
   await waitColor(0x202a33);report.colors[mode].afterLight=(await sample()).color;
   await page.evaluate(()=>visual.terminal.input('\x1b]11;rgb:0000/0000/0000\x07'));
   await waitColor(0xdce3e9);report.colors[mode].afterDark=(await sample()).color;
   report.checks.push('automatic mode reacts to light and dark terminal reports');
  }else{
   assert.ok(!ansi.includes('\x1b]11;?\x1b\\'),'An explicit preference must not depend on a background query');
   const expected=mode==='light'?0x202a33:0xdce3e9;assert.equal(initial.color,expected);
   const reply=mode==='light'?'\x1b]11;rgb:0000/0000/0000\x07':'\x1b]11;rgb:ffff/ffff/ffff\x07';
   await page.evaluate(reply=>visual.terminal.input(reply),reply);
   await page.keyboard.type('draft');await page.waitForFunction(()=>visual.text().includes('draft'),null,{timeout:5000});
   assert.equal((await sample()).color,expected,'Forced palette changed after a conflicting terminal report');
   report.checks.push(mode+' preference works without a reply and ignores a conflicting reply');
  }
  await page.evaluate(mode=>{visual.terminal.options.theme={background:mode==='light'?'#ffffff':'#101417',foreground:mode==='light'?'#202a33':'#dce5e9'};},mode);
  await page.locator('#terminal').screenshot({path:join(dir,'screen.png')});report.screenshots.push(mode+'/screen.png');
 }catch(error){await page?.screenshot({path:join(dir,'failure.png')}).catch(()=>{});throw error;}
 finally{await page?.close();if(server.exitCode===null){server.kill('SIGTERM');await ended;}}
}
try{browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});for(const mode of ['auto','light','dark'])await scenario(mode);report.ok=report.errors.length===0;}catch(error){report.errors.push(String(error));}finally{await browser?.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
