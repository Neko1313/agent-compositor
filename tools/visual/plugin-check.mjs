import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const name=process.argv[2],output=resolve(process.env.VISUAL_OUTPUT??'dist/plugin-visual/'+name);await mkdir(output,{recursive:true});
const report={plugin:name,ok:false,checks:[],screenshots:[],errors:[]};let server,browser,page;
const entries={'test-reports':['/test-report','Test reports'],'ci-review':['/ci','CI review'],'project-checks':['/checks','Project checks'],'git-review':['/git-review','Git review'],cost:['/cost','Usage'],todos:['/todos','Todos'],'ui-theme':['/theme amber','amber'],'auto-approve':['/auto status','Auto approvals'],mascot:['/mascot status','Ghost:'],mcp:['/mcp','MCP'],workflows:['/workflows','Workflows'],'checkpoint-history':['/checkpoints','Checkpoints'],'network-proxy':['/proxy status','Network proxy']};
assert.ok(entries[name],'Unknown UI profile');
try{
 const{NO_COLOR,...env}=process.env;
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...env,VISUAL_CERT_PLUGIN:name,VISUAL_OUTPUT:output,...(name==='mascot'?{VISUAL_GRAPHICS:'kitty'}:{}),...(name==='git-review'?{VISUAL_GIT_FIXTURE:'1'}:{})},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('PTY startup timeout')),15000);server.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/VISUAL_URL=(http[^\s]+)/);if(m){clearTimeout(timer);done(m[1]);}});server.once('exit',code=>{clearTimeout(timer);fail(Error('PTY exited '+code));});});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1400,height:1100}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
 const wait=text=>page.waitForFunction(t=>visual.text().includes(t),text,{timeout:15000});
 const text=()=>page.evaluate(()=>visual.text());
 async function clickCell(col,row){const point=await page.evaluate(({col,row})=>{const rect=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:rect.x+(col+.5)*rect.width/visual.terminal.cols,y:rect.y+(row+.5)*rect.height/visual.terminal.rows};},{col,row});await page.mouse.click(point.x,point.y);}
 async function clickText(value){await wait(value);const point=await page.evaluate(t=>{const lines=visual.text().split('\n'),row=lines.findIndex(line=>line.includes(t));return{row,col:lines[row].indexOf(t)+1};},value);await clickCell(point.col,point.row);}
 async function command(value){await page.keyboard.press('Alt+i');await page.keyboard.type(value);await wait('› '+value);await page.keyboard.press('Enter');await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));}
 async function shot(label,{includes=[],excludes=[]}={}){
  // Parsed terminal cells can precede xterm's painted DOM by a frame.
  await page.evaluate(()=>new Promise((done,fail)=>{
   const timer=setTimeout(()=>{subscription.dispose();fail(Error('Terminal paint timeout'));},5000);
   const subscription=visual.terminal.onRender(()=>{
    subscription.dispose();clearTimeout(timer);
    requestAnimationFrame(()=>requestAnimationFrame(done));
   });
   visual.terminal.refresh(0,visual.terminal.rows-1);
  }));
  const check=screen=>{for(const value of includes)assert.ok(screen.includes(value),`${label}: missing ${value}`);for(const value of excludes)assert.ok(!screen.includes(value),`${label}: unexpected ${value}`);};
  const before=await text();check(before);
  const path=label+'.png';await page.screenshot({path:join(output,path)});check(await text());
  await writeFile(join(output,label+'.txt'),before);report.screenshots.push(path);
 }
 async function panePosition(title,close=false){
  await page.waitForFunction(({title,close})=>visual.text().split('\n').some(line=>line.split(/[\u2500-\u257f]/).some(part=>part.replace(/\[[Fx]\]/g,'').trim()===title&&(!close||part.includes('[x]')))),{title,close});
  return page.evaluate(({title,close})=>{const lines=visual.text().split('\n');for(let row=0;row<lines.length;row++)for(const part of lines[row].split(/[\u2500-\u257f]/))if(part.replace(/\[[Fx]\]/g,'').trim()===title&&(!close||part.includes('[x]')))return{row,col:lines[row].indexOf(part)+part.indexOf(close?'[x]':title)+1};throw Error('Pane disappeared: '+title);},{title,close});
 }
 async function clickPane(title){const p=await panePosition(title);await clickCell(p.col,p.row);}
 async function closePane(title){await clickPane(title);const p=await panePosition(title,true);await clickCell(p.col,p.row);}
 await wait('Describe your task');await command(entries[name][0]);await wait(entries[name][1]);await shot('00-open');
 if(name==='cost')await wait('42 input');
 if(name==='todos')await wait('Inspect project');
 if(name==='git-review'){
  await clickText('Refresh status');await wait('## main');await shot('01-git-status');
  await clickText('Working diff');await wait('+WORKING_REVIEW_EVIDENCE');await shot('01-git-working');
  await clickText('Staged diff');await wait('+STAGED_REVIEW_EVIDENCE');
  await clickPane('Git review');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await wait('+WORKING_REVIEW_EVIDENCE');
  await clickText('Configure output');await wait('Configure Git review');await page.keyboard.press('Control+a');await page.keyboard.type('8000');await wait('8000');await page.keyboard.press('Tab');await page.keyboard.press('ArrowRight');await wait('All projects');await clickText('[ Save ]');await wait('Settings saved');await wait('8000 characters');
  await clickText('Configure output');await wait('Configure Git review');await wait('8000');await shot('01-git-settings');await page.keyboard.press('Escape');await wait('Git review');
  await page.evaluate(()=>visual.terminal.resize(48,18));await wait('Refresh status');await clickText('Refresh status');await wait('## main');await shot('01-git-narrow');
  await clickText('Close');await page.waitForFunction(()=>!visual.text().includes('Refresh status'));await command('/git-review');await wait('## main');
  await clickText('Close');await page.waitForFunction(()=>!visual.text().includes('Refresh status'));
  await page.evaluate(()=>visual.terminal.resize(100,30));
  await page.waitForFunction(()=>visual.text().split('\n').some(line=>line.indexOf('┐',90)!==-1));
  report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
  const fixture=JSON.parse(await readFile(join(output,'fixture-identity.json'),'utf8'));
  assert.ok(fixture.cwd.includes('compositor-visual-'),'Expected the isolated PTY project');
  await command('Work while I review Git');await wait('GIT_AGENT_WORKING');
  await command('/git-review');await wait('Refresh status');await wait('## main');
  assert.ok((await text()).split('\n').slice(-2).some(line=>line.includes('Working')),'Opening a new panel must not interrupt or complete the model');
  await shot('01-git-open-while-working');report.checks.push('user-command.concurrent-open');
  await writeFile(join(fixture.cwd,'concurrent-proof.txt'),'Fresh status evidence');
  await clickText('Refresh status');await wait('concurrent-proof.txt');
  assert.ok((await text()).split('\n').slice(-2).some(line=>line.includes('Working')),'A user tool must not complete the model turn');
  await writeFile(join(fixture.cwd,'.git-review-slow'),'controlled dependency');
  await clickText('Working diff');await wait('Cancel review');
  let pid=0;for(let attempt=0;attempt<200&&!pid;attempt++){pid=Number(await readFile(join(fixture.cwd,'git-review-worker.pid'),'utf8').catch(()=>''));if(!pid)await new Promise(done=>setTimeout(done,10));}
  assert.ok(pid>0,'A real owned process must start');await shot('01-git-concurrent-process');
  await clickText('Cancel review');await wait('Git review cancelled');assert.throws(()=>process.kill(pid,0));
  assert.ok((await text()).split('\n').slice(-2).some(line=>line.includes('Working')),'Cancelling a user tool must leave the model running');
  await shot('01-git-concurrent-cancelled');await rm(join(fixture.cwd,'.git-review-slow'));
  await page.keyboard.press('Alt+i');await page.keyboard.press('Control+c');await wait('Interrupted');
  await command('Continue after review');await wait('GIT_AGENT_DONE');
  report.checks.push('user-tool.concurrent','user-tool.cancel-isolated','user-tool.process-cleanup');

 }else if(name==='ci-review'){
  await wait('Configuration required');await clickText('Configure');await wait('Configure CI review');
  for(const value of ['fixture/repo','4','4000','5000']){await page.keyboard.press('Control+a');await page.keyboard.type(value);await page.keyboard.press('Tab');}
  await page.keyboard.press('ArrowRight');await wait('User / all projects');await shot('01-ci-settings');await clickText('[ Save ]');await wait('Settings saved');
  await clickText('Refresh runs');await wait('CI_FIXTURE_FAILED');await wait('CI_FIXTURE_PASSED');await shot('01-ci-runs');
  await clickText('Run 701:');await wait('Unit tests · failure');await shot('01-ci-jobs');
  await clickText('Failed logs');await wait('CI_FAILED_LOG_EVIDENCE');await clickText('Full logs');await wait('CI_FULL_LOG_EVIDENCE');await shot('01-ci-logs');
  await clickText('Configure');await wait('Configure CI review');await wait('fixture/repo');await page.keyboard.press('Escape');await page.waitForFunction(()=>!visual.text().includes('Configure CI review'));
  const fixture=JSON.parse(await readFile(join(output,'fixture-identity.json'),'utf8'));
  await command('Work while I review CI');await wait('CI_AGENT_WORKING');await command('/ci');await wait('Refresh runs');
  await clickText('Configure');await wait('Configure CI review');await page.keyboard.press('Tab');await wait('2/7 ·');await page.keyboard.press('Control+a');await page.keyboard.type('3');await wait('› 3');await shot('01-ci-editing-while-working');await clickText('[ Save ]');
  await wait('Saved in project scope.');await wait('maxRuns 3');
  assert.ok((await text()).split('\n').slice(-2).some(line=>line.includes('Working')),'Saving settings must leave the main model running');await shot('01-ci-concurrent-settings');
  assert.equal((await readFile(join(fixture.cwd,'ci-calls.jsonl'),'utf8')).trim().split('\n').length,4,'Saving settings must not fetch CI automatically');
  await clickText('Refresh runs');
  // A started subprocess and an old result do not acknowledge this refresh.
  // Wait for its unique rendered response before issuing the next request.
  await wait('CI_FIXTURE_FAILED #5');await page.waitForFunction(()=>!visual.text().includes('Cancel'));
  const working=async()=>assert.ok((await text()).split('\n').slice(-2).some(line=>line.includes('Working')),'The main model must remain active');await working();
  async function slow(){
   await rm(join(fixture.cwd,'ci-worker.pid'),{force:true});await writeFile(join(fixture.cwd,'.ci-slow'),'controlled dependency');await clickText('Refresh runs');await wait('Cancel');await wait('CI operation in progress');
   let pid=0;for(let i=0;i<200&&!pid;i++){pid=Number(await readFile(join(fixture.cwd,'ci-worker.pid'),'utf8').catch(()=>''));if(!pid)await new Promise(done=>setTimeout(done,10));}
   assert.ok(pid>0,'A real gh fixture subprocess must start');return pid;
  }
  const pid=await slow();await shot('01-ci-running',{includes:['CI operation in progress','Cancel','CI_AGENT_WORKING','CI_FIXTURE_FAILED #5']});await clickText('Cancel');
  // The conversation receives the tool error before the panel's finally view.
  // Cancellation is settled only after the pending panel state disappears.
  await page.waitForFunction(()=>visual.text().includes('CI review cancelled.')&&!visual.text().includes('CI operation in progress'));
  assert.throws(()=>process.kill(pid,0));await working();assert.ok(!(await text()).includes('CI operation in progress'),'Settled cancellation must remove the busy status');await shot('01-ci-cancelled',{includes:['CI review cancelled.','CI_AGENT_WORKING'],excludes:['CI operation in progress']});
  const closed=await slow();await clickText('Close');await page.waitForFunction(()=>!visual.text().includes('Refresh runs'));
  for(let i=0;i<200;i++){try{process.kill(closed,0);}catch{break;}await new Promise(done=>setTimeout(done,10));}assert.throws(()=>process.kill(closed,0));await working();await rm(join(fixture.cwd,'.ci-slow'));
  const calls=(await readFile(join(fixture.cwd,'ci-calls.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(calls.length,7);assert.ok(calls.every(args=>args.at(-2)==='--repo'&&args.at(-1)==='fixture/repo'));assert.equal(calls[4][calls[4].indexOf('--limit')+1],'3','The next request must use the concurrently saved limit');
  await command('/ci');await wait('Refresh runs');await page.keyboard.press('Alt+i');await page.keyboard.press('Control+c');await wait('Interrupted');await command('Continue after CI review');await wait('CI_AGENT_DONE');
  report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit','user-command.concurrent-open','user-tool.concurrent','user-tool.cancel-isolated','user-tool.process-cleanup','user-tool.close-cleanup','ci.explicit-requests','ci.fixed-repository','settings.concurrent','ci.visible-progress');
 }else if(name==='test-reports'){
  const fixture=JSON.parse(await readFile(join(output,'fixture-identity.json'),'utf8'));
  await clickPane('Test reports');await page.keyboard.press('Enter');await wait('4 tests · 1 passed · 2 failed · 1 skipped');await wait('FIRST_REPORT_DETAIL');
  await page.keyboard.press('ArrowDown');await wait('SECOND_REPORT_DETAIL');await shot('01-report-failures',{includes:['SECOND_REPORT_DETAIL']});
  await clickText('1. first failing assertion');await wait('FIRST_REPORT_DETAIL');
  await clickPane('Test reports');await page.keyboard.press('Control+u');await page.keyboard.type('missing.json');await wait('Report path: missing.json');await page.keyboard.press('Enter');await wait('ENOENT');await wait('Last loaded: reports/tests.json');await shot('01-report-error',{includes:['FIRST_REPORT_DETAIL','Last loaded: reports/tests.json']});
  await page.keyboard.press('Tab');await page.keyboard.press('Enter');await wait('Configure test reports');
  for(const value of ['reports/tests.json','2','4000']){await page.keyboard.press('Control+a');await page.keyboard.type(value);await wait(value);await page.keyboard.press('Tab');}
  await page.keyboard.press('ArrowRight');await wait('All projects');await shot('01-report-settings');await clickText('[ Save ]');await wait('Settings saved');await wait('Limits: 2 failures · 4000 bytes');await wait('Report path: reports/tests.json');
  await clickText('Read report');await wait('Report loaded.');await clickText('Close');await page.waitForFunction(()=>!visual.text().includes('Report path:'));
  await command('Work while I inspect reports');await wait('REPORT_AGENT_WORKING');await command('/test-report');await wait('Read report');
  const working=async()=>assert.ok((await text()).split('\n').slice(-2).some(line=>line.includes('Working')),'Report operations must leave the main model active');await working();
  await page.keyboard.press('Alt+i');await page.keyboard.type('REPORT_DRAFT_UNSENT');await wait('› REPORT_DRAFT_UNSENT');
  await clickText('Read report');await wait('Report loaded.');await working();await shot('01-report-concurrent',{includes:['REPORT_DRAFT_UNSENT','FIRST_REPORT_DETAIL']});
  await clickText('Configure report defaults');await wait('Configure test reports');await page.keyboard.press('Escape');await page.waitForFunction(()=>!visual.text().includes('Configure test reports'));await wait('› REPORT_DRAFT_UNSENT');await working();
  const entered=join(fixture.cwd,'.report-entered'),exited=join(fixture.cwd,'.report-exited'),gate=join(fixture.cwd,'.report-slow');
  const waitFile=async file=>{for(let i=0;i<200;i++){if(await readFile(file,'utf8').then(()=>true,()=>false))return;await new Promise(done=>setTimeout(done,10));}throw Error('Controlled report dependency did not settle: '+file);};
  async function slow(){await rm(entered,{force:true});await rm(exited,{force:true});await writeFile(gate,'controlled dependency');await clickText('Read report');await wait('Cancel read');await waitFile(entered);}
  await slow();await shot('01-report-reading',{includes:['Cancel read','FIRST_REPORT_DETAIL']});await clickText('Cancel read');await waitFile(exited);await wait('Report read cancelled.');await page.waitForFunction(()=>!visual.text().includes('Cancel read')&&!visual.text().includes('Cancelling read'));await working();await wait('› REPORT_DRAFT_UNSENT');
  await slow();await clickText('Close');await waitFile(exited);await page.waitForFunction(()=>!visual.text().includes('Report path:'));await working();await rm(gate);await page.keyboard.press('Alt+i');for(const _ of 'REPORT_DRAFT_UNSENT')await page.keyboard.press('Backspace');await wait('Describe your task');await command('/test-report');await wait('Read report');await shot('01-report-cancelled',{includes:['Report read cancelled.']});
  // Management commands append to the composer draft; explicitly clear the
  // retained draft before the command rather than losing it silently.
  await page.keyboard.press('Alt+i');await page.keyboard.press('Control+u');await page.keyboard.press('Control+c');await wait('Interrupted');await command('Continue after reports');await wait('REPORT_AGENT_DONE');
  report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit','user-command.concurrent-open','user-tool.concurrent','user-tool.cancel-isolated','user-tool.close-cleanup','report.explicit-read','report.keyboard-failures','report.previous-results','settings.concurrent','draft.preserved');
 }else if(name==='project-checks'){
  await clickText('Refresh scripts');await wait('Run check');
  await clickText('Run check');await wait('passed (exit 0)');await wait('PROJECT_CHECK_OUTPUT');await shot('01-check-pass');
  await clickText('Run fail');await wait('failed (exit 7)');await wait('PROJECT_CHECK_FAILURE');await shot('01-check-fail');
  await clickText('Configure limits');await wait('Configure project checks');await page.keyboard.press('Control+a');await page.keyboard.type('2000');
  await page.keyboard.press('Tab');await page.keyboard.press('Control+a');await page.keyboard.type('2000');
  await page.keyboard.press('Tab');await page.keyboard.press('ArrowRight');await wait('All projects');await clickText('[ Save ]');await wait('Settings saved');await wait('timeoutMs 2000');
  await clickText('Configure limits');await wait('Configure project checks');await wait('2000');await shot('01-check-settings');await page.keyboard.press('Escape');await page.waitForFunction(()=>!visual.text().includes('Configure project checks'));await wait('Settings saved');
  await command('Work while I run checks');await wait('CHECK_AGENT_WORKING');await command('/checks');await wait('Refresh scripts');
  await clickText('Run check');await wait('PROJECT_CHECK_OUTPUT');
  assert.ok((await text()).split('\n').slice(-2).some(line=>line.includes('Working')),'The main model remains active during a check');
  const fixture=JSON.parse(await readFile(join(output,'fixture-identity.json'),'utf8'));
  async function slow(){
   await rm(join(fixture.cwd,'check-worker.pid'),{force:true});await clickText('Run slow');await wait('Cancel run');
   let pid=0;for(let i=0;i<200&&!pid;i++){pid=Number(await readFile(join(fixture.cwd,'check-worker.pid'),'utf8').catch(()=>''));if(!pid)await new Promise(done=>setTimeout(done,10));}
   assert.ok(pid>0,'A real npm child must start');return pid;
  }
  const pid=await slow();await shot('01-check-running');await clickText('Cancel run');await wait('cancelled');
  // The tool journal settles before the plugin publishes its final panel. Wait
  // for that panel before measuring coordinates for another script action.
  await wait('Project check cancelled or hook expired.');
  await page.waitForFunction(()=>!visual.text().includes('Cancel run')&&!visual.text().includes('Cancelling run'));
  assert.throws(()=>process.kill(pid,0));
  assert.ok((await text()).split('\n').slice(-2).some(line=>line.includes('Working')),'Check cancellation leaves the main model running');
  const closedPid=await slow();await clickText('Close');await page.waitForFunction(()=>!visual.text().includes('Refresh scripts'));
  for(let i=0;i<200;i++){try{process.kill(closedPid,0);}catch{break;}await new Promise(done=>setTimeout(done,10));}
  assert.throws(()=>process.kill(closedPid,0));assert.ok(!(await text()).includes('Refresh scripts'),'Settlement must not reopen the panel');
  await command('/checks');await wait('Refresh scripts');await shot('01-check-cancelled');
  await page.keyboard.press('Alt+i');await page.keyboard.press('Control+c');await wait('Interrupted');await command('Continue after checks');await wait('CHECK_AGENT_DONE');
  report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit','user-command.concurrent-open','user-tool.concurrent','user-tool.cancel-isolated','user-tool.process-cleanup','user-tool.close-cleanup');
 }else if(name==='auto-approve'){
  await wait('Mode: manual');await command('/auto on');await wait('Mode: auto');await clickText('Disable auto');await wait('Mode: manual');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='mcp'){
  await clickText('Refresh tools');await wait('Approval required');await page.keyboard.press('Alt+i');await page.keyboard.press('y');await wait('no MCP config');await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await clickPane('MCP');await page.keyboard.press('Alt+f');await wait('Last operation');await page.keyboard.press('Alt+f');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='workflows'){
  await clickPane('Workflows');await page.keyboard.press('Alt+f');await wait('WORKFLOW_BETA');await clickText('bbbbbb');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await wait('WORKFLOW_ALPHA');await clickText('Replay selected run');await wait('no Python source');await page.keyboard.press('Alt+f');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='checkpoint-history'){
  await clickText('Review');await wait('Review changes');await clickText('Review changes');await page.keyboard.press('Alt+f');await wait('BEFORE');await clickText('Keep change');await wait('kept');await page.keyboard.press('Alt+f');await closePane('Review changes');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='mascot'){
  await command('/mascot pause');await wait('paused');await command('/mascot pet');await wait('Done!');await command('/mascot status');await wait('pause: on');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }else if(name==='network-proxy'){
  await command('/proxy configure');await wait('Configure network proxy');await page.keyboard.press('Tab');await page.keyboard.type('http://127.0.0.1:7890');await page.keyboard.press('Tab');await page.keyboard.insertText('fixture-user👩🏽‍💻');await wait('fixture-user👩🏽‍💻');await page.keyboard.press('Backspace');await page.waitForFunction(()=>!visual.text().includes('👩'));await page.keyboard.press('Tab');await page.keyboard.insertText('PRIVATE_PROXY_FIXTURE👩🏽‍💻');await page.keyboard.press('Backspace');await wait('fixture-user');await wait('4/11 ·');await wait('•');assert.ok(!(await text()).includes('PRIVATE_PROXY_FIXTURE'));await shot('01-private-form');for(let i=5;i<=10;i++){await page.keyboard.press('Tab');await wait(i+'/11 ·');}await wait('Save and apply');await clickText('Save and apply');await wait('Proxy settings saved');await wait('127.0.0.1:7890');assert.ok(!(await text()).includes('PRIVATE_PROXY_FIXTURE'));
  const identity=JSON.parse(await readFile(join(output,'fixture-identity.json'),'utf8')),savedProxy=JSON.parse(await readFile(join(identity.state,'proxy.json'),'utf8')),endpoint=new URL(savedProxy.url);assert.equal(decodeURIComponent(endpoint.username),'fixture-user');assert.equal(decodeURIComponent(endpoint.password),'PRIVATE_PROXY_FIXTURE');report.checks.push('form.unicode-private-editing');
  await clickPane('Network proxy');await page.keyboard.press('Alt+f');await clickText('Configure proxy');await wait('Configure network proxy');await page.keyboard.press('Escape');await wait('Network proxy');await page.keyboard.press('Alt+f');report.checks.push('ui.keyboard','ui.pointer','ui.focus','ui.submit');
 }
 await shot('02-interacted');
 await clickText('›');await page.keyboard.type('Draft survives terminal resize');await wait('Draft survives terminal resize');
 await page.evaluate(()=>visual.terminal.resize(60,24));await wait('Draft survives terminal resize');await wait(entries[name][1]);await shot('03-narrow');
 await page.evaluate(()=>visual.terminal.resize(100,30));await wait('Draft survives terminal resize');for(const _ of 'Draft survives terminal resize')await page.keyboard.press('Backspace');await wait('Describe your task');
 report.checks.push('view.narrow');
 if(name!=='mascot'&&name!=='ui-theme'){await closePane(entries[name][1]);await command(entries[name][0]);await wait(entries[name][1]);}else if(name==='mascot'){await command('/mascot off');await page.waitForFunction(()=>!visual.text().includes('Message ·'));await command('/mascot on');await wait('Message ·');}
 report.checks.push('ui.cancel');
 if(name==='network-proxy'){await command('/proxy configure');await wait('Configure network proxy');}
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(g=>visual.generation>g,generation);await wait('›');await command(entries[name][0]);await wait(entries[name][1]);
 if(name==='test-reports'){await wait('Limits: 2 failures · 4000 bytes');await wait('Report path: reports/tests.json');await clickText('Read report');await wait('FIRST_REPORT_DETAIL');}if(name==='ci-review'){await wait('fixture/repo');await wait('maxRuns 3');await clickText('Configure');await wait('Configure CI review');await wait('5000');await page.keyboard.press('Escape');await page.waitForFunction(()=>!visual.text().includes('Configure CI review'));}if(name==='project-checks'){await wait('Refresh scripts');await clickText('Configure limits');await wait('Configure project checks');await wait('2000');await page.keyboard.press('Escape');}if(name==='git-review'){await wait('Choose an action');await clickText('Configure output');await wait('Configure Git review');await wait('8000');await page.keyboard.press('Escape');}if(name==='auto-approve')await wait('Mode: manual');if(name==='todos')await wait('Inspect project');if(name==='cost')await wait('42 input');if(name==='network-proxy')await wait('127.0.0.1:7890');
 await shot('04-restarted');report.checks.push('ui.restart');assert.equal(report.errors.length,0);report.ok=true;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const end=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await end;}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
