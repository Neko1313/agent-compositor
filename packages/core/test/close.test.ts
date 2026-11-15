import {expect,it} from 'vitest';
import {mkdtemp,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentCore,ScriptedProvider,type CoreHumanRequestContext} from '../src/index.js';

it('reports closing immediately and resolves whenClosed only after teardown settles',async()=>{
  let release!:()=>void,entered!:()=>void,settled=false;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const core=new AgentCore({cwd:process.cwd(),provider:new ScriptedProvider([]),plugins:[{manifest:{name:'slow-close',version:'1.0.0',trust:'trusted'},hooks:{'session.end':async()=>{entered();await gate;}}}]});
  void core.whenClosed.then(()=>{settled=true;});
  expect(core.isClosed).toBe(false);const closing=core.close();
  try{expect(core.isClosed).toBe(true);await started;expect(settled).toBe(false);}
  finally{release();await closing;await core.whenClosed;}
  expect(settled).toBe(true);
});

it('stores one close promise before human-lifetime abort subscribers can reenter',async()=>{
  let context!:CoreHumanRequestContext,reentered:Promise<void>|undefined,ends=0;
  const core=new AgentCore({cwd:process.cwd(),provider:new ScriptedProvider([]),rules:[{tool:'ask_user',decision:'allow'}],
    onAsk:(request,current)=>{context=current!;return new Promise(resolve=>request.signal!.addEventListener('abort',()=>resolve('Cancelled'),{once:true}));},
    plugins:[{manifest:{name:'close-observer',version:'1.0.0',trust:'trusted'},hooks:{'session.end':()=>{ends++;}}}]});
  try{
    const request=core.invokeTool('ask_user',{question:'Close this request?'});await expect.poll(()=>context).toBeDefined();
    context.root.signal.addEventListener('abort',()=>{reentered=core.close();},{once:true});
    const first=core.close();await first;await request;
    expect(reentered).toBe(first);expect(core.close()).toBe(first);expect(ends).toBe(1);
  }finally{await core.close();}
});

it('does not restore SDK effect authority during close after the journal failed',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'core-close-journal-')),provider=new ScriptedProvider([]),closeSignal=new AbortController();
  const core=new AgentCore({cwd,provider,tools:[],controlTools:[],services:{'service.session.append':()=>({deny:'Journal unavailable'})},
    plugins:[{manifest:{name:'cleanup-owner',version:'1.0.0',trust:'trusted'},hooks:{'session.end':async(_event,$)=>{await $.fs.write('must-stay-absent.txt','forbidden after journal failure');}}}]});
  try{
    await core.submit('Do not execute');expect(core.failure).toContain('Journal unavailable');
    await core.close(closeSignal.signal);
    await expect(access(join(cwd,'must-stay-absent.txt'))).rejects.toMatchObject({code:'ENOENT'});
    expect(provider.requests).toEqual([]);expect(core.host.hasPlugin('cleanup-owner')).toBe(false);
  }finally{await core.close();await rm(cwd,{recursive:true,force:true});}
});
