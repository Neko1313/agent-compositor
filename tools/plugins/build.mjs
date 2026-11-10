// Build one plugin without changing or releasing the host application.
import {readFile,readdir,mkdir,writeFile,rm,cp,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {identity} from './certification.ts';
import {checkPlugin} from './check.ts';
import {copyLicenseNotices} from '../release/licenses.mjs';
import {copyPluginResources} from '../release/resources.mjs';
import {installCallix} from '../../plugins/callix/distribution.mjs';
const root=resolve(import.meta.dir,'../..'),name=process.argv[2];
const{directory,manifest}=await checkPlugin(root,name);
const tag=`plugin/${name}/v${manifest.version}`;
if(process.env.PLUGIN_RELEASE_TAG && process.env.PLUGIN_RELEASE_TAG!==tag)throw Error('Plugin release tag must match manifest version');
const platform=`${process.platform}-${process.arch}`,output=join(root,'dist/plugins',name,manifest.version),stage=join(output,platform,name);
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
const exists=path=>access(path).then(()=>true,()=>false);
const metadata={...manifest};
async function bundle(entry,target){
 const result=await Bun.build({entrypoints:[join(directory,entry)],target:'bun',format:'esm'});
 if(!result.success)throw new AggregateError(result.logs,'Plugin compilation failed');
 if(result.outputs.length!==1)throw Error('Unexpected plugin build assets');
 await writeFile(join(stage,target),Buffer.from(await result.outputs[0].arrayBuffer()));
}
const entry=manifest.main??manifest.entry??(await (async()=>{for(const path of ['hooks.ts','hooks.js','index.ts','index.js','index.mjs'])if(await exists(join(directory,path)))return path;})());
if(entry){await bundle(entry,'hooks.js');metadata.main='hooks.js';delete metadata.entry;}
for(const entry of ['tools.ts','tools.js'])if(await exists(join(directory,entry))){await bundle(entry,'tools.js');break;}
await writeFile(join(stage,'plugin.json'),JSON.stringify(metadata,null,2)+'\n');
await copyPluginResources(directory,stage,metadata);
if(name==='callix')await installCallix({destination:stage,platform,archivePath:process.env.CALLIX_RELEASE_ARCHIVE});
if(name==='monty'){
 const queue=['@pydantic/monty',`@pydantic/monty-${platform}${process.platform==='linux'?'-gnu':''}`],seen=new Set();
 for(const dependency of queue){if(seen.has(dependency))continue;seen.add(dependency);const source=join(root,'node_modules',dependency);await cp(source,join(stage,'node_modules',dependency),{recursive:true,dereference:true});queue.push(...Object.keys(JSON.parse(await readFile(join(source,'package.json'),'utf8')).dependencies??{}));}
}
await cp(join(root,'LICENSE'),join(stage,'LICENSE'));
await copyLicenseNotices(root,join(stage,'licenses'));
await writeFile(join(stage,'release.json'),JSON.stringify({plugin:name,version:manifest.version,tag,platform,hostApi:manifest.compositor.apiVersion,certification:await identity(root,name)},null,2)+'\n');
const archive=join(output,`${name}-${manifest.version}-${platform}.tar.gz`);
execFileSync('tar',['--format=ustar','-czf',archive,'-C',join(output,platform),name],{stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'}});
const digest=createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(archive+'.sha256',`${digest}  ${archive.split('/').at(-1)}\n`);
console.log(JSON.stringify({plugin:name,version:manifest.version,tag,platform,archive,sha256:digest}));
