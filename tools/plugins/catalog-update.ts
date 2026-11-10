import {readFile,writeFile,cp,mkdir} from 'node:fs/promises';
import {marketplaceSchema} from '../../packages/app/src/marketplaces.js';
import {compareVersions,SEMVER} from '@agent-compositor/loader';
import {publicationGate} from './gate.js';
import {resolve,dirname} from 'node:path';
const file=process.argv[2];if(!file)throw Error('Usage: npm run plugin:catalog -- <marketplace-entry.json>');
const incoming=JSON.parse(await readFile(file,'utf8')),path='.claude-plugin/marketplace.json';
const catalog=marketplaceSchema.parse(JSON.parse(await readFile(path,'utf8')));
if(!/^[a-z][a-z0-9-]*$/.test(incoming.name??''))throw Error('Invalid plugin identity');
const index=catalog.plugins.findIndex(plugin=>plugin.name===incoming.name);
const manifest=JSON.parse(await readFile(`plugins/${incoming.name}/plugin.json`,'utf8'));
if(manifest.name!==incoming.name||compareVersions(incoming.version,manifest.version)>0)throw Error('Entry must refer to a reviewed plugin release, not a future development version');
if(incoming.source?.source!=='archive'||['linux-x64','linux-arm64','darwin-x64','darwin-arm64'].some(platform=>!incoming.source.assets?.[platform]))throw Error('Release entry must pin all four platform archives');
if(index>=0&&compareVersions(incoming.version,catalog.plugins[index].version??'0.0.0')<0)throw Error('Catalog updates cannot downgrade plugins');
const evidence=resolve(process.argv[3]??dirname(file)+'/certification/'+incoming.name);
await publicationGate(process.cwd(),incoming.name,evidence,incoming.source.assets,incoming.version);
const retained=resolve('.claude-plugin/certification',incoming.name,incoming.version);
if(retained!==evidence){await mkdir(dirname(retained),{recursive:true});await cp(evidence,retained,{recursive:true,force:true});}
if(JSON.stringify(catalog.plugins[index])!==JSON.stringify(incoming)){
 if(index<0)catalog.plugins.push(incoming);else catalog.plugins[index]=incoming;marketplaceSchema.parse(catalog);
 const metadata=(catalog.metadata??{}) as Record<string,unknown>;
 const parts=SEMVER.exec(String(metadata.version??'1.0.0'));if(!parts)throw Error('Invalid catalog metadata version');
 catalog.metadata={...metadata,version:`${parts[1]}.${parts[2]}.${BigInt(parts[3])+1n}`};
 await writeFile(path,JSON.stringify(catalog,null,2)+'\n');
}
console.log(JSON.stringify({name:incoming.name,version:incoming.version,catalogVersion:(catalog.metadata as Record<string,unknown>|undefined)?.version}));
