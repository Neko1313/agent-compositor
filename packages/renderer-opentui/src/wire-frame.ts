import stringWidth from 'string-width';
import {literalCellText,type StyledCell,type WireMessage} from '@agent-compositor/protocol';
import type {WireRendererSnapshot,WireTextSnapshot} from './wire-store.js';

export type Rect={x:number;y:number;width:number;height:number};
export type Style=Omit<StyledCell,'ch'>;
export type WirePaint={text:string;x:number;y:number;clip:Rect;style:Style};
type Frame=Rect&{surface:string;controls?:boolean;hovered?:boolean;drop?:string;chrome?:NonNullable<WireTextSnapshot['layout']>['frames'][number]['chrome']};

const literal=literalCellText;
export function wireFrames(text:WireTextSnapshot,columns=80):Frame[]{
  if(text.layout)return text.layout.frames;
  let y=0;
  return text.surfaces.map(decl=>{const grid=text.grids.get(decl.id),height=Math.max(1,(grid?.height??0)+(decl.kind==='status-bar'?0:2+Number(Boolean(decl.title))));
    const frame={surface:decl.id,x:0,y,width:Math.max(1,columns),height};y+=height;return frame;});
}

/** Legacy wire rectangles include their own chrome; no native WM is applied again. */
export function wirePaints(text:WireTextSnapshot,columns=80):WirePaint[]{
  const paints:WirePaint[]=[];
  const add=(value:string,x:number,y:number,clip:Rect,style:Style={})=>paints.push({text:literal(value),x,y,clip,style});
  if(!text.layout&&!text.surfaces.length)add('waiting for surfaces…',0,0,{x:0,y:0,width:Math.max(1,columns),height:1},{dim:true});
  for(const frame of wireFrames(text,columns)){
    const decl=text.surfaces.find(surface=>surface.id===frame.surface),grid=text.grids.get(frame.surface);if(!decl||!grid)continue;
    const bar=decl.kind==='status-bar',focused=text.focused===frame.surface,theme=frame.chrome;
    const clip:Rect={x:frame.x,y:frame.y,width:frame.width,height:frame.height};
    let content={x:frame.x,y:frame.y,width:frame.width,height:frame.height};
    if(!bar){
      const glyph=theme?.borderStyle==='double'?['╔','═','╗','║','╚','╝']:theme?.borderStyle==='round'?['╭','─','╮','│','╰','╯']:['┌','─','┐','│','└','┘'];
      const border=frame.drop?theme?.warning??'yellow':focused||frame.hovered?theme?.accent??'cyan':theme?.border??'gray';
      if(frame.width>=2){add(glyph[0]+glyph[1].repeat(Math.max(0,frame.width-2))+glyph[2],frame.x,frame.y,clip,{fg:border});
        if(frame.height>1)add(glyph[4]+glyph[1].repeat(Math.max(0,frame.width-2))+glyph[5],frame.x,frame.y+frame.height-1,clip,{fg:border});}
      for(let y=frame.y+1;y<frame.y+frame.height-1;y++){add(glyph[3],frame.x,y,clip,{fg:border});if(frame.width>1)add(glyph[3],frame.x+frame.width-1,y,clip,{fg:border});}
      const title=Boolean(decl.title),controls=Boolean(frame.controls&&frame.width>=14),titleWidth=Math.max(0,frame.width-2-(controls?6:0));
      if(title&&frame.height>2){
        const label=' '+(frame.drop?'Drop '+(frame.drop==='center'?'to swap':frame.drop)+' · ':'')+decl.title;
        add(label.padEnd(titleWidth),frame.x+1,frame.y+1,{x:frame.x+1,y:frame.y+1,width:titleWidth,height:1},
          {fg:focused||frame.hovered?theme?.accent:theme?.muted,bg:theme?.titleBackground,bold:focused||frame.hovered});
        if(controls)add(focused||frame.hovered||theme?.controls!=='focus'?'[F][x]':'      ',frame.x+frame.width-7,frame.y+1,clip,
          {fg:focused?theme?.accent??'cyan':theme?.muted??'gray',bg:theme?.titleBackground});
      }
      const padding=decl.id==='plugin-placement'?0:1;
      content={x:frame.x+1+padding,y:frame.y+1+Number(title),width:Math.max(0,frame.width-2-padding*2),height:Math.max(0,frame.height-2-Number(title))};
    }
    for(let row=0;row<Math.min(content.height,grid.height);row++){
      let x=content.x;
      for(const segment of grid.rows[row]??[]){add(segment.text,x,content.y+row,content,segment.style);x+=stringWidth(literal(segment.text));}
    }
  }
  return paints;
}

/** Plain final-frame output for redirected streams, using the same placement commands. */
export function wireTextFrame(text:WireTextSnapshot,columns=80):string{
  const paints=wirePaints(text,columns),width=text.layout?.width??Math.max(1,columns),height=text.layout?.height??Math.max(1,...wireFrames(text,columns).map(frame=>frame.y+frame.height));
  const rows=Array.from({length:height},()=>Array.from({length:width},()=>' '));
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  for(const paint of paints){let x=paint.x;for(const{segment}of segmenter.segment(paint.text)){
    const size=stringWidth(segment);if(paint.y>=0&&paint.y<height&&paint.y>=paint.clip.y&&paint.y<paint.clip.y+paint.clip.height&&x>=paint.clip.x&&x+size<=paint.clip.x+paint.clip.width&&x>=0&&x+size<=width){rows[paint.y][x]=segment;for(let i=1;i<size;i++)rows[paint.y][x+i]='';}x+=size;
  }}
  return rows.map(row=>row.join('').trimEnd()).join('\n').trimEnd();
}

type Raster=NonNullable<Extract<WireMessage,{type:'render'}>['raster']>;
export function wireRasterFrames(snapshot:WireRendererSnapshot,columns=80):{surface:string;image:Raster;rect:Rect}[]{
  return wireFrames(snapshot.text,columns).flatMap(frame=>{const image=snapshot.rasters.get(frame.surface);if(!image||frame.width<5||frame.height<4)return[];
    const width=Math.min(image.columns,frame.width-4-image.column),height=Math.min(image.rows,frame.height-3-image.row);if(width<1||height<1)return[];
    return[{surface:frame.surface,image,rect:{x:frame.x+2+image.column,y:frame.y+2+image.row,width,height}}];});
}
