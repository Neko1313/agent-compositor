import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
const roots:string[]=[],run=promisify(execFile),sha=(s:string)=>createHash('sha256').update(s).digest('hex');
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(answer:string,exitCode=0){
 const root=await mkdtemp(join(tmpdir(),'onboarding-dialogue-'));roots.push(root);
 const model='synthetic model',engine=`#!/bin/sh\nprintf '%s' '${answer.replaceAll('__MARKER__',join(root,'marker'))}'\nexit ${exitCode}\n`,modelPath=join(root,'model'),enginePath=join(root,'engine');
 await writeFile(modelPath,model);await writeFile(enginePath,engine,{mode:0o755});
 return{root,args:[resolve('tools/evals/onboarding-cpu-dialogue.mjs'),'--engine',enginePath,'--engine-sha256',sha(engine),'--model',modelPath,'--model-sha256',sha(model),'--output',join(root,'result')]};
}
it.skipIf(process.platform==='win32')('records untrusted model text for review without executing it',async()=>{
 const f=await fixture('{"message":"$(touch __MARKER__)"}');await run(process.execPath,f.args);
 const report=JSON.parse(await readFile(join(f.root,'result/report.json'),'utf8'));expect(report.results).toHaveLength(5);
 expect(report.results.every((row:any)=>row.valid&&row.message.includes('$(touch'))).toBe(true);
 expect(report.quality).toContain('human review required');expect(report.networkSandbox).toBe(false);expect(report.launcherApiRequests).toBe(0);
 await expect(stat(join(f.root,'marker'))).rejects.toMatchObject({code:'ENOENT'});
});
it.skipIf(process.platform==='win32')('records a failed engine as invalid even when it prints valid JSON',async()=>{
 const f=await fixture('{"message":"hello"}',42);await expect(run(process.execPath,f.args)).rejects.toMatchObject({code:1});
 const report=JSON.parse(await readFile(join(f.root,'result/report.json'),'utf8'));expect(report.results.every((row:any)=>!row.valid&&row.error)).toBe(true);
});
it.skipIf(process.platform==='win32')('rejects an unexpected model before making the output directory',async()=>{
 const f=await fixture('{"message":"hello"}');f.args[f.args.indexOf('--model-sha256')+1]='0'.repeat(64);
 await expect(run(process.execPath,f.args)).rejects.toMatchObject({code:1});await expect(stat(join(f.root,'result'))).rejects.toMatchObject({code:'ENOENT'});
});
