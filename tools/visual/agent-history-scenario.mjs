import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Journal drill-down through actual terminal input; no core or UI method calls. */
export async function agentHistoryScenario({page,wait,click,text,command,shot,report,output}){
 const title=name=>page.waitForFunction(name=>visual.text().split('\n')[1]?.includes(name),name);
 const fullscreen=async name=>{await wait(name);if(!(await text()).includes('FULLSCREEN'))await page.keyboard.press('Alt+f');await title(name);};
 const capture=async name=>{
  await page.evaluate(()=>new Promise((done,fail)=>{const timer=setTimeout(()=>{subscription.dispose();fail(Error('Terminal paint timeout'));},5000);const subscription=visual.terminal.onRender(()=>{subscription.dispose();clearTimeout(timer);requestAnimationFrame(()=>requestAnimationFrame(done));});visual.terminal.refresh(0,visual.terminal.rows-1);}));
  await shot(name);
 };
 await wait('0/3 complete');await command('MAIN_TABLE_TASK');await wait('MAIN_TABLE_WORKING');
 await command('/agents create-shared Historian');await wait('Y allow once');await page.keyboard.type('y');await wait('Reply: Type a follow-up');
 await click('Reply: Type a follow-up');await page.keyboard.press('Alt+f');await title('Historian');
 await page.keyboard.type('HISTORY_TABLE_TASK');await wait('Reply: HISTORY_TABLE_TASK');await page.keyboard.press('Enter');await wait('HISTORY_INSPECTION_DONE');await wait('Reply: Type a follow-up');
 await click('[ Saved activity ]');await fullscreen('Activity: Historian');await wait('Saved activity');assert.ok((await text()).includes('Working'));
 await click('[Tools]');await wait('Saved activity · 2 records');await wait('tool.result');await click('tool.result');await wait('"type": "tool.result"');await page.keyboard.press('PageDown');await wait('HISTORICAL_TOOL_EVIDENCE');await capture('00-saved-tool-result');
 await page.keyboard.press('ArrowLeft');await page.waitForFunction(()=>!visual.text().includes('tool.result'));await page.keyboard.press('ArrowRight');await wait('Saved activity · 2 records');await wait('tool.result');
 await click('tool.call');await wait('history-proof.txt');await capture('01-saved-tool-arguments');
 await page.evaluate(()=>visual.terminal.resize(60,24));await wait('Tool: read');await capture('02-history-narrow');
 await page.evaluate(()=>visual.terminal.resize(100,30));await page.keyboard.press('Alt+i');await page.keyboard.press('Control+c');await wait('Interrupted');
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(value=>visual.generation>value,generation);await wait('Describe your task');
 await command('/agents');await fullscreen('Agents');await wait('+ Historian');await click('+ Historian');await click('[ Saved activity ]');await fullscreen('Activity: Historian');await click('[Tools]');await wait('Saved activity · 2 records');await click('tool.result');await wait('"type": "tool.result"');await page.keyboard.press('PageDown');await wait('HISTORICAL_TOOL_EVIDENCE');await capture('03-history-after-restart');
 report.transport=JSON.parse(await readFile(join(output,'workflow-transport.json'),'utf8'));assert.deepEqual([...report.transport.requests].sort(),['history-call','history-result','main']);assert.equal(report.transport.paidRequests,0);
 report.checks.push('native.history.concurrent-main','native.history.tool-arguments','native.history.tool-result','native.history.filters','native.history.keyboard','native.history.narrow','native.history.restart','native.history.bounded-transport');
}
