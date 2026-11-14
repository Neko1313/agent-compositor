import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Selected private controllers and ordinary request callers have separate owners. */
export async function seedOpenTuiControllersFixture(cwd,paths){
  const provider='native-controller-proof',requester='controller-request-probe';
  const controllerDirectory=join(cwd,'plugins',provider),requestDirectory=join(cwd,'plugins',requester);
  const gates=join(cwd,'.agent-compositor/controller-gates'),trace=join(cwd,'.agent-compositor/controller-trace.jsonl');
  await Promise.all([mkdir(controllerDirectory,{recursive:true}),mkdir(requestDirectory,{recursive:true}),mkdir(gates,{recursive:true})]);
  await writeFile(trace,'');
  await writeFile(join(controllerDirectory,'plugin.json'),JSON.stringify({name:provider,version:'1.0.0',trust:'trusted',main:'hooks.js'}));
  await writeFile(join(controllerDirectory,'hooks.js'),String.raw`
import {appendFileSync,watch} from 'node:fs';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
const trace=TRACE_PATH,gates=GATES_PATH;
const record=value=>appendFileSync(trace,JSON.stringify({at:Date.now(),...value})+'\n');
const rich={text:'CELL_FALLBACK_MUST_NOT_RENDER',cells:[...('RICH 窗口')].map(ch=>({ch,fg:'#eac280',bg:'#171a20',bold:true}))};
function gate(name){return new Promise((resolve,reject)=>{
  let settled=false;const finish=error=>{if(settled)return;settled=true;watcher.close();clearTimeout(deadline);error?reject(error):resolve();};
  const check=()=>access(join(gates,name)).then(()=>finish(),()=>{});
  const watcher=watch(gates,()=>{void check();}),deadline=setTimeout(()=>finish(Error('Controller fixture gate deadline')),60000);
  void check();
});}
function lifetime(kind,data,ctx){
  const id=crypto.randomUUID(),title=kind==='form'?data.title:data.question??data.tool;
  record({event:'created',id,kind,title});ctx.signal.addEventListener('abort',()=>record({event:'aborted',id,kind}),{once:true});
  return{id,dispose:()=>record({event:'disposed',id,kind}),input:input=>{
    record({event:'input',id,kind,input:input.kind,...(input.kind==='key'?{key:input.key,modifiers:input.modifiers}:{}),
      ...(input.kind==='text'?{paste:input.paste===true,length:input.text.length}:{}),
      ...(input.kind==='mouse'?{action:input.action,row:input.row,col:input.col}:{}),...(input.kind==='action'?{action:input.action}:{}),
      ...(input.kind==='change'?{field:input.id,length:input.value.length}:{}),
    });
  }};
}
function editable(value=''){
  let text=value,cursor=text.length;
  return{get text(){return text;},get cursor(){return cursor;},shown:()=>text.slice(0,cursor)+'|'+text.slice(cursor),
    clear:()=>{text='';cursor=0;},
    move:position=>{cursor=Math.max(0,Math.min(text.length,position));},
    handle(input){
      if(input.kind==='text'){text=text.slice(0,cursor)+input.text+text.slice(cursor);cursor+=input.text.length;}
      if(input.kind==='key'){
        if(input.key==='left')cursor=Math.max(0,cursor-1);if(input.key==='right')cursor=Math.min(text.length,cursor+1);
        if(input.key==='home')cursor=0;if(input.key==='end')cursor=text.length;
        if(input.key==='backspace'&&cursor){text=text.slice(0,cursor-1)+text.slice(cursor);cursor--;}
      }
    }};
}
export const controllers={
  approval:({data},ctx)=>{
    const life=lifetime('approval',data,ctx);
    return{preferredRows:()=>7,pointer:()=> 'pointer',dispose:life.dispose,
      render:()=>({hint:'F3 denies · F5 approves once',lines:[{text:'CUSTOM APPROVAL',bold:true},{text:'Tool: '+data.tool},rich,
        {text:'Lease: '+life.id},{text:'F3 deny | F5 allow once | F4 malformed'},{text:'Allow using controller',action:'allow-once'}]}),
      handle(input){life.input(input);
        if(input.kind==='key')return input.key==='f3'?{allow:false}:input.key==='f5'?{allow:true,scope:'once'}:input.key==='f4'?{allow:'invalid'}:undefined;
        if(input.kind==='action'&&input.action==='allow-once')return{allow:true,scope:'once'};
      }};
  },
  question:({data},ctx)=>{
    const life=lifetime('question',data,ctx),field=editable('Qvalue');
    const semantic=data.question==='CONTROLLER_QUESTION_B';let query='',changes=0;
    return{preferredRows:()=>8,pointer:row=>row===3?'text':'default',dispose:life.dispose,
      render:()=>({hint:'F4 answers · Esc cancels',...(semantic?{input:{id:'controller-query',label:'Query',value:query}}:{}),lines:[{text:'CUSTOM QUESTION',bold:true},{text:'Request: '+data.question},rich,
        {text:'Value: '+field.shown()},{text:'Lease: '+life.id},{text:'F4 selects the custom answer'},...(semantic?[{text:'Applied chars: '+query.length}]:[])]}),
      async handle(input){life.input(input);
        if(semantic&&input.kind==='change'){
          const change=++changes;if(change===1){record({event:'semantic-started',id:life.id});await gate('semantic');}
          if(change===2){record({event:'semantic-held',id:life.id,change});await gate('semantic-second');}
          query=input.value;record({event:'semantic-applied',id:life.id,change,length:query.length});return;
        }
        field.handle(input);
        if(input.kind==='mouse'&&input.action==='press'&&input.row===3)field.move(input.col-7);
        if(input.kind==='key'&&input.key==='escape')return'cancel';
        if(input.kind==='key'&&input.key==='f4')return{answer:data.questions
          ?{answers:data.questions.map(question=>question.id==='checks'?{id:question.id,selected:['Unit','Browser'],text:'Load tests'}:{id:question.id,selected:[],text:'Controller owner'})}
          :data.question?.startsWith('MAIN_QUESTION')?'Production':'Remote'};
      }};
  },
  form:({data},ctx)=>{
    const life=lifetime('form',data,ctx),name=editable(String(data.fields.find(field=>field.id==='name')?.value??''));
    const token=editable(String(data.fields.find(field=>field.id==='token')?.value??''));let active='name';
    const result=()=>({action:'save',values:{name:name.text,token:token.text}});
    return{preferredRows:()=>9,pointer:row=>row===3||row===4?'text':'default',dispose(){token.clear();life.dispose();},
      render:()=>({hint:'F5 saves · Esc cancels · Tab changes field',lines:[{text:'CUSTOM PRIVATE FORM',bold:true},{text:'Request: '+data.title},rich,
        {text:'Name: '+name.shown()},{text:'Token: '+'*'.repeat(token.text.length)},{text:'Field: '+active},{text:'Lease: '+life.id},
        {text:'Save using controller',action:'save'}]}),
      async handle(input){life.input(input);
        if(input.kind==='key'&&input.key==='tab'){active=active==='name'?'token':'name';return;}
        if(input.kind==='mouse'&&input.action==='press'){
          if(input.row===3){active='name';name.move(input.col-6);}if(input.row===4){active='token';token.move(input.col-7);}
        }
        (active==='name'?name:token).handle(input);
        if(input.kind==='key'&&input.key==='escape')return'cancel';
        if(input.kind==='key'&&input.key==='f4')return{action:'unoffered',values:{name:name.text,token:token.text}};
        if(input.kind==='key'&&input.key==='f5'||input.kind==='action'&&input.action==='save'){
          if(data.title.includes('async')){
            record({event:'async-started',id:life.id,title:data.title});await gate(data.title.endsWith('cancel')?'cancel':'save');
            record({event:'async-returned',id:life.id,title:data.title,aborted:ctx.signal.aborted});
          }
          return result();
        }
      }};
  },
};
`.replace('TRACE_PATH',JSON.stringify(trace)).replace('GATES_PATH',JSON.stringify(gates)));
  await writeFile(join(cwd,'controller-worker.sh'),'#!/bin/sh\ncase "$1" in allow|deny|malformed) ;; *) exit 2 ;; esac\nprintf "%s\\n" "$1" >> "controller-$1.effect"\n');
  await writeFile(join(requestDirectory,'plugin.json'),JSON.stringify({name:requester,version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[{name:'/controller-probe',description:'Exercise selected private request controllers',execution:'immediate'}],
    hookTimeouts:{'command.invoke':300000,'ui.press':300000},compositor:{standard:1,apiVersion:1}}));
  await writeFile(join(requestDirectory,'hooks.js'),String.raw`
const modes=['approval-malformed','approval-deny','approval-allow','question-a','question-b','questionnaire','form','form-async-save','form-async-cancel','main-form','disable-provider'];
let startupForm;
async function run(mode,$){
  const receipt=$.background();await receipt.storage.set('calls-'+mode,(await receipt.storage.get('calls-'+mode)||0)+1);
  let result;try{
    if(mode.startsWith('approval-'))result=await $.agent.tool('exec',{command:'/bin/sh controller-worker.sh '+mode.slice(9),timeoutMs:15000});
    else if(mode==='question-a')result=await $.agent.tool('ask_user',{question:'CONTROLLER_QUESTION_A',options:['Local','Remote'],allowOther:true});
    else if(mode==='question-b')result=await $.ui.ask({question:'CONTROLLER_QUESTION_B',options:['Local','Remote'],allowOther:true});
    else if(mode==='questionnaire')result=await $.agent.tool('ask_questions',{title:'Controller questionnaire',questions:[
      {id:'checks',question:'CONTROLLER_CHECKS',options:['Unit','Browser'],multi:true,allowOther:true},{id:'owner',question:'CONTROLLER_OWNER'},
    ]});
    else if(mode.startsWith('form')||mode==='main-form'){
      const open=mode==='main-form'?startupForm:$.ui.form;if(!open)throw Error('The retained startup form is unavailable');
      const value=await open({title:'Controller private '+mode,fields:[
        {id:'name',label:'Name',type:'text',value:'FORMvalue'},{id:'token',label:'Token',type:'text',required:true,value:'SYNTHETIC_CONTROLLER_DEFAULT_47'},
      ],actions:[{id:'save',label:'Save'},{id:'cancel',label:'Cancel'}]});
      if(!value)result={cancelled:true};else{
        const token=String(value.values.token??''),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
        result={action:value.action,name:value.values.name,tokenLength:token.length,tokenHash:Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('')};
      }
    }else if(mode==='disable-provider')result=await $.agent.tool('extension_control',{action:'disable',name:'native-controller-proof',scope:'project'});
    else throw Error('Unknown controller probe mode');
    result={ok:true,value:result};
  }catch(error){result={ok:false,error:String(error)};}
  await receipt.storage.set('result-'+mode,result);
}
const show=$=>$.ui.view('controls','Controller controls',{lines:modes.map(mode=>({text:'Start '+mode,action:mode}))},{site:'inspector',focus:false});
export default{
  'session.start':async(_,$)=>{startupForm=$.ui.form;await show($);},
  'command.invoke':async(event,$)=>run(event.args.trim(),$),
  'ui.press':async(event,$)=>{if(modes.includes(event.key))await run(event.key,$);},
  'session.reload':async(_,$)=>{await show($);await $.storage.set('reloaded',true);},
};
`);
  const modes=['approval-malformed','approval-deny','approval-allow','question-a','question-b','questionnaire','form','form-async-save','form-async-cancel','main-form','disable-provider'];
  const state=join(paths.state,'plugin-state',requester);
  return{provider,requester,trace,gates:{save:join(gates,'save'),cancel:join(gates,'cancel'),semantic:join(gates,'semantic'),semanticSecond:join(gates,'semantic-second')},
    selected:Object.fromEntries(['approval','question','form'].map(kind=>[kind,provider])),
    effects:Object.fromEntries(['allow','deny','malformed'].map(mode=>[mode,join(cwd,'controller-'+mode+'.effect')])),
    receipts:Object.fromEntries(modes.map(mode=>[mode,join(state,'result-'+mode+'.json')])),
    calls:Object.fromEntries(modes.map(mode=>[mode,join(state,'calls-'+mode+'.json')])),reloaded:join(state,'reloaded.json'),
    rules:[...['allow','deny','malformed'].map(mode=>({tool:'exec',command:'/bin/sh controller-worker.sh '+mode,decision:'ask',reason:'Selected controller must explicitly decide this local effect'})),
      {tool:'exec',decision:'deny',reason:'Other controller fixture shell commands remain denied'},
      {tool:'extension_control',command:'disable '+provider+'  --project',decision:'allow'},
      {tool:'extension_control',decision:'deny',reason:'Only disabling this fixture controller owner is allowed'},
    ]};
}
