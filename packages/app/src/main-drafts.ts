import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,readlink,rename,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';

/** Editor data; an input ID is a correlation key, never permission to retry. */
export type MainDraft={text:string;intentId?:string};
export type MainDraftVariant={id:string;kind:'draft'|'review'|'journal';text:string};
export type MainDraftRecovery=Omit<MainDraftVariant,'id'>|{kind:'conflict';variants:MainDraftVariant[]};
type RecordV2={version:2;owner:string;revision:number;parents:string[];text:string;intentId?:string};
type SessionState={revision:number;parents:Set<string>;conflict:boolean};
type Event={type?:unknown;recoveryId?:unknown;text?:unknown};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const head=(record:RecordV2)=>`${record.owner}:${record.revision}`;
const headPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]{0,14}$/;

/** Only identify processes where the PID namespace and boot can be compared. */
async function localProcessDomain():Promise<{boot:string;namespace:string}|undefined>{
  if(process.platform!=='linux')return;
  try{
    const [boot,link]=await Promise.all([readFile('/proc/sys/kernel/random/boot_id','utf8'),readlink('/proc/self/ns/pid')]);
    const bootId=boot.trim(),namespace=/^pid:\[([0-9]+)\]$/.exec(link)?.[1];
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bootId)||!namespace)return;
    return {boot:bootId,namespace};
  }catch{return;}
}

/** Each instance writes immutable versions per session. Divergent writers are never overwritten. */
export class MainDraftStore {
  private pending:Promise<void>=Promise.resolve();
  private readonly owner=randomUUID();
  private readonly states=new Map<string,SessionState>();
  private constructor(private readonly directory:string){}
  static open(stateDirectory:string){return new MainDraftStore(join(stateDirectory,'main-drafts-v3'));}
  private prefix(sessionId:string){return createHash('sha256').update(sessionId).digest('hex');}
  private file(sessionId:string,owner:string,revision:number){return join(this.directory,`${this.prefix(sessionId)}.${owner}.${revision}.json`);}
  private state(id:string){let value=this.states.get(id);if(!value){value={revision:0,parents:new Set(),conflict:false};this.states.set(id,value);}return value;}
  private async records(sessionId:string,allVersions=false):Promise<RecordV2[]>{
    const prefix=this.prefix(sessionId)+'.';
    const legacy=await readdir(join(dirname(this.directory),'main-drafts-v2')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    if(legacy.some(name=>name.startsWith(prefix)&&name.endsWith('.json')))throw Error('Legacy Main drafts require migration before use');
    // Cleanup by another process can remove an immutable version between listing
    // and reading it. Retry the entire snapshot rather than hiding missing data.
    for(let attempt=0;attempt<8;attempt++){
      const names=await readdir(this.directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      const files=names.filter(name=>name.startsWith(prefix)&&name.endsWith('.json'));
      if(files.length>4096)throw Error('Too many saved Main draft versions');
      try{
        const all=await Promise.all(files.map(async name=>{
          const suffix=name.slice(prefix.length,-5),match=/^([0-9a-f-]+)\.([1-9][0-9]{0,14})$/.exec(suffix),file=join(this.directory,name);
          if(!match||!uuid.test(match[1])||(await stat(file)).size>420000)throw Error('Invalid saved Main draft file');
          const value:unknown=JSON.parse(await readFile(file,'utf8'));
          if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid saved Main draft');
          const r=value as Record<string,unknown>;
          if(r.version!==2||r.owner!==match[1]||r.revision!==Number(match[2])||!Number.isSafeInteger(r.revision)||Number(r.revision)>999999999999999||
            !Array.isArray(r.parents)||r.parents.length>256||r.parents.some(parent=>typeof parent!=='string'||!headPattern.test(parent))||
            typeof r.text!=='string'||r.text.length>64000||(r.intentId!==undefined&&(typeof r.intentId!=='string'||!uuid.test(r.intentId))))
            throw Error('Invalid saved Main draft');
          return r as RecordV2;
        }));
        const latest=new Map<string,RecordV2>();
        for(const record of all){const prior=latest.get(record.owner);if(!prior||prior.revision<record.revision)latest.set(record.owner,record);}
        if(latest.size>256)throw Error('Too many saved Main draft writers');
        return allVersions?all:[...latest.values()];
      }catch(error:any){if(error?.code!=='ENOENT'||attempt===7)throw error;}
    }
    throw Error('Could not read saved Main drafts');
  }
  private leaves(records:RecordV2[]){
    const byId=new Map(records.map(record=>[head(record),record])),visiting=new Set<string>(),visited=new Set<string>();
    const visit=(id:string)=>{if(visiting.has(id))throw Error('Cyclic Main draft history');if(visited.has(id))return;
      visiting.add(id);for(const parent of byId.get(id)?.parents??[])if(byId.has(parent))visit(parent);visiting.delete(id);visited.add(id);};
    for(const id of byId.keys())visit(id);
    const superseded=new Set(records.flatMap(record=>record.parents));return records.filter(record=>!superseded.has(head(record)));
  }
  private classify(record:RecordV2,evidence:ReadonlySet<string>):MainDraftVariant{
    const kind=!record.intentId?'draft':evidence.has(JSON.stringify([record.intentId,record.text]))?'journal':'review';
    return{id:head(record),kind,text:record.text};
  }
  async load(sessionId:string,events:readonly Event[]):Promise<MainDraftRecovery|undefined>{
    const evidence=new Set(events.flatMap(event=>typeof event.recoveryId==='string'&&typeof event.text==='string'&&
      ['prompt.input.intent','prompt.queue.intent','prompt.steer.intent'].includes(String(event.type))?[JSON.stringify([event.recoveryId,event.text])]:[]));
    const operation=this.pending.catch(()=>{}).then(async():Promise<MainDraftRecovery|undefined>=>{
      const records=await this.records(sessionId),leaves=this.leaves(records),state=this.state(sessionId);
      const own=records.find(record=>record.owner===this.owner);if(own){state.revision=own.revision;for(const parent of own.parents)state.parents.add(parent);}
      const variants=leaves.filter(record=>record.text).map(record=>this.classify(record,evidence));
      state.conflict=variants.length>1;
      if(state.conflict)return{kind:'conflict',variants};
      // A successful load establishes exactly which version the next edit extends.
      for(const record of leaves)if(record.owner!==this.owner)state.parents.add(head(record));
      if(!variants.length)return;
      const {kind,text}=variants[0];return{kind,text};
    });
    this.pending=operation.then(()=>{},()=>{});return operation;
  }
  private validate(draft:MainDraft){
    if(!draft||typeof draft.text!=='string')throw Error('Invalid Main draft');
    if(draft.text.length>64000)throw Error('Main draft exceeds 64000 characters');
    if(draft.intentId!==undefined&&(typeof draft.intentId!=='string'||!uuid.test(draft.intentId)))throw Error('Invalid input identity');
  }
  private async write(sessionId:string,state:SessionState,draft:MainDraft){
    if(state.parents.size>256||state.revision>=999999999999999)throw Error('Main draft history exceeds its limit');
    const record:RecordV2={version:2,owner:this.owner,revision:state.revision+1,parents:[...state.parents],text:draft.text,...(draft.intentId?{intentId:draft.intentId}:{})};
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const file=this.file(sessionId,this.owner,record.revision),domain=await localProcessDomain();
    const identity=domain?`${process.pid}.${domain.boot}.${domain.namespace}`:'unknown';
    const temporary=`${file}.${identity}.${randomUUID()}.tmp`;
    try{await writeFile(temporary,JSON.stringify(record),{mode:0o600,flag:'wx'});await rename(temporary,file);state.revision=record.revision;}
    finally{await rm(temporary,{force:true});}
  }
  async save(sessionId:string,draft:MainDraft):Promise<void>{
    this.validate(draft);
    const snapshot:MainDraft={text:draft.text,...(draft.intentId?{intentId:draft.intentId}:{})};
    const operation=this.pending.catch(()=>{}).then(async()=>{
      const state=this.state(sessionId);if(state.conflict)throw Error('Resolve conflicting Main drafts before saving');
      // Read every record even without a prior load: corrupted foreign files must
      // never be masked by a new writer. Unseen records are not superseded.
      const records=await this.records(sessionId);this.leaves(records);
      if(!records.some(record=>record.owner===this.owner)&&records.length>=256)throw Error('Too many saved Main draft writers');
      await this.write(sessionId,state,snapshot);
    });
    this.pending=operation;await operation;
  }
  async clear(sessionId:string):Promise<void>{await this.save(sessionId,{text:''});}
  /** Remove only immutable versions already superseded in a validated snapshot. */
  async compact(sessionId:string):Promise<void>{
    const operation=this.pending.catch(()=>{}).then(async()=>{
      const all=await this.records(sessionId,true),latest=new Map<string,RecordV2>();
      for(const record of all){const prior=latest.get(record.owner);if(!prior||prior.revision<record.revision)latest.set(record.owner,record);}
      const records=[...latest.values()],leaves=this.leaves(records);
      // First remove older versions of every owner. If a superseded latest
      // version is removed first, an older one could reappear as a live draft.
      for(const record of all)if(record.revision<latest.get(record.owner)!.revision)
        await rm(this.file(sessionId,record.owner,record.revision),{force:true});
      const visible=new Set(leaves.map(head));
      for(const record of records)if(!visible.has(head(record)))await rm(this.file(sessionId,record.owner,record.revision),{force:true});
      const domain=await localProcessDomain();
      if(domain){
        const prefix=this.prefix(sessionId)+'.';
        const names=await readdir(this.directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
        for(const name of names){
          if(!name.startsWith(prefix))continue;
          const match=/^([0-9a-f-]+)\.([1-9][0-9]{0,14})\.json\.([1-9][0-9]{0,9})\.([0-9a-f-]+)\.([0-9]+)\.([0-9a-f-]+)\.tmp$/.exec(name.slice(prefix.length));
          if(!match||!uuid.test(match[1])||!uuid.test(match[6])||match[4]!==domain.boot||match[5]!==domain.namespace)continue;
          const pid=Number(match[3]);if(!Number.isSafeInteger(pid)||pid<=0||pid>2147483647)continue;
          // ESRCH is the only proof accepted. EPERM and every uncertain or
          // different process domain leave the private file untouched.
          try{process.kill(pid,0);}catch(error:any){if(error?.code==='ESRCH')await rm(join(this.directory,name),{force:true});}
        }
      }
    });
    this.pending=operation;await operation;
  }
  /** A conflict is resolved only against the exact versions the user reviewed. */
  async resolve(sessionId:string,reviewed:readonly string[],draft:MainDraft):Promise<void>{
    this.validate(draft);
    const snapshot:MainDraft={text:draft.text,...(draft.intentId?{intentId:draft.intentId}:{})},reviewedIds=[...reviewed].sort();
    const operation=this.pending.catch(()=>{}).then(async()=>{
      const records=await this.records(sessionId),leaves=this.leaves(records),actual=leaves.filter(record=>record.text).map(head).sort();
      if(JSON.stringify(reviewedIds)!==JSON.stringify(actual)||actual.length<2)throw Error('Main draft conflict changed; review again');
      if(!records.some(record=>record.owner===this.owner)&&records.length>=256)throw Error('Too many saved Main draft writers');
      const state=this.state(sessionId),parents=new Set(state.parents);for(const record of leaves)if(record.owner!==this.owner)parents.add(head(record));
      const candidate={...state,parents};await this.write(sessionId,candidate,snapshot);state.parents=parents;state.revision=candidate.revision;state.conflict=false;
    });
    this.pending=operation;await operation;
  }
  async flush(){await this.pending;}
}
