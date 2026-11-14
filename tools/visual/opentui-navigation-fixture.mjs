import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** An explicitly enabled local plugin; all visible changes use public SDK services. */
export async function seedOpenTuiNavigationFixture(cwd,paths){
  const directory=join(cwd,'plugins/navigation-probe');await mkdir(directory,{recursive:true});
  const gates=join(cwd,'.agent-compositor/navigation-gates');await mkdir(gates,{recursive:true});
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'navigation-probe',version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[
      {name:'/nav-panes',description:'Open the controlled navigation windows',ui:{site:'control'}},
      {name:'/nav-form',description:'Open an independently owned private form',ui:{site:'form'}},
      {name:'/nav-slow',description:'Open a delayed window',ui:{site:'slow'}},
      {name:'/nav-fast',description:'Open the current selected window',ui:{site:'fast'}},
      {name:'/nav-retained',description:'Open a retained gated route',ui:{site:'retained'}},
      {name:'/nav-focus',description:'Start a gated publication',execution:'immediate'},
    ],hookTimeouts:{'ui.press':300000,'command.invoke':300000,'session.reload':300000},compositor:{standard:1,apiVersion:1}}));
  await writeFile(join(directory,'hooks.js'),String.raw`
import {watch} from 'node:fs';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
async function gate($,name){
  const directory=join($.session.cwd,'.agent-compositor/navigation-gates');
  await new Promise((resolve,reject)=>{
    let watcher,finished=false;
    const finish=error=>{if(finished)return;finished=true;watcher?.close();$.signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>finish(Error('Fixture completion cancelled'));
    const check=()=>{void access(join(directory,name)).then(()=>finish(),error=>{if(error.code!=='ENOENT')finish(error);});};
    if($.signal.aborted){abort();return;}
    watcher=watch(directory,check);watcher.on('error',finish);$.signal.addEventListener('abort',abort,{once:true});check();
  });
}
async function focusView($,mode){
  const names={passive:'Passive publication',true:'Explicit focus',false:'Explicit passive',
    'rule-false':'Configured passive','rule-true':'Configured focus','late-main':'Late Main publication','late-mode':'Late mode publication'};
  const hint={workspace:6};
  if(mode==='true'||mode==='rule-false'||mode.startsWith('late-'))hint.focus=true;
  if(mode==='false')hint.focus=false;
  await $.ui.view('focus-'+mode,names[mode],{lines:[{text:'FOCUS_PUBLICATION_'+mode.toUpperCase()}]},hint);
  await $.storage.set('focus-published-'+mode,true);
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function panes($,focus=false){
  const generation=await $.storage.get('generation')||1;
  const refreshed=await $.storage.get('refresh-finished');
  await $.ui.view('control','Navigation controls',{lines:[
    {text:'NAV_GENERATION_'+generation},
    {text:'Refresh inventory',action:'refresh'},
    {text:'Open private form',action:'form'},
    {text:'Open retile workspace',action:'retile'},
    ...['true','false','rule-false','rule-true'].map(mode=>({text:'Publish focus '+mode,action:'focus:'+mode})),
  ]},{site:'inspector',workspace:1,focus});
  for(let index=1;index<=12;index++){
    if(index===12&&refreshed)continue;
    await $.ui.view('pane'+index,'Nav pane '+String(index).padStart(2,'0')+(index===11&&refreshed?' refreshed':''),
      {lines:[{text:'NAV_GENERATION_'+generation},{text:'Controlled native window '+index}]},{workspace:2,focus:false});
  }
  await $.ui.view('unicode','Заметки 窗口',{lines:[{text:'UNICODE_WINDOW'}]},{workspace:3,focus:false});
  await $.storage.set('panes',true);
}
async function retile($){
  await $.storage.set('retile',true);
  await $.ui.view('retile-a','Retile A',{lines:[{text:'RETILE_A'}]},{workspace:7,focus:false});
  await $.ui.view('retile-b','Retile B',{lines:[{text:'RETILE_B'}]},
    {workspace:7,site:'sidebar',size:.35,relativeTo:'plugin-navigation-probe-retile-a',focus:false});
  await $.ui.view('retile-c','Retile C',{lines:[{text:'RETILE_C'}]},
    {workspace:7,site:'inspector',size:.3,relativeTo:'plugin-navigation-probe-retile-b',focus:false});
  await $.storage.set('retile-ready',true);
}
async function start($,reload=false){
  const previous=await $.storage.get('generation')||0;
  await $.storage.set('generation',previous+1);
  if(reload){await $.storage.set('reload-started',true);await pause(800);}
  if(await $.storage.get('panes'))await panes($);
  if(await $.storage.get('retile'))await retile($);
  await $.storage.set('ready',{generation:previous+1});
}
async function form($){
  await $.storage.set('form-calls',(await $.storage.get('form-calls')||0)+1);
  const result=await $.ui.form({title:'Navigation private form',fields:[
    {id:'name',label:'Private name',type:'text',value:'FORMvalue'},
    {id:'enabled',label:'Enabled',type:'toggle',value:false},
  ],actions:[{id:'save',label:'Save private form'},{id:'cancel',label:'Cancel'}]});
  await $.storage.set('form-result',result);
}
export default {
  'session.start':async(_,$)=>start($),
  'session.reload':async(_,$)=>start($,true),
  'command.invoke':async(event,$)=>{
    const mode=event.args.trim();if(!['passive','late-main','late-mode'].includes(mode))throw Error('Unknown focus probe');
    const retained=$.background();await retained.storage.set('focus-started-'+mode,true);
    if(mode==='passive'){
      void(async()=>{try{await gate(retained,mode);await focusView(retained,mode);}catch(error){await retained.storage.set('focus-error-'+mode,String(error));}})();
      await retained.storage.set('focus-launcher-completed',true);return;
    }
    await gate($,mode);await focusView($,mode);
  },
  'ui.press':async(event,$)=>{
    if(event.key==='command:/nav-panes'){await panes($,true);return;}
    if(event.key==='command:/nav-form'||event.key==='form'){await form($);return;}
    if(event.key==='retile'){await retile($);return;}
    if(event.key.startsWith('focus:')){await focusView($,event.key.slice('focus:'.length));return;}
    if(event.key==='command:/nav-retained'){
      const retained=$.background();await retained.storage.set('retained-started',true);await gate(retained,'retained');
      await retained.ui.view('retained','Retained route',{lines:[{text:'RETAINED_PICKER_DESTINATION'}]},{workspace:6,focus:true});
      await retained.storage.set('retained-finished',true);return;
    }
    if(event.key==='command:/nav-fast'){
      await $.ui.view('fast','Fast route',{lines:[{text:'CURRENT_SELECTED_ROUTE'}]},{site:'inspector',focus:true});
      await $.storage.set('fast-route',true);return;
    }
    if(event.key==='command:/nav-slow'){
      const detached=$.background();await detached.storage.set('slow-started',true);await gate(detached,'slow');
      let published=false;
      try{await detached.ui.view('slow','Slow route',{lines:[{text:'LATE_CANCELLED_ROUTE'}]},{site:'inspector',focus:true});published=true;}catch{}
      await detached.storage.set('slow-finished',{published});return;
    }
    if(event.key==='refresh'){
      await $.storage.set('refresh-started',true);await pause(800);
      await $.ui.remove('pane12');
      await $.ui.view('pane11','Nav pane 11 refreshed',{lines:[{text:'NAV_REFRESH_COMPLETE'}]},{workspace:2,focus:false});
      await $.storage.set('refresh-finished',true);
    }
  },
};
`);
  const configFile=join(cwd,'agent-compositor.json'),config=JSON.parse(await readFile(configFile,'utf8'));
  config.ui={...config.ui,rules:[...(config.ui?.rules??[]),
    {match:{plugin:'navigation-probe',surface:'focus-rule-false'},focus:false,workspace:6},
    {match:{plugin:'navigation-probe',surface:'focus-rule-true'},focus:true,workspace:6},
  ]};await writeFile(configFile,JSON.stringify(config));
  const state=join(paths.state,'plugin-state/navigation-probe');
  return{state,retile:{ready:join(state,'retile-ready.json'),ids:Object.fromEntries(['a','b','c'].map(name=>[name,'plugin-navigation-probe-retile-'+name]))},focus:{gates:Object.fromEntries(['passive','late-main','late-mode','retained','slow'].map(name=>[name,join(gates,name)])),
    started:Object.fromEntries(['passive','late-main','late-mode'].map(name=>[name,join(state,'focus-started-'+name+'.json')])),
    published:Object.fromEntries(['passive','true','false','rule-false','rule-true','late-main','late-mode'].map(name=>[name,join(state,'focus-published-'+name+'.json')])),
    launcher:join(state,'focus-launcher-completed.json'),retainedStarted:join(state,'retained-started.json'),retainedFinished:join(state,'retained-finished.json')},formReceipt:join(state,'form-result.json'),formCalls:join(state,'form-calls.json'),ready:join(state,'ready.json'),
    slowStarted:join(state,'slow-started.json'),slowFinished:join(state,'slow-finished.json'),
    refreshStarted:join(state,'refresh-started.json'),refreshFinished:join(state,'refresh-finished.json'),
    reloadStarted:join(state,'reload-started.json'),approvalFile:join(cwd,'navigation-approval.txt')};
}
