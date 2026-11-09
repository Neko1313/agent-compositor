import { sixel, type CellPixels } from './sixel.js';
import { createHash, randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { WireMessage, RenderMessage } from '@agent-compositor/protocol';
import type { RendererState } from './state.js';

export type Raster = NonNullable<RenderMessage['raster']>;
export type GraphicsMode = 'auto' | 'kitty' | 'sixel' | 'off';
const escape = (control: string, data = '') => `\x1b_G${control};${data}\x1b\\`;

/** Terminal-owned pixel rendering. No plugin-supplied escape strings are executed. */
export class TerminalGraphics {
  enabled = false;
  backend:'kitty'|'sixel'='kitty';
  cell:CellPixels={width:8,height:16};
  background:[number,number,number]=[16,21,25];
  private sixelCache=new Map<string,string>();
  private sixelAdvertised=false;
  private cellKnown=false;
  private bgKnown=false;
  private areaPixels?:number[];
  private areaCells?:number[];
  private sixelPlacements=new Map<string,{x:number;y:number;columns:number;rows:number}>();
  suspended = false;
  readonly queryId = randomInt(1_000_000, 2_000_000);
  private nextId = randomInt(2_000_001, 4_000_000);
  private readonly images = new Map<string, number>();
  private readonly placements = new Map<string, { image: number; placement: number }>();
  private finishProbe?: (supported: boolean) => void;
  constructor(private write: (text: string) => unknown) {}

  async detect(mode: GraphicsMode, tty: boolean, multiplexed = false): Promise<boolean> {
    if (!tty || mode === 'off' || (multiplexed && mode === 'auto')) return false;
    if (mode === 'kitty') {this.backend='kitty';return this.enabled = true;}
    this.backend='kitty';this.sixelAdvertised=mode==='sixel';this.cellKnown=false;this.bgKnown=false;this.areaPixels=undefined;this.areaCells=undefined;
    return new Promise(resolve => {
      const timer = setTimeout(() => {if(this.sixelAdvertised&&this.cellKnown&&this.bgKnown){this.backend='sixel';this.finishProbe?.(true);}else this.finishProbe?.(false);},350);
      this.finishProbe = supported => {
        clearTimeout(timer); this.finishProbe = undefined;
        this.enabled = supported; resolve(supported);
      };
      if(mode!=='sixel')this.write(escape(`a=q,i=${this.queryId},s=1,v=1,f=24,t=d`, 'AAAA'));
      this.write('\x1b[c\x1b[16t\x1b[14t\x1b[18t\x1b]11;?\x1b\\');
    });
  }

  measure():void {
    this.areaPixels=undefined;this.areaCells=undefined;
    this.write('\x1b[16t\x1b[14t\x1b[18t\x1b]11;?\x1b\\');
  }
  response(control: string, payload: string): void {
    if(control==='da1')this.sixelAdvertised ||= payload.split(';').includes('4');
    if(control==='cell'){
      const [height,width]=payload.split(';').map(Number);
      if(width>=1&&height>=1&&width<=128&&height<=256){this.cell={width,height};this.cellKnown=true;}
    }
    // VTE supports area queries 14/18, but does not implement cell query 16.
    if(control==='areaPixels')this.areaPixels=payload.split(';').map(Number);
    if(control==='areaCells')this.areaCells=payload.split(';').map(Number);
    if(this.areaPixels&&this.areaCells){
      const [h,w]=this.areaPixels,[rows,columns]=this.areaCells;
      if(rows>0&&columns>0&&h>0&&w>0&&Number.isInteger(h/rows)&&Number.isInteger(w/columns)&&w/columns<=128&&h/rows<=256){this.cell={width:w/columns,height:h/rows};this.cellKnown=true;}
    }
    if(control==='background'){
      const rgb=/^rgb:([a-f0-9]{1,4})\/([a-f0-9]{1,4})\/([a-f0-9]{1,4})$/i.exec(payload);
      if(rgb){this.background=rgb.slice(1).map(c=>Math.round(parseInt(c,16)*255/(16**c.length-1))) as [number,number,number];this.bgKnown=true;}
      const hex=/^#([a-f0-9]{6})$/i.exec(payload);if(hex){this.background=[0,2,4].map(i=>parseInt(hex[1].slice(i,i+2),16)) as [number,number,number];this.bgKnown=true;}
    }
    if (control.split(',').includes(`i=${this.queryId}`)&&payload==='OK'&&this.finishProbe){this.backend='kitty';this.finishProbe?.(true);}
  }

  paint(state: RendererState): void {
    if (!this.enabled || this.suspended) return;
    if(this.backend==='sixel'){this.paintSixel(state);return;}
    const frames = state.layout?.frames ?? [];
    const visible = new Set(frames.filter(frame => {
      const raster = state.rasters.get(frame.surface);
      return raster && frame.width >= 5 && frame.height >= 4 &&
        frame.width - 4 - raster.column > 0 && frame.height - 3 - raster.row > 0;
    }).map(frame => frame.surface));
    for (const [surface, previous] of this.placements) {
      if (!visible.has(surface) || !state.rasters.has(surface)) {
        this.write(escape(`a=d,d=i,i=${previous.image},p=${previous.placement},q=2`));
        this.placements.delete(surface);
      }
    }
    let output = '';
    for (const frame of frames) {
      const raster = state.rasters.get(frame.surface);
      if (!raster || frame.width < 5 || frame.height < 4) continue;
      const columns = Math.min(raster.columns, frame.width - 4 - raster.column);
      const rows = Math.min(raster.rows, frame.height - 3 - raster.row);
      if (columns < 1 || rows < 1) continue;
      const key = createHash('sha256').update(`${raster.width}:${raster.height}:`).update(raster.rgba).digest('hex');
      let image = this.images.get(key);
      if (!image) {
        image = this.nextId++;
        const bytes = Buffer.from(raster.rgba, 'base64');
        if (bytes.length !== raster.width * raster.height * 4) continue;
        const payload = deflateSync(bytes).toString('base64');
        for (let offset = 0; offset < payload.length; offset += 4096) {
          const chunk = payload.slice(offset, offset + 4096), more = offset + 4096 < payload.length ? 1 : 0;
          output += escape(offset === 0 ? `a=t,f=32,s=${raster.width},v=${raster.height},i=${image},o=z,q=2,m=${more}` : `m=${more},q=2`, chunk);
        }
        this.images.set(key, image);
      }
      const old = this.placements.get(frame.surface);
      const placement = old?.placement ?? this.nextId++;
      if (old && old.image !== image) output += escape(`a=d,d=i,i=${old.image},p=${placement},q=2`);
      // Ink restores its own cursor below the UI. Never leave it at the image.
      output += `\x1b7\x1b[${frame.y + 3 + raster.row};${frame.x + 3 + raster.column}H`;
      output += escape(`a=p,i=${image},p=${placement},c=${columns},r=${rows},C=1,z=1,q=2`);
      output += '\x1b8';
      this.placements.set(frame.surface, { image, placement });
    }
    const active = new Set([...this.placements.values()].map(p => p.image));
    for (const [key, image] of this.images) {
      if (this.images.size <= 64) break;
      if (!active.has(image)) { output += escape(`a=d,d=I,i=${image},q=2`); this.images.delete(key); }
    }
    if (output) this.write(output);
  }

  /** Non-addressable protocols erase old pixels before Ink paints new text. */
  beforeUpdate(message?:WireMessage,state?:RendererState):void {
    if(this.backend!=='sixel'||!this.sixelPlacements.size)return;
    if(message&&state){
      if(message.type==='render'){
        const old=this.sixelPlacements.get(message.surface);if(!old)return;
        const frame=state.layout?.frames.find(f=>f.surface===message.surface),image=message.raster;
        if(frame&&image&&old.x===frame.x+3+image.column&&old.y===frame.y+3+image.row&&old.columns===Math.min(image.columns,frame.width-4-image.column)&&old.rows===Math.min(image.rows,frame.height-3-image.row))return;
      }else if(message.type==='layout'){
        const unchanged=[...this.sixelPlacements].every(([surface,old])=>{const frame=message.frames.find(f=>f.surface===surface),image=state.rasters.get(surface);return frame&&image&&old.x===frame.x+3+image.column&&old.y===frame.y+3+image.row&&old.columns===Math.min(image.columns,frame.width-4-image.column)&&old.rows===Math.min(image.rows,frame.height-3-image.row);});
        if(unchanged)return;
      }
    }
    let output='\x1b7';
    for(const p of this.sixelPlacements.values())for(let row=0;row<p.rows;row++)output+=`\x1b[${p.y+row};${p.x}H`+' '.repeat(p.columns);
    this.write(output+'\x1b8');this.sixelPlacements.clear();
  }
  private paintSixel(state:RendererState):void {
    let output='';
    for(const frame of state.layout?.frames??[]){
      const image=state.rasters.get(frame.surface);if(!image)continue;
      const columns=Math.min(image.columns,frame.width-4-image.column),rows=Math.min(image.rows,frame.height-3-image.row);
      if(columns<1||rows<1)continue;
      const x=frame.x+3+image.column,y=frame.y+3+image.row;
      const key=createHash('sha256').update(`${image.width}:${image.height}:${columns}:${rows}:${this.cell.width}:${this.cell.height}:${this.background}:`).update(image.rgba).digest('hex');
      let encoded=this.sixelCache.get(key);if(!encoded){encoded=sixel(image,columns,rows,this.cell,this.background);this.sixelCache.set(key,encoded);if(this.sixelCache.size>64)this.sixelCache.delete(this.sixelCache.keys().next().value!);}
      output+=`\x1b7\x1b[${y};${x}H`+encoded+'\x1b8';
      this.sixelPlacements.set(frame.surface,{x,y,columns,rows});
    }
    if(output)this.write(output);
  }
  clear(): void {
    this.beforeUpdate();
    for (const image of this.images.values()) this.write(escape(`a=d,d=I,i=${image},q=2`));
    this.images.clear(); this.placements.clear();this.sixelCache.clear();
  }

  dispose(): void { this.finishProbe?.(false); this.clear(); this.suspended = true; }
}
