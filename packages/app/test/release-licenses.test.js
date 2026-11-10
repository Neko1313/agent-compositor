import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {copyLicenseNotices} from '../../../tools/release/licenses.mjs';

it('keeps bundled dependency notices without copying unrelated documentation dependencies',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-notices-'));
 try{
  for(const name of ['runtime','documentation']){
   const directory=join(root,'node_modules',name);await mkdir(directory,{recursive:true});
   await writeFile(join(directory,'package.json'),JSON.stringify({name,version:'1.0.0'}));
   await writeFile(join(directory,'LICENSE'),'license');await writeFile(join(directory,'README.md'),'notice');
  }
  const destination=join(root,'licenses');
  await copyLicenseNotices(root,destination,new Set(['node_modules/runtime/index.js']));
  expect(await readFile(join(destination,'runtime/LICENSE'),'utf8')).toBe('license');
  expect(await readFile(join(destination,'runtime/README.md'),'utf8')).toBe('notice');
  await expect(readFile(join(destination,'documentation/package.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
