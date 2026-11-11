import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-marketplace');
await mkdir(output,{recursive:true});
const report={ok:false,mode:process.env.VISUAL_EXECUTABLE?'binary':'source',checks:[],screenshots:[],errors:[]};
let server,browser,page;
try {
  server=spawn('bun',['tools/visual/server.mjs'],{env:{...process.env,VISUAL_MARKETPLACE:'1',VISUAL_MARKETPLACE_BUSY:'1',VISUAL_OUTPUT:output},stdio:['ignore','pipe','inherit']});
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
  async function clickText(text){
    await wait(text);
    const p=await page.evaluate(text=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(text)),col=lines[row].indexOf(text)+1;const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x+(col+.5)*r.width/visual.terminal.cols,y:r.y+(row+.5)*r.height/visual.terminal.rows};},text);
    await page.mouse.click(p.x,p.y);
  }
  async function ready(){
    await page.waitForFunction(()=>visual.text().split('\n').slice(-2).some(line=>/\bReady\b/.test(line)));
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  }
  await wait('Describe your task');
  await page.waitForFunction(()=>!visual.text().includes('0/3 complete'));
  await shot('00-clean-kernel.png');
  await send('/marketplace');await wait('agent-compositor');await shot('01-default-market.png');
  report.checks.push('A fresh app has no plugin windows and exposes the offline default marketplace');
  await send('/extensions install mascot@agent-compositor --project');await wait('Inactive until you explicitly enable it.');await shot('02-installed-inactive.png');
  report.checks.push('Installing from the default catalog leaves the package inactive');
  await send('/extensions install todos@agent-compositor --project');await wait('Installed todos');
  await send('/extensions enable todos --project');await wait('Enabled todos · project');
  await send('/reload');await wait('0/3 complete');await shot('03-enabled-project.png');
  report.checks.push('An explicit project-scoped enable activates the Todos UI after reload');
  const generation=await page.evaluate(()=>visual.generation);
  await page.getByRole('button',{name:'Restart session'}).click();
  await page.waitForFunction(g=>visual.generation>g,generation);await wait('0/3 complete');await shot('04-scope-persisted.png');
  report.checks.push('The project selection survives an actual process restart');
  await send('/extensions disable todos --project');await wait('Disabled todos · project');
  await send('/reload');await page.waitForFunction(()=>!visual.text().includes('0/3 complete'));await shot('05-disabled.png');
  report.checks.push('An explicit disable and reload removes the plugin window');
  await send('/marketplace');await clickText('agent-compositor · bundled');
  await wait('Choose a plugin to install.');await clickText('auto-approve');
  await wait('Install inactive');await page.keyboard.press('ArrowRight');await wait('All my projects');await shot('06-install-scope-form.png');await clickText('Install inactive');
  await wait('Installed auto-approve');
  await send('/extensions');
  await clickText('Extensions');await page.keyboard.press('Alt+f');
  const pluginVersion=JSON.parse(await readFile('plugins/auto-approve/plugin.json','utf8')).version;
  await wait('auto-approve  v'+pluginVersion+' · off');await clickText('auto-approve');
  await wait('Manage auto-approve');await page.keyboard.press('Tab');await wait('All my projects');await shot('07-manage-scope-form.png');await clickText('Apply');
  await wait('Enabled auto-approve · user');await shot('08-managed-user.png');
  report.checks.push('Terminal mouse actions browse the catalog, install inactive through a scope form, and explicitly enable through the management form');
  await page.keyboard.press('Alt+f');
  await send('Work while I manage plugins');await wait('AGENT_BUSY');
  await clickText('[Plugins]');await wait('enabled ·');
  await clickText('Browse marketplace');await clickText('agent-compositor · bundled');await wait('Search plugins');
  await page.keyboard.type('cost');await wait('Search: cost');
  await page.waitForFunction(()=>visual.text().includes('1 plugins')&&!visual.text().includes('mascot  v'));
  await shot('09-search-while-working.png');
  await clickText('cost  v');await wait('Install cost@agent-compositor');await clickText('Install inactive');
  await wait('Installed cost');await clickText('Enable installed plugin');await wait('Manage cost');await clickText('Apply');
  await wait('Enabled cost');await shot('10-enabled-while-working.png');
  await clickText('Apply plugin changes');await wait('plugins pending');
  await shot('11-reload-pending.png');
  await clickInput();await page.keyboard.press('Control+c');
  await wait('Reloaded 2 plugins.');await shot('12-applied-after-interrupt.png');
  report.checks.push('During a held model turn, toolbar navigation, live catalog search, scoped install and enable stay usable; reload waits until the turn stops');
  await send('Ask before continuing');await wait('AGENT_QUESTION');
  await clickText('[Plugins]');await wait('enabled ·');
  await clickText('Browse marketplace');await clickText('agent-compositor · bundled');await wait('Search plugins');
  await page.keyboard.type('no-such-plugin');await wait('No matching plugins');
  await shot('13-catalog-while-question-pending.png');
  await clickText('[Settings]');await wait('Network proxy');
  await shot('14-settings-while-question-pending.png');
  report.checks.push('An unanswered agent question stays docked while marketplace search and provider settings accept input');
  await page.evaluate(()=>visual.terminal.resize(48,18));
  await page.waitForFunction(()=>visual.terminal.cols===48&&!visual.text().includes('[Plugins]'));
  await page.keyboard.press('Alt+o');await wait('Browse marketplace');
  await page.keyboard.press('Alt+,');await wait('Add provider');
  await wait('Alt+i to answer');await shot('15-narrow-management-with-question.png');
  await clickText('Alt+i to answer');await wait('AGENT_QUESTION');
  await page.waitForFunction(()=>visual.text().includes('Continue')&&!visual.text().includes('AGENT_DONE'));
  await page.keyboard.press('Enter');
  await ready();
  await page.keyboard.press('Alt+s');await wait('AGENT_DONE');
  await shot('16-question-answered-after-management.png');
  await page.keyboard.press('Alt+i');await page.keyboard.type('Unsent draft');await wait('Unsent draft');
  await page.keyboard.press('Alt+o');await wait('Browse marketplace');
  await page.keyboard.press('Alt+,');await wait('Add provider');
  await page.keyboard.press('Alt+i');await wait('Unsent draft');
  await shot('17-draft-preserved-after-management.png');
  report.checks.push('At 48x18, global plugin/settings shortcuts work while the toolbar is hidden and a question waits; returning to the question completes the turn, and later navigation preserves an unsent draft');
  report.ok=report.errors.length===0;
} catch(error){report.errors.push(String(error));await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{
  await browser?.close();
  if(server&&server.exitCode===null){const end=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await end;}
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  if(!report.ok)process.exitCode=1;
}
