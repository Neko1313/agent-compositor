import type { Raster } from './graphics.js';
export interface CellPixels {width:number;height:number}
/** Bounded adaptive palette. Transparent pixels composite onto the queried terminal background. */
export function sixel(image:Raster,columns:number,rows:number,cell:CellPixels,background:[number,number,number]):string {
  const width=Math.min(512,Math.max(1,Math.round(columns*cell.width)));
  const height=Math.min(512,Math.max(1,Math.round(rows*cell.height)));
  const rgba=Buffer.from(image.rgba,'base64');
  if(rgba.length!==image.width*image.height*4)throw Error('Invalid SIXEL pixels');
  const scale=Math.min(width/image.width,height/image.height),drawWidth=Math.max(1,Math.round(image.width*scale)),drawHeight=Math.max(1,Math.round(image.height*scale));
  const left=Math.floor((width-drawWidth)/2),top=Math.floor((height-drawHeight)/2);
  const colours=new Uint32Array(width*height),frequencies=new Map<number,number>();
  const bg=(background[0]<<16)|(background[1]<<8)|background[2];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(x<left||y<top||x>=left+drawWidth||y>=top+drawHeight){colours[y*width+x]=bg;frequencies.set(bg,(frequencies.get(bg)??0)+1);continue;}
    const offset=(Math.min(image.height-1,Math.floor((y-top)*image.height/drawHeight))*image.width+Math.min(image.width-1,Math.floor((x-left)*image.width/drawWidth)))*4;
    const alpha=rgba[offset+3]/255;
    const r=Math.round(rgba[offset]*alpha+background[0]*(1-alpha)),g=Math.round(rgba[offset+1]*alpha+background[1]*(1-alpha)),b=Math.round(rgba[offset+2]*alpha+background[2]*(1-alpha));
    const rgb=(r<<16)|(g<<8)|b;colours[y*width+x]=rgb;frequencies.set(rgb,(frequencies.get(rgb)??0)+1);
  }
  const backgroundUsed=frequencies.has(bg),limit=256-(backgroundUsed?1:0);
  const entries=[...frequencies].filter(([rgb])=>!backgroundUsed||rgb!==bg);
  let coloursForPalette:number[];
  if(entries.length<=limit)coloursForPalette=entries.map(([rgb])=>rgb);
  else{
    // Weighted median cut covers the entire colour range, unlike choosing the
    // most frequent colours (which destroys gradients when frequencies tie).
    type Point={rgb:number;weight:number};
    const bucket=new Map<number,{r:number;g:number;b:number;weight:number}>();
    for(const [rgb,weight]of entries){const r=rgb>>16,g=(rgb>>8)&255,b=rgb&255,key=((r>>3)<<10)|((g>>3)<<5)|(b>>3),value=bucket.get(key)??{r:0,g:0,b:0,weight:0};value.r+=r*weight;value.g+=g*weight;value.b+=b*weight;value.weight+=weight;bucket.set(key,value);}
    const points:Point[]=[...bucket.values()].map(p=>({rgb:(Math.round(p.r/p.weight)<<16)|(Math.round(p.g/p.weight)<<8)|Math.round(p.b/p.weight),weight:p.weight}));
    const makeBox=(points:Point[])=>{
      const min=[255,255,255],max=[0,0,0];let weight=0;
      for(const p of points){weight+=p.weight;const channels=[p.rgb>>16,(p.rgb>>8)&255,p.rgb&255];for(let c=0;c<3;c++){min[c]=Math.min(min[c],channels[c]);max[c]=Math.max(max[c],channels[c]);}}
      const ranges=max.map((v,i)=>v-min[i]),axis=ranges.indexOf(Math.max(...ranges));
      return{points,weight,axis,score:points.length>1?ranges[axis]*weight:0};
    };
    const boxes=[makeBox(points)];
    while(boxes.length<limit){
      let chosen=0;for(let i=1;i<boxes.length;i++)if(boxes[i].score>boxes[chosen].score)chosen=i;
      const box=boxes[chosen];if(!box.score)break;
      const shift=(2-box.axis)*8;box.points.sort((a,b)=>((a.rgb>>shift)&255)-((b.rgb>>shift)&255));
      let cumulative=0,cut=1;for(let i=0;i<box.points.length-1;i++){cumulative+=box.points[i].weight;cut=i+1;if(cumulative>=box.weight/2)break;}
      boxes.splice(chosen,1,makeBox(box.points.slice(0,cut)),makeBox(box.points.slice(cut)));
    }
    coloursForPalette=boxes.map(box=>{let r=0,g=0,b=0;for(const p of box.points){r+=(p.rgb>>16)*p.weight;g+=((p.rgb>>8)&255)*p.weight;b+=(p.rgb&255)*p.weight;}return(Math.round(r/box.weight)<<16)|(Math.round(g/box.weight)<<8)|Math.round(b/box.weight);});
  }
  const palette=[...(backgroundUsed?[bg]:[]),...coloursForPalette];
  const lookup=new Map(palette.map((rgb,i)=>[rgb,i])),buckets=new Map<number,number>();
  const nearest=(rgb:number)=>{
    const cached=lookup.get(rgb);if(cached!==undefined)return cached;
    const r=rgb>>16,g=(rgb>>8)&255,b=rgb&255,key=((r>>3)<<10)|((g>>3)<<5)|(b>>3),bucket=buckets.get(key);
    if(bucket!==undefined){lookup.set(rgb,bucket);return bucket;}
    let best=0,distance=Infinity;
    for(let i=0;i<palette.length;i++){const colour=palette[i],dr=r-(colour>>16),dg=g-((colour>>8)&255),db=b-(colour&255),d=dr*dr+dg*dg+db*db;if(d<distance){distance=d;best=i;}}
    lookup.set(rgb,best);buckets.set(key,best);return best;
  };
  const indices=Uint8Array.from(colours,nearest),used=new Set(indices);
  let output=`\x1bP0;1q"1;1;${width};${height}`;
  for(const index of used){const rgb=palette[index];output+=`#${index};2;${Math.round((rgb>>16)*100/255)};${Math.round(((rgb>>8)&255)*100/255)};${Math.round((rgb&255)*100/255)}`;}
  for(let y=0;y<height;y+=6){
    for(const index of used){
      const codes:number[]=[];
      for(let x=0;x<width;x++){let mask=0;for(let bit=0;bit<6&&y+bit<height;bit++)if(indices[(y+bit)*width+x]===index)mask|=1<<bit;codes.push(mask+63);}
      while(codes.length&&codes.at(-1)===63)codes.pop();if(!codes.length)continue;
      output+=`#${index}`;
      for(let x=0;x<codes.length;){let end=x+1;while(end<codes.length&&codes[end]===codes[x])end++;const count=end-x;output+=count>=4?`!${count}${String.fromCharCode(codes[x])}`:String.fromCharCode(codes[x]).repeat(count);x=end;}
      output+='$';
    }
    if(y+6<height)output+='-';
  }
  return output+'\x1b\\';
}
