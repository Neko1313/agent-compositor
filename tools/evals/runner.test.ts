import {afterEach,expect,it,vi} from 'vitest';
import {runCase} from './runner.js';
afterEach(()=>vi.unstubAllEnvs());
it('keeps parent credentials and home settings out of model-executed project checks',async()=>{
 vi.stubEnv('EVAL_PARENT_SENTINEL','private-parent-marker');
 const result=await runCase({id:'isolated-shell',prompt:'Run the project check.',files:{'checks.mjs':"import a from 'node:assert/strict';a.ok(!process.env.EVAL_PARENT_SENTINEL);a.match(process.env.HOME,/compositor-eval-.*[/\\\\]home$/);console.log('ISOLATED_SHELL_CHECK');"},rules:[{tool:'exec',command:'node checks.mjs',decision:'allow'}],expect:{verification:'ISOLATED_SHELL_CHECK',verificationCommands:['node checks.mjs']},script:[{toolCalls:[{name:'exec',args:{command:'node checks.mjs'}}]},{text:'Check finished.'}]},{model:'scripted'});
 expect(result.checks,result.error).toContainEqual({name:'agent executed verification successfully',ok:true});
 expect(result.ok).toBe(true);
});
it('records a focused coding composition and injects its actual preset',async()=>{
 const {ScriptedProvider,CODING_INSTRUCTIONS}=await import('../../packages/core/src/index.js');
 const provider=new ScriptedProvider([{text:'Ready'}]);
 const result=await runCase({id:'coding-composition',prompt:'Explain the project.',files:{},expect:{responseIncludes:'Ready'}},{model:'scripted',provider,tools:['read','edit'],agentHarness:true,instructionsPreset:'coding'});
 expect(result.ok).toBe(true);expect(result.composition).toEqual({tools:['read','edit'],agentHarness:true,instructionsPreset:'coding'});
 expect(provider.requests[0].messages[0].content).toBe(CODING_INSTRUCTIONS);expect(provider.requests[0].tools.map(tool=>tool.name).sort()).toEqual(['edit','read']);
});
