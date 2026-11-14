import {afterEach,expect,it} from 'vitest';
import {Runtime} from '@agent-compositor/runtime';
import {attach,type HooksApi,type HooksServiceScope} from '../src/index.js';

const hosts:ReturnType<typeof attach>[]=[];
afterEach(()=>{for(const host of hosts.splice(0))host.close();});

it('captures producer identity separately from UI ownership for ordinary and explicitly detached handles',async()=>{
  const runtime=new Runtime(),host=attach(runtime,{session:{id:'producer',cwd:process.cwd()}});hosts.push(host);
  const ui={id:'UI'},first=Object.freeze({id:'first-tool'}),second=Object.freeze({id:'second-tool'});
  let current:unknown=first,ordinary!:HooksApi,background!:HooksApi;
  host.setInvocationOriginProvider(()=>ui);host.setToolOperationOriginProvider(()=>current);
  host.registerPlugin({name:'owner',version:'1.0.0',trust:'trusted'},{'ui.press':(_event,$)=>{ordinary=$;background=$.background();}});
  const scopes:HooksServiceScope[]=[];runtime.setResolver('service.fs.read',()=>{
    expect(host.currentInvocationOrigin).toBe(host.currentServiceScope!.origin);
    scopes.push(host.currentServiceScope!);return{value:'read'};
  });
  await host.emit('ui.press',{site:'owner',key:'capture'});current=second;
  await ordinary.fs.read('ordinary');await background.fs.read('background');
  expect(scopes[0].origin).toBe(ui);expect(scopes[0].toolOperationOrigin).toBe(first);
  expect(scopes[1].origin).not.toBe(ui);expect(scopes[1]).toMatchObject({background:true,toolOperationOrigin:first});
  await host.withToolOperationOrigin(second,()=>ordinary.fs.read('retained ordinary'));
  expect(scopes[2].toolOperationOrigin).toBe(first);
});

it('changes only producer metadata at a new Core-owned tool boundary and identity-guards provider cleanup',async()=>{
  const runtime=new Runtime(),host=attach(runtime,{session:{id:'producer',cwd:process.cwd()}});hosts.push(host);
  const ui={id:'UI'},first={id:'first'},second={id:'second'};let api!:HooksApi,child!:HooksApi;
  host.setInvocationOriginProvider(()=>ui);const offOld=host.setToolOperationOriginProvider(()=>first),offCurrent=host.setToolOperationOriginProvider(()=>second);offOld();
  host.registerPlugin({name:'owner',version:'1.0.0',trust:'trusted'},{'ui.press':(_event,$)=>{api=$;},'service.fs.read':(event,$)=>{if(event.path==='boundary')child=$;}});
  let seen!:HooksServiceScope;runtime.setResolver('service.fs.read',()=>{seen=host.currentServiceScope!;return{value:'read'};});
  await host.emit('ui.press',{site:'owner',key:'capture'});await api.fs.read('ordinary');expect(seen.toolOperationOrigin).toBe(second);
  await host.withToolOperationOrigin(first,()=>host.emit('service.fs.read',{plugin:'owner',path:'boundary'}));
  await child.fs.read('fresh child');expect(seen.origin).toBe(ui);expect(seen.toolOperationOrigin).toBe(first);
  offCurrent();await host.emit('ui.press',{site:'owner',key:'capture'});await api.fs.read('no provider');expect(seen.toolOperationOrigin).toBeUndefined();
});
