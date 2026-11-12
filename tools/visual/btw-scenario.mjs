import assert from 'node:assert/strict';

/** Interactions use real terminal keys and cell-based mouse actions only. */
export async function btwScenario({page,wait,text,command,clickPane,closePane,shot,report}){
 await wait('Describe your task');await command('MAIN_TASK');await wait('MAIN_AGENT_WORKING');
 await command('/btw SIDE_QUESTION');await wait('SIDE_ANSWER');await shot('00-side-open');
 await clickPane('Side conversation');await page.keyboard.type('FOLLOWUP_QUESTION');await wait('FOLLOWUP_QUESTION');await page.keyboard.press('Enter');await wait('SIDE_FOLLOWUP');
 report.checks.push('conversation.concurrent','conversation.followup');
 await command('/chat');await wait('MAIN_AGENT_WORKING');await page.keyboard.press('Alt+i');await page.keyboard.type('MAIN_UNSENT_DRAFT');await wait('MAIN_UNSENT_DRAFT');
 await clickPane('Side conversation');await page.keyboard.type('SIDE_UNSENT_DRAFT');await wait('SIDE_UNSENT_DRAFT');await wait('MAIN_UNSENT_DRAFT');await shot('01-independent-drafts');
 await closePane('Side conversation');await wait('MAIN_UNSENT_DRAFT');
 await page.keyboard.press('Alt+i');await page.waitForFunction(()=>!visual.text().includes('Message → Side conversation'));for(const _ of 'MAIN_UNSENT_DRAFT')await page.keyboard.press('Backspace');await wait('Describe your task');
 await command('/btw');await wait('SIDE_UNSENT_DRAFT');await clickPane('Side conversation');await page.keyboard.press('Control+u');
 await page.keyboard.type('SIDE_HOLD');await wait('SIDE_HOLD');await page.keyboard.press('Enter');await wait('SIDE_AGENT_WORKING');await page.keyboard.press('Control+c');await wait('interrupted');
 await command('/chat');await wait('Working');assert.ok((await text()).includes('Working'),'Stopping the side agent must keep the main model running');
 report.checks.push('conversation.restore','draft.preserved','conversation.cancel');
 await page.keyboard.press('Control+c');await command('/btw');await clickPane('Side conversation');
 await page.evaluate(()=>visual.terminal.resize(60,24));await page.keyboard.type('NARROW42');await wait('NARROW42');await shot('02-side-narrow');await page.keyboard.press('Control+u');
 await page.evaluate(()=>visual.terminal.resize(100,30));
 const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();await page.waitForFunction(value=>visual.generation>value,generation);await wait('›');
 await command('/btw');await wait('SIDE_FOLLOWUP');await clickPane('Side conversation');await page.keyboard.type('AFTER_RESTART');await wait('AFTER_RESTART');await page.keyboard.press('Enter');await wait('Reply: Type a follow-up');await page.keyboard.press('PageDown');await wait('SIDE_RESUMED');await shot('03-side-restored');
 report.checks.push('view.narrow','ui.keyboard','ui.pointer','ui.focus','ui.submit','ui.cancel','ui.restart');
}
