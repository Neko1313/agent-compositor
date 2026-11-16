import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Local editor data. A pending ID is a correlation key, never an instruction to retry. */
export type MainDraft={text:string;intentId?:string};
export type MainDraftRecovery={kind:'draft'|'review'|'journal';text:string};
const identity=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class MainDraftStore {
  private pending:Promise<void>=Promise.resolve();
  private readonly blocked=new Set<string>();
  private readonly inspected=new Set<string>();
  private constructor(private readonly directory:string){}
  static open(stateDirectory:string){return new MainDraftStore(join(stateDirectory,'main-drafts'));}
  private file(sessionId:string){return join(this.directory,createHash('sha256').update(sessionId).digest('hex')+'.json');}
  async load(sessionId:string,events:readonly {type?:unknown;recoveryId?:unknown;text?:unknown}[]):Promise<MainDraftRecovery|undefined>{
    await this.pending.catch(()=>{});
    return this.read(sessionId,events);
  }
  private async read(sessionId:string,events:readonly {type?:unknown;recoveryId?:unknown;text?:unknown}[]):Promise<MainDraftRecovery|undefined>{
    const file=this.file(sessionId);let raw:string;
    try{
      if((await stat(file)).size>400000)throw Error('Saved Main draft exceeds the size limit');raw=await readFile(file,'utf8');
      const value:unknown=JSON.parse(raw);
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid saved Main draft');
      const record=value as Record<string,unknown>;
      if(record.version!==1||typeof record.text!=='string'||record.text.length>64000||
        (record.intentId!==undefined&&(typeof record.intentId!=='string'||!identity.test(record.intentId))))throw Error('Invalid saved Main draft');
      this.blocked.delete(sessionId);this.inspected.add(sessionId);
      if(!record.text)return;
      const intentId=record.intentId as string|undefined;
      return{kind:!intentId?'draft':events.some(event=>event.recoveryId===intentId&&event.text===record.text&&['prompt.input.intent','prompt.queue.intent','prompt.steer.intent'].includes(String(event.type)))?'journal':'review',text:record.text};
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){this.blocked.delete(sessionId);this.inspected.add(sessionId);return;}this.blocked.add(sessionId);this.inspected.add(sessionId);throw error;}
  }
  async save(sessionId:string,draft:MainDraft):Promise<void>{
    if(draft.text.length>64000)throw Error('Main draft exceeds 64000 characters');
    if(draft.intentId!==undefined&&!identity.test(draft.intentId))throw Error('Invalid input identity');
    const file=this.file(sessionId),value=JSON.stringify({version:1,...draft});
    const operation=this.pending.catch(()=>{}).then(async()=>{
      if(!this.inspected.has(sessionId))await this.read(sessionId,[]);
      if(this.blocked.has(sessionId))throw Error('Cannot overwrite an unreadable Main draft');
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const temporary=`${file}.${randomUUID()}.tmp`;
      try{await writeFile(temporary,value,{mode:0o600,flag:'wx'});await rename(temporary,file);}
      finally{await rm(temporary,{force:true});}
    });
    this.pending=operation;await operation;
  }
  async clear(sessionId:string):Promise<void>{
    const operation=this.pending.catch(()=>{}).then(async()=>{if(!this.inspected.has(sessionId))await this.read(sessionId,[]);if(this.blocked.has(sessionId))throw Error('Cannot remove an unreadable Main draft');await rm(this.file(sessionId),{force:true});});
    this.pending=operation;await operation;
  }
  async flush(){await this.pending;}
}
