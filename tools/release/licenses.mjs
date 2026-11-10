import {access,readdir,mkdir,cp} from 'node:fs/promises';
import {join} from 'node:path';
/** Keep third-party notices with bundles; workspace code uses the root MIT license. */
export async function copyLicenseNotices(root,destination){
 for(const entry of await readdir(join(root,'node_modules'))){
  if(entry.startsWith('.')||entry==='@agent-compositor')continue;
  const names=entry.startsWith('@')?(await readdir(join(root,'node_modules',entry))).map(name=>`${entry}/${name}`):[entry];
  for(const name of names){
   const source=join(root,'node_modules',name);if(!await access(join(source,'package.json')).then(()=>true,()=>false))continue;
   const dest=join(destination,name);await mkdir(dest,{recursive:true});await cp(join(source,'package.json'),join(dest,'package.json'));
   for(const file of await readdir(source))if(/^(licen[cs]e|notice|copying|readme)([.-]|$)/i.test(file))await cp(join(source,file),join(dest,file),{recursive:true,dereference:true});
  }
 }
}
