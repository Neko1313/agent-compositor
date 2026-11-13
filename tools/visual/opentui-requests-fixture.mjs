import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Public SDK requests from ordinary UI commands and explicit retained handles. */
export async function seedOpenTuiRequestsFixture(cwd,paths){
  const directory=join(cwd,'plugins/request-probe');await mkdir(directory,{recursive:true});
  await writeFile(join(cwd,'request-worker.sh'),String.raw`#!/bin/sh
case "$1" in allow|deny) ;; *) exit 2 ;; esac
printf '%s\n' "$1" >> "request-$1.effect"
`);
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'request-probe',version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[{name:'/request-probe',description:'Request independent local human input',execution:'immediate'}],
    hookTimeouts:{'command.invoke':300000,'ui.press':300000},compositor:{standard:1,apiVersion:1}}));
  await writeFile(join(directory,'hooks.js'),String.raw`
const question=name=>({question:'UI_QUESTION_'+name,options:['Local','Remote'],allowOther:true});
async function record($,mode,operation){
  const receipt=$.background();
  await receipt.storage.set('started-'+mode,true);
  await receipt.storage.set('calls-'+mode,(await receipt.storage.get('calls-'+mode)||0)+1);
  let result;
  try{result={ok:true,value:await operation()};}
  catch(error){result={ok:false,error:String(error)};}
  await receipt.storage.set('result-'+mode,result);
}
let launchAfter;
async function background($,mode){
  const retained=$.background();
  await retained.storage.set('started-'+mode,true);
  let admitted;const initiated=new Promise(resolve=>{admitted=resolve;});
  const request=async()=>{
    await retained.storage.set('requested-'+mode,true);
    await record(retained,mode,()=>{const pending=retained.ui.ask({question:mode==='background-before'?'BACKGROUND_BEFORE':'BACKGROUND_AFTER',
      options:['Keep','Discard'],allowOther:false});admitted();return pending;});
  };
  if(mode==='background-before'){void request();await initiated;}
  else launchAfter=request;
  await retained.storage.set('launcher-'+mode,true);
}
const modes=['approval-allow','approval-deny','question-a','question-b','questionnaire','form','background-before','background-after-trigger'];
async function run(mode,$){
    if(mode.startsWith('approval-')){
      const name=mode.slice('approval-'.length);if(!['allow','deny'].includes(name))throw Error('Unknown approval');
      await record($,mode,()=>$.agent.tool('exec',{command:'/bin/sh request-worker.sh '+name,timeoutMs:15000}));return;
    }
    if(mode==='question-a'){await record($,mode,()=>$.agent.tool('ask_user',question('A')));return;}
    if(mode==='question-b'){await record($,mode,()=>$.ui.ask(question('B')));return;}
    if(mode==='questionnaire'){
      await record($,mode,()=>$.agent.tool('ask_questions',{title:'UI questionnaire',questions:[
        {id:'checks',question:'UI_CHECKS: choose checks',options:['Unit','Browser'],multi:true,allowOther:true},
        {id:'owner',question:'UI_OWNER: name the owner'},
      ]}));return;
    }
    if(mode==='form'){
      const receipt=$.background();await receipt.storage.set('started-form',true);
      await receipt.storage.set('calls-form',(await receipt.storage.get('calls-form')||0)+1);
      let result;try{result=await $.ui.form({title:'UI private token',fields:[
        {id:'name',label:'Private label',type:'text',value:'FORMvalue'},
        {id:'token',label:'Access token',type:'password',required:true},
      ],actions:[{id:'save',label:'Save private token'},{id:'cancel',label:'Cancel'}]});}
      catch(error){await receipt.storage.set('result-form',{ok:false,error:String(error)});return;}
      if(!result){await receipt.storage.set('result-form',{ok:true,cancelled:true});return;}
      const secret=String(result.values.token??'');
      const bytes=new TextEncoder().encode(secret),digest=await crypto.subtle.digest('SHA-256',bytes);
      const tokenHash=Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,'0')).join('');
      await receipt.storage.set('result-form',{ok:true,action:result.action,name:result.values.name,tokenLength:secret.length,tokenHash});return;
    }
    if(mode==='background-before'||mode==='background-after'){await background($,mode);return;}
    if(mode==='background-after-trigger'){if(!launchAfter)throw Error('Launch the retained handle first');const start=launchAfter;launchAfter=undefined;void start();return;}
    throw Error('Unknown request probe mode');
}
export default {
  'session.start':async(_,$)=>{await $.ui.view('controls','Request controls',{lines:modes.map(mode=>({text:'Start '+mode,action:mode}))},{site:'inspector',focus:false});},
  'command.invoke':async(event,$)=>run(event.args.trim(),$),
  'ui.press':async(event,$)=>{if(modes.includes(event.key))await run(event.key,$);},
  'session.reload':async(_,$)=>{await $.storage.set('reload-complete',true);},
};
`);
  const state=join(paths.state,'plugin-state/request-probe');
  const modes=['approval-allow','approval-deny','question-a','question-b','questionnaire','form','background-before','background-after'];
  return{state,effects:Object.fromEntries(['allow','deny'].map(name=>[name,join(cwd,'request-'+name+'.effect')])),
    receipts:Object.fromEntries(modes.map(mode=>[mode,join(state,'result-'+mode+'.json')])),
    started:Object.fromEntries(modes.map(mode=>[mode,join(state,'started-'+mode+'.json')])),
    calls:Object.fromEntries(modes.map(mode=>[mode,join(state,'calls-'+mode+'.json')])),
    launchers:Object.fromEntries(['background-before','background-after'].map(mode=>[mode,join(state,'launcher-'+mode+'.json')])),
    requested:Object.fromEntries(['background-before','background-after'].map(mode=>[mode,join(state,'requested-'+mode+'.json')])),
    reloaded:join(state,'reload-complete.json'),rules:[
      {tool:'exec',command:'/bin/sh request-worker.sh allow',decision:'ask',reason:'Explicit local write requires human approval'},
      {tool:'exec',command:'/bin/sh request-worker.sh deny',decision:'ask',reason:'Explicit local write requires human approval'},
      {tool:'exec',decision:'deny',reason:'Other fixture shell invocations remain denied'},
    ]};
}
