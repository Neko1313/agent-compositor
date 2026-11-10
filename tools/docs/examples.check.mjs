import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cp, mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {buildApp} from '../../packages/app/src/index.ts';
import {ScriptedProvider} from '../../packages/core/src/index.ts';
import {root} from './structure.mjs';

test('the documented greeting package runs through real opt-in, reload and disable',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'compositor-doc-example-'));
  let app;
  try {
    const cwd=join(directory,'project'),home=join(directory,'home');
    await mkdir(join(cwd,'plugins'),{recursive:true});
    await cp(resolve(root,'tools/docs/examples/hello'),join(cwd,'plugins/hello'),{recursive:true});
    const provider=new ScriptedProvider([{text:'Ordinary prompt reached the model.'}]);
    app=await buildApp({cwd,env:{HOME:home},provider,agentHub:false});
    assert.equal(app.plugins.length,0,'Discovery must not activate the example');
    const core=app.createCore(async()=>true);
    await core.start();
    const activation=await core.invokeTool('extension_control',{action:'enable',name:'hello',scope:'project'});
    assert.equal(activation.ok,true,JSON.stringify(activation));
    await app.reloadPlugins(core);
    assert.equal(app.pluginErrors.length,0);
    assert(app.commands().some(command=>command.name==='/hello'));
    const notices=[];
    const unsubscribe=core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.notification')notices.push(event.input.message);});
    await core.submit('/hello');
    assert.equal(core.failure,undefined);
    assert(notices.includes('Hello from your plugin!'));
    assert.equal(provider.requests.length,0,'The command must not call a model');
    await core.submit('/hello-other');
    assert.equal(provider.requests.length,1,'Nearby commands must pass through');
    await app.reloadPlugins(core);
    await core.submit('/hello');
    assert.equal(notices.filter(value=>value==='Hello from your plugin!').length,2,'Reload must not duplicate hooks');
    await core.invokeTool('extension_control',{action:'disable',name:'hello',scope:'project'});
    await app.reloadPlugins(core);
    assert(!app.commands().some(command=>command.name==='/hello'));
    unsubscribe();
  }finally {await app?.close();await rm(directory,{recursive:true,force:true});}
});
