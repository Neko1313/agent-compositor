import {SEMVER} from '../../packages/loader/src/version.ts';
import {readFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareReleases} from './release-plan.mjs';

export async function releaseMetadata(root,{tag='',candidateName='',candidateSha=''}={}){
 if(tag&&(candidateName||candidateSha))throw Error('Choose a plugin tag OR candidate_name and candidate_sha');
 let name,version;
 if(tag){
  const match=/^plugin\/([a-z][a-z0-9-]*)\/v([^/]+)$/.exec(tag);
  if(!match||!SEMVER.test(match[2]))throw Error('Use plugin/<name>/v<SemVer>');
  [,name,version]=match;
 }else{
  if(!/^[a-z][a-z0-9-]*$/.test(candidateName)||!/^[a-f0-9]{40}$/.test(candidateSha))throw Error('Candidate requires a plugin name and full 40-character commit SHA');
  name=candidateName;
 }
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(sha)||(!tag&&sha!==candidateSha))throw Error('Candidate checkout does not match requested immutable SHA');
 const manifest=JSON.parse(await readFile(join(root,'plugins',name,'plugin.json'),'utf8'));
 if(manifest.name!==name||!SEMVER.test(manifest.version)||(tag&&manifest.version!==version))throw Error('Tag identity/version does not match plugin manifest');
 if((await prepareReleases(root)).plugins.some(plugin=>plugin.name===name))throw Error('Plugin has unprepared runtime changes; merge the generated plugin release PR before certification');
 return{name,version:manifest.version,tag:tag||`plugin/${name}/v${manifest.version}`,sha,mode:tag?'tag':'candidate'};
}
if(import.meta.main){
 const result=await releaseMetadata(process.cwd(),{
  tag:process.env.PLUGIN_RELEASE_TAG??process.argv[2]??'',
  candidateName:process.env.PLUGIN_CANDIDATE_NAME??'',candidateSha:process.env.PLUGIN_CANDIDATE_SHA??'',
 });
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,Object.entries(result).map(([key,value])=>`${key}=${value}\n`).join(''));
 console.log(JSON.stringify(result));
}
