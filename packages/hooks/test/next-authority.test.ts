import {expect,it} from 'vitest';
import {Runtime,type NextHandle} from '@agent-compositor/runtime';
import {attach,type HooksApi} from '../src/index.js';

it('skips retired render hook bodies while preserving live automatic fallthrough',async()=>{
  const runtime=new Runtime(),host=attach(runtime,{session:{id:'render-admission',cwd:process.cwd()}});
  const authority=new AbortController(),dispatch=new AbortController();let first=0,tail=0;
  const input={site:'test-public',surface:'terminal',props:{},viewport:{columns:40,rows:10}};
  host.registerPlugin({name:'first',version:'1.0.0',trust:'trusted'},
    {'ui.render':()=>{first++;}});
  host.registerPlugin({name:'tail',version:'1.0.0',trust:'trusted'},
    {'ui.render':()=>{tail++;return{tree:{lines:[{text:'Live fallback'}]}};}});
  try{
    authority.abort(Error('Obsolete render'));
    expect(await host.emit('ui.render',input,authority.signal,dispatch.signal)).toMatchObject({value:{tree:null},faults:[]});
    expect({first,tail}).toEqual({first:0,tail:0});
    expect(await host.emit('ui.render',input,new AbortController().signal,dispatch.signal))
      .toMatchObject({value:{tree:{lines:[{text:'Live fallback'}]}},faults:[]});
    expect({first,tail}).toEqual({first:1,tail:1});
  }finally{host.close();}
});

it.each(['function','continuation'] as const)('rejects a captured %s before downstream starts when only SDK authority is revoked',async captured=>{
  const runtime=new Runtime(),host=attach(runtime,{session:{id:'private-render-next',cwd:process.cwd()}});
  const authority=new AbortController(),dispatch=new AbortController(),reason=Error('Render job superseded');
  let api!:HooksApi,continuation:NextHandle|undefined,release!:()=>void,downstream=0;
  const pause=new Promise<void>(done=>{release=done;});
  host.registerPlugin({name:'painter',version:'1.0.0',trust:'trusted'},
    {'ui.render':async(_event,$)=>{api=$;if(captured==='continuation')continuation=$.next();await pause;return{tree:{lines:[{text:'Obsolete painter result'}]}};}});
  host.registerPlugin({name:'tail',version:'1.0.0',trust:'trusted'},
    {'ui.render':()=>{downstream++;return{tree:{lines:[{text:'Downstream must not start'}]}};}});
  const work=host.emit('ui.render',{site:'test-public',surface:'terminal',props:{},viewport:{columns:40,rows:10}},authority.signal,dispatch.signal);
  try{
    await expect.poll(()=>api).toBeDefined();const next=api.next;authority.abort(reason);
    expect(api.signal.aborted).toBe(true);expect(dispatch.signal.aborted).toBe(false);
    const attempt=Promise.resolve().then(()=>captured==='function'?next():continuation!);
    await expect(attempt).rejects.toBe(reason);expect(downstream).toBe(0);
    release();expect(await work).toMatchObject({value:{tree:{lines:[{text:'Obsolete painter result'}]}}});
    expect(downstream).toBe(0);
  }finally{release();await work.catch(()=>{});host.close();}
});

it('preserves a live continuation result and the explicit detached-next rejection',async()=>{
  const runtime=new Runtime(),host=attach(runtime,{session:{id:'live-next',cwd:process.cwd()}});let detached!:HooksApi,downstream=0;
  host.registerPlugin({name:'wrapper',version:'1.0.0',trust:'trusted'},
    {'ui.press':async(_event,$)=>{detached=$.background();return await $.next();}});
  host.registerPlugin({name:'tail',version:'1.0.0',trust:'trusted'},
    {'ui.press':()=>{downstream++;}});
  try{
    await host.emit('ui.press',{site:'live-next',key:'go'});expect(downstream).toBe(1);
    expect(()=>detached.next()).toThrow('Background callbacks cannot continue a completed hook');
  }finally{host.close();}
});
