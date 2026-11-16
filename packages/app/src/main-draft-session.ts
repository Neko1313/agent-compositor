import {randomUUID} from 'node:crypto';
import type {AgentCore,CoreInputAdmission} from '@agent-compositor/core';
import {MainDraftStore,type MainDraftRecovery,type MainDraftVariant} from './main-drafts.js';

export type MainDraftSessionState =
  | {status:'loading';revision:number}
  | {status:'draft'|'review'|'journal';revision:number;text:string}
  | {status:'conflict';revision:number;variants:readonly MainDraftVariant[]}
  | {status:'error';revision:number};

/** Owns admission for one Core generation; a recovered input is never started here. */
export class MainDraftSession {
  private state:MainDraftSessionState={status:'loading',revision:0};
  private busy=false;
  private active=true;
  private constructor(private readonly store:MainDraftStore,private readonly core:AgentCore,private readonly current:()=>boolean,
    private readonly changed:()=>void){}
  static open(store:MainDraftStore,core:AgentCore,current:()=>boolean,changed:()=>void){
    return new MainDraftSession(store,core,current,changed);
  }
  snapshot(){return this.state;}
  private live(){return this.active&&this.current();}
  private publish(value:Omit<Extract<MainDraftSessionState,{status:'draft'|'review'|'journal'}>,'revision'>
    | Omit<Extract<MainDraftSessionState,{status:'conflict'}>,'revision'> | {status:'error'}){
    this.state={...value,revision:this.state.revision+1} as MainDraftSessionState;
    queueMicrotask(()=>{if(this.live())this.changed();});
  }
  private recovered(value:MainDraftRecovery|undefined){
    if(!value)this.publish({status:'draft',text:''});
    else if(value.kind==='conflict')this.publish({status:'conflict',variants:value.variants.map(variant=>({...variant}))});
    else this.publish({status:value.kind,text:value.text});
  }
  async load(events:readonly {type?:unknown;recoveryId?:unknown;text?:unknown}[]){
    if(!this.live()||this.busy||(this.state.status!=='loading'&&this.state.status!=='error'))return;
    this.busy=true;
    try{const result=await this.store.load(this.core.sessionId,events);if(this.live())this.recovered(result);}
    catch{if(this.live())this.publish({status:'error'});}
    finally{this.busy=false;}
  }
  /** Re-read a conflict after another writer changed one of its versions. */
  async refreshConflict(events:readonly {type?:unknown;recoveryId?:unknown;text?:unknown}[]):Promise<boolean>{
    if(!this.live()||this.busy||this.state.status!=='conflict')return false;
    this.busy=true;
    try{const result=await this.store.load(this.core.sessionId,events);if(!this.live())return false;this.recovered(result);return true;}
    catch{return false;}finally{this.busy=false;}
  }
  async change(text:string,revision:number):Promise<boolean>{
    if(!this.live()||this.busy||this.state.revision!==revision||this.state.status!=='draft'||text.length>64000)return false;
    this.busy=true;
    try{await this.store.save(this.core.sessionId,{text});if(!this.live())return false;this.publish({status:'draft',text});return true;}
    catch{return false;}finally{this.busy=false;}
  }
  /** A reviewed ambiguous input can be edited, never automatically resubmitted. */
  async review(revision:number):Promise<boolean>{
    if(!this.live()||this.busy||this.state.revision!==revision||!['review','journal'].includes(this.state.status))return false;
    const text=(this.state as Extract<MainDraftSessionState,{text:string}>).text;this.busy=true;
    try{await this.store.save(this.core.sessionId,{text});if(!this.live())return false;this.publish({status:'draft',text});return true;}
    catch{return false;}finally{this.busy=false;}
  }
  async resolve(ids:readonly string[],text:string,revision:number):Promise<boolean>{
    if(!this.live()||this.busy||this.state.revision!==revision||this.state.status!=='conflict'||text.length>64000)return false;
    this.busy=true;
    try{await this.store.resolve(this.core.sessionId,ids,{text});if(!this.live())return false;this.publish({status:'draft',text});return true;}
    catch{return false;}finally{this.busy=false;}
  }
  /** Host commands have no Core journal identity; a crash leaves them for review. */
  async command(text:string,revision:number,invoke:()=>Promise<CoreInputAdmission>):Promise<CoreInputAdmission>{
    if(!this.live()||this.busy||this.state.status!=='draft'||this.state.revision!==revision||this.state.text!==text||!text.trim())return false;
    this.busy=true;
    try{
      await this.store.save(this.core.sessionId,{text,intentId:randomUUID()});
      if(!this.live())return false;
      this.publish({status:'review',text});
      const result=await invoke();
      if(!result||!this.live())return result;
      try{await this.store.clear(this.core.sessionId);if(this.live())this.publish({status:'draft',text:''});}
      catch{/* The command was accepted. Never dispatch it twice on cleanup failure. */}
      return result;
    }catch{return false;}finally{this.busy=false;}
  }
  async submit(text:string,intent:'submit'|'steer',revision:number):Promise<{admission:CoreInputAdmission;completion?:Promise<void>}>{
    if(!this.live()||this.busy||this.state.status!=='draft'||this.state.revision!==revision||this.state.text!==text||!text.trim())return{admission:false};
    this.busy=true;
    try{
      const prepared=this.core.prepareInput(text,intent);
      await this.store.save(this.core.sessionId,{text,intentId:prepared.id});
      if(!this.live())return{admission:false};
      // Treat a crash or a late journal write after this point as ambiguous.
      this.publish({status:'review',text});
      const receipt=prepared.start(),admission=await receipt.admitted;
      if(!admission||!this.live())return{admission,completion:receipt.completion};
      try{await this.store.clear(this.core.sessionId);if(this.live())this.publish({status:'draft',text:''});}
      catch{/* The input was admitted: retain its recovery marker and do not retry. */}
      return{admission,completion:receipt.completion};
    }catch{return{admission:false};}finally{this.busy=false;}
  }
  close(){this.active=false;}
}
