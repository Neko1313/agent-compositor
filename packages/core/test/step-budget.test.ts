import {afterEach,expect,it} from 'vitest';
import {AgentCore,ScriptedProvider} from '../src/index.js';

const cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();});

it('warns once before the final two steps without increasing the limit or executing extra tools',async()=>{
 const call={name:'record',args:{}};
 const provider=new ScriptedProvider([{toolCalls:[call]},{toolCalls:[call]},{toolCalls:[call]},{toolCalls:[call]},{text:'unexpected'}]);
 let executed=0;
 const core=new AgentCore({cwd:process.cwd(),provider,maxStepsPerTurn:4,controlTools:[],tools:[{name:'record',description:'Record',parameters:{type:'object',properties:{}},describe:()=>({tool:'record'}),execute:async()=>{executed++;return{ok:true,data:{},modelText:'ok'};}}],rules:[{tool:'record',decision:'allow'}]});
 cores.push(core);await core.submit('Work');
 expect(provider.requests).toHaveLength(4);expect(executed).toBe(4);expect(core.failure).toContain('Step limit (4)');
 const hints=provider.requests.map(request=>request.messages.filter(message=>message.origin==='harness'&&message.content.startsWith('Step budget:')));
 expect(hints.map(items=>items.length)).toEqual([0,0,1,1]);
 expect(hints[2][0].content).toContain('2 model steps');
});

it('does not warn for a turn completed without tools',async()=>{
 const provider=new ScriptedProvider([{text:'Done'}]);
 const core=new AgentCore({cwd:process.cwd(),provider,maxStepsPerTurn:3,controlTools:[]});cores.push(core);
 await core.submit('Hello');expect(provider.requests).toHaveLength(1);
 expect(provider.requests[0].messages.some(message=>message.content.startsWith('Step budget:'))).toBe(false);
});
