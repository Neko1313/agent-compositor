import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {compareVersions} from '../../packages/loader/src/version.ts';
const base=process.argv[2],strict=process.argv.includes('--strict');if(!base)throw Error('Usage: bun tools/plugins/changed.mjs <base-ref> [--strict]');
const pendingVersions=[];
const changed=execFileSync('git',['diff','--name-only',base,'--','plugins'],{encoding:'utf8'}).trim().split('\n');
const names=[...new Set(changed.map(path=>path.split('/')[1]).filter(name=>name&&name!=='README.md'))];
for(const name of names){
 let current;try{current=JSON.parse(await readFile(`plugins/${name}/plugin.json`,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 let before;try{before=JSON.parse(execFileSync('git',['show',`${base}:plugins/${name}/plugin.json`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{continue;}
 // Documentation/test-only changes do not require releasing a new runtime version.
 const runtime=changed.filter(path=>path.startsWith(`plugins/${name}/`)&&!/(?:\/tests\/|\.test\.|\/README\.md$|\/CHANGELOG\.md$|\/plugin\.test\.json$)/.test(path));
 if(runtime.length&&compareVersions(current.version,before.version)<=0){
  if(strict)throw Error(`${name}: runtime/contract changes require an independent version bump`);
  pendingVersions.push(name);
 }
}

let previous;try{previous=JSON.parse(execFileSync('git',['show',`${base}:.claude-plugin/marketplace.json`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{}
if(previous?.metadata?.version){
 const current=JSON.parse(await readFile('.claude-plugin/marketplace.json','utf8'));
 const withoutVersion=value=>{const copy=structuredClone(value);delete copy.metadata.version;return JSON.stringify(copy);};
 if(strict&&withoutVersion(previous)!==withoutVersion(current)&&compareVersions(current.metadata?.version??'',previous.metadata.version)<=0)throw Error('Marketplace changes require an independent catalog version bump');
}
console.log(JSON.stringify({plugins:names,pendingVersions,mode:strict?'release':'automatic-preparation'}));
