import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,access,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-recovery');await mkdir(output,{recursive:true});await rm(resolve(output,'steer-persisted'),{force:true});
const report={ok:false,checks:[],screenshots:[],errors:[]};let server,browser,page;
try{
 server=spawn('bun',['tools/visual/server.mjs'],{env:{...process.env,VISUAL_RECOVERY:'1',VISUAL_OUTPUT:output},stdio:['ignore','pipe','inherit']});
 const url=await new Promise((done,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Server timeout')),15000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/VISUAL_URL=(http[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});server.once('exit',code=>fail(Error('Server exit '+code)));});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1400,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);
 const wait=text=>page.waitForFunction(value=>visual.text().includes(value),text,{timeout:20000});
 async function send(text,key='Enter'){await page.keyboard.press('Alt+i');await page.keyboard.type(text);await page.waitForFunction(value=>visual.text().split('\n').some(line=>line.includes('› '+value)),text);await page.keyboard.press(key);}
 async function shot(name){await page.screenshot({path:resolve(output,name)});report.screenshots.push(name);}
 await wait('Describe your task');await send('HOLD_FOR_RECOVERY');await wait('RECOVERY_HOLDING');
 if(process.env.VISUAL_STEER_RECOVERY){
  await send('PLEASE_REVIEW_AFTER_RESTART','Tab');
  await page.waitForFunction(()=>!visual.text().split('\n').some(line=>line.includes('› PLEASE_REVIEW_AFTER_RESTART')));
  const deadline=Date.now()+20000;while(Date.now()<deadline&&!await access(resolve(output,'steer-persisted')).then(()=>true,()=>false))await new Promise(done=>setTimeout(done,25));
  await access(resolve(output,'steer-persisted'));
 }else {await send('PLEASE_REVIEW_AFTER_RESTART');await wait('1 queued');}
 if(process.env.VISUAL_RECOVERY_CURRENT){
  if(process.env.VISUAL_STEER_RECOVERY)throw Error('Current-session scenario requires a queued message');
  await page.keyboard.press('Alt+i');await page.keyboard.press('Control+c');await wait('Queued messages cancelled');
  if(await page.evaluate(()=>visual.text().includes('RECOVERY_RETRIED')))throw Error('Interrupted message ran without a user decision');
  await send('/recover');await wait('1. PLEASE_REVIEW_AFTER_RESTART');await shot('01-current-list.png');
  await send('/recover retry 1');await wait('RECOVERY_RETRIED');await shot('02-current-retry.png');
  report.checks.push('An interrupted queued prompt is reviewable and retried explicitly without restart');report.ok=!report.errors.length;
 }else{
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();
 await page.waitForFunction(g=>visual.generation>g,generation);await wait('recovered message');
 if(await page.evaluate(()=>visual.text().includes('RECOVERY_RETRIED')))throw Error('Recovered prompt ran without a user decision');
 await shot('01-recovery-notice.png');await send('/recover');await wait('PLEASE_REVIEW_AFTER_RESTART');await shot('02-recovery-list.png');
 await send('/recover retry 1');await wait('RECOVERY_RETRIED');await shot('03-explicit-retry.png');
 const again=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();
 await page.waitForFunction(g=>visual.generation>g,again);await wait('RECOVERY_RETRIED');await send('/recover');await wait('No recovered messages need review.');
 report.checks.push(process.env.VISUAL_STEER_RECOVERY?'Unapplied steering is reviewed after restart and runs only on explicit retry':'An interrupted queued prompt is reviewed after restart and runs only on explicit retry');report.ok=!report.errors.length;
 }
}catch(error){report.errors.push(String(error));await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(server&&server.exitCode===null){const end=new Promise(done=>server.once('exit',done));server.kill('SIGTERM');await end;}await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
