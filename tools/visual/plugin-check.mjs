import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const name=process.argv[2],output=resolve(process.env.VISUAL_OUTPUT??'dist/plugin-visual/'+name);await mkdir(output,{recursive:true});
const report={plugin:name,ok:false,checks:[],screenshots:[],errors:[]};let server,browser,page;
const entries={cost:['/cost','Usage'],todos:['/todos','Todos'],'ui-theme':['/theme amber','amber'],'auto-approve':['/auto status','Auto approvals'],mascot:['/mascot status','Ghost:'],mcp:['/mcp','MCP'],workflows:['/workflows','Workflows'],'checkpoint-history':['/checkpoints','Checkpoints'],'network-proxy':['/proxy status','Network proxy']};
assert.ok(entries[name],'Unknown UI profile');
try{
 const{NO_COLOR,...env}=process.env;
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...env,VISUAL_CERT_PLUGIN:name,VISUAL_OUTPUT:output,...(name==='mascot'?{VISUAL_GRAPHICS:'kitty'}:{})},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('PTY startup timeout')),15000);server.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/VISUAL_URL=(http[^\s]+)/);if(m){clearTimeout(timer);done(m[1]);}});server.once('exit',code=>{clearTimeout(timer);fail(Error('PTY exited '+code));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1400,height:1100}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
 const wait=text=>page.waitForFunction(t=>visual.text().includes(t),text,{timeout:15000});
 const text=()=>page.evaluate(()=>visual.text());
 async function clickCell(col,row){const point=await page.evaluate(({col,row})=>{const rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};},{col,row});await page.mouse.click(point.x,point.y);}
 async function clickText(value){await wait(value);const point=await page.evaluate(t=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(t));return{row,col:lines[row].indexOf(t)+1};},value);await clickCell(point.col,point.row);}
 async function command(value){await clickText('›');await page.keyboard.type(value);await wait('› '+value);await page.keyboard.press('Enter');await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));}
 async function shot(label){const path=label+'.png';await page.screenshot({path:join(output,path)});report.screenshots.push(path);}
 async function panePosition(title,close=false){
  await page.waitForFunction(({title,close})=>visual.text().split('\n').some(line=>line.split(/[\u2500-\u257f]/).some(part=>part.replace(/\[[Fx]\]/g,'').trim()===title&&(!close||part.includes('[x]')))),{title,close});
  return page.evaluate(({title,close})=>{const lines=visual.text().split('\n');for(let row=0;row<lines.length;row++)for(const part of lines[row].split(/[\u2500-\u257f]/))if(part.replace(/\[[Fx]\]/g,'').trim()===title&&(!close||part.includes('[x]')))return{row,col:lines[row].indexOf(part)+part.indexOf(close?'[x]':title)+1};throw Error('Pane disappeared: '+title);},{title,close});
 }
 async function clickPane(title){const p=await panePosition(title);await clickCell(p.col,p.row);}
 async function closePane(title){await clickPane(title);const p=await panePosition(title,true);await clickCell(p.col,p.row);}
 await wait('Describe your task');await command(entries[name][0]);await wait(entries[name][1]);await shot('00-open');
 if(name==='cost')await wait('42 input');
 if(name==='todos')await wait('Inspect project');
 if(name==='auto-approve'){
  await wait('Mode: manual');await command('/auto on');await wait('Mode: auto');await clickText('Disable auto');await wait('Mode: manual');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='mcp'){
  await clickText('Refresh tools');await wait('Approval required');await page.keyboard.press('y');await wait('no MCP config');await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await clickPane('MCP');await page.keyboard.press('Alt+f');await wait('Last operation');await page.keyboard.press('Alt+f');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='workflows'){
  await clickPane('Workflows');await page.keyboard.press('Alt+f');await wait('WORKFLOW_BETA');await clickText('bbbbbb');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await wait('WORKFLOW_ALPHA');await clickText('Replay selected run');await wait('no Python source');await page.keyboard.press('Alt+f');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='checkpoint-history'){
  await clickText('Review');await wait('Review changes');await clickText('Review changes');await page.keyboard.press('Alt+f');await wait('BEFORE');await clickText('Keep change');await wait('kept');await page.keyboard.press('Alt+f');await closePane('Review changes');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='mascot'){
  await command('/mascot pause');await wait('paused');await command('/mascot pet');await wait('Done!');await command('/mascot status');await wait('pause: on');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='network-proxy'){
  await command('/proxy configure');await wait('Configure network proxy');await page.keyboard.press('Tab');await page.keyboard.type('http://127.0.0.1:7890');await page.keyboard.press('Tab');await page.keyboard.type('fixture-user');await page.keyboard.press('Tab');await page.keyboard.type('PRIVATE_PROXY_FIXTURE');await wait('fixture-user');await wait('4/11 ·');await wait('•');assert.ok(!(await text()).includes('PRIVATE_PROXY_FIXTURE'));await shot('01-private-form');for(let i=5;i<=10;i++){await page.keyboard.press('Tab');await wait(i+'/11 ·');}await wait('Save and apply');await clickText('Save and apply');await wait('Proxy settings saved');await wait('127.0.0.1:7890');assert.ok(!(await text()).includes('PRIVATE_PROXY_FIXTURE'));
  await clickPane('Network proxy');await page.keyboard.press('Alt+f');await clickText('Configure proxy');await wait('Configure network proxy');await page.keyboard.press('Escape');await wait('Network proxy');await page.keyboard.press('Alt+f');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }
 await shot('02-interacted');
 await clickText('›');await page.keyboard.type('Draft survives terminal resize');await wait('Draft survives terminal resize');
 await page.evaluate(()=>visual.terminal.resize(60,24));await wait('Draft survives terminal resize');await wait(entries[name][1]);await shot('03-narrow');
 await page.evaluate(()=>visual.terminal.resize(100,30));await wait('Draft survives terminal resize');for(const _ of 'Draft survives terminal resize')await page.keyboard.press('Backspace');await page.waitForFunction(()=>!visual.text().includes('Draft survives terminal resize'));
 report.checks.push('view.narrow');
 if(name!=='mascot'&&name!=='ui-theme'){await closePane(entries[name][1]);await command(entries[name][0]);await wait(entries[name][1]);}else if(name==='mascot'){await command('/mascot off');await page.waitForFunction(()=>!visual.text().includes('Message ·'));await command('/mascot on');await wait('Message ·');}
 report.checks.push('ui.cancel');
 if(name==='network-proxy'){await command('/proxy configure');await wait('Configure network proxy');}
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(g=>visual.generation>g,generation);await wait('›');await command(entries[name][0]);await wait(entries[name][1]);
 if(name==='auto-approve')await wait('Mode: manual');if(name==='todos')await wait('Inspect project');if(name==='cost')await wait('42 input');if(name==='network-proxy')await wait('127.0.0.1:7890');
 await shot('04-restarted');report.checks.push('ui.restart');assert.equal(report.errors.length,0);report.ok=true;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const end=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await end;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
