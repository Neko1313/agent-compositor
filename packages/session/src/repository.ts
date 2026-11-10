import type { Session, SessionEvent, SessionMeta } from "./store.js";

/** Storage contract shared by journaling, history, CLI and resumption. No filesystem is required. */
export interface SessionRepository {
  create(cwd:string,options?:{id?:string;name?:string;parentId?:string}):Promise<SessionMeta>;
  append(id:string,events:SessionEvent[],cwd?:string):Promise<void>;
  load(id:string,cwd?:string):Promise<Session>;
  list(cwd:string,options?:{includeArchived?:boolean}):Promise<SessionMeta[]>;
  search(cwd:string,query:string,options?:{includeArchived?:boolean;signal?:AbortSignal}):Promise<SessionMeta[]>;
  fork(id:string,options?:{name?:string;uptoEventIndex?:number},cwd?:string):Promise<SessionMeta>;
  archive(id:string,cwd?:string):Promise<SessionMeta>;
  rename(id:string,name:string,cwd:string):Promise<SessionMeta>;
  unarchive(id:string,cwd:string):Promise<SessionMeta>;
  remove(id:string,cwd?:string):Promise<void>;
  findByPrefix(prefix:string,cwd:string):Promise<SessionMeta|undefined>;
  dispose?():void|Promise<void>;
  /** Optional compatibility helper for hosts that explicitly need local paths. */
  root?(cwd:string):string;
}
export interface SessionRepositoryContext {
  cwd:string;
  sessionsRoot:string;
  stateRoot:string;
  signal:AbortSignal;
  config(name:string):Promise<unknown>;
}
export type SessionRepositoryFactory=(context:SessionRepositoryContext)=>SessionRepository|Promise<SessionRepository>;
const methods=["create","append","load","list","search","fork","archive","rename","unarchive","remove","findByPrefix"] as const;
export function validateSessionRepository(value:unknown):asserts value is SessionRepository {
  if(!value || typeof value!=="object" || methods.some(name=>typeof (value as Record<string,unknown>)[name]!=="function"))
    throw new Error("Session repository must implement the complete storage contract");
}

/** Stable facade: callers do not retain a stale backend after a plugin reload. */
export class SessionRepositoryRouter implements SessionRepository {
  private backend:SessionRepository;
  private ready:Promise<void>=Promise.resolve();
  private pending=new Set<Promise<unknown>>();
  private closed=false;
  private closing?:Promise<void>;
  readonly cleanupErrors:unknown[]=[];
  constructor(backend:SessionRepository){validateSessionRepository(backend);this.backend=backend;}
  private async call<K extends typeof methods[number]>(method:K,args:Parameters<SessionRepository[K]>):Promise<Awaited<ReturnType<SessionRepository[K]>>> {
    await this.ready;if(this.closed)throw new Error("Session repository is closed");
    const operation=Promise.resolve((this.backend[method] as (...args:any[])=>unknown).apply(this.backend,args));
    this.pending.add(operation);try{return await operation as Awaited<ReturnType<SessionRepository[K]>>;}finally{this.pending.delete(operation);}
  }
  replace(next:SessionRepository){return this.replaceWith(()=>next);}
  /** Freeze new calls and drain writes before opening a replacement backend. */
  async replaceWith(factory:()=>SessionRepository|Promise<SessionRepository>,beforeCommit?:()=>void){
    if(this.closed)throw new Error("Session repository is closed");
    const previous=this.ready;
    const operation=(async()=>{
      await previous;await Promise.allSettled([...this.pending]);
      const next=await factory();
      try{validateSessionRepository(next);beforeCommit?.();}
      catch(error){if(next!==this.backend)await next?.dispose?.();throw error;}
      const old=this.backend;this.backend=next;
      if(old!==next)try{await old.dispose?.();}catch(error){this.cleanupErrors.push(error);}
    })();
    this.ready=operation.catch(()=>{});await operation;
  }
  create(...args:Parameters<SessionRepository["create"]>){return this.call("create",args);}
  append(...args:Parameters<SessionRepository["append"]>){return this.call("append",args);}
  load(...args:Parameters<SessionRepository["load"]>){return this.call("load",args);}
  list(...args:Parameters<SessionRepository["list"]>){return this.call("list",args);}
  search(...args:Parameters<SessionRepository["search"]>){return this.call("search",args);}
  fork(...args:Parameters<SessionRepository["fork"]>){return this.call("fork",args);}
  archive(...args:Parameters<SessionRepository["archive"]>){return this.call("archive",args);}
  rename(...args:Parameters<SessionRepository["rename"]>){return this.call("rename",args);}
  unarchive(...args:Parameters<SessionRepository["unarchive"]>){return this.call("unarchive",args);}
  remove(...args:Parameters<SessionRepository["remove"]>){return this.call("remove",args);}
  findByPrefix(...args:Parameters<SessionRepository["findByPrefix"]>){return this.call("findByPrefix",args);}
  root(cwd:string){if(!this.backend.root)throw new Error("Selected repository has no filesystem root");return this.backend.root(cwd);}
  dispose(){if(!this.closing){this.closed=true;this.closing=(async()=>{await this.ready;await Promise.allSettled([...this.pending]);await this.backend.dispose?.();})();}return this.closing;}
}
