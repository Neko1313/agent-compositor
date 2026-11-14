/** @jsxImportSource @opentui/react */
import {NativeImage,RGBA,TextAttributes,parseColor,type ImageRenderable,type ImageRenderProtocol,type MouseEvent,type OptimizedBuffer} from '@opentui/core';
import {useRenderer} from '@opentui/react';
import {useCallback,useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import type {WireMessage} from '@agent-compositor/protocol';
import type {OpenTuiWireStore} from './wire-store.js';
import {wirePaints,wireRasterFrames,type Rect,type Style} from './wire-frame.js';

type Raster=NonNullable<Extract<WireMessage,{type:'render'}>['raster']>;
const color=(value:string|undefined,background=false)=>value?parseColor(value.endsWith('Bright')?'bright'+value.slice(0,-6).toLowerCase():value):background?RGBA.defaultBackground():RGBA.defaultForeground();
function attributes(style:Style){return(style.bold?TextAttributes.BOLD:0)|(style.dim?TextAttributes.DIM:0)|(style.italic?TextAttributes.ITALIC:0)|(style.underline?TextAttributes.UNDERLINE:0)|(style.inverse?TextAttributes.INVERSE:0);}

function WirePixels({image,rect,protocol}:{image:Raster;rect:Rect;protocol:ImageRenderProtocol}){
  const renderer=useRenderer(),ref=useRef<ImageRenderable>(null);
  useLayoutEffect(()=>{if(!ref.current)return;const source=NativeImage.fromPixels(Uint8Array.from(atob(image.rgba),ch=>ch.charCodeAt(0)),image.width,image.height,{owner:renderer.nativeScene.resourceContext});
    try{ref.current.source=source;}finally{source.dispose();}
  },[renderer,image.width,image.height,image.rgba]);
  return <image ref={ref} position="absolute" left={rect.x} top={rect.y} width={rect.width} height={rect.height} fit="fill" protocol={protocol}/>;
}

export function OpenTuiWireView({store,onMouse,protocol='kitty'}:{store:OpenTuiWireStore;onMouse?(event:MouseEvent):void;protocol?:ImageRenderProtocol}){
  const renderer=useRenderer(),snapshot=useSyncExternalStore(store.subscribe,store.snapshot);
  const paint=useCallback((buffer:OptimizedBuffer)=>{
      buffer.fillRect(0,0,buffer.width,buffer.height,RGBA.defaultBackground());
      for(const command of wirePaints(snapshot.text,renderer.width)){
        if(command.clip.width<1||command.clip.height<1)continue;
        buffer.pushScissorRect(command.clip.x,command.clip.y,command.clip.width,command.clip.height);
        try{buffer.drawText(command.text,command.x,command.y,color(command.style.fg),color(command.style.bg,true),attributes(command.style));}finally{buffer.popScissorRect();}
      }
  },[renderer,snapshot.text]);
  useLayoutEffect(()=>{renderer.requestRender();},[renderer,snapshot]);
  return <box width="100%" height="100%" minWidth={0} minHeight={0} onMouse={onMouse} renderBefore={paint}>
    {wireRasterFrames(snapshot,renderer.width).map(({surface,image,rect})=><WirePixels key={surface} image={image} rect={rect} protocol={protocol}/>)}
  </box>;
}
