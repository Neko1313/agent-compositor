import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** An explicitly enabled local plugin; all visible changes use public SDK services. */
export async function seedOpenTuiNavigationFixture(cwd,paths){
  const directory=join(cwd,'plugins/navigation-probe');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'navigation-probe',version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[
      {name:'/nav-panes',description:'Open the controlled navigation windows',ui:{site:'control'}},
      {name:'/nav-form',description:'Open an independently owned private form',ui:{site:'form'}},
      {name:'/nav-slow',description:'Open a delayed window',ui:{site:'slow'}},
      {name:'/nav-fast',description:'Open the current selected window',ui:{site:'fast'}},
    ],hookTimeouts:{'ui.press':300000,'session.reload':300000},compositor:{standard:1,apiVersion:1}}));
  await writeFile(join(directory,'hooks.js'),String.raw`
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function panes($,focus=false){
  const generation=await $.storage.get('generation')||1;
  const refreshed=await $.storage.get('refresh-finished');
  await $.ui.view('control','Navigation controls',{lines:[
    {text:'NAV_GENERATION_'+generation},
    {text:'Refresh inventory',action:'refresh'},
    {text:'Open private form',action:'form'},
  ]},{site:'inspector',workspace:1,focus});
  for(let index=1;index<=12;index++){
    if(index===12&&refreshed)continue;
    await $.ui.view('pane'+index,'Nav pane '+String(index).padStart(2,'0')+(index===11&&refreshed?' refreshed':''),
      {lines:[{text:'NAV_GENERATION_'+generation},{text:'Controlled native window '+index}]},{workspace:2,focus:false});
  }
  await $.ui.view('unicode','Заметки 窗口',{lines:[{text:'UNICODE_WINDOW'}]},{workspace:3,focus:false});
  await $.storage.set('panes',true);
}
async function start($,reload=false){
  const previous=await $.storage.get('generation')||0;
  await $.storage.set('generation',previous+1);
  if(reload){await $.storage.set('reload-started',true);await pause(800);}
  if(await $.storage.get('panes'))await panes($);
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
  'ui.press':async(event,$)=>{
    if(event.key==='command:/nav-panes'){await panes($,true);return;}
    if(event.key==='command:/nav-form'||event.key==='form'){await form($);return;}
    if(event.key==='command:/nav-fast'){
      await $.ui.view('fast','Fast route',{lines:[{text:'CURRENT_SELECTED_ROUTE'}]},{site:'inspector',focus:true});
      await $.storage.set('fast-route',true);return;
    }
    if(event.key==='command:/nav-slow'){
      const detached=$.background();await detached.storage.set('slow-started',true);await pause(800);
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
  const state=join(paths.state,'plugin-state/navigation-probe');
  return{state,formReceipt:join(state,'form-result.json'),formCalls:join(state,'form-calls.json'),ready:join(state,'ready.json'),
    slowStarted:join(state,'slow-started.json'),slowFinished:join(state,'slow-finished.json'),
    refreshStarted:join(state,'refresh-started.json'),refreshFinished:join(state,'refresh-finished.json'),
    reloadStarted:join(state,'reload-started.json'),approvalFile:join(cwd,'navigation-approval.txt')};
}
