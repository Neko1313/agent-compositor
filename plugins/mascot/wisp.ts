// Pixel silhouettes follow the supplied Wisp Soul storyboard. Each terminal
// cell carries two square pixels; eye cutouts show the terminal background.
export type WispState = 'idle' | 'thinking' | 'searching' | 'editing' | 'planning' | 'waiting' | 'question' | 'approval' | 'done' | 'error';
export const WISP_WIDTH = 18;
export const WISP_ROWS = 6;
type Frame = readonly string[];

function sprite(state: WispState, phase: number): Frame {
  const pixels = Array.from({length:12},()=>Array<boolean>(WISP_WIDTH).fill(false));
  const dot = (x:number,y:number,on=true) => {if(x>=0&&x<WISP_WIDTH&&y>=0&&y<12)pixels[y][x]=on;};
  const stamp = (x:number,y:number,rows:string[]) => rows.forEach((row,dy)=>Array.from(row).forEach((c,dx)=>{if(c==='#')dot(x+dx,y+dy);}));
  // A bent, connected flame tip above a rounded body, rather than a diamond.
  stamp(4,0,[phase%2?'  ##    ':' ##     ','   ##   ','    ##  ','   ###  ','  ##### ',' #######','########','########','########','########',' ###### ','  ####  ']);
  const happy=state==='done'||state==='editing';
  if(happy){for(const x of [6,9]){dot(x,7,false);dot(x-1,8,false);dot(x+1,8,false);}}
  else if(state==='error'){for(const x of [6,9])for(const [dx,dy] of [[-1,0],[1,0],[0,1],[-1,2],[1,2]])dot(x+dx,7+dy,false);}
  else if(state==='thinking'){for(const x of [6,9]){dot(x-1,7,false);dot(x,7,false);dot(x+1,7,false);dot(x,8,false);}}
  else for(const x of [6,9]){dot(x,7,false);dot(x,8,false);}
  const plus=(x:number,y:number)=>stamp(x,y,[' # ','###',' # ']);
  if(state==='idle'||state==='done'){plus(phase%2?1:13,phase%2?4:5);if(state==='done')plus(1,3);}
  if(state==='searching')stamp(12,2,[' ### ','#   #','#   #',' ### ','    #','     #']);
  if(state==='planning')stamp(13,1,['# ###','     ','# ###','     ','# ###']);
  if(state==='waiting'){stamp(0,6,[' # ',' ##','###','# #','###']);stamp(14,6,[' # ',' ##','###','# #','###']);dot(1,phase%2?3:4);dot(15,phase%2?4:3);}
  if(state==='question'||state==='approval'||state==='error'){
    stamp(12,0,[' #### ','#    #','#    #','#    #',' #### ',' #    ']);
    // Small pixel marks fit inside the speech balloon, with a visible tail.
    if(state==='question')stamp(14,1,['##',' #','# ','# ']);
    else if(state==='approval')stamp(13,2,['   #','# # ',' #  ']);
    else stamp(14,1,['#','#',' ','#']);
  }
  const lines=Array.from({length:WISP_ROWS},(_,row)=>pixels[row*2].map((top,x)=>top?(pixels[row*2+1][x]?'█':'▀'):(pixels[row*2+1][x]?'▄':' ')).join(''));
  // Text annotations use terminal glyphs only where the storyboard is textual.
  if(state==='thinking')lines[1]=lines[1].slice(0,13)+['·    ','··   ','···  '][phase%3];
  if(state==='editing')lines[1]=lines[1].slice(0,13)+'</>  ';
  return lines;
}
const frames = (state:WispState): readonly Frame[] => Array.from({length:state==='thinking'?3:2},(_,i)=>sprite(state,i));
export const animations: Record<WispState, readonly Frame[]> = {
  idle:frames('idle'), thinking:frames('thinking'), searching:frames('searching'),
  editing:frames('editing'), planning:frames('planning'), waiting:frames('waiting'),
  question:frames('question'), approval:frames('approval'), done:frames('done'), error:frames('error'),
};
