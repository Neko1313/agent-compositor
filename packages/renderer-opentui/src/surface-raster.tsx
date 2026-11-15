/** @jsxImportSource @opentui/react */
import {CliRenderEvents,NativeImage,resolveImageRenderProtocol,type ImageRenderable} from '@opentui/core';
import {useRenderer} from '@opentui/react';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {UiTextView} from '@agent-compositor/events';
import {useAppearance} from './appearance.js';
import {appearanceText} from './colors.js';
import {composerImageProtocol,type ComposerImageProtocol} from './composer-media.js';
import {TmuxComposerImage,useTmuxComposer,type TmuxComposer} from './tmux-composer.js';

type Raster=NonNullable<UiTextView['raster']>;
function Pixels({raster,width,height,protocol}:{raster:Raster;width:number;height:number;protocol:ComposerImageProtocol}){
  const renderer=useRenderer();
  const image=useRef<ImageRenderable>(null);
  useLayoutEffect(()=>{
    if(!image.current)return;
    const bytes=Uint8Array.from(atob(raster.rgba),point=>point.charCodeAt(0));
    const source=NativeImage.fromPixels(bytes,raster.width,raster.height,{owner:renderer.nativeScene.resourceContext});
    try{image.current.source=source;}finally{source.dispose();}
  },[renderer,raster.rgba,raster.width,raster.height]);
  return <image ref={image} width={Math.max(1,width)} height={Math.max(1,height)} fit="fit" protocol={protocol} flexShrink={0}/>;
}

function TmuxPixels({runtime,raster,width,height}:{runtime:TmuxComposer;raster:Raster;width:number;height:number}){
  const frame=useMemo(()=>({width:raster.width,height:raster.height,rgba:Uint8Array.from(atob(raster.rgba),point=>point.charCodeAt(0))}),[raster.width,raster.height,raster.rgba]);
  return <TmuxComposerImage runtime={runtime} getFrame={()=>frame} columns={Math.max(1,Math.min(20,width))} rows={Math.max(1,Math.min(8,height))} fallback={appearanceText(raster.alt??'')}/>;
}

/** Preserve producer RGBA data; unsupported terminals retain the supplied text view. */
export function SurfaceRaster({raster,width,height,visible}:{raster:Raster;width:number;height:number;visible:boolean}){
  const {color}=useAppearance();
  const renderer=useRenderer();
  const tmux=useTmuxComposer();
  const graphics=process.env.AGENT_GRAPHICS??'auto';
  const [protocol,setProtocol]=useState<ComposerImageProtocol>();
  useEffect(()=>{
    const update=()=>{
      const caps=renderer.capabilities;
      const resolution=renderer.resolution,hasResolution=Boolean(resolution&&resolution.width>0&&resolution.height>0);
      const requested=graphics==='kitty'||graphics==='sixel'?graphics:'auto';
      setProtocol(composerImageProtocol(graphics,resolveImageRenderProtocol(requested,caps,hasResolution),caps,hasResolution));
    };
    renderer.on(CliRenderEvents.CAPABILITIES,update);renderer.on(CliRenderEvents.RESIZE,update);renderer.on(CliRenderEvents.FRAME,update);update();
    return()=>{renderer.off(CliRenderEvents.CAPABILITIES,update);renderer.off(CliRenderEvents.RESIZE,update);renderer.off(CliRenderEvents.FRAME,update);};
  },[renderer,graphics]);
  if(!visible)return null;
  const imageHeight=Math.max(1,Math.min(height-3,Math.ceil(width/2)));
  if(tmux&&(graphics==='auto'||graphics==='kitty')&&process.env.NO_COLOR===undefined&&process.env.TERM!=='dumb')
    return <TmuxPixels runtime={tmux} raster={raster} width={width} height={imageHeight}/>;
  if(protocol&&process.env.NO_COLOR===undefined&&process.env.TERM!=='dumb')
    return <Pixels raster={raster} width={width} height={imageHeight} protocol={protocol}/>;
  return raster.alt?<text fg={color.muted} wrapMode="word">{appearanceText(raster.alt)}</text>:null;
}
