export type Sample = {cpu?:number; rss:number; heapUsed:number; heapTotal:number};
export type Source = {
  now:()=>bigint;
  cpu:()=>{user:number;system:number};
  memory:()=>{rss:number;heapUsed:number;heapTotal:number};
};
const defaultSource:Source={now:()=>process.hrtime.bigint(),cpu:()=>process.cpuUsage(),memory:()=>process.memoryUsage()};

/** CPU is elapsed process time divided by wall time; 100% means one busy core. */
export class Sampler {
  private previous?:{time:bigint;cpu:number};
  constructor(private readonly source:Source=defaultSource){}
  reset(){this.previous=undefined;}
  sample():Sample {
    const time=this.source.now(),usage=this.source.cpu(),memory=this.source.memory();
    const total=usage.user+usage.system;
    if(![usage.user,usage.system,memory.rss,memory.heapUsed,memory.heapTotal].every(value=>Number.isFinite(value)&&value>=0))throw Error('Invalid process counters');
    const previous=this.previous;
    if(previous&&(time<=previous.time||total<previous.cpu))throw Error('Process counters moved backwards');
    this.previous={time,cpu:total};
    const cpu=previous?(total-previous.cpu)/(Number(time-previous.time)/1000)*100:undefined;
    return {...memory,cpu};
  }
}

/** A real bounded sample plot, with explicit units and scale, using portable cells. */
export function chart(values:(number|undefined)[],columns:number,unit:string,floor=0):string[]{
  const width=Math.max(4,Math.min(60,Math.floor(columns)-10)),height=6;
  const recent=values.slice(-width),top=Math.max(floor,...recent.map(value=>value??0),1);
  const cells=Array.from({length:height},()=>Array<string>(width).fill(' '));
  recent.forEach((value,index)=>{if(value!==undefined)cells[height-1-Math.min(height-1,Math.round(value/top*(height-1)))][width-recent.length+index]='*';});
  const scale=(value:number)=>(value>=1000?value.toFixed(0):value.toFixed(1)).padStart(7);
  return cells.map((row,index)=>`${scale(top*(height-1-index)/(height-1))} |${row.join('')}`).concat(`        +${'-'.repeat(width)}`,`          Older -> newer (${unit})`);
}

/** Optional RGBA plot: missing samples remain gaps, and CPU may exceed one core. */
export function chartRaster(values:(number|undefined)[],columns:number,floor=0):{width:number;height:number;rgba:string}{
  const width=120,height=48,slots=Math.max(4,Math.min(60,Math.floor(columns)-10));
  const recent=values.slice(-slots),top=Math.max(floor,...recent.map(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0),1);
  const pixels=new Uint8Array(width*height*4);
  const pixel=(x:number,y:number,color:readonly number[])=>{const offset=(y*width+x)*4;pixels.set(color,offset);};
  const grid=[90,110,125,100],point=[64,210,190,255];
  for(let row=0;row<5;row++){const y=Math.round(row*(height-1)/4);for(let x=0;x<width;x++)pixel(x,y,grid);}
  let previous:{x:number;y:number}|undefined;
  recent.forEach((value,index)=>{
    if(value===undefined||!Number.isFinite(value)||value<0){previous=undefined;return;}
    const x=Math.round((slots-recent.length+index)*(width-1)/(slots-1)),y=height-1-Math.min(height-1,Math.round(value/top*(height-1)));
    if(previous){const steps=Math.max(Math.abs(x-previous.x),Math.abs(y-previous.y));for(let i=0;i<=steps;i++)pixel(Math.round(previous.x+(x-previous.x)*i/steps),Math.round(previous.y+(y-previous.y)*i/steps),point);}
    pixel(x,y,point);previous={x,y};
  });
  return{width,height,rgba:Buffer.from(pixels).toString('base64')};
}
