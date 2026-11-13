import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyLocalCache,localCompletionFetch,type ModelPin} from './local-model.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('verifies pinned cache bytes and refuses cloud stubs or corrupt model layers',async()=>{
 const cache=await mkdtemp(join(tmpdir(),'cpu-cache-'));roots.push(cache);await mkdir(join(cache,'manifests'),{recursive:true});await mkdir(join(cache,'blobs'));
 const bytes='local test model',digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
 const pin:ModelPin={model:'test:local',manifest:'model',source:'fixture',layers:[{digest,size:bytes.length}]};
 const manifest={config:pin.layers[0],layers:[]};await writeFile(join(cache,'manifests/model'),JSON.stringify(manifest));await writeFile(join(cache,'blobs',digest.replace(':','-')),bytes);
 expect((await verifyLocalCache(cache,pin)).verified).toBe(true);
 await writeFile(join(cache,'manifests/model'),JSON.stringify({...manifest,remote_host:'https://cloud.invalid'}));await expect(verifyLocalCache(cache,pin)).rejects.toThrow('Cloud models');
 await writeFile(join(cache,'manifests/model'),JSON.stringify(manifest));await writeFile(join(cache,'blobs',digest.replace(':','-')),'corrupt');await expect(verifyLocalCache(cache,pin)).rejects.toThrow('failed verification');
});
it('blocks model/origin changes before transport and forbids redirect following',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>new Response('ok')),send=localCompletionFetch('http://127.0.0.1:12345','local:only',transport);
 await expect(send('https://cloud.invalid/v1/chat/completions',{method:'POST',body:'{}'})).rejects.toThrow('nonlocal');
 await expect(send('http://127.0.0.1:12345/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'cloud:other'})})).rejects.toThrow('unpinned');expect(transport).not.toHaveBeenCalled();
 await send('http://127.0.0.1:12345/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'local:only'}),redirect:'follow'});expect(transport.mock.calls[0][1]!.redirect).toBe('error');
 expect(()=>localCompletionFetch('http://model.example:12345','local')).toThrow('loopback');
});
// Each CLI child owns its own watchdog; the test must allow that watchdog and cleanup.
it('refuses an existing output directory before running a case or altering evidence',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{readFile,readdir}=await import('node:fs/promises');
 const output=await mkdtemp(join(tmpdir(),'cpu-existing-output-'));roots.push(output);await writeFile(join(output,'sentinel'),'preserve');
 await expect(promisify(execFile)(process.execPath,['--import','tsx','tools/evals/local-cpu.ts','--output',output,'--cache',join(output,'missing-cache')],{cwd:process.cwd(),timeout:10000})).rejects.toMatchObject({code:1});
 expect(await readFile(join(output,'sentinel'),'utf8')).toBe('preserve');expect(await readdir(output)).toEqual(['sentinel']);
},15000);
it('retains setup failure and cleanup evidence when the pinned cache is unavailable',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{readFile}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'cpu-setup-failure-'));roots.push(root);const output=join(root,'fresh');
 await expect(promisify(execFile)(process.execPath,['--import','tsx','tools/evals/local-cpu.ts','--output',output,'--cache',join(root,'missing')],{cwd:process.cwd(),timeout:20000})).rejects.toMatchObject({code:1});
 expect(JSON.parse(await readFile(join(output,'report.json'),'utf8'))).toMatchObject({completed:false,results:[],error:expect.stringContaining('ENOENT')});expect(JSON.parse(await readFile(join(output,'cleanup.json'),'utf8'))).toEqual({serverStarted:false});
},25000);
