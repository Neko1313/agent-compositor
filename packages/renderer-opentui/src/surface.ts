import type {UiTextView} from '@agent-compositor/events';
import type {ConversationApproval,ConversationInteraction,ConversationSession} from './session.js';

export interface UiSurfaceSnapshot {
  revision: number;
  title: string;
  view?: UiTextView;
  approval?: ConversationApproval;
  interaction?: ConversationInteraction;
  /** Compatibility alias for private form sources. */
  form?: Extract<ConversationInteraction, {kind: 'form'}>;
  busy?: boolean;
  error?: string;
}

/** Semantic data and admitted actions; extension code never runs in the renderer. */
export interface UiSurfaceSource {
  id: string;
  snapshot(): UiSurfaceSnapshot;
  subscribe(listener: () => void): () => void;
  press(action: string, revision: number): void;
  change(field: string, value: string, revision: number): void;
  answerApproval?(id: string, allow: boolean): void;
  answerInteraction?(id: string, value: unknown): void;
  cancelInteraction?(id: string): void;
  answerForm?(id: string, value: unknown): void;
  cancelForm?(id: string): void;
}

export const surfaceInteraction=(state:UiSurfaceSnapshot)=>state.interaction??state.form;
export const hasSurfaceRequest=(state:UiSurfaceSnapshot)=>Boolean(state.approval||surfaceInteraction(state));
export function surfaceRequestStatus(state:UiSurfaceSnapshot):string {
  const interaction=surfaceInteraction(state);
  return state.approval?'Approval':interaction?.kind==='question'?'Question':interaction?'Form':state.busy?'Working':'';
}

/** Keep private request answers bound to the current source, request and input focus. */
export function createSurfaceRequestSession(source:UiSurfaceSource,isActive:()=>boolean):ConversationSession {
  return {
    id:source.id,label:'Request',subscribe:source.subscribe,submit:()=>{},
    snapshot:()=>{
      const state=source.snapshot();
      return {messages:[],running:false,approval:state.approval,interaction:surfaceInteraction(state)};
    },
    get answerApproval(){
      if(!source.answerApproval)return;
      return (id:string,allow:boolean)=>{
        if(isActive()&&source.snapshot().approval?.id===id)source.answerApproval?.(id,allow===true);
      };
    },
    answerInteraction:(id,value)=>{
      const state=source.snapshot(),interaction=surfaceInteraction(state);
      if(!isActive()||state.approval||interaction?.id!==id)return;
      if(source.answerInteraction)source.answerInteraction(id,value);
      else if(interaction.kind==='form')source.answerForm?.(id,value);
    },
    cancelInteraction:id=>{
      const state=source.snapshot(),interaction=surfaceInteraction(state);
      if(!isActive()||state.approval||interaction?.id!==id)return;
      if(source.cancelInteraction)source.cancelInteraction(id);
      else if(interaction.kind==='form')source.cancelForm?.(id);
    },
  };
}

export interface UiSurfaceRegistry {
  snapshot(): readonly UiSurfaceSource[];
  subscribe(listener: () => void): () => void;
}
