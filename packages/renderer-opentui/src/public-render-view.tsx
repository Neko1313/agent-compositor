/** @jsxImportSource @opentui/react */
import {useCallback,useLayoutEffect,useRef,useSyncExternalStore,type RefObject} from 'react';
import type {MouseEvent,ScrollBoxRenderable} from '@opentui/core';
import {createPublicRenderMeasurements,type PublicRenderSlotSource,type PublicRenderSlotSnapshot} from './public-render.js';
import type {createConversationScrollMemory} from './conversation-scroll.js';

const initial:PublicRenderSlotSnapshot=Object.freeze({revision:0});
export function usePublicRenderSnapshot(source?:PublicRenderSlotSource){
  const subscribe=useCallback((listener:()=>void)=>source?.subscribe(listener)??(()=>{}),[source]);
  const snapshot=useCallback(()=>source?.snapshot()??initial,[source]);
  return useSyncExternalStore(subscribe,snapshot);
}

/** Use the established per-pane history memory for both native and overridden public views. */
export function usePublicScrollMemory(ref:RefObject<ScrollBoxRenderable|null>,paneId:string,visible:boolean,epoch:unknown,
  memory:ReturnType<typeof createConversationScrollMemory>,override=false){
  const ready=useRef(true);
  const current=useRef({paneId,visible,override});current.current={paneId,visible,override};
  useLayoutEffect(()=>{
    const box=ref.current;memory.reset(epoch);ready.current=true;
    if(!box||!visible||override)return;
    const capture=()=>{
      const latest=current.current;
      if(ready.current&&!box.isDestroyed&&latest.paneId===paneId&&latest.visible&&!latest.override)memory.capture(paneId,box);
    };
    ready.current=false;
    const cancel=memory.restore(paneId,box,()=>{ready.current=true;capture();});
    // A React mutation can clamp native geometry before effect cleanup. Keep
    // the last measured default position instead of sampling that new override.
    box.verticalScrollBar.on('change',capture);box.viewport.on('resize',capture);box.content.on('resize',capture);
    return()=>{cancel();box.verticalScrollBar.off('change',capture);box.viewport.off('resize',capture);box.content.off('resize',capture);capture();};
  },[paneId,visible,epoch,memory,override]);
  return useCallback(()=>ready.current,[]);
}

/** Read native public geometry after layout; the host retains render/cache authority. */
export function usePublicRenderMeasurement(source:PublicRenderSlotSource|undefined,ref:RefObject<ScrollBoxRenderable|null>,visible:boolean,insets={columns:0,rows:0},
  scroll?:{ready():boolean;input(offset:number):void}){
  const current=useRef({visible,insets,scroll});current.current={visible,insets,scroll};
  const connection=useRef<{source:PublicRenderSlotSource;box:ScrollBoxRenderable;schedule():void;input():void;mouse(event:MouseEvent):void;dispose():void}|undefined>(undefined);
  const hiddenSource=useRef<PublicRenderSlotSource|undefined>(undefined);
  useLayoutEffect(()=>{
    const box=ref.current,previous=connection.current;
    if(previous&&(previous.source!==source||previous.box!==box)){previous.dispose();connection.current=undefined;}
    if(source&&box&&!connection.current){
      const publisher=createPublicRenderMeasurements(source);let active=true,scheduled=false,inputPending=false,barHeld=false;
      const measure=()=>{
        if(!active||box.isDestroyed)return;
        const state=current.current;
        if(!state.visible){inputPending=false;barHeld=false;publisher.hide();return;}
        // Restoring the native default must precede any layout-clamp receipt.
        if(state.scroll&&!state.scroll.ready()){schedule();return;}
        const origin=inputPending||barHeld?'input':'layout';
        if(origin==='input')state.scroll?.input(box.scrollTop);
        publisher.publish({columns:Math.max(0,box.viewport.width-state.insets.columns),rows:Math.max(0,box.viewport.height-state.insets.rows),
          visible:true,scrollOffset:box.scrollTop,scrollOrigin:origin});
        inputPending=false;
      };
      const schedule=()=>{
        if(!current.current.visible){inputPending=false;barHeld=false;publisher.hide();return;}
        if(scheduled||!active||box.isDestroyed)return;scheduled=true;
        box.afterLayout(()=>{scheduled=false;measure();});
      };
      const input=()=>{if(!active||!current.current.visible)return;inputPending=true;schedule();};
      const mouse=(event:MouseEvent)=>{
        if(!active||!current.current.visible)return;
        if(event.type==='scroll'&&!event.defaultPrevented&&(event.scroll?.direction==='up'||event.scroll?.direction==='down')){input();return;}
        const bar=box.verticalScrollBar;
        if(event.type==='down'&&event.button===0&&event.target===box&&bar.visible&&event.x>=bar.x&&event.x<bar.x+bar.width&&event.y>=bar.y&&event.y<bar.y+bar.height){barHeld=true;input();}
        else if(barHeld&&(event.type==='drag'||event.type==='up'||event.type==='drag-end')){input();if(event.type!=='drag')barHeld=false;}
      };
      box.viewport.on('resize',measure);box.content.on('resize',measure);box.verticalScrollBar.on('change',measure);
      connection.current={source,box,schedule,input,mouse,dispose(){active=false;publisher.dispose();box.viewport.off('resize',measure);box.content.off('resize',measure);box.verticalScrollBar.off('change',measure);}};
    }
    if(!box&&source&&hiddenSource.current!==source){source.measure({columns:0,rows:0,visible:false,scrollOffset:0});hiddenSource.current=source;}
    if(box)hiddenSource.current=undefined;
    connection.current?.schedule();
  });
  useLayoutEffect(()=>()=>{connection.current?.dispose();connection.current=undefined;},[]);
  return {input:useCallback(()=>connection.current?.input(),[]),onMouse:useCallback((event:MouseEvent)=>connection.current?.mouse(event),[])};
}
