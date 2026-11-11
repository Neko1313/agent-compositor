import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installCiRipgrep} from './ci-ripgrep.mjs';
it.skipIf(process.platform!=='linux'||process.arch!=='x64')('rejects altered archives before extraction and preserves an existing installation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ci-ripgrep-corrupt-'));
 try{
  const archive=join(root,'archive.tar.gz'),destination=join(root,'bin');await mkdir(destination);await writeFile(join(destination,'rg'),'existing');await writeFile(archive,'untrusted archive');
  await expect(installCiRipgrep({destination,archivePath:archive})).rejects.toThrow('checksum mismatch');expect(await readFile(join(destination,'rg'),'utf8')).toBe('existing');
 }finally{await rm(root,{recursive:true,force:true});}
});
