import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {Sampler,chart} from '../../../plugins/resources/metrics.js';
import {Monitor} from '../../../plugins/resources/hooks.js';
import {uiTextViewSchema,type UiTextView} from '@agent-compositor/events';

afterEach(()=>vi.useRealTimers());
describe('resources monitor',()=>{
 it('opens through the declared UI command while the main model is held, without another request',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'resources-integration-'));let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  try{
   await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['resources'],agent:{projectContext:false,skills:false}}));
   const provider=new ScriptedProvider([{text:'MAIN_RUNNING',hold:true}]);app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[join(process.cwd(),'plugins/resources')]});expect(app.pluginErrors).toEqual([]);
   const core=app.createCore(async()=>true),views:UiTextView[]=[];core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface'&&(event.input as any).plugin==='resources')views.push((event.input as any).view);});
   const turn=core.submit('Work');await vi.waitFor(()=>{expect(core.failure).toBeUndefined();expect(provider.requests).toHaveLength(1);},{timeout:3000});
   const command=app.commands().find(command=>command.name==='/resources');expect(command?.ui?.site).toBe('plugin-resources-resources');await core.host.emit('ui.press',{site:command!.ui!.site,key:'command:/resources'});expect(views.at(-1)!.lines.some(line=>line.text.includes('Compositor process'))).toBe(true);expect(core.getState()).toBe('running');expect(provider.requests).toHaveLength(1);
   core.interrupt();await turn;
  }finally{await app?.close();await rm(cwd,{recursive:true,force:true});}
 });
 it('measures elapsed CPU including multiple cores and rejects invalid counters',()=>{
  let now=0n,user=0;const sampler=new Sampler({now:()=>now,cpu:()=>({user,system:0}),memory:()=>({rss:100,heapUsed:50,heapTotal:80})});
  expect(sampler.sample().cpu).toBeUndefined();now=1_000_000_000n;user=250000;expect(sampler.sample().cpu).toBe(25);
  now=2_000_000_000n;user=2250000;expect(sampler.sample().cpu).toBe(200);
  sampler.reset();now=9_000_000_000n;expect(sampler.sample().cpu).toBeUndefined();
  now=10_000_000_000n;user=-1;expect(()=>sampler.sample()).toThrow('Invalid process counters');
 });
 it('plots actual observations with bounded width and an honest multi-core axis',()=>{
  const plot=chart([undefined,0,50,200],30,'%',100);expect(plot[0]).toContain('200.0');expect(plot.join('\n')).toContain('Older -> newer (%)');
  expect(plot.join('').split('*').length-1).toBe(3);expect(chart(Array(1000).fill(10),24,'MiB').join('').split('*').length-1).toBe(14);
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
});
