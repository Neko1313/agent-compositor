import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
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

it('freezes source time before a paused settings write settles while transient expiry stays live',async()=>{
  const project=await mkdtemp(join(tmpdir(),'mascot-pause-'));cleanup.push(()=>rm(project,{recursive:true,force:true}));
  vi.stubEnv('NO_COLOR',undefined);vi.stubEnv('TERM','xterm-256color');
  const provider=new ScriptedProvider([]),pluginDirs=[fileURLToPath(new URL('../../../plugins',import.meta.url))];
  const app=await buildApp({cwd:project,env:{HOME:project},provider,agentHub:false,pluginDirs,
    fixedConfig:{enabledPlugins:['mascot'],compaction:{enabled:false},
      agent:{builtinTools:[],controlTools:[],projectContext:false,skills:false,verifyCompletion:false}}});
  cleanup.push(()=>app.close());
  expect(app.plugins.find(plugin=>plugin.manifest.name==='mascot')?.dir)
    .toBe(fileURLToPath(new URL('../../../plugins/mascot',import.meta.url)));
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});
  layout.resize(100,36);cleanup.push(()=>layout.disconnect());
  const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());const core=host.core;
  const views:{label:string|undefined;frame:string|undefined}[]=[];
  const committed=gate(),release=gate();let holdWrite=false,pause:Promise<unknown>|undefined;
  const visibilityCalls:{input:any;completion:ReturnType<typeof core.host.emit>}[]=[];
  const emit=core.host.emit.bind(core.host);
  vi.spyOn(core.host,'emit').mockImplementation((name,input,signal,dispatchSignal)=>{
    const completion=emit(name,input,signal,dispatchSignal);
    if(name==='ui.visibility')visibilityCalls.push({input:structuredClone(input),completion});
    return completion;
  });
  core.host.registerPlugin({name:'mascot-pause-observer',version:'1.0.0',trust:'trusted'},{
    'service.ui.view':input=>{
      if(input.plugin==='mascot')views.push({label:input.view.attachment?.label,
        frame:input.view.raster?createHash('sha256').update(input.view.raster.rgba).digest('hex'):undefined});
    },
    'service.fs.write':async(input,$)=>{
      if(!holdWrite||input.plugin!=='mascot'||input.path!=='.agent-compositor/mascot.json'||!JSON.parse(input.content).paused)return;
      const result=await $.next();committed.resolve();await release.promise;return result;
    },
  });
  await host.start();expect(core.host.hasPlugin('mascot')).toBe(true);
  const unsubscribe=host.composerMedia.subscribe(false,()=>{});cleanup.push(unsubscribe);
  await expect.poll(()=>visibilityCalls.find(call=>call.input.site==='plugin:mascot/companion'&&call.input.visible&&call.input.rows===6)).toBeDefined();
  const visible=visibilityCalls.find(call=>call.input.site==='plugin:mascot/companion'&&call.input.visible&&call.input.rows===6)!;
  expect((await visible.completion).faults).toEqual([]);
  const config=()=>readFile(join(app.storage.paths.state,'mascot.json'),'utf8').then(JSON.parse);
  cleanup.push(async()=>{release.resolve();await pause?.catch(()=>{});});

  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});
  // Restart through the public command so source time and the controlled clock
  // share an epoch, then create a real transient rather than injecting a pose.
  await core.invokeCommand('/mascot on');await core.invokeCommand('/mascot pet');
  const first=views.at(-1)!;expect(first).toMatchObject({label:'Done!',frame:expect.any(String)});
  await vi.advanceTimersByTimeAsync(1000);
  const admitted=views.at(-1)!;expect(admitted.label).toBe('Done!');expect(admitted.frame).not.toBe(first.frame);
  holdWrite=true;pause=core.invokeCommand('/mascot pause');void pause.catch(()=>{});
  await committed.promise;expect(await config()).toMatchObject({paused:true});
  const before=views.length;
  await vi.advanceTimersByTimeAsync(400);
  expect(views.slice(before)).not.toEqual([]);
  for(const view of views.slice(before))expect(view).toEqual({label:'Done! · paused',frame:admitted.frame});

  // Pause freezes motion, not the shared transient-expiry deadline. The write
  // remains held while Done expires and publishes the paused idle state.
  await vi.advanceTimersByTimeAsync(401);
  expect(views.at(-1)?.label).toBe('Ready · paused');
  const idle=views.at(-1)!.frame;expect(idle).toEqual(expect.any(String));
  release.resolve();await pause;expect(views.at(-1)).toEqual({label:'Ready · paused',frame:idle});
  holdWrite=false;await core.invokeCommand('/mascot resume');
  await vi.advanceTimersByTimeAsync(181);
  expect(views.at(-1)?.label).toBe('Ready');expect(views.at(-1)?.frame).not.toBe(idle);
  expect(await config()).toMatchObject({paused:false});expect(provider.requests).toEqual([]);
});
