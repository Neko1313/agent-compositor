import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {linkPublicSdk} from '../../packages/app/src/extensions.js';
import {installPluginArchive} from '../../packages/app/src/plugin-archive.js';
export async function withCandidate<T>(ctx:any,action:(directory:string)=>Promise<T>):Promise<T>{
 if(ctx.stage!=='artifact')return action(join(process.cwd(),'plugins',ctx.identity.plugin));
 const root=await mkdtemp(join(tmpdir(),'ac-certified-candidate-'));
 try{
  const name=ctx.identity.plugin;await installPluginArchive({url:'https://artifact.example/candidate.tar.gz',sha256:ctx.artifactSha256},root,name,new AbortController().signal,(async()=>new Response(await readFile(ctx.artifact))) as typeof fetch);
  const directory=join(root,name),manifest=JSON.parse(await readFile(join(directory,'plugin.json'),'utf8')),release=JSON.parse(await readFile(join(directory,'release.json'),'utf8'));
  assert.equal(manifest.name,name);assert.equal(manifest.version,ctx.identity.version);assert.deepEqual(release.certification,ctx.identity);assert.equal(release.platform,ctx.platform);
  await linkPublicSdk(directory);
  return await action(directory);
 }finally{await rm(root,{recursive:true,force:true});}
}
