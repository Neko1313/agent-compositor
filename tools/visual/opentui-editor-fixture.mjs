import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SessionStore} from '../../packages/session/src/store.ts';
import {seedOpenTuiControllersFixture} from './opentui-controllers-fixture.mjs';

/** Actual-app editor and ordinary request callers have separate plugin lifetimes. */
export async function seedOpenTuiEditorFixture(cwd,paths,composition='native'){
  if(!['native','selected'].includes(composition))throw Error('Unknown editor composition');
  const provider='native-editor-proof',requester='editor-request-probe',directory=join(cwd,'plugins',provider),requests=join(cwd,'plugins',requester);
  const gates=join(cwd,'.agent-compositor/editor-gates'),trace=join(cwd,'.agent-compositor/editor-trace.jsonl');
  await Promise.all([mkdir(directory,{recursive:true}),mkdir(requests,{recursive:true}),mkdir(gates,{recursive:true})]);await writeFile(trace,'');
  await writeFile(join(cwd,'editor-evidence.txt'),'EDITOR_FILE_CAPABILITY_EVIDENCE\n');
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:provider,version:'1.0.0',trust:'trusted',main:'hooks.js'}));
  await writeFile(join(directory,'hooks.js'),String.raw`
import {appendFileSync,watch} from 'node:fs';
import {access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const trace=TRACE_PATH,gates=GATES_PATH,hash=text=>createHash('sha256').update(text).digest('hex');
const record=value=>appendFileSync(trace,JSON.stringify({at:Date.now(),...value})+'\n');
function gate(name){return new Promise((resolve,reject)=>{
  let settled=false;const finish=error=>{if(settled)return;settled=true;watcher.close();clearTimeout(deadline);error?reject(error):resolve();};
  const check=()=>access(join(gates,name)).then(()=>finish(),()=>{});
  const watcher=watch(gates,()=>{void check();}),deadline=setTimeout(()=>finish(Error('Editor fixture gate deadline')),60000);void check();
});}
export const controllers={editor:({state,data},ctx)=>{
  let text=state?.text??'',cursor=state?.cursor??text.length,capabilities='not requested';
  const id=crypto.randomUUID(),sessionId=data.sessionId;
  record({event:'created',id,sessionId,length:text.length,cursor,hash:hash(text)});
  const point=value=>{cursor=Math.max(0,Math.min(text.length,value));};
  const insert=value=>{text=text.slice(0,cursor)+value+text.slice(cursor);cursor+=value.length;};
  const move=direction=>{
    if(direction<0&&cursor){cursor--;if(cursor&&/[\uDC00-\uDFFF]/.test(text[cursor])&&/[\uD800-\uDBFF]/.test(text[cursor-1]))cursor--;}
    if(direction>0&&cursor<text.length){cursor++;if(cursor<text.length&&/[\uD800-\uDBFF]/.test(text[cursor-1])&&/[\uDC00-\uDFFF]/.test(text[cursor]))cursor++;}
  };
  return{snapshot:()=>({text,cursor}),preferredRows:()=>7,pointer:row=>row===1?'text':'default',
    render:({rows})=>({hint:'F2 sends · Enter inserts a line · F3 steers',lines:[{text:'CUSTOM INPUT',bold:true},
      {text:'Draft: '+text.slice(0,cursor).replaceAll('\n','↵')+'|'+text.slice(cursor).replaceAll('\n','↵'),tone:'accent'},
      {text:'Cursor UTF16: '+cursor+' / '+text.length},{text:'Lease: '+id},{text:'Capabilities: '+capabilities+' · viewport '+rows},
      {text:'F6 commands/files · F8 delayed send · F9 history scroll · ShiftF9 latest'}]}),
    async handle(input){
      record({event:'input',id,kind:input.kind,...(input.kind==='key'?{key:input.key,modifiers:input.modifiers}:{}),
        ...(input.kind==='text'?{length:input.text.length,paste:input.paste===true}:{}),
        ...(input.kind==='mouse'?{row:input.row,col:input.col,action:input.action}:{})});
      if(input.kind==='text')insert(input.text);
      if(input.kind==='mouse'&&input.action==='press'&&input.row===1){
        const before=text.slice(0,cursor),shown=before+'|'+text.slice(cursor);let column=7,position=0;
        for(const ch of shown){if(column>=input.col)break;column+=/[\u3000-\u9fff]/u.test(ch)||ch.codePointAt(0)>0xffff?2:1;if(ch!=='|')position+=ch.length;}point(position);
      }
      if(input.kind==='key'){
        const ctrl=input.modifiers?.includes('ctrl');
        if(input.key==='f2'||input.key==='f3'||input.key==='f8'){
          const value=text;text='';cursor=0;
          record({event:'intent',id,type:input.key==='f3'?'steer':'submit',length:value.length,hash:hash(value)});
          if(input.key==='f8'){
            record({event:'late-started',id});await gate('late');let commands=false,files=false;
            try{data.commands();commands=true;}catch{}try{await data.files?.('editor-');files=true;}catch{}
            record({event:'late-returned',id,aborted:ctx.signal.aborted,commands,files});
          }
          return{type:input.key==='f3'?'steer':'submit',text:value};
        }
        if(input.key==='enter'){text+='\n';cursor=text.length;}
        if(input.key==='home'||ctrl&&input.key==='a')point(0);
        if(input.key==='end'||ctrl&&input.key==='e')point(text.length);
        if(input.key==='left')move(-1);if(input.key==='right')move(1);
        if(input.key==='backspace'&&cursor){const end=cursor;move(-1);text=text.slice(0,cursor)+text.slice(end);}
        if(input.key==='delete'&&cursor<text.length){const start=cursor;move(1);text=text.slice(0,start)+text.slice(cursor);cursor=start;}
        if(ctrl&&input.key==='u'){text='';cursor=0;}
        if(input.key==='f6'){
          const commands=data.commands(),files=await data.files?.('editor-');capabilities='commands '+commands.length+' · evidence '+Boolean(files?.some(file=>file.includes('editor-evidence.txt')));
          record({event:'capabilities',id,commands:commands.map(command=>command.name),files});
        }
        if(input.key==='f9')return{type:'scroll',rows:input.modifiers?.includes('shift')?-10000:3};
        if(input.key==='c'&&ctrl)return{type:'interrupt'};
      }
    },dispose(){text='';cursor=0;record({event:'disposed',id,length:text.length,cursor});}};
}};
`.replace('TRACE_PATH',JSON.stringify(trace)).replace('GATES_PATH',JSON.stringify(gates)));
  await writeFile(join(requests,'plugin.json'),JSON.stringify({name:requester,version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[{name:'/editor-probe',description:'Exercise ordinary editor UI operations',execution:'immediate'}],
    hookTimeouts:{'command.invoke':300000,'ui.press':300000},compositor:{standard:1,apiVersion:1}}));
  await writeFile(join(requests,'hooks.js'),String.raw`
import {watch} from 'node:fs';import {access} from 'node:fs/promises';import {join} from 'node:path';
const gates=GATES_PATH;
function gate(name,signal){return new Promise((resolve,reject)=>{
  let settled=false;const finish=error=>{if(settled)return;settled=true;watcher.close();clearTimeout(deadline);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
  const abort=()=>finish(Error('Editor UI operation cancelled')),check=()=>access(join(gates,name)).then(()=>finish(),()=>{});
  const watcher=watch(gates,()=>{void check();}),deadline=setTimeout(()=>finish(Error('Editor UI fixture gate deadline')),60000);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else void check();
});}
const modes=['form','question','hold-1','hold-2','hold-3','hold-4','hold-5','disable-editor'];
async function run(mode,$){
  const receipt=$.background();await receipt.storage.set('calls-'+mode,(await receipt.storage.get('calls-'+mode)||0)+1);
  let result;try{
    if(mode==='form'){
      const value=await $.ui.form({title:'Editor private form',fields:[{id:'name',label:'Name',type:'text',value:'FORMvalue'},
        {id:'token',label:'Token',type:'password',required:true}],actions:[{id:'save',label:'Save'},{id:'cancel',label:'Cancel'}]});
      const token=String(value?.values.token??''),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
      result=value?{action:value.action,name:value.values.name,tokenLength:token.length,tokenHash:Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('')}:{cancelled:true};
    }else if(mode==='question')result=await $.ui.ask({question:'EDITOR_PRIVATE_QUESTION',options:['Local','Remote'],allowOther:true});
    else if(mode.startsWith('hold-')){
      await $.ui.view(mode,'Editor '+mode,{lines:[{text:'EDITOR_OPERATION_'+mode.toUpperCase(),bold:true}]},{focus:false});
      await receipt.storage.set('started-'+mode,true);await gate(mode,$.signal);result={released:true};
    }else if(mode==='disable-editor')result=await $.agent.tool('extension_control',{action:'disable',name:'native-editor-proof',scope:'project'});
    else throw Error('Unknown editor fixture mode');
    result={ok:true,value:result};
  }catch(error){result={ok:false,error:String(error)};}await receipt.storage.set('result-'+mode,result);
}
const show=$=>$.ui.view('controls','Editor controls',{lines:modes.map(mode=>({text:'Start '+mode,action:mode}))},{site:'inspector',focus:false});
export default{'session.start':async(_,$)=>show($),'session.reload':async(_,$)=>{await show($);await $.storage.set('reloaded',(await $.storage.get('reloaded')||0)+1);},
  'command.invoke':async(event,$)=>run(event.args.trim(),$),'ui.press':async(event,$)=>{if(modes.includes(event.key))await run(event.key,$);},
  'prompt.submit':event=>event.text==='APP_EDITOR_DROP'?{drop:'Editor fixture handled this accepted prompt'}:undefined};
`.replace('GATES_PATH',JSON.stringify(gates)));
  const store=new SessionStore({sessionsRoot:paths.sessions}),resumeId='editor-resume-proof';
  await store.create(cwd,{id:resumeId,name:'Editor resumed conversation'});
  const history=Array.from({length:80},(_,index)=>'EDITOR_HISTORY_'+String(index).padStart(2,'0')).join('\n')+'\nEDITOR_RESUME_HISTORY';
  await store.append(resumeId,[{type:'prompt.submit',text:'Historical editor context'},{type:'assistant.text',turnId:'fixture',text:history},
    {type:'turn.complete',turnId:'fixture',text:history}],cwd);
  const selected=composition==='selected'?await seedOpenTuiControllersFixture(cwd,paths):undefined;
  const state=join(paths.state,'plugin-state',requester),modes=['form','question','hold-1','hold-2','hold-3','hold-4','hold-5','disable-editor'];
  return{composition,provider,requester,trace,resumeId,selectedProvider:selected?.provider,
    selected:{editor:provider,...(selected?.selected??{})},
    gates:Object.fromEntries(['late','model',...Array.from({length:5},(_,i)=>'hold-'+(i+1))].map(name=>[name,join(gates,name)])),
    receipts:Object.fromEntries(modes.map(mode=>[mode,join(state,'result-'+mode+'.json')])),
    calls:Object.fromEntries(modes.map(mode=>[mode,join(state,'calls-'+mode+'.json')])),
    started:Object.fromEntries(modes.filter(mode=>mode.startsWith('hold-')).map(mode=>[mode,join(state,'started-'+mode+'.json')])),
    reloaded:join(state,'reloaded.json'),selectedTrace:selected?.trace,
    rules:[{tool:'extension_control',command:'disable '+provider+'  --project',decision:'allow'},
      {tool:'extension_control',decision:'deny',reason:'Only this isolated editor owner may be disabled'}]};
}

/** Bounded normal HTTP transport; the application still assembles ProviderRouter. */
export async function editorModelResponse(prompt,body,request,fixture,record){
  if(typeof prompt!=='string'||!prompt.startsWith('APP_EDITOR_'))return;
  const allowed=['APP_EDITOR_MULTILINE\nA😀X窗éZ','APP_EDITOR_HOLD','APP_EDITOR_QUEUE','APP_EDITOR_STEER','APP_EDITOR_ERROR','APP_EDITOR_RESUMED'];
  if(!allowed.includes(prompt))return new Response('Unexpected editor fixture prompt',{status:400});
  const packet=(delta,tool=false)=>`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:tool?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`;
  if(prompt==='APP_EDITOR_ERROR')return Response.json({error:{message:'EDITOR_ACCEPTED_PROVIDER_FAILURE',type:'invalid_request_error'}},{status:400});
  if(prompt==='APP_EDITOR_HOLD'&&!body.messages.some(message=>message.tool_call_id==='editor-held-read')){
    const {watch}=await import('node:fs'),{access}=await import('node:fs/promises');
    await new Promise((resolve,reject)=>{
      let done=false;const finish=error=>{if(done)return;done=true;watcher.close();clearTimeout(deadline);request.signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const abort=()=>finish(Error('Editor HTTP hold aborted')),check=()=>access(fixture.gates.model).then(()=>finish(),()=>{});
      const watcher=watch(fixture.gates.model.replace(/\/[^/]+$/,''),()=>{void check();}),deadline=setTimeout(()=>finish(Error('Editor HTTP gate deadline')),60000);
      request.signal.addEventListener('abort',abort,{once:true});void check();
    });
    record({kind:'editor-model-released'});
    return new Response(packet({tool_calls:[{index:0,id:'editor-held-read',type:'function',function:{name:'read',arguments:JSON.stringify({path:'editor-evidence.txt'})}}]},true),{headers:{'content-type':'text/event-stream'}});
  }
  return new Response(packet({content:'EDITOR_DONE: '+prompt.replaceAll('\n',' / ')}),{headers:{'content-type':'text/event-stream'}});
}
