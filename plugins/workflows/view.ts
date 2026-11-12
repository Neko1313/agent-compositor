import {createHash} from 'node:crypto';
import type {UiTextView} from '@agent-compositor/events';
import type {Run,Stage} from './engine.js';

export type WorkflowViewState={mode:'overview'|'stages';filter:'all'|'running'|'attention';expanded:string[];runId?:string;stageId?:string;page:number};
export const initialViewState:WorkflowViewState={mode:'overview',filter:'all',expanded:[],page:0};
const PAGE_SIZE=100;
export const stageAction=(id:string)=>'stage:'+createHash('sha256').update(id).digest('hex').slice(0,56);
const title=(value:unknown,fallback:string)=>typeof value==='string'?value:fallback;
const chunks=(value:string):UiTextView['lines']=>{
 const result:UiTextView['lines']=[];
 let part='';
 for(const point of value){if(part.length+point.length>10000){result.push({text:part});part='';}part+=point;}
 if(part)result.push({text:part});
 return result;
};
const pagination=(count:number,page:number)=>{
 const pages=Math.max(1,Math.ceil(count/PAGE_SIZE)),current=Math.max(0,Math.min(page,pages-1));
 return{start:current*PAGE_SIZE,page:current,lines:[
  {text:`Page ${current+1}/${pages} · ${count} items`,tone:'muted' as const},
  ...(current>0?[{text:'[ Previous page ]',action:'previous'}]:[]),
  ...(current+1<pages?[{text:'[ Next page ]',action:'next'}]:[]),
 ]};
};
function stageDetails(stage:Stage):UiTextView['lines']{
 return[
  {text:`Stage: ${title(stage.title,stage.id)}`.slice(0,10000),bold:true},
  {text:`ID: ${stage.id}`},{text:`Agent: ${stage.agentId??'not started'}`},
  ...chunks(`Depends on: ${(stage.dependsOn??[]).join(', ')||'none'}`),
  {text:`Profile: ${stage.profile??'workflow default'} · Attempts: ${stage.attempts??0} · ${stage.tokens??0} accounted tokens`},
  ...(stage.activity?[{text:`${stage.status==='running'?'Activity':'Last activity'}: ${stage.activity}`.slice(0,10000)}]:[]),
  ...(['failed','stopped'].includes(stage.status??'')?[{text:'[ Retry selected stage ]',action:'retry',tone:'accent' as const}]:[]),
  {text:'Prompt',bold:true},...chunks(stage.prompt),
  {text:stage.error?'Error':'Output',bold:true},
  ...chunks(stage.error??stage.output??(stage.status==='skipped'?'No output: stage skipped.':'Waiting for a result')),
 ];
}

/** Pure semantic views; the plugin owns navigation and the engine owns execution. */
export function workflowView(runs:Run[],state:WorkflowViewState,withTabs=false):UiTextView{
 const common:UiTextView['lines']=[{text:'Dynamic workflows',bold:true},{text:'[ Refresh ]',action:'refresh'}];
 const run=runs.find(run=>run.id===state.runId);
 if(state.mode==='stages'&&run){
  const page=pagination(run.stages.length,state.page);
  return{hint:'Enter or click a stage to expand. All runs returns to the overview.',lines:[
   ...common,{text:'[ All runs ]',action:'back',tone:'accent'},
   {text:`${run.title} · ${run.status}`,bold:true},
   {text:`${run.stages.reduce((n,stage)=>n+(stage.tokens??0),0)} accounted tokens · ${run.concurrency} workers max`,tone:'muted'},
   ...(run.error?chunks(run.error).map(line=>({...line,tone:'warning' as const})):[]),
   ...(run.status==='completed'?[]:[{text:run.status==='running'?'[ Pause scheduling ]':'[ Resume workflow ]',action:run.status==='running'?'pause':'resume',tone:'accent' as const},{text:'[ Stop workflow ]',action:'stop',tone:'danger' as const}]),
   ...page.lines,
  ],table:{columns:[{label:'Stage',width:26},{label:'State',width:12},{label:'Attempt',width:7},{label:'Tokens',width:10}],rows:run.stages.slice(page.start,page.start+PAGE_SIZE).map(stage=>({
   id:stage.id,cells:[title(stage.title,stage.id).slice(0,500),stage.status??'pending',String(stage.attempts??0),String(stage.tokens??0)],
   action:stageAction(stage.id),expanded:state.stageId===stage.id,
   tone:stage.status==='failed'?'danger':stage.status==='running'?'accent':undefined,
   details:state.stageId===stage.id?stageDetails(stage):[{text:'Open this stage to inspect its prompt and result.'}],
  })),empty:'No stages.'}};
 }
 const visible=runs.filter(run=>state.filter==='all'||(state.filter==='running'?run.status==='running':['failed','paused','stopped'].includes(run.status)));
 const page=pagination(visible.length,state.page);
 return{...(withTabs?{tabs:[
  {id:'all',label:`All (${runs.length})`,action:'filter:all',selected:state.filter==='all'},
  {id:'running',label:`Running (${runs.filter(run=>run.status==='running').length})`,action:'filter:running',selected:state.filter==='running'},
  {id:'attention',label:`Attention (${runs.filter(run=>['failed','paused','stopped'].includes(run.status)).length})`,action:'filter:attention',selected:state.filter==='attention'},
 ]}:{}),hint:withTabs?'Left/Right switches tabs · Enter or click a run to expand · Inspect stages opens its stage table':'Enter or click a run to expand. Inspect stages opens its live stage table.',lines:[...common,
  ...(!withTabs?[{text:`[ View: ${state.filter==='all'?'All':state.filter==='running'?'Running':'Needs attention'} · ${visible.length}/${runs.length} ]`,action:'filter',tone:'accent' as const}]:[]),
  {text:'[ Legacy Python journals ]',action:'legacy'},...page.lines,
 ],table:{columns:[{label:'Workflow',width:28},{label:'State',width:12},{label:'Progress',width:10}],empty:'No runs match this view. Change View or start a workflow.',rows:visible.slice(page.start,page.start+PAGE_SIZE).map(run=>({
  id:run.id,cells:[run.title.slice(0,500),run.status,`${run.stages.filter(stage=>stage.status==='completed').length}/${run.stages.length}`],
  action:'run:'+run.id,expanded:state.expanded.includes(run.id),
  tone:run.status==='failed'?'danger':run.status==='running'?'accent':undefined,
  details:[{text:`Workflow: ${run.title}`,bold:true},{text:`ID: ${run.id}`},
   {text:`${run.stages.reduce((sum,stage)=>sum+(stage.tokens??0),0)} accounted tokens · ${run.concurrency} workers max`},
   ...(run.error?chunks(run.error).map(line=>({...line,tone:'warning' as const})):[]),
   {text:'[ Inspect stages ]',action:'inspect:'+run.id,tone:'accent'},
  ],
 }))}};
}
