import assert from 'node:assert/strict';
import {buildApp} from '../../packages/app/src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
import {behavior} from './behavior/index.js';
import {probe} from './package-contract.js';
const[cwd,home,directory,name]=process.argv.slice(2);
const app=await buildApp({cwd,env:{HOME:home},provider:new ScriptedProvider([{text:'contract model answer'}]),agentHub:false,sessionId:'certification',pluginDirs:[directory]});
try{assert.deepEqual(app.plugins.map(p=>p.manifest.name),[name]);assert.deepEqual(app.pluginErrors,[]);console.log(JSON.stringify({probe:await probe(app,name),...(process.argv.includes('--full')?{requirements:await behavior(name,app.plugins[0].dir)}:{})}));}finally{await app.close();}
