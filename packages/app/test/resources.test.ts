import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {Sampler,chart,chartRaster} from '../../../plugins/resources/metrics.js';
import resourcesHooks,{Monitor} from '../../../plugins/resources/hooks.js';
import {ChildrenCpu,processCounters,snapshotChildren,systemCounters} from '../../../plugins/resources/children.js';
import {uiTextViewSchema,type UiTextView} from '@agent-compositor/events';

afterEach(()=>vi.useRealTimers());
describe('resources monitor',()=>{
 it('opens through the declared UI command while the main model is held, without another request',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'resources-integration-'));let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  try{
   await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['resources'],agent:{projectContext:false,skills:false}}));
   const provider=new ScriptedProvider([{text:'MAIN_RUNNING',hold:true}]);app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[join(process.cwd(),'plugins/resources')]});expect(app.pluginErrors).toEqual([]);
   const core=app.createCore(async()=>true),views:UiTextView[]=[],queued:string[]=[];core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='prompt.queued')queued.push((event.input as any).text);if(event.kind==='catalog'&&event.event==='ui.surface'&&(event.input as any).plugin==='resources')views.push((event.input as any).view);});
   const turn=core.submit('Work');await vi.waitFor(()=>{expect(core.failure).toBeUndefined();expect(provider.requests).toHaveLength(1);},{timeout:3000});
   const command=app.commands().find(command=>command.name==='/resources');expect(command?.ui?.site).toBe('plugin-resources-resources');
   const opening=new AbortController();await core.host.emit('ui.press',{site:command!.ui!.site,key:'command:/resources'},opening.signal);opening.abort();
   expect(views.at(-1)!.lines.some(line=>line.text.includes('Compositor process'))).toBe(true);expect(core.getState()).toBe('running');expect(provider.requests).toHaveLength(1);
   expect(views.at(-1)!.raster).toBeUndefined();await core.host.emit('ui.press',{site:command!.ui!.site,key:'graphics-on'});
   expect(uiTextViewSchema.safeParse(views.at(-1)).success).toBe(true);expect(views.at(-1)!.raster?.alt).toContain('text chart');expect(provider.requests).toHaveLength(1);
   await core.host.emit('ui.press',{site:command!.ui!.site,key:'graphics-off'});expect(views.at(-1)!.raster).toBeUndefined();
   await core.host.emit('ui.press',{site:command!.ui!.site,key:'memory'});
   await core.host.emit('ui.press',{site:command!.ui!.site,key:'share'});
   expect(queued).toHaveLength(1);expect(views.at(-1)!.lines.some(line=>line.text==='Resource observation queued for the agent.')).toBe(true);expect(queued[0]).toContain('Compositor process RSS:');expect(queued[0]).toContain('excludes child processes');
   expect(provider.requests).toHaveLength(1);expect(core.getState()).toBe('running');
   provider.release();await turn;await vi.waitFor(()=>expect(provider.requests.length).toBeGreaterThanOrEqual(2));
   expect(JSON.stringify(provider.requests[1].messages)).toContain('Compositor process RSS:');
  }finally{await app?.close();await rm(cwd,{recursive:true,force:true});}
 });
 it('only queues complete selected observations and reports rejected requests',async()=>{
  const views:UiTextView[]=[],calls:any[]=[],sampler=new Sampler({now:()=>1n,cpu:()=>({user:0,system:0}),memory:()=>({rss:2097152,heapUsed:1048576,heapTotal:2097152})});
  const api={ui:{supports:()=>true,view:async(_id:string,_title:string,view:UiTextView)=>{views.push(view);},remove:async()=>{}},emit:async(_event:string,input:any)=>{calls.push(input);return {deny:'queue full'};}};
  const monitor=new Monitor(api,sampler);
  try{
   await monitor.show();await monitor.press('share');expect(calls).toHaveLength(0);expect(views.at(-1)!.lines.some(line=>line.text.includes('No process CPU interval'))).toBe(true);
   await monitor.press('child-cpu');await monitor.press('share');expect(calls).toHaveLength(0);expect(views.at(-1)!.lines.some(line=>line.text.includes('No complete child CPU interval'))).toBe(true);
   await monitor.press('memory');await monitor.press('share');expect(calls).toHaveLength(1);expect(calls[0].text).toContain('RSS: 2.0 MiB');expect(views.at(-1)!.lines.some(line=>line.text.includes('queue full'))).toBe(true);
  }finally{monitor.dispose();}
 });
 it('measures elapsed CPU including multiple cores and rejects invalid counters',()=>{
  let now=0n,user=0;const sampler=new Sampler({now:()=>now,cpu:()=>({user,system:0}),memory:()=>({rss:100,heapUsed:50,heapTotal:80})});
  expect(sampler.sample().cpu).toBeUndefined();now=1_000_000_000n;user=250000;expect(sampler.sample().cpu).toBe(25);
  now=2_000_000_000n;user=2250000;expect(sampler.sample().cpu).toBe(200);
  sampler.reset();now=9_000_000_000n;expect(sampler.sample().cpu).toBeUndefined();
  now=10_000_000_000n;user=-1;expect(()=>sampler.sample()).toThrow('Invalid process counters');
 });
 it('estimates child CPU only for matching process identities and marks churn incomplete',()=>{
  const stat='123 (name ) with spaces) S 1 2 3 4 5 6 7 8 9 10 20 30 0 0 0 0 0 0 999';
  expect(processCounters(stat)).toEqual({ticks:50n,start:999n});
  const system=systemCounters('cpu 10 20 30 40 50 60 70 80 900 1000\ncpu0 1 2 3 4\ncpu1 1 2 3 4\n');
  expect(system).toEqual({ticks:360n,cpus:'cpu0,cpu1'});
  const sample=(ticks:bigint,processes:Map<number,{start:bigint;ticks:bigint}>,partial=false)=>({count:processes.size,rss:0,partial,system:{ticks,cpus:'cpu0,cpu1'},processes});
  const counter=new ChildrenCpu();
  expect(counter.sample(sample(100n,new Map([[1,{start:10n,ticks:10n}]]))).cpu).toBeUndefined();
  expect(counter.sample(sample(300n,new Map([[1,{start:10n,ticks:110n}]])))).toEqual({cpu:100,partial:false});
  expect(counter.sample(sample(500n,new Map([[1,{start:11n,ticks:120n}]])))).toEqual({cpu:0,partial:true});
  counter.reset();expect(counter.sample(sample(600n,new Map())).cpu).toBeUndefined();
  expect(counter.sample({...sample(800n,new Map()),system:{ticks:800n,cpus:'cpu0'}}).cpu).toBeUndefined();
 });
 it('samples child CPU only on its active tab and resets the interval across pause and hide',async()=>{
  vi.useFakeTimers();let calls=0,latest!:UiTextView;
  const read=vi.fn(async()=>{calls++;return {count:1,rss:100,partial:false,system:{ticks:BigInt(calls*200),cpus:'cpu0,cpu1'},processes:new Map([[1,{start:1n,ticks:BigInt(calls*100)}]])};});
  const sampler=new Sampler({now:()=>BigInt(Date.now())*1000000n+1n,cpu:()=>({user:Date.now(),system:0}),memory:()=>({rss:1,heapUsed:1,heapTotal:1})});
  const monitor=new Monitor({ui:{supports:()=>true,view:async(_id:string,_title:string,view:UiTextView)=>{latest=view;},remove:async()=>{}}},sampler,read);
  try{
   await monitor.show();await vi.advanceTimersByTimeAsync(2000);expect(read).not.toHaveBeenCalled();
   await monitor.press('child-cpu');await vi.advanceTimersByTimeAsync(2000);
   expect(latest.lines.some(line=>line.text.includes('Child CPU: 100.0%'))).toBe(true);
   await monitor.press('pause');await vi.advanceTimersByTimeAsync(2000);expect(read).toHaveBeenCalledTimes(2);
   await monitor.press('sample');expect(read).toHaveBeenCalledTimes(3);
   expect(latest.lines.some(line=>line.text.includes('Child CPU: waiting for interval'))).toBe(true);
   await monitor.press('pause');await vi.advanceTimersByTimeAsync(1000);
   expect(latest.lines.some(line=>line.text.includes('Child CPU: waiting for interval'))).toBe(true);
   await monitor.visibility({visible:false,attached:true,columns:40});await vi.advanceTimersByTimeAsync(2000);expect(read).toHaveBeenCalledTimes(4);
   await monitor.visibility({visible:true,attached:true,columns:40});await vi.advanceTimersByTimeAsync(1000);
   expect(latest.lines.some(line=>line.text.includes('Child CPU: waiting for interval'))).toBe(true);
  }finally{monitor.dispose();}
 });
 it('does not display or share an old process CPU interval after pause, hide or sampling failure',async()=>{
  vi.useFakeTimers();let latest!:UiTextView,broken=false;const queued:string[]=[];
  const sampler=new Sampler({now:()=>BigInt(Date.now())*1000000n+1n,cpu:()=>({user:Date.now(),system:0}),memory:()=>{if(broken)throw Error('COUNTERS_DOWN');return {rss:1,heapUsed:1,heapTotal:1};}});
  const api={ui:{supports:()=>true,view:async(_id:string,_title:string,view:UiTextView)=>{latest=view;},remove:async()=>{}},emit:async(_event:string,input:{text:string})=>{queued.push(input.text);return {value:{queued:true}};}};
  const monitor=new Monitor(api,sampler);
  try{
   await monitor.show();await vi.advanceTimersByTimeAsync(1000);await monitor.press('share');expect(queued).toHaveLength(1);
   await monitor.press('pause');expect(latest.lines.some(line=>line.text.includes('CPU: waiting for interval'))).toBe(true);await monitor.press('share');expect(queued).toHaveLength(1);
   await monitor.press('pause');await monitor.press('share');expect(queued).toHaveLength(1);await vi.advanceTimersByTimeAsync(2000);await monitor.press('share');expect(queued).toHaveLength(2);
   await monitor.visibility({visible:false,attached:true,columns:40});await monitor.visibility({visible:true,attached:true,columns:40});await monitor.press('share');expect(queued).toHaveLength(2);
   await vi.advanceTimersByTimeAsync(1000);await monitor.press('share');expect(queued).toHaveLength(3);
   broken=true;await monitor.press('sample');expect(latest.lines.some(line=>line.text.includes('CPU: waiting for interval'))).toBe(true);await monitor.press('share');expect(queued).toHaveLength(3);
  }finally{monitor.dispose();}
 });
 it('does not share an old child CPU interval after pause, tab change or hide',async()=>{
  vi.useFakeTimers();let calls=0,latest!:UiTextView;const queued:string[]=[];
  const read=async()=>{calls++;return {count:1,rss:100,partial:false,system:{ticks:BigInt(calls*200),cpus:'cpu0,cpu1'},processes:new Map([[1,{start:1n,ticks:BigInt(calls*100)}]])};};
  const sampler=new Sampler({now:()=>BigInt(Date.now())*1000000n+1n,cpu:()=>({user:Date.now(),system:0}),memory:()=>({rss:1,heapUsed:1,heapTotal:1})});
  const api={ui:{supports:()=>true,view:async(_id:string,_title:string,view:UiTextView)=>{latest=view;},remove:async()=>{}},emit:async(_event:string,input:{text:string})=>{queued.push(input.text);return {value:{queued:true}};}};
  const monitor=new Monitor(api,sampler,read);
  try{
   await monitor.show();await monitor.press('child-cpu');await vi.advanceTimersByTimeAsync(2000);await monitor.press('share');expect(queued).toHaveLength(1);
   await monitor.press('pause');expect(latest.lines.some(line=>line.text.includes('Child CPU: waiting for interval'))).toBe(true);await monitor.press('share');expect(queued).toHaveLength(1);
   await monitor.press('pause');await vi.advanceTimersByTimeAsync(2000);await monitor.press('share');expect(queued).toHaveLength(2);
   await monitor.press('memory');await monitor.press('child-cpu');await monitor.press('share');expect(queued).toHaveLength(2);
   await vi.advanceTimersByTimeAsync(2000);await monitor.press('share');expect(queued).toHaveLength(3);
   await monitor.visibility({visible:false,attached:true,columns:40});await monitor.visibility({visible:true,attached:true,columns:40});await monitor.press('share');expect(queued).toHaveLength(3);
  }finally{monitor.dispose();}
 });
 it('plots actual observations with bounded width and an honest multi-core axis',()=>{
  const plot=chart([undefined,0,50,200],30,'%',100);expect(plot[0]).toContain('200.0');expect(plot.join('\n')).toContain('Older -> newer (%)');
  expect(plot.join('').split('*').length-1).toBe(3);expect(chart(Array(1000).fill(10),24,'MiB').join('').split('*').length-1).toBe(14);
 });
 it('draws bounded raster observations without joining across missing intervals',()=>{
  const image=chartRaster([0,undefined,200],14,100),pixels=Buffer.from(image.rgba,'base64');
  expect(image).toMatchObject({width:120,height:48});expect(pixels.length).toBe(120*48*4);
  const at=(x:number,y:number)=>[...pixels.subarray((y*120+x)*4,(y*120+x)*4+4)];
  expect(at(40,47)).toEqual([64,210,190,255]);expect(at(119,0)).toEqual([64,210,190,255]);
  expect(at(80,24)).not.toEqual([64,210,190,255]);
 });
 it('stops the retained monitor when its session ends',async()=>{
  vi.useFakeTimers();let views=0;const api:any={session:{id:'closing-session'},ui:{supports:()=>true,view:async()=>{views++;},remove:async()=>{}}};api.background=()=>api;
  await resourcesHooks['session.start']({},api);await resourcesHooks['ui.press']({site:'plugin-resources-resources',key:'command:/resources'},api);
  expect(views).toBe(1);await resourcesHooks['session.end']({},api);await vi.advanceTimersByTimeAsync(3000);expect(views).toBe(1);expect(vi.getTimerCount()).toBe(0);
 });
 it('bounds history and stops timers while paused, hidden, closed or disposed',async()=>{
  vi.useFakeTimers();let ticks=0;const views:UiTextView[]=[];
  const sampler=new Sampler({now:()=>BigInt(Date.now())*1000000n+BigInt(++ticks),cpu:()=>({user:ticks*100,system:0}),memory:()=>({rss:1048576+ticks,heapUsed:1000,heapTotal:2000})});
  const monitor=new Monitor({ui:{supports:()=>true,view:async(_id:string,_title:string,view:UiTextView)=>{expect(uiTextViewSchema.safeParse(view).success).toBe(true);views.push(view);},remove:async()=>{}}},sampler);
  try{
   await monitor.show();expect(views.at(-1)!.lines.some(line=>line.text.includes('waiting for interval'))).toBe(true);
   await vi.advanceTimersByTimeAsync(130000);expect(monitor.samples).toHaveLength(120);expect(vi.getTimerCount()).toBe(1);
   await monitor.press('pause');const count=views.length;await vi.advanceTimersByTimeAsync(5000);expect(views).toHaveLength(count);expect(vi.getTimerCount()).toBe(0);
   await monitor.press('sample');expect(views).toHaveLength(count+1);expect(monitor.samples.at(-1)!.cpu).toBeUndefined();
   await monitor.press('pause');await vi.advanceTimersByTimeAsync(1000);expect(vi.getTimerCount()).toBe(1);
   await monitor.visibility({visible:false,attached:true,columns:24});const hidden=views.length;await vi.advanceTimersByTimeAsync(5000);expect(views).toHaveLength(hidden);expect(vi.getTimerCount()).toBe(0);
   await monitor.visibility({visible:true,attached:true,columns:24});expect(monitor.samples.at(-1)!.cpu).toBeUndefined();expect(vi.getTimerCount()).toBe(1);
   await monitor.press('clear');expect(monitor.samples).toHaveLength(1);await monitor.press('close');const closed=views.length;await vi.advanceTimersByTimeAsync(5000);await monitor.press('sample');expect(views).toHaveLength(closed);expect(vi.getTimerCount()).toBe(0);
   await monitor.show();monitor.dispose();await vi.advanceTimersByTimeAsync(5000);expect(vi.getTimerCount()).toBe(0);
  }finally{monitor.dispose();}
 });
 it('offers recovery after counter failure and a chart switch on older hosts',async()=>{
  vi.useFakeTimers();let broken=true,time=0n;let latest!:UiTextView;
  const sampler=new Sampler({now:()=>++time,cpu:()=>({user:0,system:0}),memory:()=>{if(broken)throw Error('COUNTERS_DOWN');return{rss:1048576,heapUsed:100,heapTotal:200};}});
  const monitor=new Monitor({ui:{supports:()=>false,view:async(_id:string,_title:string,view:UiTextView)=>{latest=view;},remove:async()=>{}}},sampler);
  try{
   await monitor.show();expect(latest.lines.some(line=>line.text.includes('COUNTERS_DOWN'))).toBe(true);expect(vi.getTimerCount()).toBe(0);
   broken=false;await monitor.press('sample');expect(latest.lines.some(line=>line.tone==='danger')).toBe(false);expect(vi.getTimerCount()).toBe(1);
   await monitor.press('switch');expect(latest.tabs).toBeUndefined();expect(latest.lines.some(line=>line.text==='Resident memory history (MiB)')).toBe(true);
  }finally{monitor.dispose();}
 });
 it.skipIf(process.platform!=='linux')('samples RSS of a real live child process without a subprocess helper',async()=>{
  const child=spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
  try{
   await once(child.stdout!,'data');
   const status=await readFile(`/proc/${child.pid}/status`,'utf8');
   const childRss=Number(/^VmRSS:\s+(\d+)\s+kB\s*$/m.exec(status)?.[1])*1024;
   expect(childRss).toBeGreaterThan(0);
   const snapshot=await snapshotChildren();
   expect(snapshot).toBeDefined();expect(snapshot!.count).toBeGreaterThanOrEqual(1);expect(snapshot!.rss).toBeGreaterThanOrEqual(childRss);
  }finally{child.kill();await once(child,'exit');}
 });
 it.skipIf(process.platform!=='linux')('observes CPU used by a real busy descendant',async()=>{
  const child=spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{const end=Date.now()+50;while(Date.now()<end){}},60)"],{stdio:['ignore','pipe','ignore']});
  try{
   await once(child.stdout!,'data');const counter=new ChildrenCpu(),first=await snapshotChildren();expect(first).toBeDefined();counter.sample(first!);
   await new Promise(resolve=>setTimeout(resolve,1300));const second=await snapshotChildren();expect(second).toBeDefined();
   expect(counter.sample(second!).cpu).toBeGreaterThan(5);
  }finally{child.kill();await once(child,'exit');}
 });
 it('shows an explicit child snapshot and ignores an unfinished snapshot after close',async()=>{
  let resolve!:(value:{count:number;rss:number;partial:boolean})=>void,signal:AbortSignal|undefined;
  const views:UiTextView[]=[];
  const monitor=new Monitor({ui:{supports:()=>true,view:async(_id:string,_title:string,view:UiTextView)=>{views.push(view);},remove:async()=>{}}},undefined,
    current=>new Promise(done=>{signal=current;resolve=done;}));
  try{
   await monitor.show();const pending=monitor.press('children');await vi.waitFor(()=>expect(resolve).toBeDefined());
   expect(views.at(-1)!.lines.some(line=>line.text.includes('Reading child'))).toBe(true);
   resolve({count:2,rss:2*1048576,partial:true});await pending;
   expect(views.at(-1)!.lines.some(line=>line.text.includes('2 processes · 2.0 MiB RSS · incomplete'))).toBe(true);
   const next=monitor.press('children');await vi.waitFor(()=>expect(views.at(-1)!.lines.some(line=>line.text.includes('Reading child'))).toBe(true));
   await monitor.press('close');expect(signal?.aborted).toBe(true);const before=views.length;resolve({count:1,rss:1,partial:false});await next;expect(views).toHaveLength(before);
  }finally{monitor.dispose();}
 });
 it('distinguishes unsupported and failed child snapshots and permits retry',async()=>{
  let latest!:UiTextView,attempt=0;
  const monitor=new Monitor({ui:{supports:()=>true,view:async(_id:string,_title:string,view:UiTextView)=>{latest=view;},remove:async()=>{}}},undefined,
    async()=>{attempt++;if(attempt===1)return undefined;if(attempt===2)throw Error('unavailable');return {count:1,rss:1048576,partial:false};});
  try{
   await monitor.show();await monitor.press('children');expect(latest.lines.some(line=>line.text.includes('Linux only'))).toBe(true);
   await monitor.press('children');expect(latest.lines.some(line=>line.text.includes('failed. Try again'))).toBe(true);
   await monitor.press('children');expect(latest.lines.some(line=>line.text.includes('1 processes · 1.0 MiB'))).toBe(true);
  }finally{monitor.dispose();}
 });
});
