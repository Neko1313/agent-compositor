import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SessionStore} from '../../packages/session/src/store.ts';

/** Only history and placement are selected; ordinary panes and observers have separate owners. */
export async function seedOpenTuiWorkspaceControllersFixture(cwd,paths){
  const provider='native-workspace-controller-proof',requester='workspace-request-probe',observer='workspace-observer';
  const trace=join(cwd,'.agent-compositor/workspace-controller-trace.jsonl'),events=join(cwd,'.agent-compositor/workspace-observer.jsonl');
  const gates=join(cwd,'.agent-compositor/workspace-controller-gates'),resume=join(gates,'resume.json');
  await mkdir(gates,{recursive:true});await writeFile(trace,'');await writeFile(events,'');
  for(const name of [provider,requester,observer])await mkdir(join(cwd,'plugins',name),{recursive:true});
  await writeFile(join(cwd,'plugins',provider,'plugin.json'),JSON.stringify({name:provider,version:'1.0.0',trust:'trusted',main:'hooks.js'}));
  await writeFile(join(cwd,'plugins',provider,'hooks.js'),String.raw`
import {appendFileSync,writeFileSync,watch} from 'node:fs';import {access} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const trace=TRACE_PATH,gates=GATES_PATH,resume=RESUME_PATH;
const record=value=>appendFileSync(trace,JSON.stringify({at:Date.now(),...value})+'\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
function gate(name){return new Promise((resolve,reject)=>{
  let settled=false;const finish=error=>{if(settled)return;settled=true;watcher.close();clearTimeout(deadline);error?reject(error):resolve();};
  const check=()=>access(join(gates,name)).then(()=>finish(),()=>{}),watcher=watch(gates,()=>{void check();});
  const deadline=setTimeout(()=>finish(Error('Workspace controller gate deadline')),60000);void check();
});}
const rich={text:'UNVALIDATED_CELL_FALLBACK',cells:[...('WORKSPACE 窗口')].map(ch=>({ch,fg:'#eac280',bg:'#171a20',bold:true}))};
function life(kind,ctx){const id=crypto.randomUUID();record({event:'created',id,kind});return{id,
  input:input=>record({event:'input',kind,id,input:input.kind,...(input.kind==='key'?{key:input.key}:{}),
    ...(input.kind==='action'?{action:input.action}:{}),...(input.kind==='change'?{field:input.id,length:input.value.length}:{}),
    ...(input.kind==='mouse'?{row:input.row,col:input.col,action:input.action}:{})}),
  dispose:()=>record({event:'disposed',id,kind})};}
export const controllers={
  history:({data},ctx)=>{
    const lease=life('history',ctx);record({event:'history-session',id:lease.id,sessionId:data.sessionId});let query=data.query??'',matches=[],selected='workspace-seed-proof',archived=false,status='Not loaded',lastArchived;
    const search=async()=>{matches=await data.control('list',{search:query,includeArchived:archived});status='Listed '+matches.length;record({event:'listed',id:lease.id,query,length:matches.length,ids:matches.map(meta=>meta.id)});};
    const mutation=async(action,args)=>{const value=await data.control(action,args);record({event:'control',id:lease.id,action,args,value});return value;};
    return{preferredRows:()=>26,dispose:lease.dispose,
      render:()=>({hint:'Enter resumes · Esc closes · F2 Windows',input:{id:'workspace-history-query',label:'Search',value:query,placeholder:'Search saved chats'},
        lines:[{text:'CUSTOM HISTORY',bold:true},rich,{text:'Lease: '+lease.id},{text:'Selected: '+selected},{text:status},
          ...matches.slice(0,6).map(meta=>({text:(meta.id===selected?'Selected: ':'Chat: ')+(meta.name??meta.id)+(meta.archived?' · archived':''),selected:meta.id===selected,action:'select:'+meta.id})),
          {text:'Private note',action:'note'},{text:'Rename selected',action:'rename'},{text:'Fork selected',action:'fork'},
          {text:'Archive selected',action:'archive'},{text:'Unarchive last',action:'unarchive'},
          {text:'Show archived: '+(archived?'yes':'no'),action:'archived'},{text:'Resume selected',action:'resume'},
          {text:'Delayed old control',action:'late'},{text:'Close history',action:'escape'}]}),
      async handle(input){lease.input(input);
        if(input.kind==='change'&&input.id==='workspace-history-query'){query=input.value;await search();return;}
        if(input.kind!=='action')return;
        const action=input.action;if(action==='open'){await search();return;}if(action==='escape')return'close';
        if(action.startsWith('select:')){selected=action.slice(7);return;}
        if(action==='archived'){archived=!archived;await search();return;}
        if(action==='note'||action==='rename'){
          const value=await data.form({title:action==='note'?'Workspace private note':'Workspace rename',fields:[
            {id:'name',label:'Name',type:'text',value:action==='note'?'PRIVATE_NOTE_47':matches.find(meta=>meta.id===selected)?.name??''},
            {id:'token',label:'Token',type:'password',required:true}],actions:[{id:'save',label:'Save'},{id:'cancel',label:'Cancel'}]});
          const token=String(value?.values.token??'');record({event:'private-form',id:lease.id,action,cancelled:!value,
            ...(value?{name:value.values.name,tokenLength:token.length,tokenHash:hash(token)}:{})});
          if(value&&action==='rename')await mutation('rename',{id:selected,name:String(value.values.name)});await search();return;
        }
        if(action==='fork'){const value=await mutation('fork',{id:selected,name:'Workspace fork'});selected=value.id;await search();return;}
        if(action==='archive'){lastArchived=selected;await mutation('archive',{id:selected});await search();return;}
        if(action==='unarchive'){await mutation('unarchive',{id:lastArchived??selected});selected=lastArchived??selected;await search();return;}
        if(action==='late'){
          record({event:'late-control-started',id:lease.id});await gate('history-late');let allowed=false;
          try{await data.control('list',{search:'LATE_PRIVATE_QUERY_47'});allowed=true;}catch{}
          record({event:'late-control-returned',id:lease.id,allowed,aborted:ctx.signal.aborted});return{type:'resume',id:'workspace-seed-proof'};
        }
        if(action==='enter'||action==='resume'||action.startsWith('resume:')){
          const target=action.startsWith('resume:')?action.slice(7):selected;
          if(!matches.some(meta=>meta.id===target))throw Error('Choose a current history row');
          writeFileSync(resume,JSON.stringify({id:target}));record({event:'resume',id:lease.id,target});return{type:'resume',id:target};
        }
      }};
  },
  placement:({data},ctx)=>{
    const lease=life('placement',ctx);let selected='',status='Not applied';
    const windows=()=>data.windows(),target=()=>selected||windows().find(window=>window.surface==='alpha')?.id;
    const apply=async(placement,save=false,id=target())=>{
      let ok=false;try{await data.apply(id,placement,save);ok=true;status=save?'Rule saved':'Applied';}catch{status='Rejected placement';}
      record({event:'apply',id:lease.id,target:id,placement,save,ok,aborted:ctx.signal.aborted});
    };
    return{preferredRows:()=>20,dispose:lease.dispose,
      render:()=>({hint:'Esc closes · F2 Windows',lines:[{text:'CUSTOM PLACEMENT',bold:true},rich,
        {text:'Lease: '+lease.id},{text:'Target: '+target()},{text:'Anchors: '+data.anchors().join(',')},{text:status},
        {text:'Target alpha',action:'alpha'},{text:'Target beta',action:'beta'},
        {text:'Apply workspace 2',action:'apply'},{text:'Save workspace 3',action:'save'},
        {text:'Invalid workspace',action:'invalid-workspace'},{text:'Invalid neighbor',action:'invalid-neighbor'},
        {text:'Apply removed target',action:'removed'},{text:'Delayed focus apply',action:'delayed'},
        {text:'Delayed cancelled apply',action:'cancelled'},{text:'Close placement',action:'escape'}]}),
      async handle(input){lease.input(input);const action=input.kind==='action'?input.action:input.kind==='key'&&input.key==='escape'?'escape':undefined;
        if(action==='escape')return'close';
        if(action==='alpha'||action==='beta'){const available=windows();selected=available.find(window=>window.surface===action)?.id??'';record({event:'inventory',id:lease.id,windows:available,anchors:data.anchors()});return;}
        if(action==='apply')await apply({site:'sidebar',workspace:2,size:.35,relativeTo:'session',focus:false});
        if(action==='save')await apply({site:'sidebar',workspace:3,size:.4,relativeTo:'session',focus:false},true);
        if(action==='invalid-workspace')await apply({workspace:10,focus:true});
        if(action==='invalid-neighbor')await apply({workspace:2,relativeTo:target(),focus:true});
        if(action==='removed')await apply({workspace:2,focus:true});
        if(action==='delayed'||action==='cancelled'){
          const id=target();record({event:'late-apply-started',id:lease.id,action,target:id});await gate(action==='delayed'?'placement-focus':'placement-cancel');
          await apply({site:'sidebar',workspace:action==='delayed'?4:5,size:.4,relativeTo:'session',focus:true},false,id);
          record({event:'late-apply-returned',id:lease.id,action,aborted:ctx.signal.aborted});
        }
      }};
  },
};
`.replace('TRACE_PATH',JSON.stringify(trace)).replace('GATES_PATH',JSON.stringify(gates)).replace('RESUME_PATH',JSON.stringify(resume)));
  await writeFile(join(cwd,'plugins',requester,'plugin.json'),JSON.stringify({name:requester,version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[{name:'/workspace-controller-probe',description:'Publish bounded ordinary workspace controller fixtures',execution:'immediate'}],hookTimeouts:{'ui.press':300000,'command.invoke':300000}}));
  await writeFile(join(cwd,'plugins',requester,'hooks.js'),String.raw`
const show=async $=>{
  for(const name of ['alpha','beta','gamma'])await $.ui.view(name,'Workspace '+name,{lines:[{text:'WORKSPACE_'+name.toUpperCase(),bold:true}]},{site:'split',workspace:name==='alpha'?1:7,focus:false});
  await $.ui.view('controls','Workspace controls',{lines:[{text:'Remove beta',action:'remove-beta'},{text:'Disable workspace provider',action:'disable-provider'},
    {text:'Observer positive action',action:'observer'}]},{site:'inspector',focus:false});
};
export default{'session.start':async(_,$)=>show($),'session.reload':async(_,$)=>{await show($);await $.storage.set('reloaded',(await $.storage.get('reloaded')||0)+1);},
  'command.invoke':async(_,$)=>show($),'ui.press':async(event,$)=>{
    if(event.key==='remove-beta'){await $.ui.remove('beta');await $.storage.set('removed-beta',true);}
    if(event.key==='disable-provider'){const value=await $.agent.tool('extension_control',{action:'disable',name:'native-workspace-controller-proof',scope:'project'});await $.storage.set('disabled',value);}
    if(event.key==='observer')await $.storage.set('observer-action',true);
  }};
`);
  await writeFile(join(cwd,'plugins',observer,'plugin.json'),JSON.stringify({name:observer,version:'1.0.0',trust:'trusted',main:'hooks.js'}));
  await writeFile(join(cwd,'plugins',observer,'hooks.js'),String.raw`
import {appendFileSync} from 'node:fs';const file=EVENTS_PATH;
const record=(type,event)=>appendFileSync(file,JSON.stringify({at:Date.now(),type,event})+'\n');
export default Object.fromEntries(['ui.render','ui.press','ui.change','service.session.control','service.session.store'].map(type=>[type,event=>{record(type,event);}]));
`.replace('EVENTS_PATH',JSON.stringify(events)));
  const store=new SessionStore({sessionsRoot:paths.sessions}),seedId='workspace-seed-proof';await store.create(cwd,{id:seedId,name:'Workspace seed'});
  await store.append(seedId,[{type:'prompt.submit',text:'WORKSPACE_SEED_CONTEXT_47'},{type:'assistant.text',turnId:'fixture',text:'WORKSPACE_SEED_HISTORY'},
    {type:'turn.complete',turnId:'fixture',text:'WORKSPACE_SEED_HISTORY'}],cwd);
  const state=join(paths.state,'plugin-state',requester);
  return{provider,requester,observer,trace,events,resume,seedId,selected:{history:provider,placement:provider},
    gates:Object.fromEntries(['history-late','placement-focus','placement-cancel'].map(name=>[name,join(gates,name)])),
    ids:Object.fromEntries(['alpha','beta','gamma'].map(name=>[name,'plugin-'+requester+'-'+name])),
    placement:join(cwd,'.agent-compositor/agent-compositor.jsonc'),reloaded:join(state,'reloaded.json'),
    removedBeta:join(state,'removed-beta.json'),disabled:join(state,'disabled.json'),observerAction:join(state,'observer-action.json'),
    rules:[{tool:'extension_control',command:'disable '+provider+'  --project',decision:'allow'},
      {tool:'extension_control',decision:'deny',reason:'Only this isolated workspace controller provider may be disabled'}]};
}
