import {access,readdir,mkdir,cp,readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
/** Keep third-party notices with bundles; workspace code uses the root MIT license. */
export async function copyLicenseNotices(root,destination,inputs){
 const sources=new Set();
 if(inputs){
  for(const input of inputs){
   const path=resolve(root,input),marker=`${sep}node_modules${sep}`,offset=path.lastIndexOf(marker);
   if(offset<0)continue;
   const parts=path.slice(offset+marker.length).split(sep),count=parts[0].startsWith('@')?2:1;
   if(parts[0]==='@agent-compositor')continue;
   sources.add(join(path.slice(0,offset+marker.length),...parts.slice(0,count)));
  }
 }else for(const entry of await readdir(join(root,'node_modules'))){
  if(entry.startsWith('.')||entry==='@agent-compositor')continue;
  const names=entry.startsWith('@')?(await readdir(join(root,'node_modules',entry))).map(name=>`${entry}/${name}`):[entry];
  for(const name of names)sources.add(join(root,'node_modules',name));
 }
 const seen=new Map();
 for(const source of sources){
   if(!await access(join(source,'package.json')).then(()=>true,()=>false))continue;
   const {name,version}=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
   if(typeof name!=='string'||!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)||name.split('/').some(part=>part==='.'||part==='..'))throw Error('Invalid dependency name in license manifest');
   const identity=`${name}@${version}`,versions=seen.get(name)??new Set();
   if(versions.has(identity))continue;
   const suffix=versions.size?`@${String(version).replace(/[^a-z0-9._-]/gi,'_')}`:'';
   versions.add(identity);seen.set(name,versions);
   const dest=join(destination,name+suffix);await mkdir(dest,{recursive:true});await cp(join(source,'package.json'),join(dest,'package.json'));
   for(const file of await readdir(source))if(/^(licen[cs]e|notice|copying|readme)([.-]|$)/i.test(file))await cp(join(source,file),join(dest,file),{recursive:true,dereference:true});
 }
}
