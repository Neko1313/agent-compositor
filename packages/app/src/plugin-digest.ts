import {createHash} from 'node:crypto';
import {readdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {contained} from '@agent-compositor/loader';
/** Content lock excludes host SDK links and repository internals. */
export async function pluginDigest(root:string){
  const hash=createHash('sha256');let bytes=0,files=0;
  const visited=new Set<string>();
  async function walk(relative:string){
    const path=await contained(root,relative),info=await stat(path);
    if(info.isDirectory()){
      if(visited.has(path)||visited.size>1000)throw Error('Plugin directories contain a cycle or exceed limits');visited.add(path);
      for(const child of (await readdir(path)).sort()){
      if(child==='.git'||relative==='node_modules'&&child==='@agent-compositor')continue;
      await walk(join(relative,child));
      }
    }
    else if(info.isFile()){
      bytes+=info.size;files++;
      if(bytes>512*1024*1024||files>10000)throw Error('Plugin package exceeds content lock limits');
      hash.update(relative.split('\\').join('/'));hash.update('\0');hash.update(String(info.size));hash.update('\0');hash.update(await readFile(path));
    }else throw Error('Unsupported plugin resource');
  }
  await walk('.');return hash.digest('hex');
}
