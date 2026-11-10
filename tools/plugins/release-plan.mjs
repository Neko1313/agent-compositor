import {readFile,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,relative,join} from 'node:path';
import {compareVersions,SEMVER} from '../../packages/loader/src/version.ts';

export const statePath='.plugin-release.json';
const catalogPath='.claude-plugin/marketplace.json';
const packaging=['tools/plugins/build.mjs','tools/release/licenses.mjs','tools/release/resources.mjs'];
const excluded=/(?:\/tests?\/|\.test\.|\/(?:README|CHANGELOG)\.md$|\/plugin\.test\.json$)/;
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const hash=value=>createHash('sha256').update(stable(value)).digest('hex');
function at(root,ref,path){try{return JSON.parse(git(root,'show',`${ref}:${path}`));}catch{return undefined;}}
const withoutVersion=value=>{if(!value)return value;const copy=structuredClone(value);delete copy.version;return copy;};
const catalogContent=value=>{const copy=structuredClone(value);if(copy.metadata)delete copy.metadata.version;return copy;};
export function bump(version,level){
 const parts=SEMVER.exec(version);if(!parts)throw Error('Invalid release version: '+version);
 const numbers=parts.slice(1,4).map(BigInt),index={major:0,minor:1,patch:2}[level];
 numbers[index]++;for(let i=index+1;i<3;i++)numbers[i]=0n;return numbers.join('.');
}
export function commitChange(message){
 const first=message.trim().split('\n')[0],match=/^([a-z]+)(?:\([^\n)]+\))?(!)?:\s+(.+)$/.exec(first);
 const breaking=!!match?.[2]||/^BREAKING[ -]CHANGE:\s*\S/m.test(message);
 const migration=message.match(/^BREAKING[ -]CHANGE:\s*([\s\S]+)$/m)?.[1].trim().replace(/\s+/g,' ');
 return{level:breaking?'major':match?.[1]==='feat'?'minor':'patch',summary:match?.[3]??(first||'Update plugin runtime'),breaking,migration};
}
const escape=text=>text.replace(/[\\`*_[\]<>{}]/g,'\\$&');
export function changelogEntry(version,commits,repository){
 const notes=commits.map(c=>{const change=commitChange(c.message);return `- ${change.breaking?'**BREAKING:** ':''}${escape(change.summary)} ([${c.sha.slice(0,7)}](https://github.com/${repository}/commit/${c.sha}))${change.migration?'\n  '+escape(change.migration):''}`;});
 return `## ${version}\n\n<!-- plugin-release:auto:start -->\n${notes.join('\n')}\n<!-- plugin-release:auto:end -->\n`;
}
export function insertChangelog(previous,version,entry){
 const headers=[...previous.matchAll(/^##\s+([^\s]+).*$/gm)];
 const existing=headers.find(h=>h[1]===version);
 if(existing){
  const end=headers.find(h=>h.index>existing.index)?.index??previous.length;
  const section=previous.slice(existing.index,end).replace(/<!-- plugin-release:auto:start -->[\s\S]*?<!-- plugin-release:auto:end -->\s*/g,'');
  const body=section.slice(section.indexOf('\n')+1).trim();
  return previous.slice(0,existing.index)+entry+(body?'\n'+body+'\n':'')+'\n'+previous.slice(end);
 }
 const point=headers[0]?.index??previous.length;
 return previous.slice(0,point).trimEnd()+'\n\n'+entry+'\n'+previous.slice(point);
}
/** Bundler inputs identify workspace code actually shipped in each native plugin. */
export async function bundleInputs(root,name,manifest){
 if(!globalThis.Bun)throw Error('Run plugin:prepare with Bun');
 const directory=join(root,'plugins',name),files=await readdir(directory);
 const main=manifest.main??manifest.entry??['hooks.ts','hooks.js','index.ts','index.js','index.mjs'].find(file=>files.includes(file));
 const entries=[main,['tools.ts','tools.js'].find(file=>files.includes(file))].filter(Boolean);
 if(!entries.length)return [];
 const result=await Bun.build({entrypoints:entries.map(file=>join(directory,file)),target:'bun',format:'esm',metafile:true});
 if(!result.success)throw new AggregateError(result.logs,`Cannot determine release inputs for ${name}`);
 const paths=Object.keys(result.metafile.inputs).map(file=>relative(root,resolve(root,file)).replaceAll('\\','/')).filter(file=>!file.startsWith('../'));
 for(const file of [...paths]){const workspace=/^(packages\/[^/]+)\//.exec(file)?.[1];if(workspace)paths.push(`${workspace}/package.json`);}
 // Monty's worker/native packages are copied separately rather than bundled.
 // Include every platform variant because preparation precedes the release matrix.
 if(name==='monty'){
  const packages=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8')).packages??{},seen=new Set();
  const queue=Object.keys(packages).filter(path=>/^node_modules\/@pydantic\/monty(?:-|$)/.test(path));
  for(const path of queue){if(seen.has(path))continue;seen.add(path);paths.push(`${path}/package.json`);for(const dependency of Object.keys(packages[path]?.dependencies??{}))queue.push(`node_modules/${dependency}`);}
 }
 return [...new Set(paths)];
}
/** Plan from committed history; writes are explicit and never include unrelated work. */
export async function prepareReleases(root,{write=false,inputs=bundleInputs}={}){
 root=resolve(root);
 if(git(root,'status','--porcelain').trim())throw Error('Plugin release preparation requires a clean committed checkout; it never stages developer changes');
 const head=git(root,'rev-parse','HEAD').trim();
 const state=JSON.parse(await readFile(join(root,statePath),'utf8'));
 if(state.schemaVersion!==1||!/^[a-f0-9]{40}$/.test(state.bootstrap)||!/^[-\w.]+\/[-\w.]+$/.test(state.repository)||!state.plugins||Array.isArray(state.plugins))throw Error('Invalid plugin release state');
 const catalog=JSON.parse(await readFile(join(root,catalogPath),'utf8')),originalCatalog=stable(catalog),originalCatalogContent=hash(catalogContent(catalog));
 const oldCatalog=state.catalog?.digest??hash(catalogContent(at(root,state.bootstrap,catalogPath)));
 const oldCatalogVersion=state.catalog?.version??at(root,state.bootstrap,catalogPath)?.metadata?.version??'1.0.0';
 const pending=[],writes=new Map();
 for(const name of (await readdir(join(root,'plugins'))).sort()){
  if(!/^[a-z][a-z0-9-]*$/.test(name))continue;
  const manifestPath=`plugins/${name}/plugin.json`,manifest=at(root,head,manifestPath);
  if(!manifest)continue;
  if(manifest.name!==name||!SEMVER.test(manifest.version))throw Error('Invalid plugin manifest: '+name);
  const baseline=state.plugins[name]?.commit??state.bootstrap;
  if(!/^[a-f0-9]{40}$/.test(baseline))throw Error('Invalid release baseline');
  git(root,'merge-base','--is-ancestor',baseline,head);
  const before=at(root,baseline,manifestPath),previous=state.plugins[name]?.version??before?.version;
  const changed=git(root,'diff','--name-only','-z',baseline,head).split('\0').filter(Boolean);
  const own=changed.filter(path=>path.startsWith(`plugins/${name}/`)&&!excluded.test(path)&&
   (path!==manifestPath||stable(withoutVersion(before))!==stable(withoutVersion(manifest))));
  const bundled=await inputs(root,name,manifest);
  const shared=changed.filter(path=>!path.startsWith(`plugins/${name}/`)&&(bundled.includes(path)||packaging.includes(path)));
  if(changed.includes('package-lock.json')){
   const left=at(root,baseline,'package-lock.json')?.packages??{},right=at(root,head,'package-lock.json')?.packages??{};
   if(bundled.some(path=>{const dependency=/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/.exec(path)?.[1];return dependency&&stable(left[dependency])!==stable(right[dependency]);}))shared.push('package-lock.json');
  }
  const paths=[...new Set([...own,...shared])];if(!paths.length)continue;
  const commits=git(root,'rev-list','--reverse',`${baseline}..${head}`,'--',...paths).trim().split('\n').filter(Boolean).map(sha=>({sha,message:git(root,'show','-s','--format=%B',sha).trim()}));
  if(!commits.length)continue;
  const rank={patch:0,minor:1,major:2},level=commits.reduce((level,c)=>rank[commitChange(c.message).level]>rank[level]?commitChange(c.message).level:level,'patch');
  const proposed=previous?bump(previous,level):manifest.version;
  const version=compareVersions(manifest.version,proposed)>0?manifest.version:proposed;
  const notes=changelogEntry(version,commits,state.repository);
  const path=`plugins/${name}/CHANGELOG.md`,previousNotes=await readFile(join(root,path),'utf8').catch(error=>{if(error.code==='ENOENT')return '# Changelog\n';throw error;});
  if(manifest.version!==version)writes.set(manifestPath,JSON.stringify({...manifest,version},null,2)+'\n');
  writes.set(path,insertChangelog(previousNotes,version,notes));
  state.plugins[name]={version,commit:head};
  const entry=catalog.plugins.find(entry=>entry.name===name);
  if(entry&&entry.source===`./plugins/${name}`)entry.version=version;
  pending.push({name,previous:previous??null,version,level,commits:commits.map(c=>c.sha),paths});
 }
 if(hash(catalogContent(catalog))!==oldCatalog){
  const current=catalog.metadata?.version??'1.0.0';
  let proposed=bump(oldCatalogVersion,'patch');
  // A generated batch may follow an already bumped development catalog. Its
  // additional entry changes must still advance relative to the PR's base.
  if(hash(catalogContent(catalog))!==originalCatalogContent&&compareVersions(proposed,current)<=0)proposed=bump(current,'patch');
  catalog.metadata={...catalog.metadata,version:compareVersions(current,proposed)>0?current:proposed};
  state.catalog={version:catalog.metadata.version,digest:hash(catalogContent(catalog))};
 }
 if(stable(catalog)!==originalCatalog)writes.set(catalogPath,JSON.stringify(catalog,null,2)+'\n');
 const previousState=await readFile(join(root,statePath),'utf8'),nextState=JSON.stringify(state,null,2)+'\n';
 if(nextState!==previousState)writes.set(statePath,nextState);
 if(write)for(const [path,content]of writes)await writeFile(join(root,path),content);
 return{head,plugins:pending,catalogVersion:catalog.metadata?.version,files:[...writes.keys()]};
}
if(import.meta.main){
 const args=process.argv.slice(2);if(args.some(arg=>arg!=='--write'))throw Error('Usage: npm run plugin:prepare -- [--write]');
 console.log(JSON.stringify(await prepareReleases(process.cwd(),{write:args.includes('--write')}),null,2));
}
