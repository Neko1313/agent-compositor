import {afterEach,expect,it,vi} from 'vitest';
import {runCase} from './runner.js';
afterEach(()=>vi.unstubAllEnvs());
it('reports repeated actual policy denials independently of the task grade',async()=>{
 const result=await runCase({id:'denial-diagnostics',prompt:'Try the requested check and report restrictions.',files:{},rules:[{tool:'exec',decision:'deny'}],expect:{deniedTool:'exec',responseIncludes:'Blocked'},script:[{toolCalls:[{name:'exec',args:{command:'node scratch.mjs'}}]},{toolCalls:[{name:'exec',args:{command:'node scratch.mjs'}}]},{text:'Blocked'}]},{model:'scripted'});
 expect(result.ok,result.error).toBe(true);
 expect(result.permissionDiagnostics).toMatchObject({deniedCalls:2,repeatedIdenticalDeniedCalls:1,unmatchedDeniedResults:0});
 expect(result.permissionDiagnostics.denials[1].previousIdenticalDeniedCallId).toBe(result.permissionDiagnostics.denials[0].callId);
});
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
it('rejects a coding preset with its harness disabled before contacting the model',async()=>{
 const {ScriptedProvider}=await import('../../packages/core/src/index.js');const provider=new ScriptedProvider([{text:'unused'}]);
 const result=await runCase({id:'inactive-coding-preset',prompt:'Fix the project.',files:{},expect:{responseIncludes:'unused'}},{model:'scripted',provider,instructionsPreset:'coding'});
 expect(result.ok).toBe(false);expect(result.error).toContain('Coding instructions preset requires agentHarness: true');expect(provider.requests).toHaveLength(0);
});
it('keeps an explicitly selected control helper available in focused compositions',async()=>{
 const {ScriptedProvider}=await import('../../packages/core/src/index.js');
 const provider=new ScriptedProvider([{toolCalls:[{name:'tool_help',args:{name:'exec',preview:{command:'npm test'}}}]},{text:'Preview inspected.'}]);
 const result=await runCase({id:'focused-help',prompt:'Inspect current permission without execution.',files:{},expect:{permissionPreviews:[{tool:'exec',args:{command:'npm test'},decision:'ask'}]}},{model:'scripted',provider,tools:['tool_help','exec']});
 expect(result.ok,result.error).toBe(true);expect(provider.requests[0].tools.map(tool=>tool.name).sort()).toEqual(['exec','tool_help']);
 expect(result.toolTraffic.calls.map(call=>call.tool)).toEqual(['tool_help']);
});
it('advertises and executes navigation plugin tools in an explicitly selected composition',async()=>{
 const {ScriptedProvider}=await import('../../packages/core/src/index.js');
 const provider=new ScriptedProvider([{toolCalls:[{name:'glob',args:{pattern:'**/*.mjs'}}]},{toolCalls:[{name:'grep',args:{pattern:'SEARCH_EVIDENCE',path:'known.mjs'}}]},{text:'Found known.mjs with SEARCH_EVIDENCE.'}]);
 const tools=['read','write','edit','exec','glob','grep'];
 const result=await runCase({id:'navigation-composition',prompt:'Find the source file and its evidence.',files:{'known.mjs':'// SEARCH_EVIDENCE\nexport const value=1;\n'},expect:{responseIncludes:'SEARCH_EVIDENCE',tools:['glob','grep']}},{model:'scripted',provider,tools,agentHarness:true,instructionsPreset:'coding'});
 expect(result.ok,result.error).toBe(true);expect(provider.requests[0].tools.map(tool=>tool.name).sort()).toEqual([...tools].sort());
 expect(result.toolTraffic.calls.map(call=>call.tool)).toEqual(['glob','grep']);
});
it('refuses an unavailable requested tool before calling the model',async()=>{
 const {ScriptedProvider}=await import('../../packages/core/src/index.js');const provider=new ScriptedProvider([{text:'unused'}]);
 const result=await runCase({id:'missing-composition',prompt:'Work.',files:{},expect:{responseIncludes:'unused'}},{model:'scripted',provider,tools:['missing_composition_tool']});
 expect(result.ok).toBe(false);expect(result.error).toContain('Requested evaluation tools are unavailable: missing_composition_tool');expect(provider.requests).toHaveLength(0);
});
it.each([false,true])('uses ordinary directory attachments only when explicitly enabled: %s',async fileReferences=>{
 const {ScriptedProvider}=await import('../../packages/core/src/index.js');const provider=new ScriptedProvider([{text:'Ready'}]);
 const result=await runCase({id:'project-reference',prompt:'Inspect the project @.',files:{'known-source.mjs':'export const value=1;'},expect:{responseIncludes:'Ready',grader:'/* PRIVATE_GRADER_SENTINEL */'},script:[{text:'REFERENCE_SOLUTION_SENTINEL'}]},{model:'scripted',provider,tools:['read'],fileReferences});
 expect(result.ok,result.error).toBe(true);
 const context=provider.requests[0].messages.map(message=>message.content).join('\n');
 expect(context.includes('Directory @.')).toBe(fileReferences);expect(context.includes('known-source.mjs')).toBe(fileReferences);
 expect(context).not.toContain('PRIVATE_GRADER_SENTINEL');expect(context).not.toContain('REFERENCE_SOLUTION_SENTINEL');
 expect(result.composition).toHaveProperty('fileReferences',fileReferences);
});
