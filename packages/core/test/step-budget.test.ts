import {afterEach,expect,it} from 'vitest';
import {AgentCore,ScriptedProvider} from '../src/index.js';
import type {SessionEvent} from '@agent-compositor/session';

const cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();});

it('sends an accurate request-only warning for the final steps without affecting the next turn',async()=>{
 const call={name:'record',args:{}};
 const provider=new ScriptedProvider([{toolCalls:[call]},{toolCalls:[call]},{toolCalls:[call]},{toolCalls:[call]},{text:'Continued'}]);
 let executed=0;
 const core=new AgentCore({cwd:process.cwd(),provider,maxStepsPerTurn:4,controlTools:[],tools:[{name:'record',description:'Record',parameters:{type:'object',properties:{}},describe:()=>({tool:'record'}),execute:async()=>{executed++;return{ok:true,data:{},modelText:'ok'};}}],rules:[{tool:'record',decision:'allow'}]});
 cores.push(core);await core.submit('Work');
 expect(provider.requests).toHaveLength(4);expect(executed).toBe(4);expect(core.failure).toContain('Step limit (4)');
 const hints=provider.requests.map(request=>request.messages.filter(message=>message.origin==='harness'&&message.content.startsWith('Step budget:')));
 expect(hints.map(items=>items.length)).toEqual([0,0,1,1]);
 expect(hints[2][0].content).toContain('2 model steps');
 expect(hints[3][0].content).toContain('1 model step remains');
 expect(core.getMessages().some(message=>message.content.startsWith('Step budget:'))).toBe(false);
 await core.submit('Continue');
 expect(provider.requests[4].messages.some(message=>message.content.startsWith('Step budget:'))).toBe(false);
});

it('removes only the obsolete host warning when resuming an older transcript',async()=>{
 const legacy='Step budget: at most 2 model steps remain in this turn. Prioritize the next authorized action and any necessary verification. Do not assume a check passed; if work remains, report concrete results and what is unfinished.';
 const provider=new ScriptedProvider([{text:'Continued'}]);
 const events=[{type:'context.restored',messages:[{role:'user',origin:'harness',content:legacy},{role:'user',content:legacy},{role:'user',origin:'harness',content:'Step budget: unrelated plugin message'}]}] as unknown as SessionEvent[];
 const core=AgentCore.resume({cwd:process.cwd(),provider,controlTools:[]},events);cores.push(core);
 await core.submit('Continue');
 const messages=provider.requests[0].messages;
 expect(messages.filter(message=>message.content===legacy)).toEqual([{role:'user',content:legacy}]);
 expect(messages.some(message=>message.content==='Step budget: unrelated plugin message')).toBe(true);
});

it('does not warn for a turn completed without tools',async()=>{
 const provider=new ScriptedProvider([{text:'Done'}]);
 const core=new AgentCore({cwd:process.cwd(),provider,maxStepsPerTurn:3,controlTools:[]});cores.push(core);
 await core.submit('Hello');expect(provider.requests).toHaveLength(1);
 expect(provider.requests[0].messages.some(message=>message.content.startsWith('Step budget:'))).toBe(false);
});
