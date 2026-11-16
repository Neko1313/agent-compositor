import type {ConversationSession} from './session.js';

type Edit={kind:'edit';text:string;done:((ok:boolean)=>void)[]};
type Submit={kind:'submit';text:string;intent:'submit'|'steer';done:(ok:boolean)=>void};
type Job=Edit|Submit;

/** Serialize private changes around submission boundaries, keeping later edits separate. */
export class MainDraftQueue {
  private readonly jobs:Job[]=[];
  private running=false;
  private closed=false;
  private failed=false;
  private readonly identity:string;
  constructor(private readonly source:()=>ConversationSession,private readonly error:(reason:'save'|'submit')=>void){
    this.identity=this.key(source());
  }
  private key(source:ConversationSession){return JSON.stringify([source.id,source.generation??source.id,source.conversationId??source.id]);}
  private current(){const source=this.source();return !this.closed&&source.isCurrent?.()!==false&&this.key(source)===this.identity?source:undefined;}
  edit(text:string):Promise<boolean>{
    if(this.closed)return Promise.resolve(false);
    return new Promise(resolve=>{
      const tail=this.jobs.at(-1);
      if(tail?.kind==='edit'){tail.text=text;tail.done.push(resolve);}
      else this.jobs.push({kind:'edit',text,done:[resolve]});
      void this.drain();
    });
  }
  submit(text:string,intent:'submit'|'steer'):Promise<boolean>{
    if(this.closed)return Promise.resolve(false);
    return new Promise(resolve=>{
      const tail=this.jobs.at(-1);
      if(tail?.kind==='edit')tail.text=text;else this.jobs.push({kind:'edit',text,done:[]});
      this.jobs.push({kind:'submit',text,intent,done:resolve});void this.drain();
    });
  }
  private async save(text:string){
    const values=new Set<string>();
    for(let attempt=0;attempt<3;attempt++){
      const source=this.current(),draft=source?.snapshot().draft;
      if(!source?.draftChange||!draft||draft.status!=='draft')return false;
      values.add(draft.text);
      let result=false;try{result=await source.draftChange(text,draft.revision);}catch{return false;}
      if(result)return true;
      const next=this.current()?.snapshot().draft;
      if(!next||next.status!=='draft'||next.revision===draft.revision||!values.has(next.text))return false;
    }
    return false;
  }
  private async drain(){
    if(this.running)return;this.running=true;
    try{while(!this.closed&&this.jobs.length){
      const job=this.jobs.shift()!;
      if(job.kind==='edit'){
        const ok=await this.save(job.text);this.failed=!ok;
        for(const done of job.done)done(ok);
        if(!ok)this.error('save');
      }else{
        let ok=false;const source=this.current();
        if(!this.failed&&source){
          try{const result=job.intent==='steer'?source.steer?.(job.text)??false:source.submit(job.text);ok=(await result)!==false;}
          catch{/* Preserve the editor text on an unacknowledged send. */}
        }
        job.done(ok);if(!ok)this.error('submit');
      }
    }}finally{
      this.running=false;
      if(this.closed)for(const job of this.jobs.splice(0))job.kind==='edit'?job.done.forEach(done=>done(false)):job.done(false);
    }
  }
  close(){this.closed=true;if(!this.running)for(const job of this.jobs.splice(0))job.kind==='edit'?job.done.forEach(done=>done(false)):job.done(false);}
}
