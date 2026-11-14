import {RendererState,type Cursor,type Segment,type SurfaceDecl,type WireMessage} from '@agent-compositor/protocol';

export interface WireGridSnapshot {readonly width:number;readonly height:number;readonly cursor?:Cursor;readonly rows:readonly (readonly Segment[])[];}
export interface WireTextSnapshot {
  readonly surfaces:readonly SurfaceDecl[];
  readonly grids:ReadonlyMap<string,WireGridSnapshot>;
  readonly focused?:string;
  readonly layout?:Extract<WireMessage,{type:'layout'}>;
}
export interface WireRendererSnapshot {
  readonly revision:number;
  readonly text:WireTextSnapshot;
  readonly rasters:ReadonlyMap<string,NonNullable<Extract<WireMessage,{type:'render'}>['raster']>>;
}

/** Published text stays stable across unflushed diffs and pixel-only updates. */
export class OpenTuiWireStore {
  readonly state:RendererState;
  private readonly listeners=new Set<()=>void>();
  private current:WireRendererSnapshot={revision:0,text:{surfaces:[],grids:new Map()},rasters:new Map()};
  constructor(nativeImages=false){this.state=new RendererState(nativeImages);}
  snapshot=()=>this.current;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  apply(message:WireMessage):boolean {
    this.state.apply(message);
    if(!this.state.textChanged&&!this.state.rasterChanged)return false;
    let text=this.current.text;
    if(this.state.textChanged){
      const grids=new Map<string,WireGridSnapshot>();
      for(const[id,grid]of this.state.grids)grids.set(id,{width:grid.width,height:grid.height,
        cursor:grid.cursor?{...grid.cursor}:undefined,rows:Array.from({length:grid.height},(_,row)=>grid.segments(row,grid.cursor).map(segment=>({text:segment.text,style:{...segment.style}})))});
      text={surfaces:this.state.surfaceList().map(decl=>({...decl})),grids,focused:this.state.focused,
        layout:this.state.layout?structuredClone(this.state.layout):undefined};
    }
    const rasters=this.state.rasterChanged?new Map([...this.state.rasters].map(([id,image])=>[id,{...image}])):this.current.rasters;
    this.current={revision:this.current.revision+1,text,rasters};
    for(const listener of [...this.listeners])listener();return true;
  }
}
