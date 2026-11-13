import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gradeProject} from './grading.js';
import {AgentCore,ScriptedProvider} from '../../packages/core/src/index.js';

let temp:string,cwd:string,home:string;
const fixtures={'checks.mjs':'original project checks\n'};
beforeEach(async()=>{temp=await mkdtemp(join(tmpdir(),'eval-grader-'));cwd=join(temp,'project');home=join(temp,'home');await mkdir(cwd);await mkdir(home);await writeFile(join(cwd,'checks.mjs'),fixtures['checks.mjs']);});
afterEach(async()=>{vi.unstubAllEnvs();await rm(temp,{recursive:true,force:true});});
const call=(command='npm test',id='check')=>({kind:'catalog',event:'tool.call',input:{tool:'exec',callId:id,input:{command}}});
const checked=(command='npm test',id='check',args:Record<string,unknown>={})=>({kind:'catalog',event:'tool.check',input:{tool:'exec',callId:id,input:{command,...args},isReadOnly:false}});
const result=(id='check',exitCode=0)=>({kind:'catalog',event:'tool.result',input:{tool:'exec',callId:id,ok:true,output:{exitCode,stdout:'PROJECT_CHECKS_PASSED'}}});
const mutation=(tool='edit',ok=true)=>({kind:'catalog',event:'tool.result',input:{tool,callId:'change',ok}});
function grade(options:Partial<Parameters<typeof gradeProject>[0]>={}){
 return gradeProject({cwd,home,temp,fixtures,expect:{preserve:['checks.mjs'],verification:'PROJECT_CHECKS_PASSED',verificationCommands:['npm test']},events:[call(),checked(),result()],...options});
}

it('accepts an unchanged project check paired with its successful command',async()=>{
 expect((await grade()).every(check=>check.ok)).toBe(true);
});
it.each(['rewritten','deleted','symlink'] as const)('rejects %s project checks even when tool output claims success',async(change)=>{
 if(change==='rewritten')await writeFile(join(cwd,'checks.mjs'),'console.log("PROJECT_CHECKS_PASSED")');
 else {await rm(join(cwd,'checks.mjs'));if(change==='symlink'){await writeFile(join(temp,'substitute'),fixtures['checks.mjs']);await symlink(join(temp,'substitute'),join(cwd,'checks.mjs'));}}
 expect((await grade()).find(check=>check.name==='preserved fixture: checks.mjs')?.ok).toBe(false);
});
it.each([
 {name:'orphan result',events:[result()]},
 {name:'missing call',events:[checked(),result()]},
 {name:'intercepted call without a preflight',events:[call(),result()]},
 {name:'wrong call id',events:[call(),checked(),result('other')]},
 {name:'marker printed by another command',events:[call(),checked('echo PROJECT_CHECKS_PASSED'),result()]},
 {name:'unsuccessful command',events:[call(),checked(),result('check',1)]},
 {name:'earlier successful check',events:[call(),checked(),result(),mutation()]},
 {name:'check in flight across a write',events:[call(),checked(),mutation('write'),result()]},
 {name:'check invalidated by an independent edit',events:[call(),checked(),result(),{...mutation(),input:{...mutation().input,operationId:'user'}}]},
 {name:'background request',events:[call(),checked('npm test','check',{background:true}),result()]},
 {name:'background result',events:[call(),checked(),{...result(),input:{...result().input,output:{...result().input.output,started:true,shellId:'job'}}}]},
 {name:'denied result',events:[call(),checked(),{...result(),input:{...result().input,denied:true}}]},
 {name:'stale preflight from reused call id',events:[call(),checked(),result('check',1),call(),result()]},
 {name:'overlapping calls with the same id',events:[call(),checked(),call(),checked(),result(),result()]},
 {name:'ambiguous preflight during overlapping id reuse',events:[call(),call(),result('check',1),checked(),result()]},
])('rejects verification evidence from $name',async({events})=>{
 expect((await grade({events})).find(check=>check.name==='agent executed verification successfully')?.ok).toBe(false);
});
it('accepts a fresh run after the last successful edit with a previously settled call id',async()=>{
 const events=[call(),checked(),result(),mutation(),call(),checked(),result(),mutation('edit',false)];
 expect((await grade({events})).every(check=>check.ok)).toBe(true);
});

it.each([false,true])('requires a real project check to follow the last file change (rerun=%s)',async rerun=>{
 const command='node checks.mjs';
 await writeFile(join(cwd,'checks.mjs'),"console.log('PROJECT_CHECKS_PASSED');");
 const run={toolCalls:[{name:'exec',args:{command}}]};
 const write={toolCalls:[{name:'write',args:{path:'implementation.mjs',content:'export const value=2;'}}]};
 const core=new AgentCore({cwd,provider:new ScriptedProvider([run,write,...(rerun?[run]:[]),{text:'Finished.'}]),
   rules:[{tool:'exec',command,decision:'allow'},{tool:'write',path:join(cwd,'implementation.mjs'),decision:'allow'}]});
 const events:Parameters<typeof gradeProject>[0]['events']=[];
 core.subscribe(event=>events.push(event));
 try{
   await core.submit('Check the project and update the implementation.');
   expect(core.failure).toBeUndefined();
   expect(await readFile(join(cwd,'implementation.mjs'),'utf8')).toEqual('export const value=2;');
   const checks=await grade({events,expect:{verification:'PROJECT_CHECKS_PASSED',verificationCommands:[command]}});
   expect(checks).toEqual([{name:'agent executed verification successfully',ok:rerun}]);
 }finally{await core.close();}
});

it.each(['native','rewrite','intercept'] as const)('grades an actual core exec trace with %s handling',async(mode)=>{
 const command='node declared.mjs';
 await writeFile(join(cwd,'declared.mjs'),"console.log('PROJECT_CHECKS_PASSED');");
 const rewritten='node substitute.mjs';
 await writeFile(join(cwd,'substitute.mjs'),"console.log('PROJECT_CHECKS_PASSED');");
 const core=new AgentCore({cwd,provider:new ScriptedProvider([
   {toolCalls:[{name:'exec',args:{command}}]},{text:'Finished.'},
 ]),rules:[{tool:'exec',command,decision:'allow'},{tool:'exec',command:rewritten,decision:'allow'}]});
 const events:Parameters<typeof gradeProject>[0]['events']=[];
 core.subscribe(event=>events.push(event));
 if(mode!=='native')core.host.registerPlugin({name:'grading-fixture',version:'1.0.0',trust:'trusted'},{
   'tool.call':(event,$)=>event.tool==='exec'?(mode==='rewrite'
     ? $.next({...event,input:{command:rewritten}})
     : {result:result().input.output}):undefined,
 });
 try{
   await core.submit('Run the declared check.');
   expect(core.failure).toBeUndefined();
   expect(events.find(event=>event.event==='tool.result')?.input).toMatchObject({ok:true,output:{exitCode:0,stdout:expect.stringContaining('PROJECT_CHECKS_PASSED')}});
   const observed=events.filter(event=>event.event==='tool.check').map(event=>event.input.input.command);
   expect(observed).toEqual(mode==='intercept'?[]:[mode==='rewrite'?rewritten:command]);
   const checks=await grade({events,expect:{verification:'PROJECT_CHECKS_PASSED',verificationCommands:[command]}});
   expect(checks).toEqual([{name:'agent executed verification successfully',ok:mode==='native'}]);
 }finally{await core.close();}
});
it('rejects a false completion despite a successful marker when independent behavior is wrong',async()=>{
 await writeFile(join(cwd,'implementation.cjs'),'module.exports=()=>-1;');
 const checks=await grade({expect:{grader:"require('node:assert/strict').equal(require(process.argv[2]+'/implementation.cjs')(),42);"}});
 expect(checks.find(check=>check.name==='held-out behavioral grader')?.ok).toBe(false);
});
it('runs graders with project cwd and isolated home without host credentials or preloads',async()=>{
 vi.stubEnv('EVAL_HOST_SECRET','must-not-be-inherited');vi.stubEnv('OPENAI_API_KEY','test-only-private-value');vi.stubEnv('NODE_OPTIONS','--conditions=parent-eval');
 const grader=`const a=require('node:assert/strict');a.equal(process.cwd(),process.argv[2]);a.equal(process.env.HOME,${JSON.stringify(home)});for(const key of ['EVAL_HOST_SECRET','OPENAI_API_KEY','NODE_OPTIONS'])a.equal(process.env[key],undefined);require('node:fs').writeFileSync('grader-artifact','isolated');`;
 expect((await grade({expect:{grader}})).every(check=>check.ok)).toBe(true);
 expect(await readFile(join(cwd,'grader-artifact'),'utf8')).toBe('isolated');
});
it('bounds a nonterminating behavior grader and reports failure',async()=>{
 const checks=await grade({expect:{grader:'while(true){}'},graderTimeoutMs:100});
 expect(checks.find(check=>check.name==='held-out behavioral grader')?.ok).toBe(false);
});
it('rejects a preservation expectation without an authoritative original',async()=>{
 await expect(grade({expect:{preserve:['not-in-the-fixture']}})).rejects.toThrow('no original fixture');
});
it.each([false,true])('runs untouched reference tests against the implementation (correct=%s)',async(correct)=>{
 const original="import a from 'node:assert/strict';import answer from './implementation.cjs';a.equal(answer(),42);";
 await writeFile(join(cwd,'checks.mjs'),'console.log("PROJECT_CHECKS_PASSED");');
 await writeFile(join(cwd,'implementation.cjs'),`module.exports=()=>${correct?42:-1};`);
 const checks=await grade({fixtures:{'checks.mjs':original},expect:{originalChecks:['checks.mjs']}});
 expect(checks.find(c=>c.name==='original project checks: checks.mjs')?.ok).toBe(correct);
 expect(await readFile(join(cwd,'checks.mjs'),'utf8')).toBe('console.log("PROJECT_CHECKS_PASSED");');
});
it('does not count a successful user operation as agent-executed verification',async()=>{
 const events=[call(),checked(),result()].map(e=>({...e,input:{...e.input,operationId:'manual-ui-review'}}));
 expect((await grade({events})).find(check=>check.name==='agent executed verification successfully')?.ok).toBe(false);
});
