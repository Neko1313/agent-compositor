import {afterEach,expect,it,vi} from 'vitest';
import type {UiSurfaceSnapshot,UiSurfaceSource} from '../src/surface.js';

afterEach(()=>vi.unstubAllEnvs());

it.skipIf(Number(process.versions.node.split('.')[0])<26)('reveals an action-created raster and respects later manual scrolling',async()=>{
  vi.stubEnv('AGENT_GRAPHICS','off');
  const [{createTestRenderer},{createRoot,flushSync},{createElement},{SurfaceView}]=await Promise.all([
    import('@opentui/core/testing'),import('@opentui/react'),import('react'),import('../src/surface-view.js'),
  ]);
  const terminal=await createTestRenderer({width:45,height:12,exitOnCtrlC:false}),root=createRoot(terminal.renderer);
  const lines=Array.from({length:40},(_,i)=>({text:`ITEM_${String(i).padStart(2,'0')}`,...(i===0?{action:'first'}:i===20?{action:'build'}:{})}));
  let state:UiSurfaceSnapshot={revision:1,title:'Fixture',view:{lines}},listeners=new Set<()=>void>();
  const update=(patch:Partial<UiSurfaceSnapshot>)=>{state={...state,...patch,revision:state.revision+1};for(const listener of listeners)listener();};
  const source:UiSurfaceSource={id:'fixture',snapshot:()=>state,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    press:()=>update({busy:true}),change:()=>{}};
  const addRaster=()=>update({busy:false,view:{lines,raster:{width:1,height:1,rgba:'/wAA/w==',alt:'RASTER_START'}}});
  try{
    terminal.renderer.start();
    flushSync(()=>root.render(createElement(SurfaceView,{source,focused:true,width:45,height:12,isActive:()=>true,isVisible:()=>true})));
    await terminal.waitForFrame(frame=>frame.includes('ITEM_00'));
    terminal.mockInput.pressArrow('down');await terminal.waitForFrame(frame=>frame.includes('ITEM_20'));
    terminal.mockInput.pressEnter();await terminal.waitForFrame(frame=>frame.includes('Working'));
    flushSync(addRaster);await terminal.waitForFrame(frame=>frame.includes('RASTER_START'));
    flushSync(()=>update({view:{...state.view!}}));await terminal.waitForFrame(frame=>frame.includes('RASTER_START'));
    terminal.mockInput.pressKey('\x1b[6~');await terminal.waitForFrame(frame=>!frame.includes('RASTER_START'));
    flushSync(()=>update({view:{...state.view!}}));await terminal.flush({maxPasses:30});expect(terminal.captureCharFrame()).not.toContain('RASTER_START');
    terminal.mockInput.pressArrow('down');await terminal.waitForFrame(frame=>frame.includes('ITEM_20'));
    flushSync(()=>update({view:{lines}}));terminal.mockInput.pressEnter();await terminal.waitForFrame(frame=>frame.includes('Working'));
    terminal.mockInput.pressKey('\x1b[6~');await terminal.flush({maxPasses:30});flushSync(addRaster);await terminal.flush({maxPasses:30});
    expect(terminal.captureCharFrame()).not.toContain('RASTER_START');
    const single=lines.map((line,i)=>i===0?{text:line.text}:line);
    flushSync(()=>update({view:{lines:single}}));await terminal.flush({maxPasses:30});
    terminal.mockInput.pressTab();await terminal.waitForFrame(frame=>frame.includes('ITEM_20'));
  }finally{root.unmount();await terminal.dispose();}
});
