import type {HooksHost,HooksServiceScope} from '@agent-compositor/hooks';
import type {UiForm,UiFormResult} from '@agent-compositor/events';

/** Host-generated execution identity; provider call IDs are descriptive only. */
export interface CoreToolInvocation {
  readonly id:string;
  readonly turnId:string;
  readonly callId:string;
  /** Original dispatched name, before hook rewrites; never a permission descriptor. */
  readonly tool:string;
  readonly parentId?:string;
}

/** Inert producer identity. Never includes a delegated prompt or tool arguments. */
export interface CoreHumanRequestOrigin {
  readonly sessionId:string;
  readonly agentId?:string;
  readonly depth:number;
  readonly parent?:{
    readonly sessionId:string;
    readonly agentId?:string;
    readonly invocationId:string;
    readonly tool?:string;
  };
  readonly invocation?:CoreToolInvocation;
}

/** Private host routing context; must not be published as UI/catalog data. */
export interface CoreHumanRequestRoot {
  readonly instance:object;
  readonly host:HooksHost;
  readonly signal:AbortSignal;
}

export interface CoreHumanRequestContext {
  readonly instance:object;
  readonly host:HooksHost;
  readonly origin:CoreHumanRequestOrigin;
  readonly signal:AbortSignal;
  /** Owning agent family lifetime, independent of delegation authority. */
  readonly root:CoreHumanRequestRoot;
  readonly serviceScope?:HooksServiceScope;
  readonly invocationOrigin:unknown;
  readonly delegatedFrom?:CoreHumanRequestContext;
}

export type CoreHumanFormHandler=(plugin:string,request:UiForm,signal:AbortSignal,
  context:CoreHumanRequestContext)=>Promise<UiFormResult|null>;
