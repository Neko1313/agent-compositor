import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';

/** Actual process readings and terminal input; no seeded graph or synthetic UI events. */
export async function resourcesScenario({page,wait,text,command,click,shot,report,output,native=false}){
 const count=()=>page.evaluate(()=>Number(visual.text().match(/Samples (\d+)\/120/)?.[1]));
 const reveal=async value=>{for(let i=0;i<6&&!(await text()).includes(value);i++){const before=await text();await page.keyboard.press('PageDown');await page.waitForFunction(before=>visual.text()!==before,before);}await wait(value);};
 const full=async()=>{await wait('Resources');await click('Resources');if(!(await text()).includes('FULLSCREEN'))await page.keyboard.press('Alt+f');await page.waitForFunction(()=>visual.text().split('\n')[1]?.includes('Resources'));};
 await wait(native?'0/3 complete':'Describe your task');await command(native?'MAIN_TABLE_TASK':'RESOURCE_MAIN');await wait(native?'MAIN_TABLE_WORKING':'RESOURCE_AGENT_WORKING');
 await command('/resources');await full();await wait('CPU history (%)');
 await page.waitForFunction(()=>Number(visual.text().match(/Samples (\d+)\/120/)?.[1])>=3);assert.ok((await text()).includes('Working'));assert.match(await text(),/RSS: [0-9.]+ MiB/);assert.ok((await text()).includes('*'));await shot('00-live-cpu');
 await click('[ Pause ]');await wait('Paused');const paused=await count(),start=await page.evaluate(()=>performance.now());
 await page.waitForFunction(({count,start})=>{if(Number(visual.text().match(/Samples (\d+)\/120/)?.[1])!==count)throw Error('Paused monitor sampled automatically');return performance.now()-start>=2200;},{count:paused,start});
 await click('[Memory]');await wait('Resident memory history');await shot('01-paused-memory');await page.keyboard.press('ArrowLeft');await wait('CPU history (%)');
 await click('[ Sample now ]');await page.waitForFunction(previous=>Number(visual.text().match(/Samples (\d+)\/120/)?.[1])===previous+1,paused);assert.ok((await text()).includes('Paused'));
 await click('[ Clear history ]');await wait('Samples 1/120');
 await page.evaluate(()=>visual.terminal.resize(48,18));await wait('RSS:');await reveal('[ Resume ]');await wait('[ Sample now ]');await shot('02-resources-narrow');
 await page.evaluate(()=>visual.terminal.resize(100,30));await page.keyboard.press('Alt+q');await page.waitForFunction(()=>!visual.text().includes('│ Resources')&&visual.text().split('\n')[1]?.includes('Conversation'));assert.ok((await text()).includes('Working'));
 const closedStart=await page.evaluate(()=>performance.now());await page.waitForFunction(start=>{if(visual.text().includes('│ Resources'))throw Error('Closed monitor reopened');return performance.now()-start>=2200;},closedStart);
 await command('/resources');await full();await wait('Paused');await wait('Samples 2/120');
 await page.keyboard.press('Alt+i');await page.keyboard.press('Control+c');await wait('Interrupted');
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(value=>visual.generation>value,generation);await wait('Describe your task');
 await command('/resources');await full();await wait('Live');await wait('Samples 1/120');await shot('03-resources-fresh-restart');
 if(native){
  const launch=JSON.parse(await readFile(join(output,'fixture-launch.json'),'utf8')),identity=JSON.parse(await readFile(join(launch.cwd,'native-resources-identity.json'),'utf8'));
  assert.equal(identity.plugin,'resources');assert.equal(await realpath(identity.directory),await realpath(join(dirname(report.executable.path),'plugins/resources')));
  const manifest=JSON.parse(await readFile(join(identity.directory,'plugin.json'),'utf8'));assert.equal(identity.version,manifest.version);
  report.resourcePlugin={...identity,sha256:createHash('sha256').update(await readFile(join(identity.directory,'hooks.js'))).digest('hex')};
  report.transport=JSON.parse(await readFile(join(output,'workflow-transport.json'),'utf8'));assert.deepEqual(report.transport.requests,['main']);assert.equal(report.transport.paidRequests,0);}
 report.checks.push('view.narrow','ui.keyboard','ui.pointer','ui.focus','ui.submit','ui.cancel','ui.restart','resources.live','resources.pause','resources.sample','resources.clear','resources.closed','resources.no-model');
}
