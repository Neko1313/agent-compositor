import type { AgentCoreOptions } from "@agent-compositor/core";
import type { UiForm,UiFormResult } from "@agent-compositor/events";
import type { SessionMeta } from "@agent-compositor/session";
import type { Placement } from "./placement.js";
import type { PluginWindow } from "./plugin-panel.js";

/** Private request.data contracts supplied by the assembled terminal host. */
export interface AppUiControllerData {
  editor:{sessionId:string;commands():{name:string;description:string;usage?:string}[];files?:()=>Promise<string[]>};
  approval:Omit<Parameters<NonNullable<AgentCoreOptions["onApproval"]>>[0],"signal">;
  question:Omit<Parameters<NonNullable<AgentCoreOptions["onAsk"]>>[0],"signal">;
  form:UiForm;
  history:{sessionId:string;query:string;
    control(action:"list",args?:{search?:string;includeArchived?:boolean;signal?:AbortSignal}):Promise<SessionMeta[]>;
    control(action:"rename"|"fork"|"archive"|"unarchive",args?:{id?:string;name?:string}):Promise<SessionMeta>;
    form(request:UiForm):Promise<UiFormResult|null>;
  };
  placement:{windows():PluginWindow[];anchors():string[];apply(id:string,placement:Placement,save?:boolean):Promise<void>};
}
export type UiApprovalResult={allow:boolean;scope?:"once"|"session"|"project"};
export type UiHistoryIntent="close"|{type:"resume";id:string;name?:string};
