import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
const roots:string[]=[],run=promisify(execFile),sha=(s:string)=>createHash('sha256').update(s).digest('hex');
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(fail=false){
 const root=await mkdtemp(join(tmpdir(),'onboarding-multiturn-'));roots.push(root);
 const model='fixture model';
 const engine=`#!/usr/bin/env node\nconst fs=require('node:fs');const path=require('node:path');const file=path.join(process.env.HOME,'calls.json');let calls=[];try{calls=JSON.parse(fs.readFileSync(file));}catch{} calls.push(process.argv[process.argv.indexOf('-p')+1]);fs.writeFileSync(file,JSON.stringify(calls));process.stdout.write(${fail?"calls.length===2?'not json':":''}JSON.stringify({message:'answer '+calls.length+' <tag>'}));\n`;
 const modelPath=join(root,'model'),enginePath=join(root,'engine');await writeFile(modelPath,model);await writeFile(enginePath,engine,{mode:0o755});
 return{root,args:[resolve('tools/evals/onboarding-cpu-multiturn.mjs'),'--engine',enginePath,'--engine-sha256',sha(engine),'--model',modelPath,'--model-sha256',sha(model),'--output',join(root,'result')]};
}
it.skipIf(process.platform==='win32')('feeds real earlier responses into later turns as escaped data',async()=>{
 const f=await fixture();await run(process.execPath,f.args);
 const calls=JSON.parse(await readFile(join(f.root,'result/home/calls.json'),'utf8'));
 const report=JSON.parse(await readFile(join(f.root,'result/report.json'),'utf8'));
 expect(calls).toHaveLength(3);expect(calls[1]).toContain('answer 1 \\u003ctag\\u003e');expect(calls[2]).toContain('answer 2 \\u003ctag\\u003e');
 expect(report.results.map((row:any)=>row.message)).toEqual(['answer 1 <tag>','answer 2 <tag>','answer 3 <tag>']);
 expect(report.quality).toContain('human review required');expect(report.networkSandbox).toBe(false);
});
it.skipIf(process.platform==='win32')('stops after an invalid turn rather than fabricating dialogue history',async()=>{
 const f=await fixture(true);await expect(run(process.execPath,f.args)).rejects.toMatchObject({code:1});
 const report=JSON.parse(await readFile(join(f.root,'result/report.json'),'utf8'));
 expect(report.results).toHaveLength(2);expect(report.results[1].valid).toBe(false);
});
it.skipIf(process.platform==='win32')('checks model pins before creating output',async()=>{
 const f=await fixture();f.args[f.args.indexOf('--model-sha256')+1]='0'.repeat(64);
 await expect(run(process.execPath,f.args)).rejects.toMatchObject({code:1});await expect(stat(join(f.root,'result'))).rejects.toMatchObject({code:'ENOENT'});
});
