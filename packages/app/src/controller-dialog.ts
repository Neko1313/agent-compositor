import type { UiControllerLease, UiControllerInput } from "@agent-compositor/hooks";
import type { Row } from "./presentation.js";

/** Geometry stays in AppUI; all content and interaction belong to the lease. */
export class ControllerDialog<Request> {
  hint?:string;
  constructor(readonly lease:UiControllerLease,readonly request:Request){}
  visible(columns:number,rows:number):Row[]{try{const view=this.lease.render(columns,rows);this.hint=view.hint;return view.lines;}catch{this.lease.dispose();return[{text:"Controller unavailable",tone:"danger"}];}}
  rows(columns:number):Row[]{try{return Array.from({length:this.lease.preferredRows(columns,2000)},()=>({text:""}));}catch{this.lease.dispose();return[{text:"Controller unavailable"}];}}
  handle(input:UiControllerInput){return this.lease.handle(input);}
  interactiveRow(row:number){try{return this.lease.pointer(row,0)!=="default";}catch{return false;}}
  get review(){return (this.lease.snapshot() as {review?:boolean}|undefined)?.review===true;}
  clear(){this.lease.dispose();}
}
