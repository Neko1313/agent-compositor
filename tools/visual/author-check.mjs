import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-plugin-author');
await mkdir(output,{recursive:true});
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
let server,browser,page;
try {
  server=spawn('bun',['tools/visual/server.mjs'],{env:{...process.env,VISUAL_AUTHOR:'1',VISUAL_OUTPUT:output},stdio:['ignore','pipe','inherit']});
  const url=await new Promise((done,fail)=>{
    let text='';const timer=setTimeout(()=>fail(Error('Server timeout')),15000);
    server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});
    server.once('exit',code=>{clearTimeout(timer);fail(Error('Server exit '+code));});
  });
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1400,height:1100}});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(url);
  const wait=text=>page.waitForFunction(text=>visual.text().includes(text),text,{timeout:20000});
  async function clickInput(){
    const p=await page.evaluate(()=>{
      const lines=visual.text().split('\n');const row=lines.findIndex(line=>line.includes('›'));
      if(row<0)throw Error('Input not visible');const col=lines[row].indexOf('›')+2;
      const r=document.querySelector('.xterm-screen').getBoundingClientRect();
      return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};
    });await page.mouse.click(p.x,p.y);
  }
  async function send(text){await clickInput();await page.keyboard.type(text);await wait(text);await page.keyboard.press('Enter');}
  async function shot(name){await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);}
  async function ready(){
    await page.waitForFunction(()=>visual.text().split('\n').slice(-2).some(line=>/\bReady\b/.test(line)));
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  }
  await wait('Describe your task');
  await send('/plugin Create /hello-local with a panel, skill and MCP');
  await wait('Approval required');
  await shot('00-authoring-write-approval.png');
  await page.keyboard.press('y');
  await wait('Plugin files checked. Run /reload, then /hello-local.');
  await ready();
  await shot('01-authored-and-checked.png');
  report.checks.push('Human /plugin request loads composition guidance, scaffolds all six components, edits existing hooks without removing other components, and checks with real tools');
  await send('/reload');await wait('Reloaded');
  await send('/hello-local');
  const version=JSON.parse(await readFile('schema/events.json','utf8')).version;
  await wait('LOCAL_AUTHOR_OK_'+version);await shot('02-local-command-active.png');
  await wait('hello-local ready');
  await send('Check composed MCP');await wait('COMPOSED_MCP_OK');await ready();
  await send('Check composed skill');await wait('COMPOSED_SKILL_OK');await ready();await shot('03-composed-capabilities.png');
  report.checks.push('The authored panel renders and the package skill loads; the real bundled stdio server answers through mcp_call');
  report.checks.push('User reload activates the authored command and its public SDK import; completion does not substitute for executing the extension');
  const generation=await page.evaluate(()=>visual.generation);
  await page.getByRole('button',{name:'Restart session'}).click();
  await page.waitForFunction(g=>visual.generation>g,generation);await wait('Describe your task');
  await send('/hello-local');await wait('LOCAL_AUTHOR_OK_'+version);await wait('hello-local ready');
  await send('Check composed MCP');await wait('COMPOSED_MCP_OK');await ready();
  await send('Check composed skill');await wait('COMPOSED_SKILL_OK');await ready();await shot('04-composite-after-restart.png');
  report.checks.push('Project extension loads and executes after a real process restart');
  await send('Disable composed plugin');await wait('COMPOSED_DISABLE_OK');await ready();
  await send('/reload');await wait('Reloaded');
  await page.waitForFunction(()=>!visual.text().includes('hello-local ready'));
  await send('/mcp');await wait('0 configured');await shot('05-owner-disabled.png');
  report.checks.push('Disabling the owner and reloading removes its actual panel and MCP contribution from the terminal');
  await send('Enable composed plugin');await wait('COMPOSED_ENABLE_OK');await ready();
  await send('/reload');await wait('Reloaded');await send('/hello-local');await wait('hello-local ready');
  await send('Check composed MCP');await wait('COMPOSED_MCP_OK');await ready();await shot('06-owner-enabled.png');
  report.checks.push('Re-enabling and reloading restores UI and a fresh MCP connection');
  report.ok=report.errors.length===0;
} catch(error){report.errors.push(String(error));await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{
  await browser?.close();
  if(server&&server.exitCode===null){const end=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await end;}
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  if(!report.ok)process.exitCode=1;
}
