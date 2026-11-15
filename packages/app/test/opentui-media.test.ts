import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScriptedProvider} from '@agent-compositor/core';
import {COMPOSER_MEDIA_STATUS,decodeLine,encodeMessage,hello,nativeMediaMessage,nativeProtocolElements,type NativeOperation,type WireMessage} from '@agent-compositor/protocol';
import type {ComposerMedia} from '@agent-compositor/renderer-opentui';
import {buildApp} from '../src/build.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';
import {createOpenTuiWireHost} from '../src/opentui-wire.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{vi.useRealTimers();for(const close of cleanup.splice(0).reverse())await close();vi.restoreAllMocks();vi.unstubAllEnvs();});
type Frame=Parameters<Parameters<ComposerMedia['subscribe']>[1]>[0];
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
async function fixture(mascot=false){
 const cwd=await mkdtemp(join(tmpdir(),'opentui-media-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
 vi.stubEnv('NO_COLOR',undefined);vi.stubEnv('TERM','xterm-256color');
 const provider=new ScriptedProvider([]),app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,pluginDirs:mascot?[fileURLToPath(new URL('../../../plugins',import.meta.url))]:[],fixedConfig:{enabledPlugins:mascot?['mascot']:[],
  agent:{builtinTools:[],controlTools:[],projectContext:false,skills:false,verifyCompletion:false},compaction:{enabled:false}}});cleanup.push(()=>app.close());
 if(mascot){
  expect(app.plugins.find(plugin=>plugin.manifest.name==='mascot')?.dir).toBe(fileURLToPath(new URL('../../../plugins/mascot',import.meta.url)));
  await mkdir(app.storage.paths.state,{recursive:true});await writeFile(join(app.storage.paths.state,'mascot.json'),JSON.stringify({restoreInk:false}));
 }
 const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});layout.resize(100,36);cleanup.push(()=>layout.disconnect());
 const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());const visibility:any[]=[],visibilityListeners=new Set<(event:any)=>void>();
 const visibilityCalls:{input:any;completion:ReturnType<typeof host.core.host.emit>}[]=[];
 const emit=host.core.host.emit.bind(host.core.host);
 vi.spyOn(host.core.host,'emit').mockImplementation((name,input,signal,dispatchSignal)=>{
  const completion=emit(name,input,signal,dispatchSignal);
  if(name==='ui.visibility')visibilityCalls.push({input:structuredClone(input),completion});
  return completion;
 });
 host.core.host.registerPlugin({name:'media-observer',version:'1.0.0',trust:'trusted'},{'ui.visibility':event=>{
  visibility.push(structuredClone(event));for(const listener of visibilityListeners)listener(event);
 }});
 for(const name of ['old-art','new-art'])host.core.host.registerPlugin({name,version:'1.0.0',trust:'trusted'},{});
 await host.start();
 if(mascot)expect(host.core.host.hasPlugin('mascot')).toBe(true);
 const publish=(owner:string,label:string,alt=label)=>host.core.host.emit('service.ui.view',{plugin:owner,id:'companion',title:'Ghost',view:{
  attachment:{site:'composer',width:18,rows:6,label},raster:{width:1,height:1,rgba:'/wAA/w==',alt},lines:[]}});
 const latest=(owner:string)=>visibility.filter(value=>value.site==='plugin:'+owner+'/companion').at(-1);
 return{host,layout,provider,publish,visibility,visibilityListeners,visibilityCalls,latest};
}

it('keeps compact status live without pixels and aggregates expanded subscribers without changing the default',async()=>{
 const f=await fixture();await f.publish('old-art','Ready','Original Ghost');const compact:Frame[]=[],expanded:Frame[]=[];
 const stop=f.host.composerMedia.subscribe(false,frame=>compact.push(frame),{expanded:false});cleanup.push(stop);
 await expect.poll(()=>f.latest('old-art')).toMatchObject({attached:true,visible:true,columns:0,rows:1});
 expect(compact).toEqual([undefined]);expect(f.host.composerMedia.presentation?.()).toEqual({label:'Ready',alt:'Original Ghost',hasImage:true});
 await f.publish('old-art','Thinking');expect(compact.at(-1)).toBeUndefined();expect(f.host.composerMedia.presentation?.()).toMatchObject({label:'Thinking'});
 await f.host.core.host.emit('service.ui.view',{plugin:'old-art',id:'companion',title:'Ghost',view:{attachment:{site:'composer',width:18,rows:6,label:'Status only'},lines:[]}});
 expect(f.host.composerMedia.presentation?.()).toEqual({label:'Status only',alt:undefined,hasImage:false});expect(compact.at(-1)).toBeUndefined();
 await f.publish('old-art','Thinking');
 const stopExpanded=f.host.composerMedia.subscribe(true,frame=>expanded.push(frame));
 await expect.poll(()=>f.latest('old-art')).toMatchObject({visible:true,columns:18,rows:6});
 expect(expanded.at(-1)).toMatchObject({width:1,height:1,rgba:new Uint8Array([255,0,0,255])});expect(compact.every(value=>value===undefined)).toBe(true);
 stopExpanded();await expect.poll(()=>f.latest('old-art')).toMatchObject({visible:true,columns:0,rows:1});
 stop();await expect.poll(()=>f.latest('old-art')).toMatchObject({visible:false,columns:0,rows:0});expect(f.provider.requests).toEqual([]);
});

it.each(['remove','unload'] as const)('resumes the previous producer visibility after selected producer %s',async stop=>{
 const f=await fixture();const labels:(string|undefined)[]=[];const off=f.host.composerMedia.subscribe(false,()=>labels.push(f.host.composerMedia.presentation?.()?.label),{expanded:false});cleanup.push(off);
 await f.publish('old-art','Old');await expect.poll(()=>f.latest('old-art')?.visible).toBe(true);
 await f.publish('new-art','New');await expect.poll(()=>f.latest('old-art')?.visible).toBe(false);expect(labels.at(-1)).toBe('New');
 if(stop==='remove')await f.host.core.host.emit('service.ui.remove',{plugin:'new-art',id:'companion'});else f.host.core.host.unregisterPlugin('new-art');
 await expect.poll(()=>f.latest('old-art')).toMatchObject({attached:true,visible:true,columns:0,rows:1});
 expect(labels.at(-1)).toBe('Old');expect(f.host.composerMedia.presentation?.()).toMatchObject({label:'Old',hasImage:true});
 await f.host.close();expect(labels.at(-1)).toBeUndefined();expect(f.host.composerMedia.presentation?.()).toMatchObject({hasImage:false});
});

it('lets the actual mascot expire transient compact labels while idle motion stays stopped',async()=>{
 const f=await fixture(true),frames:Frame[]=[];const stop=f.host.composerMedia.subscribe(false,value=>frames.push(value),{expanded:false});cleanup.push(stop);
 await expect.poll(()=>f.latest('mascot')).toMatchObject({visible:true,columns:0,rows:1});
 await expect.poll(()=>f.host.composerMedia.presentation?.()?.label).toBe('Ready');
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});
 const before=frames.length;await vi.advanceTimersByTimeAsync(1000);expect(frames).toHaveLength(before);
 const pet=gate();const offPet=f.host.composerMedia.subscribe(false,()=>{if(f.host.composerMedia.presentation?.()?.label==='Done!')pet.resolve();},{expanded:false});cleanup.push(offPet);
 await f.host.submit('/mascot pet');await pet.promise;expect(f.host.composerMedia.presentation?.()?.label).toBe('Done!');
 const expired=gate();const off=f.host.composerMedia.subscribe(false,()=>{if(f.host.composerMedia.presentation?.()?.label==='Ready')expired.resolve();},{expanded:false});cleanup.push(off);
 await vi.advanceTimersByTimeAsync(1801);await expired.promise;expect(frames.every(value=>value===undefined)).toBe(true);expect(f.provider.requests).toEqual([]);
 vi.useRealTimers();
});

it.each(['remove','unload'] as const)('restarts the actual hidden mascot clock after its covering producer %s',async stop=>{
 const f=await fixture(true),frames:Frame[]=[];const off=f.host.composerMedia.subscribe(false,value=>frames.push(value));cleanup.push(off);
 await expect.poll(()=>f.latest('mascot')).toMatchObject({visible:true,columns:18,rows:6});
 await f.publish('new-art','Cover');await expect.poll(()=>f.latest('mascot')?.visible).toBe(false);
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});await vi.advanceTimersByTimeAsync(1000);
 const resumed=gate();const observe=(event:any)=>{
  if(event.site==='plugin:mascot/companion'&&event.visible===true)resumed.resolve();
 };f.visibilityListeners.add(observe);cleanup.push(()=>f.visibilityListeners.delete(observe));
 if(stop==='remove')await f.host.core.host.emit('service.ui.remove',{plugin:'new-art',id:'companion'});else f.host.core.host.unregisterPlugin('new-art');
 await resumed.promise;
 const resumedCall=f.visibilityCalls.filter(call=>call.input.site==='plugin:mascot/companion'&&call.input.visible===true).at(-1)!;
 expect((await resumedCall.completion).faults).toEqual([]);
 const first=frames.at(-1)!.rgba,advanced=gate();const unsubscribe=f.host.composerMedia.subscribe(false,frame=>{
  if(frame&&frame.width===228&&!Buffer.from(frame.rgba).equals(Buffer.from(first)))advanced.resolve();
 });cleanup.push(unsubscribe);
 await vi.advanceTimersByTimeAsync(181);await advanced.promise;expect(f.host.composerMedia.presentation?.()?.label).toBe('Ready');expect(f.provider.requests).toEqual([]);vi.useRealTimers();
});

it.each([false,true])('gates status/expanded media fields on both peer capabilities: %s',async status=>{
 const f=await fixture();await f.publish('old-art','Thinking','Original Ghost');const messages:WireMessage[]=[];
 const broker=createOpenTuiWireHost({host:f.host,layout:f.layout,onCtrlC:()=> 'handled'},message=>messages.push(decodeLine(encodeMessage(message))));cleanup.push(()=>broker.close());
 broker.hello();broker.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements,...(status?[COMPOSER_MEDIA_STATUS]:[])],encodings:['jsonl']}));
 let id=0;const input=(operation:NativeOperation)=>broker.receive(decodeLine(encodeMessage({type:'native-input',epoch:broker.epoch,id:++id,target:'@media',operation})));
 if(!status){input({kind:'media-active',enabled:true,active:false,expanded:false});expect(messages.at(-1)).toMatchObject({type:'native-receipt',status:'rejected'});}
 input({kind:'media-active',enabled:true,active:false,...(status?{expanded:false}:{})});
 await expect.poll(()=>f.latest('old-art')).toMatchObject({visible:true,columns:status?0:18,rows:status?1:6});
 const media=()=>messages.filter((message):message is Extract<WireMessage,{type:'native-media'}>=>message.type==='native-media');
 expect(media().at(-1)?.presentation).toEqual(status?{label:'Thinking',alt:'Original Ghost',hasImage:true}:undefined);
 expect(Boolean(media().at(-1)?.frame)).toBe(!status);
 await f.publish('old-art','Done!');expect(media().at(-1)?.presentation?.label).toBe(status?'Done!':undefined);
 if(!status)for(const message of media())expect(nativeMediaMessage.omit({presentation:true}).parse(message)).toEqual(message);
 broker.close();await expect.poll(()=>f.latest('old-art')?.visible).toBe(false);expect(f.provider.requests).toEqual([]);
});
