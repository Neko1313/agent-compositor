import {mkdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

/** Private, bounded reply drafts. Independent agents never overwrite each other. */
export class AgentDrafts {
  private readonly values=new Map<string,string>();
  private readonly dirty=new Map<string,number>();
  private readonly blocked=new Map<string,string>();
  private timer?:ReturnType<typeof setTimeout>;
  private pending:Promise<void>=Promise.resolve();
  private revision=0;
  private constructor(private readonly directory:string,private readonly onError:(error:unknown)=>void){}
  private file(id:string){return join(this.directory,createHash('sha256').update(id).digest('hex')+'.json');}
  get loadError(){return this.blocked.size?`Unable to read saved agent drafts in ${this.directory}; move damaged files aside and restart to restore saving for those agents.`:undefined;}
  static async open(directory:string,ids:ReadonlySet<string>,onError:(error:unknown)=>void){
    const store=new AgentDrafts(join(directory,'agent-drafts'),onError);
    await Promise.all([...ids].map(async id=>{
      const file=store.file(id);
      try{
        if((await stat(file)).size>25000)throw Error('Agent draft exceeds the size limit');
        const value:unknown=JSON.parse(await readFile(file,'utf8'));
        if(typeof value!=='string'||value.length>4000)throw Error('Invalid agent draft');
        if(value)store.values.set(id,value);
      }catch(error:any){if(error.code!=='ENOENT')store.blocked.set(id,file);}
    }));
    return store;
  }
  get(id:string){return this.values.get(id);}
  set(id:string,text:string){
    if((this.values.get(id)??'')===text&&!(text===''&&this.blocked.has(id)))return;
    if(text)this.values.set(id,text);else this.values.delete(id);
    this.dirty.set(id,++this.revision);
    clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=undefined;void this.flush().catch(this.onError);},250);this.timer.unref?.();
  }
  async flush(){
    clearTimeout(this.timer);this.timer=undefined;
    if(!this.dirty.size){await this.pending;return;}
    const snapshot=[...this.dirty].map(([id,revision])=>({id,revision,text:this.values.get(id)??''}));
    const operation=this.pending.catch(()=>{}).then(async()=>{
      const errors:unknown[]=[];
      for(const {id,revision,text} of snapshot){
        try{
          const file=this.file(id),blocked=this.blocked.get(id);
          if(blocked)throw Error(`Cannot save agent draft; move damaged file aside: ${blocked}`);
          if(!text)await rm(file,{force:true});
          else{
            const temporary=`${file}.${randomUUID()}.tmp`;
            try{await mkdir(this.directory,{recursive:true,mode:0o700});await writeFile(temporary,JSON.stringify(text),{mode:0o600,flag:'wx'});await rename(temporary,file);}
            finally{await rm(temporary,{force:true});}
          }
          if(this.dirty.get(id)===revision)this.dirty.delete(id);
        }catch(error){errors.push(error);}
      }
      if(errors.length)throw new AggregateError(errors,'Could not save one or more agent drafts');
    });
    this.pending=operation;await operation;
  }
}
