import type {CorePlugin} from '@agent-compositor/core';
import type {HooksApi} from '@agent-compositor/hooks';
import {atomicJson,type ProjectStorage} from '@agent-compositor/config';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const suggestions=[
 {name:'project-checks',label:'Project checks',reason:'Find and run project scripts with normal command permissions.',coding:true},
 {name:'test-reports',label:'Test reports',reason:'Read test failures and inspect individual diagnostics.'},
 {name:'checkpoint-history',label:'Change review',reason:'Inspect agent changes and restore earlier checkpoints.'},
 {name:'web',label:'Web research',reason:'Search and fetch public information.',research:true},
 {name:'resources',label:'Resource monitor',reason:'View CPU and memory without calling a model.'},
 {name:'btw',label:'Side conversation',reason:'Chat alongside the main task; needs agent-hub and model usage.'},
 {name:'auto-approve',label:'Automatic approval review',reason:'Optional model reviews; use /auto on after reload. Uncertain actions still ask.'},
];
type ModelStatus={configured:boolean;profile:string;model:string};
type Dependencies={
 model:()=>Promise<ModelStatus>;
 configure:($:HooksApi)=>Promise<void>;
 enabled:()=>string[];
 loaded:()=>string[];
 activationRestriction:(name:string)=>string|undefined;
 sideConversationAvailable:()=>boolean;
 control:(args:unknown,signal:AbortSignal)=>Promise<{ok:boolean;data?:any;error?:string}>;
};

/** A deterministic first-run guide. Nothing is installed, activated or queried by showing it. */
export function setupGuide(storage:ProjectStorage,deps:Dependencies){
 type GuideState={visible:boolean;revision:number;changed:string[];notes:string[]};
 const file=join(storage.paths.home,'setup.json'),sessions=new Map<string,GuideState>();
 const guide=($:HooksApi)=>{let value=sessions.get($.session.id);if(!value){value={visible:false,revision:0,changed:[],notes:[]};sessions.set($.session.id,value);}return value;};
 const state=async():Promise<{status?:'complete'|'skipped';invalid?:boolean}>=>{
  let text:string;
  try{text=await readFile(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{};throw error;}
  let saved:unknown;
  try{saved=JSON.parse(text);}catch{return{invalid:true};}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return{invalid:true};
  const record=saved as Record<string,unknown>;
  if(record.version!==1||(record.status!=='complete'&&record.status!=='skipped'))return{invalid:true};
  return{status:record.status};
 };
 const pending=()=>{const enabled=deps.enabled(),loaded=deps.loaded();return suggestions.map(item=>item.name).filter(name=>enabled.includes(name)&&!loaded.includes(name));};
 const show=async($:HooksApi,focus=true)=>{
  const current=guide($);current.visible=true;const revision=++current.revision,[model,saved]=await Promise.all([deps.model(),state()]);
  if(!current.visible||current.revision!==revision||sessions.get($.session.id)!==current||$.signal.aborted)return;
  const waiting=pending(),enabled=deps.enabled();
  await $.ui.view('setup','Get started',{hint:'No model is needed for this guide. You choose what to configure and install.',lines:[
   {text:'Connect a model, choose tools, then start a task.',bold:true},
   ...(saved.invalid?[{text:'Saved setup status is invalid. Finish or skip to replace it.',tone:'warning' as const}]:[]),
   {text:model.configured?`Model selected: ${model.profile} · ${model.model}`:'Model: choose a connection before sending a task',tone:model.configured?'accent':'warning'},
   {text:'[ Set up model ]',action:'model',tone:'accent'},
   {text:`Tools: ${deps.loaded().filter(name=>suggestions.some(item=>item.name===name)).length} suggested plugins active`},
   {text:'[ Choose recommended tools ]',action:'tools'},
   ...(waiting.length?[{text:`Apply pending tools: ${waiting.join(', ')}`,tone:'warning' as const},{text:'[ Apply plugin changes ]',action:'navigate:reload'}]:[]),
   {text:'[ Start chatting ]',action:'finish',tone:'accent'},
   {text:'[ Skip for now ]',action:'skip'},
   ...current.notes.filter(text=>!text.startsWith('auto-approve: after applying changes,')||enabled.includes('auto-approve')).map(text=>({text:current.changed.some(name=>!enabled.includes(name)&&text===`${name}: selected for this project`)?text.replace(': selected for this project',': no longer enabled'):text,tone:'muted' as const})),
   {text:'[ Models & providers ]',action:'navigate:settings'},
   {text:'[ All plugins and marketplace ]',action:'navigate:extensions'},
   {text:'You can reopen this guide with /setup. No connection is tested until you request it.',tone:'muted'},
  ]},{site:'sidebar',size:.6,focus});
 };
 const tools=async($:HooksApi)=>{
  const current=guide($);
  const goal=await $.ui.form({title:'Choose your work',description:'Recommendations are optional. Existing plugins and settings are kept.',fields:[{id:'work',label:'Main use',type:'select',value:'coding',options:[{value:'coding',label:'Code and tests'},{value:'research',label:'Read and research'},{value:'chat',label:'Chat without extra tools'}]}],actions:[{id:'next',label:'Continue'},{id:'cancel',label:'Cancel'}]});
  $.signal.throwIfAborted();
  if(!goal||goal.action!=='next')return;
  const options=suggestions.filter(item=>!deps.enabled().includes(item.name));
  if(!options.length){current.notes=['All suggested tools are already enabled. Existing installations were kept.'];return;}
  const selected=await $.ui.form({title:'Choose optional tools',description:'Checked plugins will be installed if needed and enabled for this project. Downloads may be required. Existing active plugins are kept; manage them in All plugins.',fields:options.map(item=>({id:item.name,label:`${item.label} · ${item.name}`,type:'toggle' as const,value:!deps.activationRestriction(item.name)&&((goal.values.work==='coding'&&item.coding===true)||(goal.values.work==='research'&&item.research===true)),hint:deps.activationRestriction(item.name)??(item.name==='btw'&&!deps.sideConversationAvailable()?'agent-hub is unavailable. Enable it in project configuration and restart; /btw --once still works.':item.reason)})),actions:[{id:'apply',label:'Install and enable selected'},{id:'cancel',label:'Cancel'}]});
  $.signal.throwIfAborted();
  if(!selected||selected.action!=='apply')return;
  const names=options.filter(item=>selected.values[item.name]===true).map(item=>item.name);if(!names.length){current.notes=['No optional tools selected. You can add them later.'];return;}
  current.notes=[];
  const allowed=names.filter(name=>{const restriction=deps.activationRestriction(name);if(restriction)current.notes.push(`${name}: ${restriction}`);return !restriction;});
  if(!allowed.length)return;
  const inventory=await deps.control({action:'list'},$.signal);$.signal.throwIfAborted();if(!inventory.ok)throw Error(inventory.error??'Could not list available plugins');
  for(const name of allowed){
   $.signal.throwIfAborted();
   if(deps.enabled().includes(name)){current.notes.push(`${name}: already enabled; installation kept`);continue;}
   let installedNow=false;
   try{
    const local=inventory.data?.available?.some((row:any)=>row.name===name&&!row.bundled);
    if(!inventory.data?.installed?.[name]&&!local){const installed=await deps.control({action:'install',name:name+'@agent-compositor',scope:'project'},$.signal);if(!installed.ok)throw Error(installed.error??'Installation failed');installedNow=true;if($.signal.aborted){current.notes.push(`${name}: installed; activation cancelled`);$.signal.throwIfAborted();}}
    const enabled=await deps.control({action:'enable',name,scope:'project'},$.signal);if(!enabled.ok)throw Error(enabled.error??'Activation failed');
    current.changed=[...new Set([...current.changed,name])];current.notes.push(`${name}: selected for this project`);
    if(name==='btw'&&!deps.sideConversationAvailable())current.notes.push('btw: side conversations need agent-hub enabled in project configuration and an app restart; /btw --once remains available');
    if(name==='auto-approve')current.notes.push('auto-approve: after applying changes, use /auto on. Reviews use a model; uncertain actions still ask.');
    $.signal.throwIfAborted();
   }catch(error){$.signal.throwIfAborted();current.notes.push(`${name}: ${installedNow?'installed; enable reported an error: ':''}${error instanceof Error?error.message:String(error)}`);}
  }
 };
 const plugin:CorePlugin={manifest:{name:'setup-guide',version:'1.0.0',trust:'trusted',hookTimeouts:{'ui.press':300000,'service.extension.control':300000}},hooks:{
  'prompt.submit':async(event,$)=>{if(event.text.trim()!=='/setup')return;await show($);return{drop:'setup-guide: handled'};},
  'ui.press':async(event,$)=>{
   if(event.site!=='plugin-setup-guide-setup')return;
   const current=guide($);
   if(event.key==='close'){current.visible=false;current.revision++;return;}
   try{
    if(event.key==='model')await deps.configure($);
    else if(event.key==='tools')await tools($);
    else if(event.key==='finish'||event.key==='skip'){
     if(event.key==='finish'){const model=await deps.model();$.signal.throwIfAborted();if(!model.configured){await $.ui.notify('Set up a model or choose Skip for now.','warn');return;}}
     if(event.key==='finish'&&pending().length){await $.ui.notify('Apply plugin changes before starting, or choose Skip for now.','warn');await show($,false);return;}
     $.signal.throwIfAborted();
     await atomicJson(file,{version:1,status:event.key==='finish'?'complete':'skipped'});current.visible=false;current.revision++;await $.ui.remove('setup');
     await $.ui.notify(event.key==='finish'?'Ready. Enter a task in the main message box.':'Setup skipped. Reopen it with /setup.');return;
    }
    await show($);
   }catch(error){$.signal.throwIfAborted();current.notes=[`Setup needs attention: ${error instanceof Error?error.message:String(error)}`];await show($);}
  },
  'session.reload':async(_,$)=>{if(guide($).visible)await show($,false);},
  'session.end':async(_,$)=>{sessions.delete($.session.id);},
  'service.extension.control':async(event,$)=>{
   const result=await $.next();
   if(['enable','disable','remove'].includes(event.action)&&result&&typeof result==='object'&&'value'in result&&guide($).visible&&!$.signal.aborted){
    try{await show($,false);}catch{/* A view refresh must not change the completed management result. */}
   }
   return result;
  },
 }};
 return{plugin,shouldOffer:async()=>!(await state()).status&&!(await deps.model()).configured};
}
