import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Native input only; file reads verify persisted selection rather than driving UI. */
export async function conversationTabsScenario({page,wait,click,text,command,shot,report,output}){
 const title=name=>page.waitForFunction(name=>visual.text().split('\n')[1]?.includes(name),name);
 await wait('0/3 complete');await command('MAIN_TABLE_TASK');await wait('MAIN_TABLE_WORKING');
 for(const name of ['First','Second']){
  await command('/agents create-shared '+name);await wait('Y allow once');await page.keyboard.type('y');await wait('[ Send message ]');
  await command('/agents');await wait('[All ('+(name==='First'?'1':'2')+')]');
 }
 await page.keyboard.press('Alt+f');await title('Agents');await click('+ First');await click('[ Open conversation ]');await title('First');await wait('[Second]');
 await page.keyboard.type('SIDE_TABLE_TASK');await wait('Reply: SIDE_TABLE_TASK');await page.keyboard.press('Enter');await wait('SIDE_TABLE_DONE');await wait('idle · shared workspace');
 await page.keyboard.type('UNSENT_FIRST');await wait('Reply: UNSENT_FIRST');await page.keyboard.press('ArrowRight');await title('Second');
 assert.ok(!(await text()).includes('UNSENT_FIRST'));assert.ok(!(await text()).includes('SIDE_TABLE_DONE'));
 await page.keyboard.type('SECOND_TABLE_TASK');await wait('Reply: SECOND_TABLE_TASK');await click('[ Send message ]');await wait('SECOND_TABLE_DONE');await wait('idle · shared workspace');
 await page.keyboard.type('UNSENT_SECOND');await wait('Reply: UNSENT_SECOND');await page.keyboard.press('ArrowLeft');await title('First');await wait('Reply: UNSENT_FIRST');await wait('SIDE_TABLE_DONE');
 assert.ok(!(await text()).includes('SECOND_TABLE_DONE'));await page.keyboard.press('ArrowRight');await title('Second');await wait('Reply: UNSENT_SECOND');await shot('00-independent-conversations');
 await page.keyboard.press('Alt+q');await command('/agents');await wait('[All (2)]');await click('[ Open conversation ]');await title('First');await click('[Second]');await title('Second');await wait('Reply: UNSENT_SECOND');
 await page.evaluate(()=>visual.terminal.resize(60,24));await wait('[First]');await wait('[Second]');await wait('Reply: UNSENT_SECOND');await shot('01-conversations-narrow');assert.ok((await text()).includes('Working'));
 await page.evaluate(()=>visual.terminal.resize(100,30));await page.keyboard.press('Alt+i');await page.keyboard.press('Control+c');await wait('Interrupted');await click('[Second]');await title('Second');
 const launch=JSON.parse(await readFile(join(output,'fixture-launch.json'),'utf8'));
 const records=JSON.parse(await readFile(join(launch.state,'agents.json'),'utf8')),second=records.find(record=>record.name==='Second');assert.ok(second);
 const until=Date.now()+5000;let saved;
 while(Date.now()<until){saved=await readFile(join(launch.state,'layout.json'),'utf8').then(JSON.parse).catch(()=>undefined);if(saved?.windows?.focused==='plugin-agent-hub-agent-'+second.id)break;await new Promise(done=>setTimeout(done,10));}
 assert.equal(saved?.windows?.focused,'plugin-agent-hub-agent-'+second.id);
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(value=>visual.generation>value,generation);
 await title('Second');await wait('SECOND_TABLE_DONE');assert.ok(!(await text()).includes('UNSENT_SECOND'));await shot('02-selected-conversation-restored');
 await page.keyboard.press('ArrowLeft');await title('First');await wait('SIDE_TABLE_DONE');assert.ok(!(await text()).includes('SECOND_TABLE_DONE'));
 report.transport=JSON.parse(await readFile(join(output,'workflow-transport.json'),'utf8'));assert.deepEqual([...report.transport.requests].sort(),['main','second','side']);assert.equal(report.transport.paidRequests,0);
 report.checks.push('native.conversations.switch','native.conversations.isolated-context','native.conversations.independent-drafts','native.conversations.send-button','native.conversations.closed-reopen','native.conversations.narrow','native.conversations.persisted-selection','native.conversations.restart-history','native.conversations.bounded-transport');
}
