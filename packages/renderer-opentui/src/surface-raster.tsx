/** @jsxImportSource @opentui/react */
import {CliRenderEvents,NativeImage,resolveImageRenderProtocol,type ImageRenderable} from '@opentui/core';
import {useRenderer} from '@opentui/react';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {UiTextView} from '@agent-compositor/events';
import {useAppearance} from './appearance.js';
import {appearanceText} from './colors.js';
import {composerImageProtocol} from './composer-media.js';
import {TmuxComposerImage,useTmuxComposer,type TmuxComposer} from './tmux-composer.js';

type Raster=NonNullable<UiTextView['raster']>;
function Pixels({raster,width,height}:{raster:Raster;width:number;height:number}){
  const renderer=useRenderer();
  const image=useRef<ImageRenderable>(null);
  useLayoutEffect(()=>{
    if(!image.current)return;
    const bytes=Uint8Array.from(atob(raster.rgba),point=>point.charCodeAt(0));
    const source=NativeImage.fromPixels(bytes,raster.width,raster.height,{owner:renderer.nativeScene.resourceContext});
    try{image.current.source=source;}finally{source.dispose();}
  },[renderer,raster.rgba,raster.width,raster.height]);
  return <image ref={image} width={Math.max(1,width)} height={Math.max(1,height)} fit="fit" protocol="kitty" flexShrink={0}/>;
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
  const [supported,setSupported]=useState(false);
  useEffect(()=>{
    const update=()=>{
      const caps=renderer.capabilities;
      setSupported(composerImageProtocol('kitty',resolveImageRenderProtocol('auto',caps,false),caps,false)==='kitty');
    };
    renderer.on(CliRenderEvents.CAPABILITIES,update);update();
    return()=>{renderer.off(CliRenderEvents.CAPABILITIES,update);};
  },[renderer]);
  if(!visible)return null;
  const graphics=process.env.AGENT_GRAPHICS??'auto';
  const imageHeight=Math.max(1,Math.min(height-3,Math.ceil(width/2)));
  if(tmux&&(graphics==='auto'||graphics==='kitty')&&process.env.NO_COLOR===undefined&&process.env.TERM!=='dumb')
    return <TmuxPixels runtime={tmux} raster={raster} width={width} height={imageHeight}/>;
  if(supported&&(graphics==='auto'||graphics==='kitty')&&process.env.NO_COLOR===undefined&&process.env.TERM!=='dumb')
    return <Pixels raster={raster} width={width} height={imageHeight}/>;
  return raster.alt?<text fg={color.muted} wrapMode="word">{appearanceText(raster.alt)}</text>:null;
}
