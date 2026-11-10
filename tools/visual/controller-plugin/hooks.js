// Test-only external extension. Deliberately uses neither AppUI nor SessionStore.
import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const controllers={
  editor:({state},ctx)=>{
    let text=state?.text??'',cursor=state?.cursor??text.length;
    return{snapshot:()=>({text,cursor}),preferredRows:()=>3,
      render:()=>({hint:'F2 sends · Enter inserts a line',lines:[{text:'CUSTOM INPUT',bold:true},{text:text||'Your workspace, your controls',tone:'accent'}]}),
      handle:input=>{
        if(input.kind==='text'){text=text.slice(0,cursor)+input.text+text.slice(cursor);cursor+=input.text.length;}
        if(input.kind==='key'){
          if(input.key==='f2'){const value=text;text='';cursor=0;return{type:'submit',text:value};}
          if(input.key==='backspace'&&cursor){text=text.slice(0,cursor-1)+text.slice(cursor);cursor--;}
          if(input.key==='enter'){text+='\n';cursor=text.length;}
          if(input.key==='c'&&input.modifiers?.includes('ctrl'))return{type:'interrupt'};
        }
      },pointer:()=> 'text',dispose(){text='';cursor=0;},
    };
  },
  approval:({data})=>({preferredRows:()=>4,
    render:()=>({hint:'F3 denies · F5 approves once',lines:[{text:'CUSTOM APPROVAL',bold:true},{text:data.tool},{text:'F3 deny | F5 allow once'}]}),
    handle:input=>input.kind==='key'?(input.key==='f3'?{allow:false}:input.key==='f5'?{allow:true,scope:'once'}:input.key==='f4'?{allow:'invalid'}:undefined):undefined}),
  question:()=>({preferredRows:()=>4,
    render:()=>({hint:'F4 answers',lines:[{text:'CUSTOM QUESTION',bold:true},{text:'F4 selects the custom answer'}]}),
    handle:input=>input.kind==='key'&&input.key==='f4'?{answer:'custom response'}:undefined}),
  form:({data})=>{
    let token='';return{render:()=>({hint:'F5 saves · Esc cancels',lines:[{text:'CUSTOM PRIVATE FORM',bold:true},{text:'Token: '+ '•'.repeat(token.length)}]}),
      handle:input=>{if(input.kind==='text')token+=input.text;
        if(input.kind==='key'&&input.key==='f5')return{action:'save',values:Object.fromEntries(data.fields.map(field=>[field.id,token]))};
        if(input.kind==='key'&&input.key==='escape')return'cancel';},dispose(){token='';}};
  },
  history:({data})=>{
    let query=data.query??'',matches=[];
    const search=async()=>{matches=await data.control('list',{search:query});};
    return{render:()=>({hint:'Enter resumes · Esc closes',input:{id:'custom-search',value:query,placeholder:'Custom repository search'},
      lines:[{text:'CUSTOM HISTORY',bold:true},...matches.map(meta=>({text:meta.name||meta.id,action:'resume:'+meta.id}))]}),
      handle:async input=>{
        if(input.kind==='change'){query=input.value;await search();}
        if(input.kind==='action'){
          if(input.action==='open')await search();
          if(input.action==='escape')return'close';
          const id=input.action.startsWith('resume:')?input.action.slice(7):input.action==='enter'?matches[0]?.id:undefined;
          if(id)return{type:'resume',id};
        }
      }};
  },
  placement:({data})=>({render:()=>({hint:'Esc closes',lines:[{text:'CUSTOM PLACEMENT',bold:true},...data.windows().map(w=>({text:w.title}))]}),
    handle:input=>input.kind==='key'&&input.key==='escape'?'close':undefined}),
};
export const hooks={
  'prompt.submit':async(event,$)=>{
    if(event.text==='/private-form'){
      const result=await $.ui.form({title:'Private fixture',fields:[{id:'token',label:'Token',type:'password'}],actions:[{id:'save',label:'Save'}]});
      if($.signal.aborted)return{drop:'cancelled private form'};
      await $.storage.set('form-result',result);await $.ui.notify(result?'Custom form saved':'Custom form cancelled');return{drop:'private form'};
    }
    if(event.text==='/private-question'){
      const answer=await $.ui.ask({question:'Custom question'});await $.ui.notify('Answer: '+answer);return{drop:'private question'};
    }
    if(event.text==='/private-approval'){
      const result=await $.agent.tool('exec',{command:'printf custom-controller-approved'});await $.ui.notify(result.ok?'Custom tool approved':'Custom tool denied');return{drop:'private approval'};
    }
  },
};
export async function sessionRepository({cwd,stateRoot,signal}){
  await mkdir(stateRoot,{recursive:true});const file=join(stateRoot,'custom-conversations.json'),log=join(stateRoot,'custom-repository.log');
  const sessions=JSON.parse(await readFile(file,'utf8').catch(()=>'{}'));let writes=Promise.resolve();
  const save=()=>{const json=JSON.stringify(sessions);writes=writes.then(()=>writeFile(file,json));return writes;};
  const check=()=>signal.throwIfAborted();
  const get=id=>{check();if(!sessions[id])throw new Error('Custom session not found');return sessions[id];};
  const repository={
    async create(cwd,opts={}){check();const id=opts.id??randomUUID();if(!sessions[id]){sessions[id]={meta:{id,cwd,name:opts.name,parentId:opts.parentId,createdAt:Date.now(),updatedAt:Date.now(),archived:false,eventCount:0,messageCount:0},events:[]};await save();}return structuredClone(sessions[id].meta);},
    async append(id,events){const session=get(id);session.events.push(...structuredClone(events));session.meta.eventCount=session.events.length;
      for(const event of events){if(event.type==='prompt.submit'&&!event.text.startsWith('/')){session.meta.firstPrompt??=event.text;session.meta.messageCount++;}if(event.type==='turn.complete'){session.meta.lastResponse=event.text;session.meta.messageCount++;}}
      session.meta.updatedAt=Date.now();await save();},
    async load(id){return structuredClone(get(id));},
    async list(cwd,opts={}){check();return Object.values(sessions).map(s=>structuredClone(s.meta)).filter(m=>m.cwd===cwd&&(opts.includeArchived||!m.archived));},
    async search(cwd,query,opts={}){opts.signal?.throwIfAborted();return(await repository.list(cwd,opts)).filter(m=>JSON.stringify(sessions[m.id]).toLowerCase().includes(query.toLowerCase()));},
    async fork(id,opts={}){const original=get(id);const meta=await repository.create(original.meta.cwd,{name:opts.name,parentId:id});await repository.append(meta.id,original.events.slice(0,opts.uptoEventIndex));return meta;},
    async rename(id,name){get(id).meta.name=name;await save();return structuredClone(get(id).meta);},
    async archive(id){get(id).meta.archived=true;await save();return structuredClone(get(id).meta);},
    async unarchive(id){get(id).meta.archived=false;await save();return structuredClone(get(id).meta);},
    async remove(id){get(id);delete sessions[id];await save();},
    async findByPrefix(prefix,cwd){const matches=(await repository.list(cwd,{includeArchived:true})).filter(m=>m.id.startsWith(prefix));return matches.length===1?matches[0]:undefined;},
    async dispose(){await writes;await appendFile(log,'disposed\n');},
  };return repository;
}
