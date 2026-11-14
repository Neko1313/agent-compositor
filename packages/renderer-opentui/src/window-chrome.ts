import type {WindowFrame} from './layout.js';

export interface Rectangle {x:number;y:number;width:number;height:number}
export interface TitleControl extends Rectangle {surface:string;action:'zoom'|'close'}

export function finderRectangle(width:number,height:number):Rectangle {
  const w=Math.max(1,Math.min(width,92)),h=Math.max(1,Math.min(height,22));
  return{x:Math.max(0,Math.floor((width-w)/2)),y:Math.max(0,Math.floor((height-h)/3)),width:w,height:h};
}

/** Painting and hit testing share these six title cells; borders remain draggable. */
export function titleControls(frame:WindowFrame,visible:boolean):readonly TitleControl[] {
  if(!visible||frame.width<14||frame.height<1)return[];
  const x=frame.x+frame.width-7;
  return[{surface:frame.surface,action:'zoom',x,y:frame.y,width:3,height:1},
    {surface:frame.surface,action:'close',x:x+3,y:frame.y,width:3,height:1}];
}

export function contains(rect:Rectangle,x:number,y:number):boolean {
  return x>=rect.x&&x<rect.x+rect.width&&y>=rect.y&&y<rect.y+rect.height;
}

/** A final chrome pass must never paint through the private foreground Finder. */
export function titleSegments(frame:Rectangle,occluder?:Rectangle):readonly Rectangle[] {
  if(frame.width<=0||frame.height<=0)return[];
  const row={x:frame.x,y:frame.y,width:frame.width,height:1};
  if(!occluder||frame.y<occluder.y||frame.y>=occluder.y+occluder.height
    ||frame.x>=occluder.x+occluder.width||frame.x+frame.width<=occluder.x)return[row];
  const left=Math.max(0,occluder.x-frame.x),right=Math.max(0,frame.x+frame.width-(occluder.x+occluder.width));
  return[...(left?[{...row,width:left}]:[]),...(right?[{...row,x:occluder.x+occluder.width,width:right}]:[])];
}
