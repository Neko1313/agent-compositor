import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildApp} from '../../packages/app/src/build.js';
import {installPluginArchive} from '../../packages/app/src/plugin-archive.js';
import {ScriptedProvider} from '@agent-compositor/core';
const name=process.argv[2];if(!/^[a-z][a-z0-9-]*$/.test(name??''))throw Error('Provide a plugin name');
const manifest=JSON.parse(await readFile(`plugins/${name}/plugin.json`,'utf8')),platform=`${process.platform}-${process.arch}`;
const archive=resolve(`dist/plugins/${name}/${manifest.version}/${name}-${manifest.version}-${platform}.tar.gz`);
const expected=(await readFile(archive+'.sha256','utf8')).split(' ')[0];assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),expected);
const root=await mkdtemp(join(tmpdir(),'ac-plugin-artifact-')),project=join(root,'project');await mkdir(project);
let app;
try{
 await installPluginArchive({url:'https://artifact.example/package.tar.gz',sha256:expected},root,name,new AbortController().signal,(async()=>new Response(await readFile(archive))) as typeof fetch);
 await writeFile(join(project,'agent-compositor.json'),JSON.stringify({enabledPlugins:[name],agent:{projectContext:false}}));
 app=await buildApp({cwd:project,env:{HOME:root},provider:new ScriptedProvider([]),agentHub:false,pluginDirs:[join(root,name)]});
 assert.deepEqual(app.pluginErrors,[]);assert.equal(app.plugins[0]?.manifest.name,name);
 const core=app.createCore(async()=>true);
 if(name==='monty'){const result=await core.invokeTool('run_python',{code:'6*7'});assert.equal(result.ok,true,result.error??'Tool failed');assert.equal((result.output as any).output,42);}
 if(name==='callix')assert.match(execFileSync(join(root,name,'bin/callix'),['--version'],{encoding:'utf8'}),/^callix /);
 if(name==='plugin-author'){const result=await core.invokeTool('plugin_dev',{action:'guide',topic:'contracts'});assert.equal(result.ok,true,result.error??'Tool failed');}
 console.log(JSON.stringify({plugin:name,version:manifest.version,platform,archiveSmoke:true}));
}finally{await app?.close();await rm(root,{recursive:true,force:true});}
