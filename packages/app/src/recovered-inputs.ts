import type {AgentCore} from '@agent-compositor/core';
import {clean} from './presentation.js';

/** Explicit review only: a recovered entry could already have run or been cancelled. */
export function recoverySummary(core:AgentCore):string|undefined {
  const count=core.getRecoveredInputs().length;
  return count?`${count} recovered message${count===1?' needs':'s need'} review. Use /recover.`:undefined;
}
export async function recoveryCommand(core:AgentCore,text:string):Promise<string> {
  const words=text.trim().split(/\s+/),items=core.getRecoveredInputs();
  if(words.length===1){
    if(!items.length)return 'No recovered messages need review.';
    return 'Recovered messages may have run or been cancelled. Review before retrying.\n'+
      items.map((item,index)=>`${index+1}. ${clean(item.text).replace(/\n/g,' ').slice(0,160)}${item.text.length>160?'…':''}`).join('\n')+
      '\n/recover show N · /recover retry N · /recover discard N';
  }
  const index=Number(words[2])-1;
  if(words.length!==3||!Number.isSafeInteger(index)||index<0||!items[index]||!['show','retry','discard'].includes(words[1]))
    return 'Usage: /recover [show|retry|discard N]';
  const item=items[index];
  if(words[1]==='show')return `Recovered message ${index+1} (may have run or been cancelled):\n${clean(item.text)}`;
  if(words[1]==='discard'){await core.discardRecoveredInput(item.id);return 'Recovered message discarded.';}
  const admitted=await core.retryRecoveredInput(item.id);
  return admitted?'Recovered message submitted or queued.':'Recovered message was not submitted. Review it with /recover.';
}
