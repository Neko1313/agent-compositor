import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {storagePaths} from '@agent-compositor/config';
import {PluginLoader} from '@agent-compositor/loader';
import type {HooksHost} from '@agent-compositor/hooks';
import {buildApp,type BuildAppOptions} from '../src/build.js';
/** Positive fixtures explicitly opt into their discovered plugins. Policy tests use buildApp directly. */
export async function buildAppWithPlugins(options:BuildAppOptions){
 const home=options.env?.HOME??options.cwd;
 const dirs=[join(home,'.agent-compositor/plugins'),join(options.cwd,'plugins'),join(options.cwd,'.agent-compositor/plugins'),...(options.pluginDirs??[])];
 const {found}=await new PluginLoader({} as HooksHost,{dirs}).discover();
 const file=join(storagePaths(options.cwd,options.env??process.env).state,'extensions-state.json');
 const state=await readFile(file,'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return{disabled:[],installed:{}};});
 state.enabled=[...new Set([...(state.enabled??[]),...found.map(p=>p.manifest.name)])];
 await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(state));
 return buildApp(options);
}
