import {realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {BuiltApp} from './build.js';
import {createOpenTuiHost} from './opentui-host.js';
import {connectWindowLayout} from './opentui-windows.js';

/** Resolve relocatable native assets beside the executable, never through cwd. */
async function rendererModule():Promise<typeof import('@agent-compositor/renderer-opentui')>{
  const bunMain=(globalThis as {Bun?:{main?:string}}).Bun?.main;
  if(import.meta.url.includes('/$bunfs/')||bunMain?.includes('/$bunfs/')){
    const executable=await realpath(process.execPath);
    return import(pathToFileURL(join(dirname(executable),'node_modules/@agent-compositor/renderer-opentui/index.js')).href);
  }
  return import('@agent-compositor/renderer-opentui');
}

export async function runOpenTui(app:BuiltApp,stdin:NodeJS.ReadStream,stdout:NodeJS.WriteStream,
  startupCommand?:string,env:NodeJS.ProcessEnv=process.env):Promise<void>{
  let layout:Awaited<ReturnType<typeof connectWindowLayout>>|undefined;
  let host:ReturnType<typeof createOpenTuiHost>|undefined;
  const stop=new AbortController();
  let startup:Promise<void>|undefined;
  let startupFailure:unknown;
  try{
    const windows=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});
    layout=windows;
    host=createOpenTuiHost(app,windows);
    const current=host;
    const {runOpenTuiRenderer}=await rendererModule();
    startup=current.start().then(async()=>{
      const command=startupCommand??(await app.shouldOfferSetup?.()?'/setup':undefined);
      if(command&&!stop.signal.aborted)await current.submit(command);
    }).catch(error=>{startupFailure=error;stop.abort(error);});
    await runOpenTuiRenderer([current.session],{
      stdin,stdout,environment:Object.fromEntries(Object.entries(env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),
      signal:stop.signal,windowLayout:windows,surfaces:current.surfaces,composerMedia:current.composerMedia,navigation:current.navigation,
      animations:env.AGENT_GRAPHICS!=='off'&&!env.NO_COLOR&&env.AGENT_REDUCED_MOTION!=='1',
      onCtrlC:()=>{
        if(current.navigation.handle({kind:'key',key:'c',modifiers:['ctrl']}))return 'handled';
        const focused=windows.snapshot().focused;
        const surface=current.surfaces.snapshot().find(source=>source.id===focused);
        const request=surface?.snapshot();
        if(request?.controller){surface?.cancelController?.(request.controller.id);return 'handled';}
        if(request?.approval){surface?.answerApproval?.(request.approval.id,false);return 'handled';}
        if(request?.interaction){surface?.cancelInteraction?.(request.interaction.id);return 'handled';}
        const form=request?.form;
        if(form){surface?.cancelForm?.(form.id);return 'handled';}
        const mainController=focused==='session'?current.session.snapshot().controller:undefined;
        if(mainController){current.session.cancelController?.(mainController.id);return 'handled';}
        if(current.cancelOperation(focused))return 'handled';
        if(current.core.getState()==='running'){current.core.interrupt();return 'handled';}
        return 'exit';
      },
    });
    if(startupFailure)throw startupFailure;
  }finally{
    stop.abort(new Error('Terminal closed'));
    await host?.close();
    await startup;
    await layout?.disconnect();
    await app.close();
  }
}
