import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {seedOpenTuiControllersFixture} from './opentui-controllers-fixture.mjs';

/** No layout or journal is seeded: Ink creates every migrated view through keys. */
export async function seedOpenTuiConversationCopiesFixture(cwd,paths,composition='native'){
  if(!['native','selected'].includes(composition))throw Error('Unknown conversation-copy composition');
  const requester='copy-request-probe',provider='copy-editor-proof',observer='copy-render-observer';
  const directory=join(cwd,'plugins',requester),editor=join(cwd,'plugins',provider),watcher=join(cwd,'plugins',observer);
  const evidence=join(cwd,'.agent-compositor/copy-proof'),trace=join(evidence,'trace.jsonl'),active=join(evidence,'active.json'),fork=join(evidence,'fork.json'),gates=join(evidence,'gates');
  await Promise.all([mkdir(directory,{recursive:true}),mkdir(editor,{recursive:true}),mkdir(watcher,{recursive:true}),mkdir(gates,{recursive:true})]);await writeFile(trace,'');
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:requester,version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[{name:'/copy-probe',description:'Isolated conversation-copy lifecycle proof',execution:'immediate'}],hookTimeouts:{'command.invoke':300000,'ui.press':300000}}));
  await writeFile(join(directory,'hooks.js'),String.raw`
import {appendFileSync,writeFileSync,readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const trace=TRACE,active=ACTIVE,fork=FORK,hash=text=>createHash('sha256').update(text).digest('hex');
const record=value=>appendFileSync(trace,JSON.stringify({at:Date.now(),...value})+'\n');
async function started($,event){writeFileSync(active,JSON.stringify({id:$.session.id}));record({event,sessionId:$.session.id});
  await $.ui.view('controls','Copy controls',{lines:[{text:'COPY_CONTROLS',bold:true},{text:'Open private form',action:'form'},
    {text:'Fork current conversation',action:'fork'},{text:'Resume fork',action:'resume'}]},{workspace:6,focus:false});}
async function run(args,$){
  const [mode,id]=args.trim().split(/\s+/);record({event:'called',mode,sessionId:$.session.id});
  if(mode==='form'){
    const result=await $.ui.form({title:'Copy private form',fields:[{id:'name',label:'Name',type:'text',value:'FORMvalue'},
      {id:'token',label:'Token',type:'password',required:true}],actions:[{id:'save',label:'Save'},{id:'cancel',label:'Cancel'}]});
    const token=String(result?.values.token??'');record({event:'form-result',sessionId:$.session.id,result:result?
      {action:result.action,name:result.values.name,tokenLength:token.length,tokenHash:hash(token)}:{cancelled:true}});
  }else if(mode==='fork'){
    const result=await $.emit('service.session.control',{action:'fork',name:'Copy fork proof'});record({event:'fork-result',result});if(result?.value?.id)writeFileSync(fork,JSON.stringify({id:result.value.id}));
  }else if(mode==='resume'){
    const result=await $.emit('service.session.control',{action:'resume',id:id??JSON.parse(readFileSync(fork,'utf8')).id});record({event:'resume-result',result});
  }else throw Error('Unknown copy fixture command');
}
export default{'session.start':async(_,$)=>started($,'started'),'session.reload':async(_,$)=>started($,'reloaded'),
  'command.invoke':(event,$)=>run(event.args,$),'ui.press':(event,$)=>run(event.key,$)};
`.replace('TRACE',JSON.stringify(trace)).replace('ACTIVE',JSON.stringify(active)).replace('FORK',JSON.stringify(fork)));
  await writeFile(join(editor,'plugin.json'),JSON.stringify({name:provider,version:'1.0.0',trust:'trusted',main:'hooks.js'}));
  await writeFile(join(editor,'hooks.js'),String.raw`
import {appendFileSync,watch} from 'node:fs';import {access} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const trace=TRACE,gates=GATES,hash=text=>createHash('sha256').update(text).digest('hex');
const record=value=>appendFileSync(trace,JSON.stringify({at:Date.now(),...value})+'\n');
function gate(name){return new Promise((resolve,reject)=>{let settled=false;
  const finish=error=>{if(settled)return;settled=true;watcher.close();clearTimeout(deadline);error?reject(error):resolve();};
  const check=()=>access(join(gates,name)).then(()=>finish(),()=>{}),watcher=watch(gates,()=>{void check();});
  const deadline=setTimeout(()=>finish(Error('Copy editor gate deadline')),60000);void check();
});}
export const controllers={editor:({state,data},ctx)=>{
  let text=state?.text??'',cursor=state?.cursor??text.length;const id=crypto.randomUUID();
  record({event:'editor-created',id,sessionId:data.sessionId,length:text.length,cursor,hash:hash(text)});
  const point=value=>{cursor=Math.max(0,Math.min(text.length,value));};
  const move=direction=>{if(direction<0&&cursor){cursor--;if(cursor&&/[\uDC00-\uDFFF]/.test(text[cursor]))cursor--;}
    if(direction>0&&cursor<text.length){cursor++;if(cursor<text.length&&/[\uD800-\uDBFF]/.test(text[cursor-1]))cursor++;}};
  return{snapshot:()=>({text,cursor}),preferredRows:()=>7,
    render:({rows})=>({hint:'F2 sends · Enter inserts a line · F8 delayed send',lines:[{text:'COPY CUSTOM INPUT',bold:true},
      {text:'D: '+text.slice(0,cursor).replaceAll('\n','↵')+'|'+text.slice(cursor).replaceAll('\n','↵'),tone:'accent'},
      {text:'Cursor UTF16: '+cursor+' / '+text.length},{text:'Editor lease: '+id},{text:'Viewport rows: '+rows}]}),
    async handle(input){record({event:'editor-input',id,kind:input.kind,...(input.kind==='key'?{key:input.key}:{}),...(input.kind==='text'?{length:input.text.length}:{})});
      if(input.kind==='text'){text=text.slice(0,cursor)+input.text+text.slice(cursor);cursor+=input.text.length;}
      if(input.kind==='key'){
        if(input.key==='f2'||input.key==='f8'){
          const value=text;text='';cursor=0;record({event:'editor-submit',id,hash:hash(value),length:value.length});
          if(input.key==='f8'){record({event:'late-started',id});await gate('late');let commands=false;try{data.commands();commands=true;}catch{}
            record({event:'late-returned',id,aborted:ctx.signal.aborted,commands});}
          return{type:'submit',text:value};
        }
        if(input.key==='enter'){text+='\n';cursor=text.length;}
        if(input.key==='home')point(0);if(input.key==='end')point(text.length);
        if(input.key==='left')move(-1);if(input.key==='right')move(1);
        if(input.key==='backspace'&&cursor){const end=cursor;move(-1);text=text.slice(0,cursor)+text.slice(end);}
        if(input.key==='u'&&input.modifiers?.includes('ctrl')){text='';cursor=0;}
      }
    },dispose(){text='';cursor=0;record({event:'editor-disposed',id,length:text.length,cursor});}};
}};
`.replace('TRACE',JSON.stringify(trace)).replace('GATES',JSON.stringify(gates)));
  const publicTrace=join(evidence,'public.jsonl');await writeFile(publicTrace,'');
  await writeFile(join(watcher,'plugin.json'),JSON.stringify({name:observer,version:'1.0.0',trust:'trusted',main:'hooks.js'}));
  await writeFile(join(watcher,'hooks.js'),String.raw`import {appendFileSync} from 'node:fs';const file=${JSON.stringify(publicTrace)};export default Object.fromEntries(['ui.render','ui.press','ui.change'].map(event=>[event,input=>{appendFileSync(file,JSON.stringify({event,input})+'\n');}]));`);
  const selected=composition==='selected'?await seedOpenTuiControllersFixture(cwd,paths):undefined;
  return{composition,requester,provider,observer,trace,publicTrace,active,fork,selectedTrace:selected?.trace,selectedProvider:selected?.provider,
    selected:composition==='selected'?{editor:provider,...selected.selected}:{},gates:{late:join(gates,'late')},
    rules:[{tool:'write',decision:'ask',reason:'Copy approvals require explicit consent'}],
    effect:join(cwd,'copy-approval.txt')};
}

/** The normal configured ProviderRouter uses this bounded loopback HTTP transport. */
export function conversationCopiesModelResponse(prompt,body){
  const allowed=['APP_COPY_SEED','APP_COPY_SHARED','APP_COPY_QUESTION','APP_COPY_APPROVAL','APP_COPY_RESTORED'];
  if(!allowed.includes(prompt))return new Response('Unexpected conversation-copy fixture prompt',{status:400});
  const tool=id=>body.messages.findLast(message=>message.role==='tool'&&message.tool_call_id===id)?.content;
  const answer=tool('copy-question'),approval=tool('copy-approval');let delta;
  if(prompt==='APP_COPY_QUESTION')delta=answer?{content:'COPY_ANSWER_RECEIVED: '+(answer.includes('Production')?'Production':'unexpected')}
    :{tool_calls:[{index:0,id:'copy-question',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'MAIN_QUESTION: choose deployment',options:['Preview','Production'],allowOther:false})}}]};
  else if(prompt==='APP_COPY_APPROVAL')delta=approval?{content:'COPY_APPROVAL_SETTLED: '+(/denied|cancel|Permission/i.test(approval)?'denied':'unexpected')}
    :{tool_calls:[{index:0,id:'copy-approval',type:'function',function:{name:'write',arguments:JSON.stringify({path:'copy-approval.txt',content:'MUST_REQUIRE_EXPLICIT_APPROVAL\n'})}}]};
  else if(prompt==='APP_COPY_SEED')delta={content:Array.from({length:80},(_,i)=>'COPY_HISTORY_'+String(i).padStart(2,'0')).join('\n\n')+'\n\nCOPY_HISTORY_BOTTOM'};
  else delta={content:'COPY_DONE: '+prompt+'; seed='+(body.messages.some(message=>message.role==='user'&&message.content==='APP_COPY_SEED')?'retained':'missing')};
  const finish=delta.tool_calls?'tool_calls':'stop';return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:finish}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
}
