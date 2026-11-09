import type { Frame } from './animations.js';

/** Source-time playback: rendering latency never accumulates into the period. */
export class Timeline {
  private key?: object;
  private elapsed = 0;
  private epoch = 0;
  private running = false;
  select(key:object,now=performance.now()):void {
    if(this.key===key)return;
    this.key=key;this.elapsed=0;this.epoch=now;
  }
  play(running:boolean,now=performance.now()):void {
    if(this.running===running)return;
    if(this.running)this.elapsed+=now-this.epoch;
    this.epoch=now;this.running=running;
  }
  sample(frames:Frame[],plays=0,now=performance.now()):{index:number;wait:number;done:boolean} {
    if(frames.length<=1)return{index:0,wait:0,done:true};
    const duration=frames.reduce((sum,f)=>sum+f.delay,0);
    const elapsed=Math.max(0,this.elapsed+(this.running?now-this.epoch:0));
    if(plays>0&&elapsed>=duration*plays)return{index:frames.length-1,wait:0,done:true};
    let phase=elapsed%duration;
    for(let index=0;index<frames.length;index++){
      if(phase<frames[index].delay)return{index,wait:frames[index].delay-phase,done:false};
      phase-=frames[index].delay;
    }
    return{index:0,wait:frames[0].delay,done:false};
  }
}
