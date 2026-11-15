import {deflateSync} from 'node:zlib';

// Kitty's rowcolumn-diacritics table, indices 0–19. The composer caps its
// image rectangle at 20 columns by 8 rows.
const marks=[0x0305,0x030d,0x030e,0x0310,0x0312,0x033d,0x033e,0x033f,0x0346,0x034a,
  0x034b,0x034c,0x0350,0x0351,0x0352,0x0357,0x035b,0x0363,0x0364,0x0365];
const placeholder='\u{10eeee}';
const maximumPixels=1024*1024;
const imageId=(id:number)=>Number.isInteger(id)&&id>0&&id<=0xffffff;
const rectangle=(columns:number,rows:number)=>Number.isInteger(columns)&&columns>=1&&columns<=20&&Number.isInteger(rows)&&rows>=1&&rows<=8;
type ImageFrame={width:number;height:number;rgba:Uint8Array};
function validFrame(frame:ImageFrame):boolean {
  return Number.isSafeInteger(frame.width)&&Number.isSafeInteger(frame.height)&&frame.width>=1&&frame.height>=1&&
    frame.width*frame.height<=maximumPixels&&frame.rgba.byteLength===frame.width*frame.height*4;
}

/** tmux consumes one escape layer; never send raw graphics control bytes. */
export function tmuxWrap(sequence:string):Buffer {
  return Buffer.from('\x1bPtmux;'+sequence.replaceAll('\x1b','\x1b\x1b')+'\x1b\\');
}

/** Probe a unique image id and require an affirmative Unicode-placement reply. */
export function tmuxFeatureQuery(id:number):Buffer {
  if(!imageId(id))throw RangeError('Invalid Kitty image id');
  return tmuxWrap(`\x1b_Ga=q,i=${id},e=T,U=1,C=1\x1b\\`);
}
export function tmuxFeatureReply(sequence:string,id:number):boolean {
  if(!imageId(id)||!sequence.startsWith('\x1b_G')||!sequence.endsWith('\x1b\\'))return false;
  const content=sequence.slice(3,-2),separator=content.indexOf(';');
  if(separator<0||content.slice(separator+1)!=='OK')return false;
  const values=new Map<string,string>();
  for(const field of content.slice(0,separator).split(',')){
    const match=/^([a-zA-Z])=([a-zA-Z0-9]+)$/.exec(field);
    if(!match||values.has(match[1]))return false;
    values.set(match[1],match[2]);
  }
  return values.get('i')===String(id)&&values.get('e')==='T'&&values.get('U')==='1';
}

/** Explicit row/column marks keep clipping and horizontal movement independent. */
export function tmuxPlaceholderRows(columns:number,rows:number):string[] {
  if(!rectangle(columns,rows))throw RangeError('Invalid Kitty placement rectangle');
  return Array.from({length:rows},(_,row)=>Array.from({length:columns},(_,column)=>
    placeholder+String.fromCodePoint(marks[row],marks[column])).join(''));
}

/** Kitty interprets the placeholder foreground RGB as its 24-bit image id. */
export function tmuxImageColor(id:number):string {
  if(!imageId(id))throw RangeError('Invalid Kitty image id');
  return '#'+id.toString(16).padStart(6,'0');
}

/** Every chunk is independently wrapped and bounded for tmux's input parser. */
export function tmuxVirtualImage(frame:ImageFrame,id:number,columns:number,rows:number):Buffer[] {
  if(!imageId(id)||!rectangle(columns,rows))throw RangeError('Invalid Kitty placement');
  if(!validFrame(frame))throw RangeError('Invalid RGBA frame');
  const data=deflateSync(frame.rgba).toString('base64'),chunks:Buffer[]=[];
  for(let offset=0;offset<data.length;offset+=4096){
    const more=offset+4096<data.length?1:0;
    const header=offset===0?`a=T,U=1,i=${id},q=2,f=32,s=${frame.width},v=${frame.height},c=${columns},r=${rows},o=z,m=${more}`:`m=${more}`;
    chunks.push(tmuxWrap(`\x1b_G${header};${data.slice(offset,offset+4096)}\x1b\\`));
  }
  return chunks;
}

/** Submit this batch atomically to NativeSession so other output cannot split an upload. */
export function tmuxVirtualImageBatch(frame:ImageFrame,id:number,columns:number,rows:number):Buffer {
  return Buffer.concat(tmuxVirtualImage(frame,id,columns,rows));
}

export interface TmuxOutputSink {
  readonly maxAtomicWriteBytes:bigint;
  write(bytes:Uint8Array):boolean;
  idle():Promise<void>;
}

/** Admission is all-or-nothing; wait for queue pressure without splitting an upload. */
export async function tmuxWriteAtomic(sink:TmuxOutputSink,bytes:Uint8Array,signal?:AbortSignal):Promise<void> {
  if(BigInt(bytes.byteLength)>sink.maxAtomicWriteBytes)throw RangeError('Kitty batch exceeds atomic output capacity');
  const owned=Uint8Array.from(bytes);
  for(let attempt=0;attempt<3;attempt++){
    signal?.throwIfAborted();
    if(sink.write(owned))return;
    if(!signal){await sink.idle();continue;}
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{cleanup();reject(signal.reason);};
      const cleanup=()=>signal.removeEventListener('abort',abort);
      signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted){abort();return;}
      let idle:Promise<void>;
      try{idle=sink.idle();}catch(error){cleanup();reject(error);return;}
      idle.then(()=>{cleanup();resolve();},error=>{cleanup();reject(error);});
    });
  }
  throw Error('Kitty output remained unavailable after draining');
}

/** One bounded capability query; unconfirmed and late responses never enable images. */
export class TmuxFeatureProbe {
  private readonly controller=new AbortController();
  private result?:Promise<boolean>;
  private finish?: (supported:boolean)=>void;
  private closed=false;
  constructor(private readonly sink:TmuxOutputSink,private readonly id:number,private readonly timeoutMs=1500){
    if(!imageId(id)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw RangeError('Invalid tmux feature probe');
  }
  start():Promise<boolean>{
    if(this.closed)return Promise.resolve(false);
    if(this.result)return this.result;
    this.result=new Promise<boolean>(resolve=>{
      const timer=setTimeout(()=>finish(false),this.timeoutMs);timer.unref?.();
      const finish=(supported:boolean)=>{
        if(this.finish!==finish)return;
        this.finish=undefined;clearTimeout(timer);this.controller.abort();resolve(supported);
      };
      this.finish=finish;
      void tmuxWriteAtomic(this.sink,tmuxFeatureQuery(this.id),this.controller.signal).catch(()=>finish(false));
    });
    return this.result;
  }
  /** Consume only this probe's response; duplicate or late replies cannot change the result. */
  accept(sequence:string):boolean {
    if(this.closed||!this.result||!sequence.startsWith('\x1b_G')||!sequence.endsWith('\x1b\\'))return false;
    const header=sequence.slice(3,-2).split(';',1)[0];
    const ids=header.split(',').filter(field=>field.startsWith('i='));
    if(ids.length!==1||ids[0]!==`i=${this.id}`)return false;
    this.finish?.(tmuxFeatureReply(sequence,this.id));return true;
  }
  dispose(){this.closed=true;this.finish?.(false);this.controller.abort();}
}

/** Single in-flight upload and one newest pending frame; the caller owns disposal. */
export class TmuxFramePlayer {
  private readonly controller=new AbortController();
  private pending?:ImageFrame;
  private running?:Promise<void>;
  private closing?:Promise<void>;
  private closed=false;
  private owned=false;
  constructor(private readonly sink:TmuxOutputSink,private readonly id:number,private readonly columns:number,private readonly rows:number,
    private readonly onFrame:()=>void,private readonly onError:(error:unknown)=>void){
    if(!imageId(id)||!rectangle(columns,rows))throw RangeError('Invalid Kitty placement');
  }
  present(frame:ImageFrame):void {
    if(this.closed)throw Error('Kitty frame player is closed');
    if(!validFrame(frame))throw RangeError('Invalid RGBA frame');
    this.pending={width:frame.width,height:frame.height,rgba:Uint8Array.from(frame.rgba)};
    this.schedule();
  }
  private schedule():void {
    if(this.running||this.closed||!this.pending)return;
    // Publish the owned task before calling the sink, which may re-enter the
    // player or synchronously trigger disposal.
    const task=Promise.resolve().then(()=>this.pump());this.running=task;
    void task.then(()=>{if(this.running===task)this.running=undefined;this.schedule();},error=>{
      if(this.running===task)this.running=undefined;
      if(!this.closed){this.pending=undefined;this.onError(error);}
    });
  }
  private async pump():Promise<void>{
    while(!this.closed&&this.pending){
      const frame=this.pending;this.pending=undefined;
      const batch=tmuxVirtualImageBatch(frame,this.id,this.columns,this.rows);
      await tmuxWriteAtomic(this.sink,batch,this.controller.signal);
      this.owned=true;
      if(!this.closed)this.onFrame();
    }
  }
  async idle():Promise<void>{while(this.running)await this.running;}
  dispose():Promise<void>{
    if(this.closing)return this.closing;
    this.closed=true;this.pending=undefined;this.controller.abort();
    const closing=(async()=>{
      try{await this.running;}catch{}
      if(this.owned){await tmuxWriteAtomic(this.sink,tmuxDeleteImage(this.id));this.owned=false;}
    })();
    this.closing=closing;
    void closing.catch(()=>{if(this.closing===closing)this.closing=undefined;});
    return closing;
  }
}

/** Remove only this image and its virtual placements, never another client's. */
export function tmuxDeleteImage(id:number):Buffer {
  if(!imageId(id))throw RangeError('Invalid Kitty image id');
  return tmuxWrap(`\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`);
}
