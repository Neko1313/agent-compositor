import {expect,it} from 'vitest';
import {AgentCore,ScriptedProvider} from '../src/index.js';
import {TokenBudget} from '@agent-compositor/context';
it('automatically recovers from a first oversized tool batch without losing the user request or replaying its effect',async()=>{
 let effects=0,summaries=0;const task='Analyze the export and preserve this exact task.';
 const provider=new ScriptedProvider([{toolCalls:[{name:'large',args:{}}]},{text:'Recovered'}]);
 const core=new AgentCore({cwd:process.cwd(),provider,systemPrompt:'System instructions',tools:[{name:'large',description:'Read project export',parameters:{type:'object'},describe:()=>({tool:'large',readOnly:true}),execute:async()=>{effects++;return{ok:true,data:'x'.repeat(30000)};}}],rules:[{tool:'large',decision:'allow'}],compaction:{budget:new TokenBudget({contextWindow:8192,reserveOutput:1024,reserveSystem:1024}),summarize:async()=>{summaries++;return'Export read successfully; analysis remains.';}}});
 try{await core.submit(task);expect(core.failure).toBeUndefined();expect(effects).toBe(1);expect(summaries).toBe(1);expect(provider.requests).toHaveLength(2);expect(provider.requests[1].messages.at(-1)).toMatchObject({role:'user',content:task});expect(provider.requests[1].messages.some(m=>m.role==='tool'||m.toolCalls?.length)).toBe(false);}finally{await core.close();}
});
