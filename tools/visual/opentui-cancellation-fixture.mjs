import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Two foreground tools share one plugin owner but keep separate command lifetimes. */
export async function seedOpenTuiCancellationFixture(cwd,paths){
  const directory=join(cwd,'plugins/cancellation-probe');await mkdir(directory,{recursive:true});
  await writeFile(join(cwd,'cancel-worker.sh'),String.raw`#!/bin/sh
case "$1" in a|b|denied) ;; *) exit 2 ;; esac
printf '%s\n' "$$" > "cancel-$1.pid"
printf '%s\n' "$1" > "cancel-$1.started"
while :; do /bin/sleep 1; done
`);
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'cancellation-probe',version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[{name:'/cancel-probe',description:'Run an independently cancellable local worker',execution:'immediate'}],
    hookTimeouts:{'command.invoke':300000},compositor:{standard:1,apiVersion:1}}));
  await writeFile(join(directory,'hooks.js'),String.raw`
export default {
  'command.invoke':async(event,$)=>{
    const name=event.args.trim();if(!['a','b','denied'].includes(name))throw Error('Expected a, b or denied');
    const title='Cancel worker '+name.toUpperCase();
    await $.ui.view(name,title,{lines:[{text:'WORKER_'+name.toUpperCase()+'_REQUESTED'}]},{site:'inspector',focus:true});
    const receipt=$.background();let result;
    try{result=await $.agent.tool('exec',{command:'/bin/sh cancel-worker.sh '+name,timeoutMs:300000});}
    catch(error){result={ok:false,error:String(error)};}
    await receipt.storage.set('result-'+name,{ok:result?.ok===true,error:result?.error,
      exitCode:result?.output?.exitCode,signalAborted:$.signal.aborted});
    await receipt.ui.view(name,title,{lines:[{text:name==='denied'?'POLICY_DENIED':'WORKER_'+name.toUpperCase()+'_SETTLED'}]},
      {site:'inspector',focus:false});
  },
  'session.reload':async(_,$)=>{await $.storage.set('reload-complete',true);},
};
`);
  const state=join(paths.state,'plugin-state/cancellation-probe');
  return{state,pids:Object.fromEntries(['a','b','denied'].map(name=>[name,join(cwd,'cancel-'+name+'.pid')])),
    receipts:Object.fromEntries(['a','b','denied'].map(name=>[name,join(state,'result-'+name+'.json')])),
    reloaded:join(state,'reload-complete.json'),rules:[
      {tool:'exec',command:'/bin/sh cancel-worker.sh a',decision:'allow',reason:'Exact isolated worker A fixture'},
      {tool:'exec',command:'/bin/sh cancel-worker.sh b',decision:'allow',reason:'Exact isolated worker B fixture'},
      {tool:'exec',decision:'deny',reason:'Other fixture shell invocations remain denied'},
    ]};
}
