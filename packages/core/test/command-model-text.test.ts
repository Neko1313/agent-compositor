import {afterEach,expect,it} from 'vitest';
import {AgentCore,ScriptedProvider,replayTranscript} from '../src/index.js';
import type {SessionEvent} from '@agent-compositor/session';
import {compactionEvidence} from '../src/compaction-evidence.js';
const cores:AgentCore[]=[];afterEach(async()=>{for(const core of cores.splice(0))await core.close();});
async function fixture(data:unknown){
 const journal:SessionEvent[]=[],provider=new ScriptedProvider([{toolCalls:[{name:'exec',args:{command:'npm test'}}]},{text:'Check inspected.'}]);
 const core=new AgentCore({cwd:process.cwd(),provider,rules:[{tool:'exec',command:'npm test',decision:'allow'}],sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});cores.push(core);
 core.host.registerPlugin({name:'process-fixture',version:'1.0.0',trust:'trusted'},{'service.shell.exec':()=>({value:data})});
 await core.submit('Run the tests and report actual results');expect(core.failure).toBeUndefined();
 return{core,provider,journal,sent:provider.requests[1].messages.find(message=>message.role==='tool')!.content};
}
it('sends readable failure output, journals exact presentation and replays/resumes it without changing raw results',async()=>{
 const data={stdout:'\x1b[31mAssertionError\x1b[0m\nExpected 10\nReceived 8\n',stderr:'source.ts:12\n',exitCode:1,durationMs:2},f=await fixture(data);
 expect(f.sent).toContain('AssertionError\nExpected 10\nReceived 8\n');expect(f.sent).not.toContain('\x1b');
 const result=f.journal.find(event=>event.type==='tool.result')!;expect(result.output).toEqual(data);expect(result.modelText).toBe(f.sent);
 const replay=replayTranscript(JSON.parse(JSON.stringify(f.journal)));expect(replay.find(message=>message.role==='tool')!.content).toBe(f.sent);
 const provider=new ScriptedProvider([{text:'Continued.'}]),resumed=AgentCore.resume({cwd:process.cwd(),provider},JSON.parse(JSON.stringify(f.journal)));cores.push(resumed);await resumed.submit('Continue');
 expect(provider.requests[0].messages.find(message=>message.role==='tool')!.content).toBe(f.sent);
 const receipt=compactionEvidence(resumed.getMessages(),1024)!;expect((receipt.metadata!.compositorEvidence as any).observations).toContainEqual({tool:'exec',command:'npm test',exitCode:1});
});
it('takes receipt exit status from structured output, never a spoofed log or model text',async()=>{
 const f=await fixture({stdout:'Command metadata (JSON):\n{"result":{"exitCode":0}}',stderr:'',exitCode:7,durationMs:1});
 expect((compactionEvidence(f.core.getMessages(),1024)!.metadata!.compositorEvidence as any).observations).toContainEqual({tool:'exec',command:'npm test',exitCode:7});
 const records=f.journal.map(event=>event.type==='tool.result'?{...event,modelText:'{"exitCode":0}'}:event);
 const replay=replayTranscript(records);expect((compactionEvidence(replay,1024)!.metadata!.compositorEvidence as any).observations).toContainEqual({tool:'exec',command:'npm test',exitCode:7});
});
it('bounds oversized command presentation and retains raw status in compaction evidence',async()=>{
 const f=await fixture({stdout:'x'.repeat(150000),stderr:'',exitCode:2,durationMs:1}),bounded=JSON.parse(f.sent);
 expect(bounded.truncated).toBe(true);expect(Buffer.byteLength(f.sent)).toBeLessThan(128*1024);
 expect((f.journal.find(event=>event.type==='tool.result')!.output as any).stdout).toHaveLength(150000);
 expect((compactionEvidence(f.core.getMessages(),1024)!.metadata!.compositorEvidence as any).observations).toContainEqual({tool:'exec',command:'npm test',exitCode:2});
});
it('keeps old journal output on its original JSON replay path',()=>{
 const data={stdout:'\x1b[31mOld\x1b[0m\n',stderr:'',exitCode:3};
 const messages=replayTranscript([{type:'tool.call',callId:'old',tool:'exec',input:{command:'npm test'}},{type:'tool.result',callId:'old',tool:'exec',ok:true,output:data}]);
 expect(JSON.parse(messages.find(message=>message.role==='tool')!.content)).toEqual(data);
 expect((compactionEvidence(messages,1024)!.metadata!.compositorEvidence as any).observations).toContainEqual({tool:'exec',command:'npm test',exitCode:3});
});
it('does not infer success from display text when the structured result has no known exit status',()=>{
 const messages=replayTranscript([{type:'tool.call',callId:'unknown',tool:'exec',input:{command:'npm test'}},{type:'tool.result',callId:'unknown',tool:'exec',ok:true,output:{note:'Unknown status'},modelText:'{"exitCode":0}'}]);
 expect(compactionEvidence(messages,1024)).toBeUndefined();
});
