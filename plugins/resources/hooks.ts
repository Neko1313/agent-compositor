import {randomUUID} from 'node:crypto';
import {Sampler,chart,chartRaster,type Sample} from './metrics.js';
import {ChildrenCpu,snapshotChildren,type ChildrenSnapshot} from './children.js';

export class Monitor {
  samples:Sample[]=[];
  private open=false;
  private visible=true;
  private paused=false;
  private columns=60;
  private metric:'cpu'|'memory'|'children'='cpu';
  private graphics=false;
  private error?:string;
  private revision=0;
  private timer?:ReturnType<typeof setTimeout>;
  private children?:ChildrenSnapshot | null;
  private childrenError=false;
  private childrenPending=false;
  private sharing=false;
  private shareStatus?:string;
  private childrenRevision=0;
  private childrenController?:AbortController;
  private readonly childrenCpu=new ChildrenCpu();
  private childrenHistory:{cpu?:number;partial:boolean}[]=[];
  private currentChildCpu?:{cpu?:number;partial:boolean};
  private currentProcessCpu?:number;
  constructor(private readonly $:any,private readonly sampler=new Sampler(),private readonly readChildren=snapshotChildren){}
  private stop(){clearTimeout(this.timer);this.timer=undefined;this.revision++;}
  private cancelChildren(){this.childrenRevision++;this.childrenController?.abort();this.childrenController=undefined;this.childrenPending=false;this.childrenCpu.reset();this.currentChildCpu=undefined;}
  private resetSampler(){this.sampler.reset();this.currentProcessCpu=undefined;}
  dispose(){this.open=false;this.cancelChildren();this.stop();this.resetSampler();}
  private take(){
    try{const sample=this.sampler.sample();this.currentProcessCpu=sample.cpu;this.samples.push(sample);this.samples=this.samples.slice(-120);this.error=undefined;}
    catch(error){this.error=String(error).slice(0,500);this.resetSampler();}
  }
  private schedule(){
    this.stop();
    if(!this.open||!this.visible||this.paused||this.error)return;
    const revision=this.revision;
    this.timer=setTimeout(async()=>{
      this.timer=undefined;
      if(revision!==this.revision||!this.open||!this.visible)return;
      this.take();
      try{
        if(this.metric==='children'&&this.children!==null)await this.sampleChildren(true);
        await this.paint();if(revision===this.revision)this.schedule();
      }catch{this.stop();}
    },1000);
    this.timer.unref?.();
  }
  private async paint(focus=false){
    if(!this.open||!this.visible)return;
    const latest=this.samples.at(-1),mib=(bytes:number)=>(bytes/1048576).toFixed(1),tabs=this.$.ui.supports?.('tabs')===true;
    const values=this.metric==='children'?this.childrenHistory.map(sample=>sample.partial?undefined:sample.cpu):this.samples.map(sample=>this.metric==='cpu'?sample.cpu:sample.rss/1048576);
    const unit=this.metric==='memory'?'MiB':'%',floor=this.metric==='memory'?0:100;
    await this.$.ui.view('resources','Resources',{
      ...(this.graphics?{raster:{...chartRaster(values,this.columns,floor),alt:'Graphic unavailable; the text chart below shows the same samples.'}}:{}),
      ...(tabs?{tabs:[{id:'cpu',label:'CPU',action:'cpu',selected:this.metric==='cpu'},{id:'memory',label:'Memory',action:'memory',selected:this.metric==='memory'},{id:'children',label:'Child CPU',action:'child-cpu',selected:this.metric==='children'}]}:{}),
      scrollKeys:'host',hint:this.graphics?'Process metrics only · PgUp shows graph · Pause freezes samples':'Process metrics only · PgUp/PgDn scroll · Pause freezes samples',
      lines:[
        {text:`Compositor process · PID ${process.pid}`,bold:true},
        {text:'Main metrics include in-process agents; exclude child processes.',tone:'muted'},
        {text:`${this.paused?'Paused':'Live'} · Samples ${this.samples.length}/120 · 1 s target interval`,bold:true},
        {text:`CPU: ${this.currentProcessCpu===undefined?'waiting for interval':this.currentProcessCpu.toFixed(1)+'%'} · 100% = one core`},
        {text:latest?`RSS: ${mib(latest.rss)} MiB · JS heap used: ${mib(latest.heapUsed)} MiB`:'No measurements yet.'},
        ...(this.childrenPending?[{text:'Reading child processes…',tone:'muted' as const}]:this.childrenError?[{text:'Child snapshot failed. Try again.',tone:'danger' as const}]:this.children===null?[{text:'Child snapshots are available on Linux only.',tone:'muted' as const}]:this.children?[{text:`Last child snapshot: ${this.children.count} processes · ${mib(this.children.rss)} MiB RSS${this.children.partial?' · incomplete':''}`,tone:'muted' as const}]:[]),
        ...(this.error?[{text:'Sampling failed: '+this.error,tone:'danger' as const},{text:'Use Sample now to retry.',tone:'muted' as const}]:[]),
        ...(!tabs?[{text:`[ Chart: ${this.metric==='cpu'?'CPU':this.metric==='memory'?'Memory':'Child CPU'} · switch ]`,action:'switch'}]:[]),
        ...(this.metric==='children'?[{text:`Child CPU: ${this.currentChildCpu?.cpu===undefined?'waiting for interval':this.currentChildCpu.cpu.toFixed(1)+'%'}${this.currentChildCpu?.partial?' · incomplete':''}`,tone:'muted' as const}]:[]),
        {text:this.graphics?'[ Graphics: on · switch ]':'[ Graphics: off · switch ]',action:this.graphics?'graphics-off':'graphics-on'},
        {text:this.metric==='cpu'?'CPU history (%)':this.metric==='memory'?'Resident memory history (MiB)':'Child CPU history (%) · approximate',bold:true},
        ...chart(values,this.columns,unit,floor).map(text=>({text})),
        ...(this.shareStatus?[{text:this.shareStatus,tone:'muted' as const}]:[]),
        {text:'[ Send latest sample to agent ]',action:'share'},
        {text:this.paused?'[ Resume ]':'[ Pause ]',action:'pause',tone:'accent' as const},
        {text:'[ Sample now ]',action:'sample'},this.childrenPending?{text:'[ Reading children… ]',tone:'muted' as const}:{text:'[ Snapshot children ]',action:'children'},{text:'[ Clear history ]',action:'clear'},{text:'[ Close ]',action:'close'},
      ],
    },{site:'inspector',focus});
  }
  private async sampleChildren(trackCpu:boolean){
    if(this.childrenPending)return;
    const revision=++this.childrenRevision,controller=new AbortController();this.childrenController=controller;this.childrenPending=true;this.childrenError=false;
    try {
      const value=await this.readChildren(controller.signal);
      if(revision===this.childrenRevision){
        this.children=value??null;
        if(trackCpu){this.currentChildCpu=value?this.childrenCpu.sample(value):undefined;if(this.currentChildCpu){this.childrenHistory.push(this.currentChildCpu);this.childrenHistory=this.childrenHistory.slice(-120);}}
      }
    }catch{if(revision===this.childrenRevision){this.childrenError=true;this.childrenCpu.reset();this.currentChildCpu=undefined;}}
    if(revision===this.childrenRevision){this.childrenController=undefined;this.childrenPending=false;}
  }
  async show(){this.stop();this.cancelChildren();this.open=true;this.visible=true;this.resetSampler();this.take();await this.paint(true);this.schedule();}
  private async share($:any){
    if(this.sharing)return;
    const latest=this.samples.at(-1),child=this.currentChildCpu;
    let observation:string;
    if(this.metric==='children'){
      if(!child||child.cpu===undefined||child.partial){this.shareStatus='No complete child CPU interval to send.';await this.paint();return;}
      observation=`Child CPU: ${child.cpu.toFixed(1)}% (100% is one core). Approximate live descendant estimate; short-lived processes can be missed.`;
    }else if(this.metric==='cpu'){
      if(this.currentProcessCpu===undefined){this.shareStatus='No process CPU interval to send yet.';await this.paint();return;}
      observation=`Compositor process CPU: ${this.currentProcessCpu.toFixed(1)}% (100% is one core). Includes in-process agents and excludes child processes.`;
    }else{
      if(!latest){this.shareStatus='No memory sample to send yet.';await this.paint();return;}
      observation=`Compositor process RSS: ${(latest.rss/1048576).toFixed(1)} MiB; JavaScript heap used: ${(latest.heapUsed/1048576).toFixed(1)} MiB. Includes in-process agents and excludes child processes.`;
    }
    this.sharing=true;
    try{
      const result=await $.emit('service.agent.enqueue',{plugin:'resources',key:`observation:${randomUUID()}`,text:`The user explicitly sent this resource observation for analysis: ${observation} This is a point-in-time measurement, not per-agent attribution or machine-wide usage. ${this.paused?'Sampling is paused, so this observation may be stale.':'This is the latest available sample; sampling can be delayed or stopped by errors.'} Investigate further only as appropriate for the user's task.`});
      if(result?.deny)throw Error(result.deny);
      if(result?.value?.queued!==true)throw Error('Follow-up was not queued');
      this.shareStatus='Resource observation queued for the agent.';
    }catch(error){this.shareStatus=`Could not queue resource observation: ${String(error).slice(0,300)}`;}
    finally{this.sharing=false;}
    await this.paint();
  }
  async press(key:string,$=this.$){
    if(!this.open)return;
    if(key==='close'){this.dispose();await this.$.ui.remove('resources');return;}
    if(key==='share'){await this.share($);return;}
    if(key==='children'){
      if(this.childrenPending)return;
      const revision=this.childrenRevision;const pending=this.sampleChildren(false);await this.paint();await pending;
      if(revision+1===this.childrenRevision)await this.paint();
      return;
    }
    if(!['cpu','memory','child-cpu','switch','pause','sample','clear','graphics-on','graphics-off'].includes(key))return;
    this.stop();
    if(['cpu','memory','child-cpu','switch','pause','clear'].includes(key))this.cancelChildren();
    if(key==='cpu'||key==='memory')this.metric=key;
    if(key==='child-cpu')this.metric='children';
    if(key==='switch')this.metric=this.metric==='cpu'?'memory':this.metric==='memory'?'children':'cpu';
    if(key==='graphics-on')this.graphics=true;
    if(key==='graphics-off')this.graphics=false;
    if(key==='pause'){this.paused=!this.paused;this.resetSampler();}
    if(key==='sample'){this.take();if(this.metric==='children')await this.sampleChildren(true);}
    if(key==='clear'){this.samples=[];this.childrenHistory=[];this.resetSampler();this.take();}
    await this.paint();this.schedule();
  }
  async visibility(event:{visible:boolean;attached:boolean;columns:number}){
    if(!this.open)return;
    if(!event.attached){this.dispose();return;}
    const width=Math.max(14,event.columns);
    if(this.visible===event.visible&&this.columns===width)return;
    const wasVisible=this.visible;this.visible=event.visible;this.columns=width;this.stop();
    if(!this.visible){this.cancelChildren();this.resetSampler();return;}
    if(!wasVisible){this.resetSampler();if(!this.paused)this.take();}
    await this.paint();this.schedule();
  }
}
const instances=new Map<string,Monitor>();
function monitor($:any){let value=instances.get($.session.id);if(!value){value=new Monitor($.background());instances.set($.session.id,value);}return value;}
function initialize(_:unknown,$:any){instances.get($.session.id)?.dispose();instances.delete($.session.id);}
export function dispose(){for(const value of instances.values())value.dispose();instances.clear();}
export default {
  'session.start':initialize,'session.reload':initialize,'session.end':initialize,
  'prompt.submit':async(event:{text:string},$:any)=>{
    if(event.text.trim()!=='/resources')return;
    await monitor($).show();return {drop:'resources: opened'};
  },
  'ui.press':async(event:{site:string;key:string},$:any)=>{
    if(event.site!=='plugin-resources-resources')return;
    if(event.key==='command:/resources')await monitor($).show();else await instances.get($.session.id)?.press(event.key,$);
  },
  'ui.visibility':async(event:any,$:any)=>{
    if(event.site==='plugin:resources/resources')await instances.get($.session.id)?.visibility(event);
  },
};
