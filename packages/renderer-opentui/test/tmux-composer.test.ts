import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {console as inspectorConsole} from 'node:inspector';
import type {NativeSession} from '@opentui/core';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.restoreAllMocks();vi.unstubAllEnvs();});

describe.skipIf(Number(process.versions.node.split('.')[0])<26)('tmux composer integration',()=>{
  let timeStamp:PropertyDescriptor | undefined;
  beforeAll(()=>{timeStamp=Object.getOwnPropertyDescriptor(console,'timeStamp');Object.defineProperty(console,'timeStamp',{configurable:true,writable:true,value:inspectorConsole.timeStamp.bind(inspectorConsole)});});
  afterAll(()=>{if(timeStamp)Object.defineProperty(console,'timeStamp',timeStamp);else Reflect.deleteProperty(console,'timeStamp');});
  it('negotiates a virtual image, updates frames and deletes it on unmount',async()=>{
    vi.stubEnv('AGENT_GRAPHICS','auto');vi.stubEnv('NO_COLOR',undefined);vi.stubEnv('TERM','tmux-256color');vi.stubEnv('AGENT_REDUCED_MOTION',undefined);
    const properties:number[]=[],measure=performance.measure;let probeReads=0;
    vi.spyOn(performance,'measure').mockImplementation((...args:Parameters<typeof performance.measure>)=>{
      const [name,options]=args,detail=typeof options==='object'?options.detail:undefined;
      if(name.replaceAll('\u200b','')==='TmuxComposerImage'&&Array.isArray(detail?.devtools?.properties))properties.push(detail.devtools.properties.length);
      return Reflect.apply(measure,performance,args);
    });
    const [{createTestRenderer,setRendererCapabilities},{createRoot,flushSync},{createElement},{TmuxComposer,TmuxComposerProvider},{Ghost}]=await Promise.all([
      import('@opentui/core/testing'),import('@opentui/react'),import('react'),import('../src/tmux-composer.js'),import('../src/ghost.js'),
    ]);
    const writes:Buffer[]=[],sink={maxAtomicWriteBytes:100000n,write:(bytes:Uint8Array)=>{writes.push(Buffer.from(bytes));return true;},idle:async()=>{}};
    const runtime=new TmuxComposer(sink as unknown as NativeSession);cleanup.push(()=>runtime.close());
    const terminal=await createTestRenderer({width:80,height:24,exitOnCtrlC:false});cleanup.push(()=>terminal.dispose());
    setRendererCapabilities(terminal.renderer,{kitty_graphics:false,multiplexer:'tmux'});
    const root=createRoot(terminal.renderer);cleanup.push(()=>root.unmount());
    const pixels=Uint8Array.from({length:8*8*4},(_,i)=>i%4===3?255:i%4+1);
    Object.defineProperty(pixels,'inspectionProbe',{enumerable:true,get(){probeReads++;return 'not component metadata';}});
    let send!:(frame:{width:number;height:number;rgba:Uint8Array})=>void,expanded:boolean|undefined;
    const media={presentation:()=>({label:'Ready',hasImage:true}),dimensions:()=>({width:2,height:2}),
      subscribe:(_active:boolean,listener:typeof send,options?:{expanded?:boolean})=>{send=listener;expanded=options?.expanded;listener({width:8,height:8,rgba:pixels});return()=>{};}};
    flushSync(()=>root.render(createElement(TmuxComposerProvider,{runtime,children:createElement(Ghost,{media,enabled:true,expanded:true,active:false})})));
    await terminal.flush({maxPasses:30});expect(expanded).toBe(false);expect(terminal.captureCharFrame()).toContain('images unavailable');
    runtime.start();await vi.waitFor(()=>expect(writes.length).toBeGreaterThan(0));
    const query=writes[0].toString().replaceAll('\x1b\x1b','\x1b'),id=/i=(\d+)/.exec(query)?.[1];expect(id).toBeTruthy();
    flushSync(()=>expect(runtime.input(`\x1b_Gi=${id},e=T,U=1;OK\x1b\\`)).toBe(true));
    await vi.waitFor(()=>expect(expanded).toBe(true));await vi.waitFor(()=>expect(writes.some(value=>value.toString().includes('a=T,U=1'))).toBe(true));
    await terminal.flush({maxPasses:30});expect(terminal.captureCharFrame()).toContain('\u{10eeee}');
    const uploads=()=>writes.filter(value=>value.toString().includes('a=T,U=1')).length,prior=uploads();
    flushSync(()=>send({width:8,height:8,rgba:pixels}));await vi.waitFor(()=>expect(uploads()).toBeGreaterThan(prior));
    await terminal.flush({maxPasses:30});
    expect(properties.length).toBeGreaterThan(0);expect(Math.max(...properties)).toBeLessThanOrEqual(64);expect(probeReads).toBe(0);
    flushSync(()=>root.unmount());await vi.waitFor(()=>expect(writes.some(value=>value.toString().includes('a=d,d=I'))).toBe(true));
    await runtime.close();
  });
  it('renders plugin rasters after negotiation, updates them and removes images when hidden',async()=>{
    vi.stubEnv('AGENT_GRAPHICS','auto');vi.stubEnv('NO_COLOR',undefined);vi.stubEnv('TERM','tmux-256color');
    const [{createTestRenderer,setRendererCapabilities},{createRoot,flushSync},{createElement},{TmuxComposer,TmuxComposerProvider},{SurfaceRaster}]=await Promise.all([
      import('@opentui/core/testing'),import('@opentui/react'),import('react'),import('../src/tmux-composer.js'),import('../src/surface-raster.js'),
    ]);
    const writes:Buffer[]=[],sink={maxAtomicWriteBytes:100000n,write:(bytes:Uint8Array)=>{writes.push(Buffer.from(bytes));return true;},idle:async()=>{}};
    const runtime=new TmuxComposer(sink as unknown as NativeSession);cleanup.push(()=>runtime.close());
    const terminal=await createTestRenderer({width:80,height:24,exitOnCtrlC:false});cleanup.push(()=>terminal.dispose());
    setRendererCapabilities(terminal.renderer,{kitty_graphics:false,multiplexer:'tmux'});
    const root=createRoot(terminal.renderer);cleanup.push(()=>root.unmount());
    const render=(rgba:string,visible=true)=>flushSync(()=>root.render(createElement(TmuxComposerProvider,{runtime,children:createElement(SurfaceRaster,{raster:{width:1,height:1,rgba,alt:'Resource chart'},width:30,height:10,visible})})));
    render('/wAA/w==');await terminal.flush({maxPasses:30});expect(terminal.captureCharFrame()).toContain('Resource chart');
    runtime.start();const id=/i=(\d+)/.exec(writes[0].toString())?.[1];expect(id).toBeTruthy();
    flushSync(()=>expect(runtime.input(`\x1b_Gi=${id},e=T,U=1;OK\x1b\\`)).toBe(true));
    const uploads=()=>writes.filter(value=>value.toString().includes('a=T,U=1')).length;
    await vi.waitFor(()=>expect(uploads()).toBeGreaterThan(0));await terminal.flush({maxPasses:30});expect(terminal.captureCharFrame()).toContain('\u{10eeee}');
    const prior=uploads();render('AP8A/w==');await vi.waitFor(()=>expect(uploads()).toBeGreaterThan(prior));
    render('AP8A/w==',false);await vi.waitFor(()=>expect(writes.some(value=>value.toString().includes('a=d,d=I'))).toBe(true));
    await terminal.flush({maxPasses:30});expect(terminal.captureCharFrame()).not.toContain('\u{10eeee}');
  });
});

describe.skipIf(Number(process.versions.node.split('.')[0])<26)('tmux composer cleanup',()=>{
  it('retries a rejected image deletion when the runtime closes',async()=>{
    const {TmuxComposer}=await import('../src/tmux-composer.js');
    const writes:Buffer[]=[];let rejectDeletion=true;
    const sink={maxAtomicWriteBytes:100000n,write:(bytes:Uint8Array)=>{
      const value=Buffer.from(bytes);if(value.includes(Buffer.from('a=d,d=I'))&&rejectDeletion)return false;
      writes.push(value);return true;
    },idle:async()=>{}};
    const runtime=new TmuxComposer(sink as unknown as NativeSession);cleanup.push(()=>runtime.close());runtime.start();
    const id=/i=(\d+)/.exec(writes[0].toString())?.[1];expect(id).toBeTruthy();
    expect(runtime.input(`\x1b_Gi=${id},e=T,U=1;OK\x1b\\`)).toBe(true);
    await vi.waitFor(()=>expect(runtime.snapshot()).toBe(true));
    const {player}=runtime.create(2,2,()=>{},()=>{});
    player.present({width:1,height:1,rgba:Uint8Array.of(1,2,3,255)});await player.idle();
    await expect(runtime.release(player)).rejects.toThrow('remained unavailable');
    rejectDeletion=false;await runtime.close();
    expect(writes.some(value=>value.includes(Buffer.from('a=d,d=I')))).toBe(true);
    expect(()=>runtime.create(2,2,()=>{},()=>{})).toThrow('unavailable');
  });
});
