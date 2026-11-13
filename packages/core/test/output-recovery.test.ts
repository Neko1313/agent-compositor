import {afterEach,expect,it} from 'vitest';
import {AgentCore,ScriptedProvider,replayTranscript} from '../src/index.js';
import type {AgentCoreOptions} from '../src/loop.js';
import type {ScriptedStep} from '../src/provider.js';
import type {SessionEvent} from '@agent-compositor/session';

const cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();});
function fixture(script:ScriptedStep[],options:Partial<AgentCoreOptions>={}){
 const executed:unknown[]=[],journal:SessionEvent[]=[],provider=new ScriptedProvider(script);
 const core=new AgentCore({cwd:process.cwd(),provider,controlTools:[],tools:[{
  name:'record',description:'Record a value',parameters:{type:'object',properties:{value:{type:'string'}}},describe:()=>({tool:'record'}),
  execute:async(_ctx,args)=>{executed.push(args);return{ok:true,data:args,modelText:JSON.stringify(args)};},
 }],rules:[{tool:'record',decision:'allow'}],sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}},...options});
 cores.push(core);return{core,provider,executed,journal};
}
const call=(value:string)=>({name:'record',args:{value}});

it('discards every call in a truncated response, retries with guidance and replays the exact recovered transcript',async()=>{
 const f=fixture([
  {text:'Incomplete claim',toolCalls:[call('discard-1'),call('discard-2')],finish:'length',usage:{inputTokens:10,outputTokens:20}},
  {toolCalls:[call('complete')],usage:{inputTokens:30,outputTokens:40}},
  {text:'Verified completion',usage:{inputTokens:50,outputTokens:60}},
 ]);
 await f.core.submit('Record a value');
 expect(f.core.failure).toBeUndefined();expect(f.executed).toEqual([{value:'complete'}]);expect(f.provider.requests).toHaveLength(3);
 const retry=f.provider.requests[1].messages;
 expect(retry.at(-1)).toMatchObject({role:'user',origin:'harness',content:expect.stringContaining('truncated')});
 expect(JSON.stringify(retry)).not.toContain('Incomplete claim');expect(retry.flatMap(m=>m.toolCalls??[])).toEqual([]);
 expect(f.journal.filter(e=>e.type==='tool.call')).toHaveLength(1);
 expect(f.journal.find(e=>e.type==='turn.usage')).toMatchObject({inputTokens:90,outputTokens:120});
 const replay=replayTranscript(JSON.parse(JSON.stringify(f.journal)));
 expect(JSON.parse(JSON.stringify(replay))).toEqual(JSON.parse(JSON.stringify(f.core.getMessages())));
 const provider=new ScriptedProvider([{text:'Continued'}]);
 const resumed=AgentCore.resume({cwd:process.cwd(),provider},JSON.parse(JSON.stringify(f.journal)));cores.push(resumed);
 await resumed.submit('Continue');expect(provider.requests[0].messages.some(m=>m.origin==='harness'&&m.content.includes('truncated'))).toBe(true);
 expect(JSON.stringify(provider.requests[0].messages)).not.toContain('Incomplete claim');
});

it('allows only one recovery per turn, including when a successful tool batch separates truncations',async()=>{
 const f=fixture([{toolCalls:[call('discard')],finish:'length'},{toolCalls:[call('complete')]},{toolCalls:[call('discard-again')],finish:'length'},{text:'Must not run'}]);
 await f.core.submit('Record a value');expect(f.core.failure).toContain('output/context limit');expect(f.provider.requests).toHaveLength(3);expect(f.executed).toEqual([{value:'complete'}]);
});

it('does not retry beyond the last permitted step',async()=>{
 const f=fixture([{toolCalls:[call('discard')],finish:'length'},{text:'Must not run'}],{maxStepsPerTurn:1});
 await f.core.submit('Record a value');expect(f.provider.requests).toHaveLength(1);expect(f.executed).toEqual([]);expect(f.core.failure).toContain('output/context limit');
});

it('counts recovery against the ordinary step limit',async()=>{
 const f=fixture([{finish:'length'},{toolCalls:[call('complete')]},{text:'Must not run'}],{maxStepsPerTurn:2});
 await f.core.submit('Record a value');expect(f.provider.requests).toHaveLength(2);expect(f.executed).toEqual([{value:'complete'}]);expect(f.core.failure).toContain('Step limit (2)');
});

it('does not treat an ordinary provider error as output truncation',async()=>{
 const f=fixture([{toolCalls:[call('discard')],finish:'error',error:'Provider unavailable'},{text:'Must not run'}]);
 await f.core.submit('Record a value');expect(f.provider.requests).toHaveLength(1);expect(f.executed).toEqual([]);expect(f.core.failure).toBe('Provider unavailable');
});

it('keeps token exhaustion authoritative even when the response would otherwise be retried',async()=>{
 const f=fixture([{toolCalls:[call('discard')],finish:'length',usage:{inputTokens:50000,outputTokens:50000}},{text:'Must not run'}],{maxTokensPerTurn:100000});
 await f.core.submit('Record a value');expect(f.provider.requests).toHaveLength(1);expect(f.executed).toEqual([]);expect(f.core.failure).toContain('Token budget exhausted');
});

it('sends the retried call through ordinary permission checks',async()=>{
 const f=fixture([{toolCalls:[call('discard')],finish:'length'},{toolCalls:[call('denied')]},{text:'Action denied'}],{rules:[{tool:'record',decision:'deny'}]});
 await f.core.submit('Record a value');expect(f.executed).toEqual([]);expect(f.provider.requests).toHaveLength(3);
 expect(f.journal.find(e=>e.type==='tool.result')).toMatchObject({ok:false,error:expect.stringContaining('denied')});
});

it('does not retry when saving the recovery boundary fails',async()=>{
 const f=fixture([{finish:'length'},{toolCalls:[call('must-not-run')]}],{sessions:{create:async()=>{},append:async(_id,events)=>{if(events.some(e=>e.type==='context.restored'))throw Error('Storage unavailable');}}});
 await f.core.submit('Record a value');expect(f.executed).toEqual([]);expect(f.provider.requests).toHaveLength(1);expect(f.core.failure).toContain('Storage unavailable');
});

it('keeps provider output ceilings unchanged during recovery',async()=>{
 const f=fixture([{finish:'length'},{text:'Short answer'}]);
 f.core.host.registerPlugin({name:'capacity-fixture',version:'1.0.0',trust:'trusted'},{'service.model.capabilities':()=>({value:{contextWindow:32768,maxOutputTokens:512,source:'provider'}})});
 await f.core.submit('Give a short answer');expect(f.core.failure).toBeUndefined();expect(f.provider.requests.map(r=>r.maxOutputTokens)).toEqual([512,512]);
});

it('honors interruption before a truncated response can trigger recovery',async()=>{
 const f=fixture([{text:'Partial answer',toolCalls:[call('discard')],finish:'length'},{text:'Must not run'}]);
 f.core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='assistant.text')f.core.interrupt();});
 await f.core.submit('Record a value');expect(f.provider.requests).toHaveLength(1);expect(f.executed).toEqual([]);expect(f.core.getState()).toBe('interrupted');
});
