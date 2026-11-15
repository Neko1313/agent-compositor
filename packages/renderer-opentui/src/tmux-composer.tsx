/** @jsxImportSource @opentui/react */
import {randomInt} from 'node:crypto';
import {createContext,useContext,useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import type {NativeSession} from '@opentui/core';
import {TmuxFeatureProbe,TmuxFramePlayer,tmuxImageColor,tmuxPlaceholderRows} from './tmux-image-codec.js';

type Frame={width:number;height:number;rgba:Uint8Array};

/** Owns the negotiated capability and all image IDs for one terminal session. */
export class TmuxComposer {
  private readonly probe:TmuxFeatureProbe;
  private readonly ids=new Set<number>();
  private readonly players=new Map<TmuxFramePlayer,number>();
  private readonly releases=new Map<TmuxFramePlayer,Promise<void>>();
  private readonly listeners=new Set<()=>void>();
  private supported=false;
  private closed=false;
  private closing?:Promise<void>;
  constructor(private readonly session:NativeSession){this.probe=new TmuxFeatureProbe(session,randomInt(1,0x1000000));}
  start(){void this.probe.start().then(supported=>{if(!this.closed&&supported){this.supported=true;for(const listener of this.listeners)listener();}});}
  input(sequence:string){return this.probe.accept(sequence);}
  snapshot=()=>this.supported;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  create(columns:number,rows:number,onFrame:()=>void,onError:(error:unknown)=>void){
    if(this.closed||!this.supported)throw Error('tmux image output is unavailable');
    let id:number;do{id=randomInt(1,0x1000000);}while(this.ids.has(id));
    this.ids.add(id);
    const player=new TmuxFramePlayer(this.session,id,columns,rows,onFrame,onError);this.players.set(player,id);
    return {player,id};
  }
  release(player:TmuxFramePlayer){
    const id=this.players.get(player);if(id===undefined)return Promise.resolve();
    const active=this.releases.get(player);if(active)return active;
    const release=player.dispose().then(()=>{this.ids.delete(id);this.players.delete(player);});
    this.releases.set(player,release);
    void release.then(()=>this.releases.delete(player),()=>this.releases.delete(player));
    return release;
  }
  close():Promise<void>{
    if(this.closing)return this.closing;
    this.closed=true;this.probe.dispose();this.supported=false;
    this.listeners.clear();
    this.closing=(async()=>{
      const cleanup=async()=>{await Promise.allSettled([...this.players.keys()].map(player=>this.release(player)));
        await Promise.allSettled([...this.players.keys()].map(player=>this.release(player)));};
      let timer:ReturnType<typeof setTimeout> | undefined;
      try{await Promise.race([cleanup(),new Promise<void>(resolve=>{timer=setTimeout(resolve,1000);})]);}
      finally{clearTimeout(timer);}
    })();
    return this.closing;
  }
}

const Context=createContext<TmuxComposer | null>(null);
const noSubscribe=()=>()=>{};
const unsupported=()=>false;
export function TmuxComposerProvider({runtime,children}:{runtime:TmuxComposer | null;children:ReactNode}){
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}
export function useTmuxComposer(){
  const runtime=useContext(Context),ready=useSyncExternalStore(runtime?.subscribe??noSubscribe,runtime?.snapshot??unsupported);
  return ready?runtime:null;
}

/** Placeholder cells remain ordinary OpenTUI text, so tmux owns clipping and movement. */
export function TmuxComposerImage({runtime,getFrame,columns,rows,fallback}:{runtime:TmuxComposer;getFrame:()=>Frame;columns:number;rows:number;fallback:string}){
  // React development profiling expands props; never expose the pixel array as a prop.
  const frame=getFrame();
  const [image,setImage]=useState<{id:number;ready:boolean;failed:boolean}>();
  const current=useRef<TmuxFramePlayer | undefined>(undefined);
  useEffect(()=>{
    let active=true;
    let allocation:{player:TmuxFramePlayer;id:number};
    try{allocation=runtime.create(columns,rows,()=>{if(active)setImage(value=>value?.id===allocation.id?{...value,ready:true}:value);},()=>{
      if(active)setImage(value=>value?.id===allocation.id?{...value,failed:true}:value);
      void runtime.release(allocation.player).catch(()=>{});
    });}catch{setImage({id:0,ready:false,failed:true});return;}
    const {player,id}=allocation;
    current.current=player;setImage({id,ready:false,failed:false});
    return()=>{active=false;if(current.current===player)current.current=undefined;void runtime.release(player).catch(()=>{});};
  },[runtime,columns,rows]);
  useEffect(()=>{
    const player=current.current;if(!player||image?.failed)return;
    try{player.present(frame);}catch{
      setImage(value=>value?{...value,failed:true}:value);current.current=undefined;void runtime.release(player).catch(()=>{});
    }
  },[frame,runtime,columns,rows,image?.failed]);
  if(!image?.ready||image.failed)return fallback?<text height={1} wrapMode="none" truncate>{fallback}</text>:null;
  return <box flexDirection="column" width={columns} height={rows} flexShrink={0}>
    {tmuxPlaceholderRows(columns,rows).map((text,index)=><text key={index} height={1} wrapMode="none" selectable={false} fg={tmuxImageColor(image.id)}>{text}</text>)}
  </box>;
}
