import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {ScriptedProvider} from '@agent-compositor/core';
import {buildApp} from '../src/build.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{
  vi.useRealTimers();
  for(const close of cleanup.splice(0).reverse())await close();
  vi.restoreAllMocks();vi.unstubAllEnvs();
});
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}

it('does not resume UI or an animation timer after a mascot command is cancelled during an admitted config write',async()=>{
  const project=await mkdtemp(join(tmpdir(),'mascot-command-cancel-'));cleanup.push(()=>rm(project,{recursive:true,force:true}));
  vi.stubEnv('NO_COLOR',undefined);vi.stubEnv('TERM','xterm-256color');
  const provider=new ScriptedProvider([]),pluginDirs=[fileURLToPath(new URL('../../../plugins',import.meta.url))];
  const app=await buildApp({cwd:project,env:{HOME:project},provider,agentHub:false,pluginDirs,
    fixedConfig:{enabledPlugins:['mascot'],compaction:{enabled:false},
      agent:{builtinTools:[],controlTools:[],projectContext:false,skills:false,verifyCompletion:false}}});
  cleanup.push(()=>app.close());
  const mascot=app.plugins.find(plugin=>plugin.manifest.name==='mascot')!;
  expect(mascot?.dir).toBe(fileURLToPath(new URL('../../../plugins/mascot',import.meta.url)));
  const command=mascot.hooks['command.invoke'];let actualOnHandler:Promise<unknown>|undefined;
  vi.spyOn(mascot.hooks,'command.invoke').mockImplementation((event,$)=>{
    const completion=Promise.resolve(command(event,$));
    if(event.name==='/mascot'&&event.args==='on')actualOnHandler=completion;
    // Observe the physical plugin handler, even if Runtime has already rejected
    // the cancelled dispatch. This does not replace its actual implementation.
    void completion.catch(()=>{});return completion;
  });
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});
  layout.resize(100,36);cleanup.push(()=>layout.disconnect());
  const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());const core=host.core;
  const ui:{event:string;id?:string;label?:string;message?:string}[]=[];
  const committed=gate(),release=gate();cleanup.push(()=>release.resolve());let holdWrite=false;
  core.host.registerPlugin({name:'mascot-cancel-observer',version:'1.0.0',trust:'trusted'},{
    'service.ui.view':input=>{if(input.plugin==='mascot')ui.push({event:'view',id:input.id,label:input.view.attachment?.label});},
    'service.ui.notify':input=>{if(input.plugin==='mascot')ui.push({event:'notify',message:input.message});},
    'service.ui.remove':input=>{if(input.plugin==='mascot')ui.push({event:'remove',id:input.id});},
    'service.fs.write':async(input,$)=>{
      if(!holdWrite||input.plugin!=='mascot'||input.path!=='.agent-compositor/mascot.json'||!JSON.parse(input.content).enabled)return;
      const result=await $.next();committed.resolve();await release.promise;return result;
    },
  });
  await host.start();expect(core.host.hasPlugin('mascot')).toBe(true);
  const unsubscribe=host.composerMedia.subscribe(false,()=>{});cleanup.push(unsubscribe);
  await expect.poll(()=>host.composerMedia.presentation?.()?.hasImage).toBe(true);
  await core.invokeCommand('/mascot off');expect(host.composerMedia.presentation?.()?.hasImage).toBe(false);
  const config=()=>readFile(join(app.storage.paths.state,'mascot.json'),'utf8').then(JSON.parse);
  expect(await config()).toMatchObject({enabled:false});

  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});holdWrite=true;
  const controller=new AbortController(),outcome=core.invokeCommand('/mascot on',controller.signal).then(
    value=>({value}),error=>({error}));
  await committed.promise;
  // A write admitted before cancellation may have committed. It is not rolled
  // back; only the cancelled command's later UI effects must be suppressed.
  expect(await config()).toMatchObject({enabled:true});expect(actualOnHandler).toBeDefined();
  const before=ui.length;controller.abort(Error('Cancel the mascot command'));release.resolve();
  await actualOnHandler!.catch(()=>{});
  await vi.advanceTimersByTimeAsync(1000);
  expect(await outcome).toMatchObject({error:expect.any(Error)});
  expect({laterUI:ui.slice(before),timers:vi.getTimerCount()}).toEqual({laterUI:[],timers:0});
  expect(host.composerMedia.presentation?.()?.hasImage).toBe(false);
  expect(await config()).toMatchObject({enabled:true});expect(provider.requests).toEqual([]);
});
