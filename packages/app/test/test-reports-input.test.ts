import {it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {UndoStore,WorkspaceAccess,type ToolContext} from '@agent-compositor/tools';
import tools from '../../../plugins/test-reports/tools.js';

let cwd:string,ctx:ToolContext;
const tool=tools[0]!;
const failed=(message='failure')=>({testResults:[{name:'example.test.ts',status:'failed',assertionResults:[{name:'fails',status:'failed',failureMessages:[message]}]}]});
beforeEach(async()=>{
 cwd=await realpath(await mkdtemp(join(tmpdir(),'report-input-')));
 const access=new WorkspaceAccess(cwd);
 ctx={cwd,signal:new AbortController().signal,undo:new UndoStore(),resolvePath:value=>access.resolve(value),request:async()=>{throw Error('Unexpected service call');}};
});
afterEach(async()=>{await rm(cwd,{recursive:true,force:true});});

it('test-reports: accepts Jest assertion names and omitted failureMessages without trusting aggregates',async()=>{
 await writeFile(join(cwd,'report.json'),JSON.stringify({numTotalTests:999,testResults:[{name:'jest.test.ts',status:'failed',assertionResults:[{name:'failed test',status:'failed'},{name:'pending',status:'pending'}]}]}));
 expect(await tool.execute(ctx,{path:'report.json'})).toEqual({ok:true,data:{total:2,passed:0,failed:1,skipped:1,failures:[{name:'failed test',file:'jest.test.ts',message:''}],truncated:false}});
});
it('test-reports: rejects invalid UTF-8, runtime suite failures and invalid diagnostic arrays',async()=>{
 for(const data of [Buffer.from([0xff,0xfe]),JSON.stringify({testResults:[{name:'setup',status:'failed',assertionResults:[{status:'passed'}]}]}),JSON.stringify({testResults:[{name:'bad',assertionResults:[{name:'bad',status:'failed',failureMessages:[123]}]}]})]){
  await writeFile(join(cwd,'bad.json'),data);
  expect(await tool.execute(ctx,{path:'bad.json'})).toMatchObject({ok:false});
 }
});
it('test-reports: requires a host path guard before opening any file',async()=>{
 await writeFile(join(cwd,'report.json'),JSON.stringify(failed()));
 expect(await tool.execute({...ctx,resolvePath:undefined},{path:join(cwd,'report.json')})).toMatchObject({ok:false,error:expect.stringContaining('path resolution')});
});
it('test-reports: reports cancellation after resolution and leaves the source untouched',async()=>{
 const text=JSON.stringify(failed()),abort=new AbortController();await writeFile(join(cwd,'report.json'),text);
 const result=await tool.execute({...ctx,signal:abort.signal,resolvePath:async value=>{const path=await ctx.resolvePath!(value);abort.abort();return path;}},{path:'report.json'});
 expect(result).toEqual({ok:false,error:'Test report read cancelled.'});
 // Re-reading succeeds after cancellation; the cancelled call did not mutate it.
 expect(await tool.execute(ctx,{path:'report.json'})).toMatchObject({ok:true,data:{failed:1}});
});
it('test-reports: returns bounded structured Unicode data and retains the first failure',async()=>{
 await writeFile(join(cwd,'unicode.json'),JSON.stringify(failed('😀界'.repeat(20000))));
 const result=await tool.execute(ctx,{path:'unicode.json',maxBytes:1024});
 expect(result.ok).toBe(true);if(!result.ok)return;
 expect(Buffer.byteLength(JSON.stringify(result.data))).toBeLessThanOrEqual(1024);
 expect(result.data).toMatchObject({total:1,failed:1,truncated:true,failures:[{name:'fails',file:'example.test.ts'}]});
 expect(result.data.failures[0]!.message).not.toMatch(/[\ud800-\udbff]$/u);
});
it('test-reports: validates omitted, null and control-character arguments',async()=>{
 for(const input of [null,[],{}, {path:'\u0000'}, {path:'a',maxFailures:'1'}, {path:'a',maxBytes:Infinity}, {path:'a',maxFailures:null}, {path:'a',maxBytes:null}]){
  expect(await tool.execute(ctx,input)).toMatchObject({ok:false});
  expect(()=>tool.describe(input)).toThrow();
 }
});
it.skipIf(process.platform==='win32')('test-reports: rejects a FIFO without waiting for a writer',async()=>{
 const path=join(cwd,'pipe');execFileSync('mkfifo',[path]);
 expect(await tool.execute(ctx,{path:'pipe'})).toMatchObject({ok:false,error:expect.stringContaining('regular file')});
},2000);
