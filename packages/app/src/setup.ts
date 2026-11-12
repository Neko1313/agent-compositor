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
];
type ModelStatus={configured:boolean;profile:string;model:string};
type Dependencies={
 model:()=>Promise<ModelStatus>;
 configure:($:HooksApi)=>Promise<void>;
 enabled:()=>string[];
 loaded:()=>string[];
 control:(args:unknown,signal:AbortSignal)=>Promise<{ok:boolean;data?:any;error?:string}>;
};

/** A deterministic first-run guide. Nothing is installed, activated or queried by showing it. */
export function setupGuide(storage:ProjectStorage,deps:Dependencies){
 const file=join(storage.paths.home,'setup.json');let visible=false,changed:string[]=[],notes:string[]=[];
 const state=async()=>readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return{};});
 const pending=()=>changed.filter(name=>!deps.loaded().includes(name));
 const show=async($:HooksApi,focus=true)=>{
  visible=true;const model=await deps.model(),waiting=pending();
  await $.ui.view('setup','Get started',{hint:'No model is needed for this guide. You choose what to configure and install.',lines:[
   {text:'Connect a model, choose tools, then start a task.',bold:true},
   {text:model.configured?`Model selected: ${model.profile} · ${model.model}`:'Model: choose a connection before sending a task',tone:model.configured?'accent':'warning'},
   {text:'[ Set up model ]',action:'model',tone:'accent'},
   {text:`Tools: ${deps.loaded().filter(name=>suggestions.some(item=>item.name===name)).length} suggested plugins active`},
   {text:'[ Choose recommended tools ]',action:'tools'},
   ...(waiting.length?[{text:`Apply pending tools: ${waiting.join(', ')}`,tone:'warning' as const},{text:'[ Apply plugin changes ]',action:'navigate:reload'}]:[]),
   ...notes.map(text=>({text,tone:'muted' as const})),
   {text:'[ Start chatting ]',action:'finish',tone:'accent'},
   {text:'[ Skip for now ]',action:'skip'},
   {text:'[ Models & providers ]',action:'navigate:settings'},
   {text:'[ All plugins and marketplace ]',action:'navigate:extensions'},
   {text:'You can reopen this guide with /setup. No connection is tested until you request it.',tone:'muted'},
  ]},{site:'sidebar',size:.6,focus});
 };
 const tools=async($:HooksApi)=>{
  const goal=await $.ui.form({title:'Choose your work',description:'Recommendations are optional. Existing plugins and settings are kept.',fields:[{id:'work',label:'Main use',type:'select',value:'coding',options:[{value:'coding',label:'Code and tests'},{value:'research',label:'Read and research'},{value:'chat',label:'Chat without extra tools'}]}],actions:[{id:'next',label:'Continue'},{id:'cancel',label:'Cancel'}]});
  if(!goal)return;
  const options=suggestions.filter(item=>!deps.enabled().includes(item.name));
  if(!options.length){notes=['All suggested tools are already enabled. Existing installations were kept.'];return;}
  const selected=await $.ui.form({title:'Choose optional tools',description:'Checked plugins will be installed if needed and enabled for this project. Downloads may be required. Existing active plugins are kept; manage them in All plugins.',fields:options.map(item=>({id:item.name,label:`${item.label} · ${item.name}`,type:'toggle' as const,value:(goal.values.work==='coding'&&item.coding===true)||(goal.values.work==='research'&&item.research===true),hint:item.reason})),actions:[{id:'apply',label:'Install and enable selected'},{id:'cancel',label:'Cancel'}]});
  if(!selected)return;
  const names=options.filter(item=>selected.values[item.name]===true).map(item=>item.name);if(!names.length){notes=['No optional tools selected. You can add them later.'];return;}
  const inventory=await deps.control({action:'list'},$.signal);if(!inventory.ok)throw Error(inventory.error??'Could not list available plugins');
  notes=[];
  for(const name of names){
   if(deps.enabled().includes(name)){notes.push(`${name}: already enabled; installation kept`);continue;}
   try{
    const local=inventory.data?.available?.some((row:any)=>row.name===name&&!row.bundled);
    if(!inventory.data?.installed?.[name]&&!local){const installed=await deps.control({action:'install',name:name+'@agent-compositor',scope:'project'},$.signal);if(!installed.ok)throw Error(installed.error??'Installation failed');}
    const enabled=await deps.control({action:'enable',name,scope:'project'},$.signal);if(!enabled.ok)throw Error(enabled.error??'Activation failed');
    changed=[...new Set([...changed,name])];notes.push(`${name}: selected for this project`);
   }catch(error){notes.push(`${name}: ${error instanceof Error?error.message:String(error)}`);}
  }
 };
 const plugin:CorePlugin={manifest:{name:'setup-guide',version:'1.0.0',trust:'trusted',hookTimeouts:{'ui.press':300000}},hooks:{
  'prompt.submit':async(event,$)=>{if(event.text.trim()!=='/setup')return;await show($);return{drop:'setup-guide: handled'};},
  'ui.press':async(event,$)=>{
   if(event.site!=='plugin-setup-guide-setup')return;
   if(event.key==='close'){visible=false;return;}
   try{
    if(event.key==='model')await deps.configure($);
    else if(event.key==='tools')await tools($);
    else if(event.key==='finish'||event.key==='skip'){
     if(event.key==='finish'&&!(await deps.model()).configured){await $.ui.notify('Set up a model or choose Skip for now.','warn');return;}
     if(event.key==='finish'&&pending().length){await $.ui.notify('Apply plugin changes before starting, or choose Skip for now.','warn');return;}
     await atomicJson(file,{version:1,status:event.key==='finish'?'complete':'skipped'});visible=false;await $.ui.remove('setup');
     await $.ui.notify(event.key==='finish'?'Ready. Enter a task in the main message box.':'Setup skipped. Reopen it with /setup.');return;
    }
    await show($);
   }catch(error){notes=[`Setup needs attention: ${error instanceof Error?error.message:String(error)}`];await show($);}
  },
  'session.reload':async(_,$)=>{if(visible)await show($,false);},
 }};
 return{plugin,shouldOffer:async()=>!(await state()).status&&!(await deps.model()).configured};
}
