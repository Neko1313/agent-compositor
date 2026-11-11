import {expect,it} from 'vitest';
import {AgentCore,ScriptedProvider} from '../src/index.js';
import {TokenBudget} from '@agent-compositor/context';
it('sends the configured output reserve without provider capacity metadata',async()=>{
 const provider=new ScriptedProvider([{text:'done'}]),events:any[]=[];
 const core=new AgentCore({cwd:process.cwd(),provider,tools:[],systemPrompt:'Help with the task.',compaction:{budget:new TokenBudget({contextWindow:8192,reserveOutput:700,reserveSystem:0}),limits:()=>({contextWindow:8192,reserveOutput:700,reserveSystem:0}),summarize:async()=> 'Progress'}});core.subscribe(e=>events.push(e));
 try{await core.submit('Continue');expect(core.failure).toBeUndefined();expect(provider.requests[0].maxOutputTokens).toBe(700);expect(events.find(e=>e.event==='context.pressure').input.reserve).toBe(700);}finally{await core.close();}
});
it('honors an embedder budget reserve without a separate limits callback',async()=>{
 const provider=new ScriptedProvider([{text:'done'}]);const core=new AgentCore({cwd:process.cwd(),provider,tools:[],systemPrompt:'Help.',compaction:{budget:new TokenBudget({contextWindow:8192,reserveOutput:300,reserveSystem:0}),summarize:async()=> 'Progress'}});
 try{await core.submit('Continue');expect(provider.requests[0].maxOutputTokens).toBe(300);}finally{await core.close();}
});
it('caps a configured reserve at the provider output ceiling',async()=>{
 const scripted=new ScriptedProvider([{text:'done'}]);const provider={...scripted,complete:scripted.complete.bind(scripted),capabilities:async()=>({contextWindow:16384,maxOutputTokens:256,source:'provider' as const})};
 const core=new AgentCore({cwd:process.cwd(),provider,tools:[],systemPrompt:'Help.',compaction:{budget:new TokenBudget({contextWindow:8192,reserveOutput:2048,reserveSystem:0}),limits:()=>({contextWindow:8192,reserveOutput:2048,reserveSystem:0}),summarize:async()=> 'Progress'}});
 try{await core.submit('Continue');expect(core.failure).toBeUndefined();expect(scripted.requests[0].maxOutputTokens).toBe(256);}finally{await core.close();}
});
it('keeps small context defaults usable and rejects invalid output reservations',()=>{
 const budget=new TokenBudget({contextWindow:2048});expect(budget.usable).toBeGreaterThan(0);
 for(const reserveOutput of [0,-1,NaN,1.5])expect(()=>new TokenBudget({contextWindow:8192,reserveOutput})).toThrow(/output reserve/i);
});
it('resolves auxiliary profile ceilings without borrowing the foreground profile or changing its context',async()=>{
 const scripted=new ScriptedProvider([{text:'Auxiliary result'}]),profiles:(string|undefined)[]=[];
 const provider={...scripted,complete:scripted.complete.bind(scripted),capabilities:async(_signal:AbortSignal,profile?:string)=>{profiles.push(profile);return{contextWindow:8192,maxOutputTokens:profile==='small'?96:1000,source:'provider' as const};}};
 const core=new AgentCore({cwd:process.cwd(),provider,modelProfile:'main',tools:[]});
 try{const contextBefore=core.getContextWindow();for await(const _ of core.streamModel({messages:[{role:'user',content:'Review this change'}],tools:[],signal:new AbortController().signal,profile:'small',maxOutputTokens:512})){}
 expect(profiles).toEqual(['small']);expect(scripted.requests[0]).toMatchObject({profile:'small',maxOutputTokens:96});expect(core.getContextWindow()).toBe(contextBefore);}finally{await core.close();}
});
it('stops generation when the selected capacity service denies resolution',async()=>{
 const provider=new ScriptedProvider([{text:'Must not run'}]),core=new AgentCore({cwd:process.cwd(),provider,tools:[]});
 core.host.registerPlugin({name:'capacity-policy',version:'1.0.0',trust:'trusted'},{'service.model.capabilities':()=>({deny:'Capacity policy denied this profile'})});
 try{await core.submit('Run task');expect(provider.requests).toHaveLength(0);expect(core.failure).toContain('Capacity policy denied');}finally{await core.close();}
});
it('restores configured limits after provider ceilings change or disappear',async()=>{
 const scripted=new ScriptedProvider([{text:'First'},{text:'Second'},{text:'Third'}]);let ceiling:number|undefined=128;
 const provider={...scripted,complete:scripted.complete.bind(scripted),get capabilities(){return ceiling===undefined?undefined:async()=>({contextWindow:8192,maxOutputTokens:ceiling,source:'provider' as const});}};
 const core=new AgentCore({cwd:process.cwd(),provider,tools:[],systemPrompt:'Help.',compaction:{budget:new TokenBudget({contextWindow:8192,reserveOutput:900,reserveSystem:0}),summarize:async()=> 'Progress'}});
 try{await core.submit('First');ceiling=2000;await core.submit('Second');ceiling=undefined;await core.submit('Third');expect(scripted.requests.map(r=>r.maxOutputTokens)).toEqual([128,900,900]);}finally{await core.close();}
});
it('cancels an idle auxiliary capacity hook before generation starts',async()=>{
 const provider=new ScriptedProvider([{text:'Must not run'}]),core=new AgentCore({cwd:process.cwd(),provider,tools:[]}),abort=new AbortController();let started=false,hookSignal:AbortSignal|undefined;
 core.host.registerPlugin({name:'capacity-wait',version:'1.0.0',trust:'trusted'},{'service.model.capabilities':async(_event,$)=>{hookSignal=$.signal;started=true;await new Promise<void>(done=>$.signal.addEventListener('abort',()=>done(),{once:true}));return{value:{contextWindow:8192,maxOutputTokens:256,source:'provider'}};}});
 try{const request=(async()=>{for await(const _ of core.streamModel({messages:[{role:'user',content:'Review'}],tools:[],signal:abort.signal,maxOutputTokens:500})){} })();
 await expect.poll(()=>started).toBe(true);abort.abort(Error('Cancelled auxiliary capacity lookup'));await expect(request).rejects.toThrow('Cancelled auxiliary');expect(hookSignal?.aborted).toBe(true);expect(provider.requests).toHaveLength(0);}finally{await core.close();}
});
