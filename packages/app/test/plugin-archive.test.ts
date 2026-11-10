import {it,expect,afterEach} from 'vitest';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installPluginArchive} from '../src/plugin-archive.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
function pack(entries:{path:string;body?:string;type?:string;mode?:string}[]){
 const chunks:Buffer[]=[];
 for(const entry of entries){const body=Buffer.from(entry.body??''),header=Buffer.alloc(512);header.write(entry.path);header.write(entry.mode??'0000644',100);header.write(body.length.toString(8).padStart(11,'0'),124);header[156]=(entry.type??'0').charCodeAt(0);header.write('ustar',257);header.fill(32,148,156);const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);chunks.push(header,body,Buffer.alloc((512-body.length%512)%512));}
 return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
const manifest={path:'probe/plugin.json',body:'{"name":"probe","version":"1.0.0","trust":"trusted"}'};
async function install(bytes:Buffer,sha256=createHash('sha256').update(bytes).digest('hex')){
 const root=await mkdtemp(join(tmpdir(),'ac-archive-'));roots.push(root);
 const fetcher=async()=>new Response(bytes as unknown as BodyInit);
 return installPluginArchive({url:'https://artifacts.example/probe.tar.gz',sha256},root,'probe',new AbortController().signal,fetcher as typeof fetch);
}
it('extracts checked native artifacts and preserves executable bits without special permissions',async()=>{
 const root=await install(pack([manifest,{path:'probe/bin/server',body:'echo ready',mode:'0004755'}]));
 expect(JSON.parse(await readFile(join(root,'plugin.json'),'utf8')).name).toBe('probe');
 expect((await stat(join(root,'bin/server'))).mode&0o7777).toBe(0o755);
});
it('checks the downloaded digest before extracting files',async()=>{await expect(install(pack([manifest]),'0'.repeat(64))).rejects.toThrow('checksum');});
it.each(['../outside','/outside','probe/../../outside','other/plugin.json','probe\\outside'])('refuses escaping artifact entry %s',async path=>{await expect(install(pack([manifest,{path,body:'outside'}]))).rejects.toThrow('escapes');});
it.each(['1','2','3','6','x'])('rejects links, devices and unsupported tar extension %s',async type=>{await expect(install(pack([manifest,{path:'probe/link',type}]))).rejects.toThrow('links or special');});
it('rejects duplicate entries, missing manifests and truncated archives',async()=>{
 await expect(install(pack([manifest,manifest]))).rejects.toThrow('Duplicate');
 await expect(install(pack([{path:'probe/README.md',body:'readme'}]))).rejects.toThrow('missing');
 const archive=pack([manifest]);await expect(install(archive.subarray(0,20))).rejects.toThrow();
});
it('rejects credentials and insecure remote archive locations before network access',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ac-archive-url-'));roots.push(root);let calls=0;
 for(const url of ['http://example.com/artifact','https://user:secret@example.com/artifact'])await expect(installPluginArchive({url,sha256:'0'.repeat(64)},root,'probe',new AbortController().signal,(async()=>{calls++;return new Response();})as typeof fetch)).rejects.toThrow('HTTPS');
 expect(calls).toBe(0);
});
