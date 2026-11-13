import {afterEach,expect,it} from 'vitest';
import {Runtime} from '@agent-compositor/runtime';
import {attach,type HooksApi,type HooksServiceScope} from '../src/index.js';

const hosts:ReturnType<typeof attach>[]=[];
afterEach(()=>{for(const host of hosts.splice(0))host.close();});
const manifest=(name:string)=>({name,version:'1.0.0',trust:'trusted' as const});
const request={title:'Private request',fields:[{id:'value',label:'Value',type:'text' as const}],actions:[{id:'save',label:'Save'}]};
function fixture(){
 const runtime=new Runtime(),host=attach(runtime,{session:{id:'scope',cwd:process.cwd()}});
 hosts.push(host);return{runtime,host};
}

it('captures the invocation origin at handle construction and disposes only the exact provider binding',async()=>{
 const {runtime,host}=fixture();let current:unknown={operation:'first'},captured!:HooksApi,calls=0;
 const provider=()=>{calls++;return current;};
 const first=host.setInvocationOriginProvider(provider),second=host.setInvocationOriginProvider(provider);
 first();
 const scopes:HooksServiceScope[]=[];
 runtime.setResolver('service.fs.read',()=>{scopes.push(host.currentServiceScope!);return{value:'read'};});
 host.registerPlugin(manifest('owner'),{'ui.press':(_event,$)=>{captured=$;}});
 const original=current;
 await host.emit('ui.press',{site:'owner',key:'capture'});
 current={operation:'another'};
 await captured.fs.read('first');
 expect(scopes[0]).toMatchObject({plugin:'owner',background:false});
 expect(scopes[0].origin).toBe(original);expect(scopes[0].signal).toBe(captured.signal);
 expect(Object.isFrozen(scopes[0])).toBe(true);expect(calls).toBe(1);
 second();await host.emit('ui.press',{site:'owner',key:'capture'});await captured.fs.read('second');
 expect(scopes[1].origin).toBeUndefined();expect(calls).toBe(1);
 expect(host.currentServiceScope).toBeUndefined();expect(host.currentSignal).toBeUndefined();
});

it('preserves ordinary captured ownership inside background interceptors and gives new APIs their inherited lineage and actual requester',async()=>{
 const {runtime,host}=fixture(),launcher={operation:'launcher'},ambient={operation:'ambient'};
 let origin:unknown=launcher,ordinary!:HooksApi,retained!:HooksApi,child!:HooksApi,childLifetime!:AbortSignal;
 host.setInvocationOriginProvider(()=>origin);
 const seen:{path:string;scope:HooksServiceScope;explicit:boolean}[]=[];
 runtime.setResolver('service.fs.read',input=>{
  seen.push({path:(input as {path:string}).path,scope:host.currentServiceScope!,explicit:host.isBackgroundService});return{value:'read'};
 });
 host.registerPlugin(manifest('launcher'),{'ui.press':(_event,$)=>{ordinary=$;retained=$.background();}});
 let incoming!:HooksServiceScope;
 host.registerPlugin(manifest('interceptor'),{'service.fs.read':async(event,$)=>{
  if(event.path!=='trigger')return;
  incoming=host.currentServiceScope!;child=$;childLifetime=$.background().signal;
  await ordinary.fs.read('ordinary');
  await $.fs.read('inherited');
  return{value:'triggered'};
 }});
 await host.emit('ui.press',{site:'launcher',key:'capture'});origin=ambient;
 expect(await retained.fs.read('trigger')).toBe('triggered');
 await child.fs.read('retained-child');
 expect(incoming).toMatchObject({plugin:'launcher',background:true});expect(incoming.origin).not.toBe(launcher);
 expect(typeof incoming.origin).toBe('object');expect(incoming.lifetime).toBe(retained.signal);
 expect(seen[0]).toMatchObject({path:'ordinary',explicit:false,scope:{plugin:'launcher',background:false}});
 expect(seen[0].scope.origin).toBe(launcher);
 for(const call of seen.slice(1)){
  expect(call.scope).toMatchObject({plugin:'interceptor',background:true});expect(call.explicit).toBe(false);
  expect(call.scope.origin).toBe(incoming.origin);expect(call.scope.lifetime).toBe(childLifetime);
  expect(call.scope.signal).toBe(child.signal);
 }
 expect(childLifetime).not.toBe(retained.signal);expect(host.currentServiceScope).toBeUndefined();
});

it('exposes the effective per-call signal without replacing the captured plugin-instance lifetime',async()=>{
 const {runtime,host}=fixture();let api!:HooksApi,scope!:HooksServiceScope;
 host.registerPlugin(manifest('owner'),{'ui.press':(_event,$)=>{api=$.background();}});
 runtime.setResolver('service.agent.tool',()=>{scope=host.currentServiceScope!;expect(host.currentSignal).toBe(scope.signal);return{value:{ok:true}};});
 await host.emit('ui.press',{site:'owner',key:'capture'});
 const caller=new AbortController();await api.agent.tool('probe',{}, {signal:caller.signal});
 expect(scope.background).toBe(true);expect(scope.lifetime).toBe(api.signal);expect(scope.signal).not.toBe(api.signal);
 caller.abort(Error('One call cancelled'));
 expect(scope.signal.aborted).toBe(true);expect(scope.lifetime.aborted).toBe(false);expect(api.signal.aborted).toBe(false);
});

it('runs direct private forms under captured ordinary, explicit background and inherited background service scopes',async()=>{
 const {runtime,host}=fixture(),launcher={operation:'launcher'};
 let ordinary!:HooksApi,retained!:HooksApi;
 host.setInvocationOriginProvider(()=>launcher);
 const seen:{scope:HooksServiceScope;explicit:boolean;signal:AbortSignal}[]=[];
 host.setFormHandler(async(plugin,form,signal)=>{
  const scope=host.currentServiceScope!;
  expect(scope.plugin).toBe(plugin);expect(scope.signal).toBe(signal);expect(host.currentSignal).toBe(signal);
  expect(form.title).toBe(request.title);seen.push({scope,explicit:host.isBackgroundService,signal});
  return{action:'save',values:{value:'PRIVATE_RESULT'}};
 });
 host.registerPlugin(manifest('launcher'),{'ui.press':(_event,$)=>{ordinary=$;retained=$.background();}});
 host.registerPlugin(manifest('interceptor'),{'service.fs.read':async(event,$)=>{
  if(event.path==='form'){await ordinary.ui.form(request);return{value:await $.ui.form(request)};}
 }});
 runtime.setResolver('service.fs.read',()=>({value:'unused'}));
 await host.emit('ui.press',{site:'launcher',key:'capture'});
 expect(await ordinary.ui.form(request)).toMatchObject({values:{value:'PRIVATE_RESULT'}});
 await retained.ui.form(request);await retained.fs.read('form');
 expect(seen.map(call=>[call.scope.plugin,call.scope.background,call.explicit])).toEqual([
  ['launcher',false,false],['launcher',true,true],['launcher',false,false],['interceptor',true,false],
 ]);
 expect(seen[0].scope.origin).toBe(launcher);expect(seen[2].scope.origin).toBe(launcher);
 expect(seen[1].scope.origin).toBe(seen[3].scope.origin);expect(seen[1].signal).toBe(retained.signal);
 expect(host.currentServiceScope).toBeUndefined();expect(host.currentSignal).toBeUndefined();
});

it('keeps the exact old plugin lifetime revoked when its name is reused',async()=>{
 const {runtime,host}=fixture();let retained!:HooksApi;
 const scopes:HooksServiceScope[]=[];
 runtime.setResolver('service.fs.read',()=>{scopes.push(host.currentServiceScope!);return{value:'read'};});
 const capture={ 'ui.press':(_event:unknown,$:HooksApi)=>{retained=$.background();} };
 host.registerPlugin(manifest('owner'),capture);await host.emit('ui.press',{site:'owner',key:'capture'});
 const old=retained;await old.fs.read('old');
 host.unregisterPlugin('owner');host.registerPlugin(manifest('owner'),capture);
 await host.emit('ui.press',{site:'owner',key:'capture'});await retained.fs.read('new');
 expect(scopes[0].lifetime).toBe(old.signal);expect(scopes[0].lifetime.aborted).toBe(true);
 expect(scopes[1].lifetime).toBe(retained.signal);expect(scopes[1].lifetime.aborted).toBe(false);
 expect(scopes[1].lifetime).not.toBe(scopes[0].lifetime);expect(scopes[1].origin).not.toBe(scopes[0].origin);
 await expect(old.fs.read('revoked')).rejects.toThrow('unloaded');expect(scopes).toHaveLength(2);
});

it('does not accept service payload fields as ownership authority',async()=>{
 const {runtime,host}=fixture(),origin={operation:'real'},foreign={operation:'forged'};
 let api!:HooksApi,scope!:HooksServiceScope;
 host.setInvocationOriginProvider(()=>origin);
 host.registerPlugin(manifest('owner'),{'ui.press':(_event,$)=>{api=$;}});
 runtime.setResolver('service.fs.read',()=>{scope=host.currentServiceScope!;return{value:'read'};});
 await host.emit('ui.press',{site:'owner',key:'capture'});
 const fakeLifetime=new AbortController().signal;
 await api.emit('service.fs.read',{path:'probe',plugin:'forged',origin:foreign,background:true,lifetime:fakeLifetime});
 expect(scope.plugin).toBe('owner');expect(scope.origin).toBe(origin);expect(scope.background).toBe(false);
 expect(scope.lifetime).not.toBe(fakeLifetime);expect(scope.signal).toBe(api.signal);
});

it('admits fresh same-host reload capabilities only across an explicit host lifecycle boundary',async()=>{
 const {runtime,host}=fixture(),launch={operation:'launch'},reload={operation:'reload'};
 let origin:unknown=launch,ordinary!:HooksApi,retained!:HooksApi,replacement!:HooksApi;
 host.setInvocationOriginProvider(()=>origin);
 const scopes:HooksServiceScope[]=[];
 runtime.setResolver('service.fs.read',()=>{scopes.push(host.currentServiceScope!);return{value:'read'};});
 host.registerPlugin(manifest('owner'),{
  'ui.press':(_event,$)=>{ordinary=$;retained=$.background();},
  'service.fs.read':async event=>{
   if(event.path!=='reload')return;
   const launching=host.currentServiceScope!;expect(launching.background).toBe(true);
   host.unregisterPlugin('owner');origin=reload;
   host.registerPlugin(manifest('owner'),{'session.reload':async(_event,$)=>{
    replacement=$;expect(host.currentServiceScope).toBeUndefined();expect(host.currentSignal).toBeUndefined();
    expect(host.isBackgroundService).toBe(false);await $.fs.read('fresh');
   }});
   await host.withoutServiceScope(()=>host.emit('session.reload',{plugins:[]}));
   expect(host.currentServiceScope).toBe(launching);
   return{value:'reloaded'};
  },
 });
 await host.emit('ui.press',{site:'owner',key:'capture'});
 expect(await retained.fs.read('reload')).toBe('reloaded');
 expect(scopes).toHaveLength(1);expect(scopes[0]).toMatchObject({plugin:'owner',background:false});
 expect(scopes[0].origin).toBe(reload);expect(scopes[0].signal).toBe(replacement.signal);
 expect(replacement.signal.aborted).toBe(false);expect(scopes[0].lifetime).not.toBe(retained.signal);
 await expect(ordinary.fs.read('revoked-ordinary')).rejects.toThrow('unloaded');
 await expect(retained.fs.read('revoked-background')).rejects.toThrow('unloaded');
 expect(host.currentServiceScope).toBeUndefined();
});
