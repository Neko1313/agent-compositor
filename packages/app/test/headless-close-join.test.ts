import {expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ScriptedProvider} from '@agent-compositor/core';
import {buildApp} from '../src/build.js';

it.skipIf(process.platform==='win32')('joins an already-closing Core before application cleanup can finish',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'headless-close-join-')),provider=new ScriptedProvider([]);
  const app=await buildApp({cwd,env:{HOME:cwd},provider,fixedConfig:{enabledPlugins:[],
    agent:{tools:[],builtinTools:[],controlTools:[],skills:false,projectContext:false,fileReferences:false},compaction:{enabled:false}}});
  const core=app.createCore(async()=>false);let release!:()=>void,entered!:()=>void,pid=0;
  const pause=new Promise<void>(done=>{release=done;}),started=new Promise<void>(done=>{entered=done;});
  let worker:Promise<unknown>|undefined,first:Promise<void>|undefined,closing:Promise<void>|undefined;
  try{
    await core.start();core.host.registerPlugin({name:'join-owner',version:'1.0.0',trust:'trusted',hookTimeouts:{'session.end':300000}},
      {'ui.press':(_event,$)=>{worker=$.background().exec.run(process.execPath,['-e',`require('node:fs').writeFileSync(${JSON.stringify(join(cwd,'worker.pid'))},String(process.pid));setInterval(()=>{},1000);`]).catch(error=>error);},
        'session.end':async()=>{entered();await pause;}});
    await core.host.emit('ui.press',{site:'join',key:'start'});
    await expect.poll(async()=>{pid=await readFile(join(cwd,'worker.pid'),'utf8').then(Number,()=>0);return pid;},{timeout:3000}).toBeGreaterThan(0);
    first=core.close();await started;let coreDone=false,appDone=false;
    const second=core.close().then(()=>{coreDone=true;});closing=app.close().then(()=>{appDone=true;});
    await new Promise<void>(done=>setTimeout(done,100));
    expect({coreDone,appDone}).toEqual({coreDone:false,appDone:false});expect(()=>process.kill(pid,0)).not.toThrow();
    release();await Promise.all([first,second,closing,worker]);
    await expect.poll(()=>{try{process.kill(pid,0);return true;}catch(error:any){if(error.code==='ESRCH')return false;throw error;}},{timeout:2000}).toBe(false);
    expect(provider.requests).toEqual([]);
  }finally{
    release();await Promise.allSettled([first,closing,app.close()]);
    if(pid)try{process.kill(-pid,'SIGKILL');}catch{}
    await rm(cwd,{recursive:true,force:true});
  }
},10000);
