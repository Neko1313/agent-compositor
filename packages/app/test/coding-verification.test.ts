import {afterEach,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp,type BuiltApp} from '../src/build.js';
import {ScriptedProvider,type ScriptedStep} from '@agent-compositor/core';
const roots:string[]=[],apps:BuiltApp[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(script:ScriptedStep[],agent:Record<string,unknown>={instructionsPreset:'coding'},check="import a from 'node:assert/strict';import{readFileSync}from'node:fs';a.equal(readFileSync('result.txt','utf8'),'fixed');console.log('CHECK_OK');"){
 const cwd=await mkdtemp(join(tmpdir(),'coding-verification-'));roots.push(cwd);await writeFile(join(cwd,'verify.mjs'),check);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agent-harness'],agent:{...agent,tools:['write','exec'],builtinTools:['write','exec'],controlTools:[],projectContext:false,skills:false,fileReferences:false},permissions:{rules:[{tool:'write',path:cwd+'/**',decision:'allow'},{tool:'exec',command:'node verify.mjs',decision:'allow'}]}}));
 const provider=new ScriptedProvider(script),app=await buildApp({cwd,env:{HOME:cwd},provider});apps.push(app);const core=app.createCore(async()=>false);return{core,provider};
}
const write={toolCalls:[{name:'write',args:{path:'result.txt',content:'fixed'}}]};
it('coding preset verifies a write without requiring a saved task plan',async()=>{
 const f=await fixture([write,{text:'Done without a check.'},{toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},{text:'CHECK_OK verified.'}]);
 await f.core.submit('Fix the project and verify it');expect(f.provider.requests).toHaveLength(4);expect(f.core.failure).toBeUndefined();expect(f.provider.requests[2].messages.some(message=>message.content.includes('no successful verification command'))).toBe(true);
});
it('keeps unchecked coding changes failed after bounded completion feedback',async()=>{
 const f=await fixture([write,{text:'Everything passes.'},{text:'Everything passes.'},{text:'Everything passes.'}]);await f.core.submit('Fix and verify');expect(f.core.failure).toContain('Completion checks remain unsatisfied');expect(f.provider.requests).toHaveLength(4);
});
it('does not accept a nonzero project check as coding verification',async()=>{
 const f=await fixture([write,{toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},{text:'Passed.'},{text:'Passed.'},{text:'Passed.'}],{instructionsPreset:'coding'},'process.exit(1);');await f.core.submit('Fix and verify');expect(f.core.failure).toContain('Completion checks remain unsatisfied');expect(f.provider.requests).toHaveLength(5);
});
it.each([{instructionsPreset:'general'},{instructionsPreset:'coding',verifyCompletion:false}])('preserves the general preset and explicit verification opt-out: %j',async agent=>{
 const f=await fixture([write,{text:'Saved.'}],agent);await f.core.submit('Save this text');expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(2);
});
it('requires finished matching background output and rejects running, failed, killed or unrelated jobs',async()=>{
 const {successfulVerification}=await import('../src/harness.js');
 const start={name:'exec',ok:true,args:{command:'npm test'},output:{started:true,shellId:'job'}},done={name:'exec_output',ok:true,args:{id:'job'},output:{id:'job',done:true,exitCode:0}};
 expect(successfulVerification([start])).toBe(false);expect(successfulVerification([start,done])).toBe(true);
 for(const changed of [{...done,output:{...done.output,done:false}},{...done,output:{...done.output,exitCode:1}},{...done,args:{id:'another'}},{...done,output:{...done.output,id:'another'}}])expect(successfulVerification([start,changed])).toBe(false);
 expect(successfulVerification([start,{name:'exec_kill',ok:true,args:{id:'job'},output:{killed:true}},done])).toBe(false);
 expect(successfulVerification([{name:'project_check',ok:true,args:{action:'run',name:'test'},output:{exitCode:0}}])).toBe(true);
 expect(successfulVerification([{name:'project_check',ok:true,args:{action:'run',name:'test'},output:{exitCode:1}}])).toBe(false);
});
it('invalidates an earlier passed check after a later edit',async()=>{
 const f=await fixture([write,{toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},{toolCalls:[{name:'write',args:{path:'result.txt',content:'regressed'}}]},{text:'The previous check passed.'},{toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},{text:'Passed.'},{text:'Passed.'}]);
 await f.core.submit('Keep the final change verified');expect(f.provider.requests).toHaveLength(7);expect(f.core.failure).toContain('Completion checks remain unsatisfied');
});
