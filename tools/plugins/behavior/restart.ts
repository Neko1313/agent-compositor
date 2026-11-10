import {buildApp} from '../../../packages/app/src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
const[name,cwd,home,directory]=process.argv.slice(2),app=await buildApp({cwd,env:{HOME:home},provider:new ScriptedProvider([]),agentHub:false,pluginDirs:[directory],sessionId:'behavior'});
try{const core=app.createCore(async()=>true);if(name==='callix'){const r=await core.invokeTool('code_query',{action:'symbols',pattern:'alpha'});if(!r.ok)throw Error(r.error);console.log(JSON.stringify(r.output));}else if(name==='background-jobs'){await core.start();const r=await core.invokeTool('background_jobs',{action:'list'});if(!r.ok)throw Error(r.error);console.log(JSON.stringify(r.output));}else throw Error('Unsupported restart probe');}finally{await app.close();}
