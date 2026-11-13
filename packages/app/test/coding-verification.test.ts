import {afterEach,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp,type BuiltApp} from '../src/build.js';
import {ScriptedProvider,type ScriptedStep} from '@agent-compositor/core';
const roots:string[]=[],apps:BuiltApp[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(script:ScriptedStep[],agent:Record<string,unknown>={instructionsPreset:'coding'},check="import a from 'node:assert/strict';import{readFileSync}from'node:fs';a.equal(readFileSync('result.txt','utf8'),'fixed');console.log('CHECK_OK');",checkFile='verify.mjs',extraChecks:Record<string,string>={}){
 const cwd=await mkdtemp(join(tmpdir(),'coding-verification-'));roots.push(cwd);await writeFile(join(cwd,checkFile),check);
 for(const [file,text] of Object.entries(extraChecks))await writeFile(join(cwd,file),text);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agent-harness'],agent:{...agent,tools:['write','edit','exec'],builtinTools:['write','edit','exec'],controlTools:[],projectContext:false,skills:false,fileReferences:false},permissions:{rules:[{tool:'edit',path:cwd+'/**',decision:'allow'},{tool:'write',path:cwd+'/**',decision:'allow'},...[checkFile,...Object.keys(extraChecks)].map(file=>({tool:'exec',command:`node ${file}`,decision:'allow'}))]}}));
 const provider=new ScriptedProvider(script),app=await buildApp({cwd,env:{HOME:cwd},provider});apps.push(app);const core=app.createCore(async()=>false);return{core,provider,cwd};
}
const write={toolCalls:[{name:'write',args:{path:'result.txt',content:'fixed'}}]};
const unchanged:ScriptedStep = {toolCalls:[{name:'edit',args:{path:'result.txt',oldText:'wrong',newText:'wrong',strict:true}}]};
it('rejects unsupported success after only failed edit attempts', async () => {
 const claim = {text:'The fix was applied, and the tests are now passing.'};
 const f = await fixture([unchanged,claim,claim,claim], undefined, undefined, 'verify.mjs', {'result.txt':'wrong'});
 await f.core.submit('Repair the wrong result and run checks');
 expect(f.core.failure).toContain('Completion checks remain unsatisfied');
 expect(f.provider.requests).toHaveLength(4);
 expect(f.provider.requests[2].messages.at(-1)?.content).toContain('No write or edit succeeded');
});
it('allows an explicit unchanged outcome or a successful repair after an unsuccessful edit', async () => {
 const blocked = await fixture([unchanged,{text:'[no file changes] The attempted edit made no change. Checks were not run.'}]);
 await blocked.core.submit('Try to fix the output');
 expect(blocked.core.failure).toBeUndefined();
 expect(blocked.provider.requests).toHaveLength(2);
 const fixed = await fixture([unchanged,{text:'Fixed.'},write,{toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},{text:'Repaired and verified.'}]);
 await fixed.core.submit('Fix and verify');
 expect(fixed.core.failure).toBeUndefined();
 expect(fixed.provider.requests).toHaveLength(5);
});
it('accepts an executed checks.mjs project check without redundant completion retries',async()=>{
 const f=await fixture([write,{toolCalls:[{name:'exec',args:{command:'node checks.mjs'}}]},{text:'The project checks passed.'}],{instructionsPreset:'coding'},undefined,'checks.mjs');
 await f.core.submit('Fix the project and run its existing checks');
 expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(3);
});
it('coding preset verifies a write without requiring a saved task plan',async()=>{
 const f=await fixture([write,{text:'Done without a check.'},{toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},{text:'CHECK_OK verified.'}]);
 await f.core.submit('Fix the project and verify it');expect(f.provider.requests).toHaveLength(4);expect(f.core.failure).toBeUndefined();expect(f.provider.requests[2].messages.some(message=>message.content.includes('no successful verification command'))).toBe(true);
});
it('keeps unchecked coding changes failed after bounded completion feedback',async()=>{
 const f=await fixture([write,{text:'Everything passes.'},{text:'Everything passes.'},{text:'Everything passes.'}]);await f.core.submit('Fix and verify');expect(f.core.failure).toContain('Completion checks remain unsatisfied');expect(f.provider.requests).toHaveLength(4);
});
it('does not accept a nonzero project check as coding verification',async()=>{
 const f=await fixture([write,{toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},{text:'Passed.'},{text:'Passed.'},{text:'Passed.'}],{instructionsPreset:'coding'},'process.exit(1);');await f.core.submit('Fix and verify');expect(f.core.failure).toContain('Completion checks remain unsatisfied');expect(f.provider.requests).toHaveLength(5);
 const reminder=f.provider.requests[3].messages.at(-1)?.content??'';
 expect(reminder).toContain('Rerun unresolved checks only when authorized');expect(reminder).not.toContain('refused by permission policy');
});
it('preserves permission denial evidence and avoids telling the model to rerun a refused check',async()=>{
 const f=await fixture([write,{toolCalls:[{name:'exec',args:{command:'node scratch-check.mjs'}}]},{text:'Changed the file.'},{text:'[verification unavailable] Permission policy refused the scratch check; no verification was executed.'}]);
 const finishes:any[]=[];f.core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='service.agent.finish')finishes.push(event.input);});
 await f.core.submit('Fix the project and verify it');
 expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(4);
 expect(finishes[0].tools.find((tool:any)=>tool.name==='exec')).toMatchObject({ok:false,denied:true});
 const reminder=f.provider.requests[3].messages.at(-1)?.content??'';
 expect(reminder).toContain('refused by permission policy');
 expect(reminder).toContain('Do not rerun');expect(reminder).toContain('[verification unavailable]');
 expect(reminder).not.toContain('Rerun unresolved checks');
});
it('does not count a different passing check as clearing a permission-blocked verification',async()=>{
 const f=await fixture([write,{toolCalls:[{name:'exec',args:{command:'node scratch-check.mjs'}}]},{toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},{text:'All checks passed.'},{text:'[verification unavailable] The existing project check passed; the separate scratch check was refused and was not run.'}]);
 await f.core.submit('Fix the project and verify it');
 expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(5);
 const reminder=f.provider.requests[4].messages.at(-1)?.content??'';
 expect(reminder).toContain('refused by permission policy');
 expect(f.provider.requests.flatMap(request=>request.messages).filter(message=>message.role==='user'&&message.origin==='harness').some(message=>message.content.includes('Rerun unresolved checks'))).toBe(false);
});
it('does not carry a refused verification across a later edit',async()=>{
 const f=await fixture([write,{toolCalls:[{name:'exec',args:{command:'node scratch-check.mjs'}}]},write,{text:'Done.'},{toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},{text:'The final edit passed its check.'}]);
 await f.core.submit('Fix the project and verify the final edit');
 expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(6);
 const reminder=f.provider.requests[4].messages.at(-1)?.content??'';
 expect(reminder).toContain('no successful verification command');expect(reminder).not.toContain('refused by permission policy');
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

it.each([false,true])('uses the latest real execution of a check, recovered=%s',async recovered=>{
 const run={toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]};
 const final=[{text:'All checks passed.'},{text:'All checks passed.'},{text:'All checks passed.'}];
 const f=await fixture([write,run,run,...(recovered?[run]:[]),...final],{instructionsPreset:'coding'},"import{existsSync,readFileSync,writeFileSync}from'node:fs';const n=existsSync('attempts')?Number(readFileSync('attempts','utf8')):0;writeFileSync('attempts',String(n+1));process.exit(n===1?1:0);");
 await f.core.submit('Verify the final result');
 if(recovered){expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(5);}
 else{expect(f.core.failure).toContain('Completion checks remain unsatisfied');expect(f.provider.requests).toHaveLength(6);}
});

it('keeps each attempted check unresolved until that check succeeds again',async()=>{
 const {successfulVerification:verified}=await import('../src/harness.js');
 const check=(command:string,exitCode:number,cwd?:string)=>({name:'exec',ok:true,args:{command,cwd},output:{exitCode}});
 const test=check('npm test',0),bad=check('npm test',1),lint=check('npm run lint',0);
 expect(verified([test,bad])).toBe(false);expect(verified([bad,lint])).toBe(false);
 expect(verified([bad,lint,test])).toBe(true);expect(verified([bad,{...test,ok:false}])).toBe(false);
 expect(verified([check('npm test',1,'a'),check('npm test',0,'b')])).toBe(false);
 expect(verified([{name:'project_check',ok:true,args:{action:'run',name:'test'},output:{exitCode:1}},lint])).toBe(false);
 const start={name:'exec',ok:true,args:{command:'npm test'},output:{started:true,shellId:'job'}};
 const done={name:'exec_output',ok:true,args:{id:'job'},output:{id:'job',done:true,exitCode:0}};
 expect(verified([test,start,lint])).toBe(false);expect(verified([start,lint,done])).toBe(true);
 expect(verified([start,bad,done])).toBe(false);
 expect(verified([start,{name:'write',ok:true},done])).toBe(false);
});

it('retains executed check obligations across edits instead of allowing an unrelated check to replace them',async()=>{
 const {successfulVerification:verified}=await import('../src/harness.js');
 const edit={name:'edit',ok:true},run=(command:string,exitCode:number)=>({name:'exec',ok:true,args:{command},output:{exitCode}});
 const test=run('npm test',0),bad=run('npm test',1),lint=run('npm run lint',0);
 expect(verified([bad,edit,lint])).toBe(false);
 expect(verified([test,edit,lint])).toBe(false);
 expect(verified([bad,edit,lint,test])).toBe(true);
 const project={name:'project_check',ok:true,args:{action:'run',name:'test'},output:{exitCode:1}};
 expect(verified([project,edit,lint])).toBe(false);
 expect(verified([project,edit,lint,{...project,output:{exitCode:0}}])).toBe(true);
});

it('keeps pre-edit background executions stale and does not promote denied-only checks into old execution obligations',async()=>{
 const {successfulVerification:verified}=await import('../src/harness.js');
 const edit={name:'write',ok:true},lint={name:'exec',ok:true,args:{command:'npm run lint'},output:{exitCode:0}};
 const start={name:'exec',ok:true,args:{command:'npm test'},output:{started:true,shellId:'old'}};
 const done={name:'exec_output',ok:true,args:{id:'old'},output:{id:'old',done:true,exitCode:0}};
 expect(verified([start,edit,done,lint])).toBe(false);
 expect(verified([start,edit,done,lint,{...start,output:{started:true,shellId:'new'}},{...done,args:{id:'new'},output:{id:'new',done:true,exitCode:0}}])).toBe(true);
 const denied={name:'exec',ok:false,denied:true,args:{command:'npm test'}};
 expect(verified([denied,edit,lint])).toBe(true);
 expect(verified([{...start,output:{exitCode:1}},denied,edit,lint])).toBe(false);
});

it('continues after a different check passes until the earlier executed test is rerun on the repaired file',async()=>{
 const verify={toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},lint={toolCalls:[{name:'exec',args:{command:'node lint.mjs'}}]};
 const f=await fixture([verify,write,lint,{text:'Everything passed.'},verify,{text:'Both checks passed on the final file.'}],undefined,undefined,undefined,{'lint.mjs':"console.log('LINT_OK');"});
 await writeFile(join(f.cwd,'result.txt'),'broken');await f.core.submit('Fix the file and verify the final result');
 expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(6);
 expect(f.provider.requests[4].messages.at(-1)?.content).toContain('Earlier executed checks need fresh results');
});

it('does not instruct a refused rerun when an earlier executed obligation survives another edit',async()=>{
 const verify={toolCalls:[{name:'exec',args:{command:'node verify.mjs'}}]},lint={toolCalls:[{name:'exec',args:{command:'node lint.mjs'}}]};
 const f=await fixture([verify,verify,write,lint,{text:'Everything passed.'},{text:'[verification unavailable] The original test failed and its rerun was refused. Only lint passed after the fix.'}],undefined,undefined,undefined,{'lint.mjs':"console.log('LINT_OK');"});
 let attempts=0;f.core.host.registerPlugin({name:'refuse-rerun',version:'1.0.0',trust:'trusted'},{'tool.check':(e:any)=>{if(e.tool==='exec'&&e.input?.command==='node verify.mjs'&&++attempts===2)return{decision:'deny',reason:'Explicit refusal'};}});
 await writeFile(join(f.cwd,'result.txt'),'broken');await f.core.submit('Fix and verify without bypassing refusals');
 expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(6);expect(attempts).toBe(2);
 const reminder=f.provider.requests[5].messages.at(-1)?.content??'';expect(reminder).toContain('refused by permission policy');expect(reminder).toContain('Do not rerun');expect(reminder).not.toContain('Rerun unresolved checks');
});
