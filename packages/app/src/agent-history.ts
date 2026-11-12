import type { SessionEvent } from '@agent-compositor/session';
import type { UiTextView } from '@agent-compositor/events';

const types=new Set(['prompt.submit','prompt.steer','turn.start','turn.complete','turn.failed','turn.interrupted','turn.usage','tool.call','tool.result']);
const pageSize=25,detailSize=8000;
type HistoryState={events:SessionEvent[];filter:'all'|'turns'|'tools';page:number;selected?:number;detail:number;error?:string;visible:boolean;revision:number;loading:boolean};
const cut=(text:string,limit:number)=>Array.from(text).slice(0,limit).join('');

/** Snapshot reader: no model/context mutation and no background storage polling. */
export function agentHistory(read:()=>Promise<SessionEvent[]>,publish:(view:UiTextView,focus:boolean)=>Promise<unknown>){
 const state:HistoryState={events:[],filter:'all',page:0,detail:0,visible:false,revision:0,loading:false};
 const matches=()=>state.events.map((event,index)=>({event,index})).filter(({event})=>types.has(event.type)&&(state.filter==='all'||(state.filter==='tools'?event.type.startsWith('tool.'):!event.type.startsWith('tool.'))));
 async function paint(focus=false){
  if(!state.visible)return;
  const events=matches(),pages=Math.max(1,Math.ceil(events.length/pageSize));state.page=Math.max(0,Math.min(state.page,pages-1));
  const selected=state.selected===undefined?undefined:state.events[state.selected];
  const detail=selected?Array.from(JSON.stringify(selected,null,2)):[],parts=Math.max(1,Math.ceil(detail.length/detailSize));state.detail=Math.max(0,Math.min(state.detail,parts-1));
  await publish({scrollKeys:'host',hint:'Click or Enter expands a record · PgUp/PgDn scroll · Refresh reads saved activity',
   tabs:([{id:'all',label:'All',action:'filter:all'},{id:'turns',label:'Turns',action:'filter:turns'},{id:'tools',label:'Tools',action:'filter:tools'}]).map(tab=>({...tab,selected:tab.id===state.filter})),
   lines:[
    {text:`Saved activity · ${events.length} records · Page ${state.page+1}/${pages}`,bold:true},
    {text:state.loading?'Reading saved activity…':'[ Refresh history ]',...(state.loading?{}:{action:'refresh'}),tone:'accent'},
    {text:'[ Open conversation ]',action:'conversation'},{text:'[ Agent overview ]',action:'overview'},
    ...(state.error?[{text:state.error,tone:'danger' as const}]:[]),
    ...(state.page>0?[{text:'[ Previous records ]',action:'previous'}]:[]),
    ...(state.page+1<pages?[{text:'[ Next records ]',action:'next'}]:[]),
   ],table:{columns:[{label:'#',width:6},{label:'Event',width:20},{label:'Tool',width:20},{label:'Outcome',width:10}],empty:'No saved activity matches this tab.',
    rows:events.slice(state.page*pageSize,(state.page+1)*pageSize).map(({event,index})=>({id:String(index),cells:[String(index+1),event.type,cut(String(event.tool??''),500),event.type==='tool.result'?(event.denied?'denied':event.ok?'ok':'failed'):event.type==='turn.failed'?'failed':''],action:'event:'+index,expanded:state.selected===index,
     tone:event.ok===false||event.type==='turn.failed'?'danger' as const:undefined,
     ...(state.selected===index?{details:[{text:`Record ${index+1} · Part ${state.detail+1}/${parts}`,bold:true},
      ...(state.detail>0?[{text:'[ Previous part ]',action:'detail:previous'}]:[]),
      ...(state.detail+1<parts?[{text:'[ Next part ]',action:'detail:next'}]:[]),
      {text:detail.slice(state.detail*detailSize,(state.detail+1)*detailSize).join('')},
     ]}:{details:[{text:'Expand to inspect this saved record.'}]}),
    })),
   },
  },focus);
 }
 async function refresh(focus=false,latest=false){
  const revision=++state.revision;state.visible=true;state.loading=true;await paint(focus);if(!state.visible||revision!==state.revision)return;
  try{const events=await read();if(!state.visible||revision!==state.revision)return;state.events=events;state.error=undefined;if(latest)state.page=Math.max(0,Math.ceil(matches().length/pageSize)-1);}
  catch(error){if(!state.visible||revision!==state.revision)return;state.error=cut(`Could not read saved activity. Retry Refresh history. ${String(error)}`,1000);}
  state.loading=false;await paint(focus);
 }
 return{
  open:()=>refresh(true,true),
  close:()=>{state.visible=false;state.revision++;},
  async press(key:string){
   if(key==='close'){state.visible=false;state.revision++;return;}
   if(key==='refresh'){await refresh();return;}
   if(['filter:all','filter:turns','filter:tools'].includes(key)){state.filter=key.slice(7) as HistoryState['filter'];state.page=0;state.selected=undefined;state.detail=0;}
   else if(key==='previous'||key==='next'){state.page+=key==='next'?1:-1;state.selected=undefined;state.detail=0;}
   else if(key.startsWith('event:')){const index=Number(key.slice(6));if(!matches().slice(state.page*pageSize,(state.page+1)*pageSize).some(record=>record.index===index))return;state.selected=state.selected===index?undefined:index;state.detail=0;}
   else if(key==='detail:next'||key==='detail:previous'){state.detail+=key==='detail:next'?1:-1;}
   else return;
   await paint();
  },
 };
}
