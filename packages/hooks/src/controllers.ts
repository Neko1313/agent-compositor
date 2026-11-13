import type { UiTextView } from "@agent-compositor/events";
import { uiTextViewSchema } from "@agent-compositor/events";
import { cellSchema, type InputMessage, type RenderMessage } from "@agent-compositor/protocol";
type Cell=NonNullable<RenderMessage["grid"]>[number][number];

export type UiControllerKind = "editor" | "approval" | "question" | "form" | "placement" | "history";
export type UiControllerInput = InputMessage["data"] | {kind:"action";action:string} | {kind:"change";id:string;value:string};
export interface UiEditorState {text:string;cursor:number;}
export type UiEditorIntent = {type:"submit"|"steer";text:string} | {type:"interrupt"} | {type:"scroll";rows:number};
export interface UiControllerView extends Omit<UiTextView,"lines"> {
  lines:(UiTextView["lines"][number] & {cells?:Cell[]})[];
}
export interface UiController {
  render(viewport:{columns:number;rows:number}):UiControllerView;
  handle(input:UiControllerInput):unknown | Promise<unknown>;
  snapshot?():unknown;
  preferredRows?(columns:number,maxRows:number):number;
  pointer?(row:number,col:number):"default"|"pointer"|"text";
  dispose?():void;
}
export interface UiControllerContext {
  readonly signal:AbortSignal;
  invalidate():void;
}
/** Requests and controller state use a private host channel, never the event log. */
export interface UiControllerRequest {kind:UiControllerKind;data:unknown;state?:unknown;}
export type UiControllerFactory = (request:UiControllerRequest,context:UiControllerContext)=>UiController;
export type UiControllers = Partial<Record<UiControllerKind,UiControllerFactory>>;
const kinds:UiControllerKind[]=["editor","approval","question","form","placement","history"];

export function validateControllers(value:unknown):asserts value is UiControllers {
  if(value===undefined)return;
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("controllers must be a factory map");
  for(const [kind,factory]of Object.entries(value))if(!kinds.includes(kind as UiControllerKind)||typeof factory!=="function")
    throw new Error(`Invalid controller factory: ${kind}`);
}

export class UiControllerLease {
  lastView?:UiControllerView;
  private readonly lifetime=new AbortController();
  private tail:Promise<unknown>|undefined;
  private stopped=false;
  private rendering=false;
  private savedEditorState:unknown;
  readonly signal:AbortSignal;
  readonly instance:UiController;
  constructor(readonly owner:string,readonly kind:UiControllerKind,factory:UiControllerFactory,request:UiControllerRequest,
    ownerSignal:AbortSignal,invalidate:()=>void,private renderScope:<T>(owner:string,fn:()=>T)=>T) {
    this.signal=AbortSignal.any([ownerSignal,this.lifetime.signal]);
    this.signal.throwIfAborted();
    try{this.instance=factory(request,{signal:this.signal,invalidate:()=>{if(this.rendering)throw new Error("Invalidation during controller rendering is forbidden");if(!this.signal.aborted)invalidate();}});}catch(error){this.lifetime.abort(error);throw error;}
    if(!this.instance || typeof this.instance.render!=="function" || typeof this.instance.handle!=="function" || (kind==="editor"&&typeof this.instance.snapshot!=="function")){
      this.lifetime.abort();this.stop();throw new Error(`Invalid ${kind} controller from ${owner}`);
    }
    this.signal.addEventListener("abort",()=>this.stop(),{once:true});
  }
  get isDefault(){return this.owner==="@host";}
  render(columns:number,rows:number):UiControllerView {
    this.signal.throwIfAborted();
    return this.pure(()=>{
      const result=this.instance.render({columns,rows});
      if(!result || !Array.isArray(result.lines))throw new Error("Controller must return a synchronous view");
      const parsed=uiTextViewSchema.parse({...result,lines:result.lines.map(({cells,...line})=>line)});
      const view={...parsed,lines:parsed.lines.map((line,index)=>({...line,...(result.lines[index].cells?{cells:result.lines[index].cells!.map(cell=>cellSchema.parse(cell))}:{})}))};
      this.lastView=view;return view;
    });
  }
  handle(input:UiControllerInput):unknown|Promise<unknown> {
    const invoke=()=>{this.signal.throwIfAborted();return this.instance.handle(input);};
    if(this.isDefault)return invoke();
    const result=this.tail ? this.tail.then(invoke) : invoke();
    if(result && typeof (result as PromiseLike<unknown>).then==="function") {
      let abort:()=>void;
      const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(this.signal.reason);if(this.signal.aborted)abort();else this.signal.addEventListener("abort",abort,{once:true});});
      const pending=Promise.race([Promise.resolve(result),cancelled]).then(value=>{this.signal.throwIfAborted();return value;}).finally(()=>this.signal.removeEventListener("abort",abort));
      this.tail=pending.then(()=>{},()=>{});const settled=this.tail;
      void settled.finally(()=>{if(this.tail===settled)this.tail=undefined;});return pending;
    }
    return result;
  }
  private pure<T>(fn:()=>T):T {return this.renderScope(this.owner,()=>{const previous=this.rendering;this.rendering=true;try{return fn();}finally{this.rendering=previous;}});}
  snapshot(){
    if(this.stopped&&this.kind==="editor")return this.savedEditorState;
    const state=this.pure(()=>this.instance.snapshot?.());
    if(this.kind==="editor")this.savedEditorState=structuredClone(state);
    return state;
  }
  preferredRows(columns:number,maxRows:number){const rows=this.pure(()=>this.instance.preferredRows?.(columns,maxRows))??this.render(columns,maxRows).lines.length;return Number.isFinite(rows)?Math.max(1,Math.min(maxRows,Math.floor(rows))):1;}
  pointer(row:number,col:number){return this.pure(()=>this.instance.pointer?.(row,col))??"default";}
  dispose(){if(this.stopped)return;this.lifetime.abort(new Error("Controller disposed"));this.stop();}
  private stop(){if(this.stopped)return;if(this.kind==="editor")try{this.snapshot();}catch{/* Use the last valid snapshot. */}this.stopped=true;try{this.instance?.dispose?.();}catch{/* Teardown cannot prevent other components from closing. */}}
}

/** Per-core registry. Only explicitly selected providers receive private requests. */
export class UiControllerRegistry {
  private readonly providers=new Map<string,{factories:UiControllers;signal:AbortSignal}>();
  private readonly leases=new Set<UiControllerLease>();
  private readonly listeners=new Set<(kinds:UiControllerKind[])=>void>();
  constructor(private selected:Partial<Record<UiControllerKind,string>>={},private renderScope:<T>(owner:string,fn:()=>T)=>T=(_owner,fn)=>fn()){}
  selectedOwner(kind: UiControllerKind): string { return this.selected[kind] ?? '@host'; }
  register(owner:string,factories:UiControllers|undefined,signal:AbortSignal){
    validateControllers(factories);if(!factories)return;
    this.providers.set(owner,{factories,signal});this.changed(Object.keys(factories) as UiControllerKind[]);
  }
  remove(owner:string){const entry=this.providers.get(owner);if(!entry)return;this.providers.delete(owner);this.changed(Object.keys(entry.factories) as UiControllerKind[]);}
  subscribe(listener:(kinds:UiControllerKind[])=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private changed(kinds:UiControllerKind[]){for(const listener of this.listeners)listener(kinds);}
  disposeAll(){const leases=[...this.leases];this.leases.clear();for(const lease of leases)lease.dispose();}
  create(kind:UiControllerKind,data:unknown,fallback:UiControllerFactory,invalidate:()=>void,state?:unknown,callerSignal?:AbortSignal):UiControllerLease {
    const owner=this.selected[kind]??"@host",entry=this.providers.get(owner),factory=owner==="@host"?fallback:entry?.factories[kind];
    if(!factory)throw new Error(`Selected ${kind} controller ${owner} is unavailable`);
    const lease=new UiControllerLease(owner,kind,factory,{kind,data,state},AbortSignal.any([...(entry?[entry.signal]:[]),...(callerSignal?[callerSignal]:[])]),invalidate,this.renderScope);
    this.leases.add(lease);lease.signal.addEventListener("abort",()=>this.leases.delete(lease),{once:true});return lease;
  }
}
