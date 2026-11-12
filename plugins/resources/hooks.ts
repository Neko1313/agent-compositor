import {Sampler,chart,type Sample} from './metrics.js';

export class Monitor {
  samples:Sample[]=[];
  private open=false;
  private visible=true;
  private paused=false;
  private columns=60;
  private metric:'cpu'|'memory'='cpu';
  private error?:string;
  private revision=0;
  private timer?:ReturnType<typeof setTimeout>;
  constructor(private readonly $:any,private readonly sampler=new Sampler()){}
  private stop(){clearTimeout(this.timer);this.timer=undefined;this.revision++;}
  dispose(){this.open=false;this.stop();this.sampler.reset();}
  private take(){
    try{this.samples.push(this.sampler.sample());this.samples=this.samples.slice(-120);this.error=undefined;}
    catch(error){this.error=String(error).slice(0,500);this.sampler.reset();}
  }
  private schedule(){
    this.stop();
    if(!this.open||!this.visible||this.paused||this.error)return;
    const revision=this.revision;
    this.timer=setTimeout(()=>{
      this.timer=undefined;
      if(revision!==this.revision||!this.open||!this.visible)return;
      this.take();
      void this.paint().then(()=>{if(revision===this.revision)this.schedule();}).catch(()=>this.stop());
    },1000);
    this.timer.unref?.();
  }
  private async paint(focus=false){
    if(!this.open||!this.visible)return;
    const latest=this.samples.at(-1),mib=(bytes:number)=>(bytes/1048576).toFixed(1),tabs=this.$.ui.supports?.('tabs')===true;
    await this.$.ui.view('resources','Resources',{
      ...(tabs?{tabs:[{id:'cpu',label:'CPU',action:'cpu',selected:this.metric==='cpu'},{id:'memory',label:'Memory',action:'memory',selected:this.metric==='memory'}]}:{}),
      scrollKeys:'host',hint:'Process metrics only · PgUp/PgDn scroll · Pause freezes samples',
      lines:[
        {text:`Compositor process · PID ${process.pid}`,bold:true},
        {text:'Includes in-process agents; excludes child shell processes.',tone:'muted'},
        {text:`${this.paused?'Paused':'Live'} · Samples ${this.samples.length}/120 · 1 s target interval`,bold:true},
        {text:`CPU: ${latest?.cpu===undefined?'waiting for interval':latest.cpu.toFixed(1)+'%'} · 100% = one core`},
        {text:latest?`RSS: ${mib(latest.rss)} MiB · JS heap used: ${mib(latest.heapUsed)} MiB`:'No measurements yet.'},
        ...(this.error?[{text:'Sampling failed: '+this.error,tone:'danger' as const},{text:'Use Sample now to retry.',tone:'muted' as const}]:[]),
        ...(!tabs?[{text:`[ Chart: ${this.metric==='cpu'?'CPU':'Memory'} · switch ]`,action:'switch'}]:[]),
        {text:this.metric==='cpu'?'CPU history (%)':'Resident memory history (MiB)',bold:true},
        ...chart(this.samples.map(sample=>this.metric==='cpu'?sample.cpu:sample.rss/1048576),this.columns,this.metric==='cpu'?'%':'MiB',this.metric==='cpu'?100:0).map(text=>({text})),
        {text:this.paused?'[ Resume ]':'[ Pause ]',action:'pause',tone:'accent' as const},
        {text:'[ Sample now ]',action:'sample'},{text:'[ Clear history ]',action:'clear'},{text:'[ Close ]',action:'close'},
      ],
    },{site:'inspector',focus});
  }
  async show(){this.stop();this.open=true;this.visible=true;this.sampler.reset();this.take();await this.paint(true);this.schedule();}
  async press(key:string){
    if(!this.open)return;
    if(key==='close'){this.dispose();await this.$.ui.remove('resources');return;}
    if(!['cpu','memory','switch','pause','sample','clear'].includes(key))return;
    this.stop();
    if(key==='cpu'||key==='memory')this.metric=key;
    if(key==='switch')this.metric=this.metric==='cpu'?'memory':'cpu';
    if(key==='pause'){this.paused=!this.paused;this.sampler.reset();}
    if(key==='sample')this.take();
    if(key==='clear'){this.samples=[];this.sampler.reset();this.take();}
    await this.paint();this.schedule();
  }
  async visibility(event:{visible:boolean;attached:boolean;columns:number}){
    if(!this.open)return;
    if(!event.attached){this.dispose();return;}
    const width=Math.max(14,event.columns);
    if(this.visible===event.visible&&this.columns===width)return;
    const wasVisible=this.visible;this.visible=event.visible;this.columns=width;this.stop();
    if(!this.visible){this.sampler.reset();return;}
    if(!wasVisible){this.sampler.reset();if(!this.paused)this.take();}
    await this.paint();this.schedule();
  }
}
const instances=new Map<string,Monitor>();
function monitor($:any){let value=instances.get($.session.id);if(!value){value=new Monitor($);instances.set($.session.id,value);}return value;}
function initialize(_:unknown,$:any){instances.get($.session.id)?.dispose();instances.delete($.session.id);}
export function dispose(){for(const value of instances.values())value.dispose();instances.clear();}
export default {
  'session.start':initialize,'session.reload':initialize,
  'prompt.submit':async(event:{text:string},$:any)=>{
    if(event.text.trim()!=='/resources')return;
    await monitor($).show();return {drop:'resources: opened'};
  },
  'ui.press':async(event:{site:string;key:string},$:any)=>{
    if(event.site!=='plugin-resources-resources')return;
    if(event.key==='command:/resources')await monitor($).show();else await instances.get($.session.id)?.press(event.key);
  },
  'ui.visibility':async(event:any,$:any)=>{
    if(event.site==='plugin:resources/resources')await instances.get($.session.id)?.visibility(event);
  },
};
