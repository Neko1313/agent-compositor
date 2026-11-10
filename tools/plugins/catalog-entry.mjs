import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {compareVersions} from '../../packages/loader/src/version.ts';
import {publicationGate} from './gate.ts';
const name=process.env.PLUGIN_NAME??process.argv[2];if(!/^[a-z][a-z0-9-]*$/.test(name??''))throw Error('Provide a plugin identity');
const manifest=JSON.parse(await readFile(`plugins/${name}/plugin.json`,'utf8')),tag=`plugin/${name}/v${manifest.version}`;
const directory=process.argv[3]??'dist/plugin-release',repository=process.env.GITHUB_REPOSITORY??'Neko1313/agent-compositor';
if(!/^[\w.-]+\/[\w.-]+$/.test(repository))throw Error('Invalid release repository');
const files=[];async function walk(path){for(const entry of await readdir(path,{withFileTypes:true})){if(entry.isDirectory())await walk(join(path,entry.name));else files.push(join(path,entry.name));}}await walk(directory);
const assets={};
for(const platform of ['linux-x64','linux-arm64','darwin-x64','darwin-arm64']){
 const filename=`${name}-${manifest.version}-${platform}.tar.gz`,file=files.find(path=>path.endsWith('/'+filename));
 if(!file)throw Error('Missing verified plugin artifact: '+platform);
 const sha256=createHash('sha256').update(await readFile(file)).digest('hex');
 const declared=(await readFile(file+'.sha256','utf8')).split(' ')[0];if(sha256!==declared)throw Error('Artifact checksum mismatch');
 assets[platform]={url:`https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${filename}`,sha256};
}
const catalog=JSON.parse(await readFile('.claude-plugin/marketplace.json','utf8')),entry=catalog.plugins.find(plugin=>plugin.name===name);
if(entry?.version&&compareVersions(entry.version,manifest.version)>0)throw Error('Catalog version is newer than this release');
const result={...(entry??{name,description:manifest.description,compositor:{format:'native'}}),version:manifest.version,source:{source:'archive',assets}};
await publicationGate(process.cwd(),name,join(directory,'certification',name),assets,manifest.version);
await writeFile(join(directory,'marketplace-entry.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({name,version:manifest.version,tag,platforms:Object.keys(assets)}));
