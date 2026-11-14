import {randomUUID} from 'node:crypto';
import {inputMessage} from '@agent-compositor/protocol';
import type {HooksApi} from '@agent-compositor/hooks';
import type {ControllerInput,WindowController} from '@agent-compositor/renderer-opentui';
import type {SessionHistoryBinding} from './sessions.js';

function immutable<T>(value:T):T {
  if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))immutable(child);}
  return value;
}

/** The history lease and its callable capabilities remain in the application. */
export function createOpenTuiHistoryController(options:{
  binding:SessionHistoryBinding;
  signal:AbortSignal;
  current():boolean;
  changed():void;
  captureIntent():number;
  inputScope(intent:number,signal:AbortSignal,run:(api:HooksApi)=>Promise<void>):Promise<void>;
  failed(cancelled:boolean):void;
}) {
  const lease=options.binding.lease,id=randomUUID();
  let active=true,columns=80,rows=20,revision=0,sequence=0,inputRevision=0;
  let state:WindowController|undefined,tail=Promise.resolve();
  const live=()=>active&&options.current()&&!options.signal.aborted&&!lease.signal.aborted;
  function fail(cancelled:boolean){if(!active)return;active=false;lease.dispose();options.failed(cancelled);}
  function render(){
    if(!live())return;
    try{
      const preferredRows=lease.preferredRows(columns,rows),view=lease.render(columns,rows);
      if(!live())return;
      state=immutable({id,kind:'history',revision:++revision,inputRevision,preferredRows,view});options.changed();
    }catch{fail(lease.signal.aborted||options.signal.aborted);}
  }
  function normalized(input:ControllerInput):ControllerInput|undefined {
    if(!state||!input||typeof input!=='object')return;
    if(input.kind==='action'){
      const actions=[...state.view.lines.map(row=>row.action),
        ...(state.view.tabs??[]).filter(tab=>!tab.disabled).map(tab=>tab.action),
        ...(state.view.table?.rows??[]).flatMap(row=>[row.action,...(row.expanded?row.details??[]:[]).map(line=>line.action)])];
      return typeof input.action==='string'&&actions.includes(input.action)?{kind:'action',action:input.action}:undefined;
    }
    if(input.kind==='change')return input.id===state.view.input?.id&&typeof input.value==='string'&&input.value.length<=4000
      ?{kind:'change',id:input.id,value:input.value}:undefined;
    // History keeps the reference host's semantic action/change contract.
    if(input.kind==='text'||input.kind==='mouse')return;
    const result=inputMessage.safeParse({type:'input',surface:id,data:input});
    if(!result.success)return;
    const value=result.data.data;
    if(value.kind==='mouse'&&(value.col>=columns||value.row>=rows))return;
    return value;
  }
  async function execute(input:ControllerInput,ticket:number,intent:number){
    if(!live())return;
    try{
      await options.inputScope(intent,lease.signal,async api=>{
        if(!live())return;
        await options.binding.input(input.kind==='key'?{kind:'action',action:input.key}:input,api);
      });
      if(!live())return;
      inputRevision=ticket;render();
    }catch{if(live())fail(false);}
  }
  lease.signal.addEventListener('abort',()=>fail(true),{once:true});
  if(lease.signal.aborted)fail(true);else render();
  return {
    snapshot:()=>state,
    update:render,
    input(input:ControllerInput,expected:number){
      if(!live()||state?.revision!==expected)return;
      const value=normalized(input);if(!value)return;
      const intent=options.captureIntent(),ticket=++sequence;
      tail=tail.then(()=>execute(value,ticket,intent));void tail.catch(()=>{});return ticket;
    },
    viewport(nextColumns:number,nextRows:number){
      if(!active||!Number.isInteger(nextColumns)||!Number.isInteger(nextRows)||nextColumns<1||nextRows<1
        ||nextColumns>10000||nextRows>10000||columns===nextColumns&&rows===nextRows)return;
      columns=nextColumns;rows=nextRows;render();
    },
    close(){if(active){active=false;lease.dispose();}},
  };
}
