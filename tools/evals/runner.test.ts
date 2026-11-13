import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {ScriptedProvider} from '../../packages/core/src/index.js';
import {runCase,type EvalCase} from './runner.js';
afterEach(()=>vi.unstubAllEnvs());

it('preserves the checkout import when a correct discount edit is followed by a function-only overwrite',async()=>{
 const cases:EvalCase[]=JSON.parse(await readFile(new URL('./agent-cases.json',import.meta.url),'utf8'));
 const fixture=cases.find(test=>test.id==='multi-file-bug')!;
 const provider=new ScriptedProvider([
   {toolCalls:[{name:'edit',args:{target:'math.mjs',oldText:'total + total * percent / 100',newText:'total - (total * percent / 100)'}}]},
   {toolCalls:[{name:'write',args:{path:'checkout.mjs',content:'export function checkout(items, percent=0) { return discount(subtotal(items), percent); }'}}]},
   {toolCalls:[{name:'exec',args:{command:'npm test'}}]},
   {text:'Fixed the discount calculation and verified the project checks.'},
 ]);
 const result=await runCase(fixture,{model:'scripted',provider,tools:['read','write','edit','exec'],agentHarness:true,instructionsPreset:'coding'});
 const outputs=result.trajectory.filter(event=>event.event==='tool.result').map(event=>event.input);
 expect(outputs).toMatchObject([
   {tool:'edit',ok:true,output:{match:'exact',replacements:1}},
   {tool:'write',ok:false,error:expect.stringContaining('already present as an excerpt')},
   {tool:'exec',ok:true,output:{exitCode:0,stdout:expect.stringContaining('PROJECT_CHECKS_PASSED')}},
 ]);
 expect(result.checks).toEqual(expect.arrayContaining([
   {name:'agent executed verification successfully',ok:true},
   {name:'held-out behavioral grader',ok:true},
 ]));
 expect(result.ok,result.error??JSON.stringify(result.checks)).toBe(true);
});
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

it('exposes only the project fixture through directory references, glob and grep', async () => {
 const {ScriptedProvider} = await import('../../packages/core/src/index.js');
 const provider = new ScriptedProvider([
  {toolCalls:[{name:'glob',args:{pattern:'**/*'}}]},
  {toolCalls:[{name:'grep',args:{pattern:'checks.mjs'}}]},
  {toolCalls:[{name:'read',args:{path:'.agent-compositor/callix.json'}}]},
  {text:'Inspected the fixture.'},
 ]);
 const result = await runCase({
  id:'project-discovery', prompt:'Inspect the project @.', navigationMode:'text',
  files:{'package.json':'{"scripts":{"test":"node checks.mjs"}}','checks.mjs':"console.log('passed');\n"},
  rules:[{tool:'exec',command:'node checks.mjs',decision:'allow'}],
  expect:{preserve:['package.json','checks.mjs']},
 },{model:'scripted',provider,tools:['glob','grep','read'],fileReferences:true});
 expect(result.ok,result.error).toBe(true);
 const context = provider.requests[0].messages.find(message => message.role === 'user')?.content;
 expect(context).toContain('Directory @.');
 expect(context).toContain('checks.mjs');
 expect(context).toContain('package.json');
 expect.soft(context).not.toContain('agent-compositor.json');
 expect.soft(context).not.toContain('.agent-compositor');
 const outputs = result.trajectory.filter(event => event.event === 'tool.result').map(event => event.input);
 expect.soft(outputs.find(event => event.tool === 'glob')?.output.files).toEqual(['checks.mjs','package.json']);
 expect.soft(outputs.find(event => event.tool === 'grep')?.output.matches.map((match:{path:string}) => match.path)).toEqual(['package.json']);
 expect(outputs.find(event => event.tool === 'read')).toMatchObject({ok:false,error:expect.stringMatching(/ENOENT|not found|does not exist/i)});
});

it('preserves a fixture named agent-compositor.json while enforcing the evaluation toolset and rules', async () => {
 const {ScriptedProvider} = await import('../../packages/core/src/index.js');
 const check = 'node checks.mjs';
 const fixture = JSON.stringify({
  agent:{tools:['read'],builtinTools:['read']},
  permissions:{rules:[{tool:'exec',command:check,decision:'allow'}]},
 },null,2) + '\n';
 const provider = new ScriptedProvider([
  {toolCalls:[{name:'read',args:{path:'agent-compositor.json'}}]},
  {toolCalls:[{name:'exec',args:{command:check}}]},
  {text:'Inspected the project config.'},
 ]);
 const result = await runCase({
  id:'project-config-fixture',prompt:'Read the project config and check the permission @.',
  files:{'agent-compositor.json':fixture,'checks.mjs':"console.log('completed');\n"},
  rules:[{tool:'exec',command:check,decision:'deny'}],expect:{preserve:['agent-compositor.json'],deniedTool:'exec'},
 },{model:'scripted',provider,tools:['read','exec'],fileReferences:true});
 expect(result.ok,JSON.stringify(result.checks) + (result.error ?? '')).toBe(true);
 expect(provider.requests[0].tools.map(tool => tool.name).sort()).toEqual(['exec','read']);
 const outputs = result.trajectory.filter(event => event.event === 'tool.result').map(event => event.input);
 expect(outputs.find(event => event.tool === 'read')).toMatchObject({ok:true,output:{content:fixture}});
 expect(outputs.find(event => event.tool === 'exec')).toMatchObject({ok:false,denied:true,error:'denied by permission rules'});
});
