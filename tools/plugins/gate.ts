import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {certifiedTestPlanSchema,compareVersions,SEMVER} from '@agent-compositor/loader';
import {platforms,identity,workspaceDigest,digest,packageDigest,verifyCertificate} from './certification.js';
export function verifyPreviousVersion(root:string,name:string,version:string,declared:string|null){
 const tags=execFileSync('git',['tag','--list',`plugin/${name}/v*`],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const versions=tags.map(tag=>tag.slice(`plugin/${name}/v`.length)).filter(value=>SEMVER.test(value)&&compareVersions(value,version)<0).sort(compareVersions);
 const previous=versions.at(-1)??null;
 if(declared!==previous)throw Error('Previous release declaration must match the preceding plugin tag: '+previous);
}
/** Publication/promotion only consume complete evidence; reports never grant themselves a pass. */
export async function publicationGate(root:string,name:string,evidence:string,assets:Record<string,{sha256:string}>,version?:string){
 if(!/^[a-z][a-z0-9-]*$/.test(name))throw Error('Invalid plugin identity');
 const current=JSON.parse(await readFile(join(root,'plugins',name,'plugin.json'),'utf8'));
 const target=version??current.version;
 if(!SEMVER.test(target))throw Error('Invalid release version');
 const ref=`plugin/${name}/v${target}`;
 const manifest=JSON.parse(execFileSync('git',['show',`${ref}:plugins/${name}/plugin.json`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const planBytes=execFileSync('git',['show',`${ref}:plugins/${name}/plugin.test.json`],{cwd:root});
 const plan=certifiedTestPlanSchema.parse(JSON.parse(planBytes.toString()));
 const tree=execFileSync('git',['ls-tree','-r',ref,'--',`plugins/${name}`],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
 if(tree.some(line=>!/^100(?:644|755) blob /.test(line)))throw Error('Release snapshot contains unsupported file entries');
 const paths=tree.map(line=>line.slice(line.indexOf('\t')+1)).sort();
 const entries=paths.map(path=>path.slice(`plugins/${name}/`.length)+'\0'+digest(execFileSync('git',['show',`${ref}:${path}`],{cwd:root})));
 const expected={plugin:name,version:target,source:digest(entries.sort().join('\n')),workspace:await workspaceDigest(root,ref),plan:digest(planBytes),hostApi:1 as const};
 verifyPreviousVersion(root,name,target,plan.previousVersion);
 if(manifest.name!==name||version&&manifest.version!==version)throw Error('Certification release identity mismatch');
 if(plan.platforms.length!==platforms.length||platforms.some(p=>!plan.platforms.includes(p)))throw Error('Official publication requires all four supported platform certificates');
 // Reject surplus/missing platforms, rather than silently ignoring an untested distribution.
 if(Object.keys(assets).length!==plan.platforms.length)throw Error('Artifact platform matrix does not match plan');
 await verifyCertificate(join(evidence,'release','linux-x64'),plan,expected,'release','linux-x64');
 for(const platform of plan.platforms){
  if(!assets[platform]||!/^[a-f0-9]{64}$/.test(assets[platform].sha256))throw Error('Missing artifact checksum: '+platform);
  await verifyCertificate(join(evidence,'artifact',platform),plan,expected,'artifact',platform,assets[platform].sha256);
 }
 return{plugin:name,version:manifest.version,certified:true};
}
if(import.meta.main){
 const [name,directory,assetsFile]=process.argv.slice(2);
 if(!name||!directory||!assetsFile)throw Error('Usage: plugin:gate <name> <evidence-directory> <marketplace-entry.json>');
 const entry=JSON.parse(await readFile(assetsFile,'utf8'));
 if(entry.name!==name||entry.source?.source!=='archive')throw Error('Archive release entry required');
 console.log(JSON.stringify(await publicationGate(process.cwd(),name,resolve(directory),entry.source.assets,entry.version)));
}
