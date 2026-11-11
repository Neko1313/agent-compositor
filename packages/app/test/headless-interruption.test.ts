import {afterEach,expect,it} from 'vitest';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import {runHeadless} from '../src/headless.js';
import type {BuiltApp} from '../src/build.js';
const cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();});
function harness(interrupt:'during'|'before'|false,history=true){
 const provider=interrupt==='before'?{name:'interrupt-before-output',async *complete(){core.interrupt();yield{type:'finish' as const,reason:'stop' as const};}}:new ScriptedProvider([{text:interrupt?'Partial current answer':'Current completed answer',hold:!!interrupt}]);
 const core=AgentCore.resume({cwd:process.cwd(),provider},history?[{type:'prompt.submit',text:'An old task'},{type:'assistant.text',text:'Old answer must not become this response'},{type:'turn.complete',text:'Old answer must not become this response'}]:[]);
 if(history)expect(core.getMessages().some(message=>message.role==='assistant'&&message.content==='Old answer must not become this response')).toBe(true);
 cores.push(core);
 if(interrupt==='during')core.subscribe(event=>{if(event.kind==='text')core.interrupt();});
 return{core,app:{createCore:()=>core} as unknown as BuiltApp};
}
it.each(['json','stream-json','text'] as const)('reports interrupted %s execution as unsuccessful while preserving partial output',async(format)=>{
 const {app}=harness('during');let output='';const code=await runHeadless(app,'New task',format,text=>{output+=text;});
 expect(code).not.toBe(0);expect(output).not.toContain('Old answer must not become this response');
 if(format==='text'){expect(output).toContain('Partial current answer');expect(output).toMatch(/interrupted/i);}
 else{const result=JSON.parse(output.trim().split('\n').at(-1)!);expect(result).toMatchObject({type:'result',response:'Partial current answer'});expect(result.error).toMatch(/interrupted/i);}
});
it('never returns an older response if interrupted before current output',async()=>{
 const {app}=harness('before');let output='';const code=await runHeadless(app,'New task','json',text=>{output+=text;});
 expect(code).not.toBe(0);expect(JSON.parse(output)).toMatchObject({response:'',error:expect.stringMatching(/interrupted/i)});
});
it('keeps completed runs successful and returns only this turn',async()=>{
 const {app}=harness(false);let output='';expect(await runHeadless(app,'New task','json',text=>{output+=text;})).toBe(0);
 expect(JSON.parse(output)).toMatchObject({type:'result',response:'Current completed answer'});expect(JSON.parse(output)).not.toHaveProperty('error');
});
it('does not mistake a historical response for a handled host command result',async()=>{
 const {core,app}=harness(false);core.host.registerPlugin({name:'headless-test-command',version:'1.0.0',trust:'trusted'},{'prompt.submit':()=>({drop:'handled host command'})});
 let output='';expect(await runHeadless(app,'/host-command','json',text=>{output+=text;})).toBe(0);expect(JSON.parse(output).response).toBe('');
});
