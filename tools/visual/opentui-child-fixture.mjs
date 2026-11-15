import {appendFile,mkdir,realpath,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {seedOpenTuiControllersFixture} from './opentui-controllers-fixture.mjs';

/** Ordinary Core delegation and persistent-manager entry points, never synthetic request frames. */
export async function seedOpenTuiChildFixture(cwd,paths){
 const composition=process.env.VISUAL_OPENTUI_CHILD_COMPOSITION??'native',effectRoot=await realpath(cwd);
 if(!['native','selected'].includes(composition))throw Error('Unknown child composition');
 const selectedFixture=composition==='selected'?await seedOpenTuiControllersFixture(cwd,paths):undefined;
 if(selectedFixture)await appendFile(join(cwd,'plugins',selectedFixture.provider,'hooks.js'),String.raw`
// Observe the original factory without changing its frame, handler, input or lifetime.
for(const [kind,factory]of Object.entries(controllers))controllers[kind]=(request,context)=>{
 const controller=factory(request,context),render=controller.render;let observed=false;
 controller.render=function(...args){const view=render.apply(this,args);if(!observed){
  const id=view.lines.find(line=>line.text.startsWith('Lease: '))?.text.slice(7);if(id){observed=true;
   record({event:'child-factory-bound',id,kind,tool:request.data?.tool,path:request.data?.input?.path,title:request.data?.title});}
 }return view;};return controller;
};
`);
 const directory=join(cwd,'plugins','child-proof'),state=join(cwd,'.agent-compositor','child-proof');await mkdir(directory,{recursive:true});await mkdir(state,{recursive:true});
 const trace=join(state,'trace.jsonl'),publicTrace=join(state,'public.jsonl'),active=join(state,'active.json'),managed=join(state,'managed.json');
 await writeFile(trace,'');await writeFile(publicTrace,'');
 await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'child-proof',version:'1.0.0',trust:'trusted',main:'hooks.js',commands:[{name:'/child-proof',description:'Isolated real child routing probe',execution:'immediate'}],hookTimeouts:{'ui.press':300000,'command.invoke':300000,'prompt.submit':300000}}));
 await writeFile(join(directory,'hooks.js'),String.raw`
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const trace=TRACE_PATH,publicTrace=PUBLIC_PATH,active=ACTIVE_PATH,managed=MANAGED_PATH;
const record=(event,extra={})=>appendFileSync(trace,JSON.stringify({at:Date.now(),event,...extra})+'\n');
const read=path=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{return undefined;}};
const digest=text=>createHash('sha256').update(text).digest('hex');
const labels=[['spawn-five','Start five sibling questions'],['spawn-approvals','Start two sibling approvals'],['spawn-form','Start child private form'],['settings','Open independent settings'],['background','Start background child'],['detached','Start detached child'],['resume','Resume current Main'],['disable-selected','Disable selected owner'],['enable-selected','Enable selected owner'],['managed-create','Create managed proof'],['managed-question','Ask managed first question'],['managed-later','Ask managed later question'],['managed-form','Open managed private form'],['managed-nested','Start managed nested child'],['managed-close','Close managed proof'],['managed-create-last','Create managed shutdown proof'],['managed-last-form','Open managed shutdown form']];
async function show($){await $.ui.view('controls','Child controls',{lines:labels.map(([action,text])=>({text,action}))},{site:'inspector',focus:false});}
async function spawn($,kind,count=1,mode='ordinary'){
 const work=Array.from({length:count},async(_,index)=>{
  const tag=kind+'_'+index,prompt='CHILD_'+tag;
  record('child-launch',{tag,mode,parentSession:$.session.id});
  try{const result=mode==='background'?await $.background().agent.tool('task',{prompt}):await $.emit('service.agent.spawn',{prompt,agentId:'same-alias',...(mode==='detached'?{detached:true}:{})});
   record('child-result',{tag,mode,ok:true,value:result});
  }catch(error){record('child-result',{tag,mode,ok:false,error:String(error)});}
 });
 if(mode==='ordinary')await Promise.all(work);else{void Promise.all(work).catch(()=>{});record('launcher-settled',{mode});}
}
async function control(action,$){
 record('control',{action,sessionId:$.session.id});
 if(action==='missing-return'){await $.ui.view('missing','Missing input proof',{input:{id:'missing-next',label:'Reply',value:'SERVER_MISSING',submitAction:'commit-missing'},lines:[{text:'Commit missing input',action:'commit-missing'}]},{site:'inspector',focus:false});return;}
 if(action==='missing'){await $.ui.view('missing','Missing input proof',{input:{id:'missing-first',label:'Reply',value:'',submitAction:'commit-missing'},lines:[{text:'Commit missing input',action:'commit-missing'}]},{site:'inspector',focus:false});return;}
 if(action==='conflict'){await $.ui.view('conflict','Conflict proof',{input:{id:'conflict-first',label:'Reply',value:'',submitAction:'commit-conflict'},lines:[{text:'Commit conflict input',action:'commit-conflict'}]},{site:'inspector',focus:false});return;}
 if(action==='repaint'){await $.ui.view('repaint','Repaint proof',{input:{id:'repaint-input',label:'Reply',value:'',submitAction:'commit'},lines:[{text:'Commit repaint input',action:'commit'}]},{site:'inspector',focus:false});return;}
 if(action==='spawn-five')return spawn($,'SIBLING_Q',5);
 if(action==='spawn-approvals')return spawn($,'APPROVAL',2);
 if(action==='spawn-form')return spawn($,'FORM',1);
 if(action==='background'||action==='detached')return spawn($,action==='background'?'BACKGROUND_Q':'DETACHED_Q',1,action);
 if(action==='settings'){const value=await $.ui.form({title:'Independent child settings',fields:[{id:'name',label:'Name',type:'text',value:'SETTINGS_OK'},{id:'token',label:'Optional token',type:'password'}],actions:[{id:'save',label:'Save'}]});record('settings-result',{value});return;}
 if(action==='resume'){record('resume-started',{sessionId:$.session.id});await $.emit('service.session.control',{action:'resume',id:$.session.id});return;}
 if(action==='disable-selected'||action==='enable-selected'){const result=await $.agent.tool('extension_control',{action:action==='disable-selected'?'disable':'enable',name:'native-controller-proof',scope:'project'});record('extension-result',{action,result});return;}
 if(action==='managed-create'||action==='managed-create-last'){
  const result=await $.emit('service.agent.control',{action:'create',name:action==='managed-create'?'Managed proof':'Managed shutdown proof',worktree:false});
  if(!result.value?.id)throw Error('Managed create did not return a real registry identity');
  const data={...(read(managed)??{}),[action==='managed-create'?'first':'last']:result.value.id};writeFileSync(managed,JSON.stringify(data));record('managed-created',{which:action,id:result.value.id,record:result.value});return;
 }
 if(action.startsWith('managed-')){
  const ids=read(managed),id=action==='managed-last-form'?ids?.last:ids?.first;if(!id)throw Error('No managed agent identity');
  const prompt=action==='managed-question'?'MANAGED_QUESTION_FIRST':action==='managed-later'?'MANAGED_QUESTION_LATER':action==='managed-nested'?'MANAGED_NESTED':action==='managed-last-form'?'CHILD_FORM_MANAGED_LAST':'CHILD_FORM_MANAGED';
  const result=await $.emit('service.agent.control',action==='managed-close'?{action:'archive',id}:{action:'send',id,prompt});record('managed-control',{action,id,result});return;
 }
 throw Error('Unknown child action');
}
export default {
 'session.start':async(_,$)=>{const old=read(active);if(old&&old.id!==$.session.id)return;const data={id:$.session.id,generation:(old?.generation??0)+1};writeFileSync(active,JSON.stringify(data));record('main-started',data);await show($);},
 'session.reload':async(_,$)=>{if(read(active)?.id!==$.session.id)return;record('main-reloaded',{sessionId:$.session.id});await show($);},
 'command.invoke':async(event,$)=>control(event.args.trim(),$),
 'ui.press':async(event,$)=>{if(event.site==='plugin-child-proof-controls')return control(event.key,$);if(event.site==='plugin-child-proof-missing'&&event.key==='commit-missing'){await new Promise(done=>setTimeout(done,250));await $.ui.view('missing','Missing input proof',{lines:[{text:'FIELD MISSING'}]});return;}if(event.site==='plugin-child-proof-conflict'&&event.key==='commit-conflict'){await new Promise(done=>setTimeout(done,250));await $.ui.view('conflict','Conflict proof',{input:{id:'conflict-next',label:'Reply',value:'SERVER_CONFLICT',submitAction:'commit-conflict'},lines:[{text:'Commit conflict input',action:'commit-conflict'}]},{site:'inspector',focus:false});return;}if(event.site==='plugin-child-proof-repaint'&&event.key==='commit'){await new Promise(done=>setTimeout(done,250));writeFileSync(managed+'.submitted',JSON.stringify($.state.get('repaint')??''));}},
 'prompt.submit':async(event,$)=>{
  const tag=event.text;if(!tag.startsWith('CHILD_')&&!tag.startsWith('MANAGED_'))return;
  record('producer-prompt',{tag,sessionId:$.session.id});$.signal.addEventListener('abort',()=>record('producer-aborted',{tag,sessionId:$.session.id}),{once:true});
  if(!tag.startsWith('CHILD_FORM'))return;
  try{const value=await $.ui.form({title:'Child local form',fields:[{id:'name',label:'Private name',type:'text'},{id:'token',label:'Token',type:'password',required:true}],actions:[{id:'save',label:'Save'},{id:'cancel',label:'Cancel'}]});
   record('private-form-result',{tag,sessionId:$.session.id,value:value?{action:value.action,name:value.values.name,tokenLength:String(value.values.token??'').length,tokenHash:digest(String(value.values.token??''))}:null});
  }catch(error){record('private-form-result',{tag,sessionId:$.session.id,error:String(error)});}
  return{drop:'Child private form handled'};
 },
 'subagent.start':(event,$)=>record('subagent-start',{parentSession:$.session.id,agentId:event.agentId,prompt:event.prompt,depth:event.depth}),
 'subagent.complete':(event,$)=>record('subagent-complete',{parentSession:$.session.id,agentId:event.agentId,ok:event.ok}),
 'ui.change':async(event,$)=>{if(event.site==='plugin-child-proof-missing'){writeFileSync(managed+'.missing',JSON.stringify({id:event.id,value:event.value}));return;}if(event.site==='plugin-child-proof-conflict'){writeFileSync(managed+'.conflict',JSON.stringify({id:event.id,value:event.value}));return;}if(event.site!=='plugin-child-proof-repaint'||event.id!=='repaint-input')return;await new Promise(done=>setTimeout(done,12));$.state.set('repaint',event.value);writeFileSync(managed+'.repaint',JSON.stringify(event.value));await $.ui.view('repaint','Repaint proof',{input:{id:'repaint-input',label:'Reply',value:event.value,submitAction:'commit'},lines:[{text:'Commit repaint input',action:'commit'}]},{site:'inspector',focus:false});},
 'ui.render':event=>appendFileSync(publicTrace,JSON.stringify(event)+'\n'),
};
`.replace('TRACE_PATH',JSON.stringify(trace)).replace('PUBLIC_PATH',JSON.stringify(publicTrace)).replace('ACTIVE_PATH',JSON.stringify(active)).replace('MANAGED_PATH',JSON.stringify(managed)));
 return{composition,plugins:['child-proof','agent-hub','session-manager','extension-manager',...(selectedFixture?[selectedFixture.provider]:[])],selected:selectedFixture?.selected??{},trace,publicTrace,active,managed,selectedTrace:selectedFixture?.trace,
  controls:'plugin-child-proof-controls',rules:[{tool:'write',decision:'ask',reason:'Child writes require a distinct human decision'},{tool:'agent_control',decision:'allow'},...['enable','disable'].map(action=>({tool:'extension_control',command:action+' native-controller-proof  --project',decision:'allow'}))],
  effects:{allow:join(effectRoot,'child-effect-0.txt'),deny:join(effectRoot,'child-effect-1.txt')}};
}

/** Loopback deterministic provider; child dispatch still uses actual Core task/spawn. */
export function childModelResponse(prompt,body){
 const last=body.messages?.at(-1);let delta;
 if(last?.role==='tool')delta={content:'CHILD_FLOW_DONE '+prompt};
 else if(prompt==='REPLY_ENTER_PROOF')delta={content:'REPLY_ENTER_DONE'};
 else if(prompt==='APP_CHILD_SAVED')delta={content:'CHILD_SAVED_CONTEXT'};
 else if(prompt==='APP_CHILD_MAIN_HOLD')delta={tool_calls:[call('ask_user',{question:'MAIN_QUESTION: choose deployment',options:['Preview','Production'],allowOther:false})]};
 else if(prompt.startsWith('APP_CHILD_TASK_'))delta={tool_calls:[call('task',{prompt:'CHILD_'+prompt.slice('APP_CHILD_TASK_'.length)})]};
 else if(prompt==='MANAGED_NESTED'||prompt.startsWith('CHILD_NESTED'))delta={tool_calls:[call('task',{prompt:'CHILD_LEAF_Q'})]};
 else if(prompt.startsWith('CHILD_APPROVAL')){const index=prompt.endsWith('_1')?1:0;delta={tool_calls:[call('write',{path:'child-effect-'+index+'.txt',content:'CHILD_EFFECT_'+index+'\n'})]};}
 else if(prompt.startsWith('CHILD_QNAIRE'))delta={tool_calls:[call('ask_questions',{title:'CHILD_PRIVATE_QUESTIONNAIRE',questions:[{id:'checks',question:'CHILD_PRIVATE_CHECKS',options:['Unit','Browser'],multi:true,allowOther:true}]})]};
 else if(prompt.startsWith('CHILD_')||prompt.startsWith('MANAGED_'))delta={tool_calls:[call('ask_user',{question:'CHILD_PRIVATE_QUESTION '+prompt,options:['Local','Remote'],allowOther:false})]};
 else return new Response('Unexpected child fixture prompt',{status:400});
 return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:delta.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:2}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
}
function call(name,args){return{index:0,id:'same-child-provider-call-id',type:'function',function:{name,arguments:JSON.stringify(args)}};}
