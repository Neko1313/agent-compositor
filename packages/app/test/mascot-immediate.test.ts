import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {ScriptedProvider} from '@agent-compositor/core';
import {buildApp} from '../src/build.js';

const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});

it('controls the actual mascot while Main remains held without queueing a model prompt',async()=>{
  const project=await mkdtemp(join(tmpdir(),'mascot-immediate-'));directories.push(project);
  const provider=new ScriptedProvider([{text:'MAIN_IS_WORKING',hold:true}]);
  const app=await buildApp({cwd:project,env:{HOME:project},provider,agentHub:false,
    pluginDirs:[fileURLToPath(new URL('../../../plugins',import.meta.url))],
    fixedConfig:{enabledPlugins:['mascot'],compaction:{enabled:false}}});
  const core=app.createCore(async()=>false);
  await core.start();
  const main=core.submit('Keep Main working');
  const settings=async()=>JSON.parse(await readFile(join(app.storage.paths.state,'mascot.json'),'utf8').catch(()=>'{}'));
  try{
    await expect.poll(()=>provider.requests.length).toBe(1);
    expect(core.host.hasPlugin('mascot')).toBe(true);
    await core.submit('/mascot pause');expect(await settings()).toMatchObject({paused:true});
    expect(core.getState()).toBe('running');expect(provider.requests[0].signal.aborted).toBe(false);
    await core.submit('/mascot resume');expect(await settings()).toMatchObject({paused:false});
    await core.submit('/mascot off');expect(await settings()).toMatchObject({enabled:false});
    await core.submit('/mascot on');expect(await settings()).toMatchObject({enabled:true});
    await Promise.all(['/mascot pause','/mascot resume','/mascot off','/mascot on'].map(command=>core.submit(command)));
    expect(await settings()).toMatchObject({paused:false,enabled:true});
    await core.submit('/mascot status');await core.submit('/mascot pet');await core.submit('/mascot reload');
    expect(provider.requests).toHaveLength(1);expect(core.getState()).toBe('running');
    expect(core.getMessages().filter(message=>message.role==='user').map(message=>message.content)).toEqual(['Keep Main working']);
  }finally{provider.release();await main;await app.close();}
});
