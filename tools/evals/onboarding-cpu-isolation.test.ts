import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';

const roots:string[]=[],run=promisify(execFile),sha=(s:string)=>createHash('sha256').update(s).digest('hex');
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

it.skipIf(process.platform==='win32').each(['probe','dialogue','multiturn'])('starts the %s CPU engine outside the caller project with a private home',async kind=>{
 const root=await mkdtemp(join(tmpdir(),'onboarding-isolation-'));roots.push(root);
 const model='synthetic model',answer=kind==='probe'?'{"work":"coding"}':'{"message":"hello"}';
 const engine=`#!/bin/sh\npwd > "$HOME/cwd"\nprintf '%s' "\${GGML_BACKEND_PATH-unset}" > "$HOME/backend-env"\nprintf '%s' '${answer}'\n`;
 const modelPath=join(root,'model'),enginePath=join(root,'engine'),output=join(root,'result');
 await writeFile(modelPath,model);await writeFile(enginePath,engine,{mode:0o755});
 const args=[resolve(`tools/evals/onboarding-cpu-${kind}.mjs`),'--engine',enginePath,'--engine-sha256',sha(engine),'--model',modelPath,'--model-sha256',sha(model),'--output',output];
 try{await run(process.execPath,args,{cwd:root,env:{...process.env,GGML_BACKEND_PATH:join(root,'untrusted.so')}});}catch(error:any){if(kind!=='probe'||error.code!==1)throw error;}
 expect((await readFile(join(output,'home/cwd'),'utf8')).trim()).toBe(join(output,'home'));
 expect(await readFile(join(output,'home/backend-env'),'utf8')).toBe('unset');
 expect((await stat(output)).mode&0o077).toBe(0);expect((await stat(join(output,'home'))).mode&0o077).toBe(0);
});
