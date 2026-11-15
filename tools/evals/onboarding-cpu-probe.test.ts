import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
const roots:string[]=[],run=promisify(execFile),sha=(s:string)=>createHash('sha256').update(s).digest('hex');
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(exitCode=0){
 const root=await mkdtemp(join(tmpdir(),'cpu-onboarding-probe-'));roots.push(root);
 const model='synthetic model',engine=`#!/bin/sh\nprintf '{"work":"coding"}'\nexit ${exitCode}\n`,modelPath=join(root,'model'),enginePath=join(root,'engine');
 await writeFile(modelPath,model);await writeFile(enginePath,engine,{mode:0o755});
 return{root,args:[resolve('tools/evals/onboarding-cpu-probe.mjs'),'--engine',enginePath,'--engine-sha256',sha(engine),'--model',modelPath,'--model-sha256',sha(model),'--output',join(root,'result')]};
}
it.skipIf(process.platform==='win32')('records incorrect classifications without authorizing any action',async()=>{
 const f=await fixture();await expect(run(process.execPath,f.args)).rejects.toMatchObject({code:1});
 const report=JSON.parse(await readFile(join(f.root,'result/report.json'),'utf8'));expect(report.results).toHaveLength(12);
 expect(report.results.filter((row:any)=>row.correct)).toHaveLength(2);expect(report.results.every((row:any)=>row.valid)).toBe(true);
 expect(report.networkSandbox).toBe(false);expect(report.launcherApiRequests).toBe(0);
});
it.skipIf(process.platform==='win32')('rejects failed runtimes even when they print valid JSON',async()=>{
 const f=await fixture(42);await expect(run(process.execPath,f.args)).rejects.toMatchObject({code:1});
 const report=JSON.parse(await readFile(join(f.root,'result/report.json'),'utf8'));expect(report.results.every((row:any)=>!row.valid&&!row.correct&&row.error)).toBe(true);
});
it.skipIf(process.platform==='win32')('refuses a changed model before starting the executable or creating a report',async()=>{
 const f=await fixture();f.args[f.args.indexOf('--model-sha256')+1]='0'.repeat(64);
 await expect(run(process.execPath,f.args)).rejects.toMatchObject({code:1});await expect(stat(join(f.root,'result'))).rejects.toMatchObject({code:'ENOENT'});
});
