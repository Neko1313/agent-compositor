import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,posix} from 'node:path';
const limit=128*1024*1024;
function artifactUrl(value:string){
 const url=new URL(value);
 if(url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Plugin archives require credential-free HTTPS');
 return url;
}
/** Curated native release artifacts use regular-file/directory ustar, with no links or extensions. */
export async function installPluginArchive(artifact:{url:string;sha256:string},destination:string,name:string,signal:AbortSignal,fetcher:typeof fetch=fetch){
 signal=AbortSignal.any([signal,AbortSignal.timeout(120000)]);
 let url=artifactUrl(artifact.url),response:Response|undefined;
 for(let redirects=0;redirects<5;redirects++){
  response=await fetcher(url,{signal,redirect:'manual'});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Archive redirect has no location');url=artifactUrl(new URL(location,url).href);continue;
  }
  break;
 }
 if(!response?.ok||!response.body)throw Error('Plugin archive download failed');
 const chunks:Uint8Array[]=[];let bytes=0;
 for await(const chunk of response.body){signal.throwIfAborted();bytes+=chunk.byteLength;if(bytes>limit){await response.body.cancel().catch(()=>{});throw Error('Plugin archive exceeds download limit');}chunks.push(chunk);}
 const compressed=Buffer.concat(chunks);
 if(createHash('sha256').update(compressed).digest('hex')!==artifact.sha256)throw Error('Plugin archive checksum mismatch');
 const tar=gunzipSync(compressed,{maxOutputLength:512*1024*1024}),seen=new Set<string>();let files=0;
 const text=(header:Buffer,start:number,length:number)=>header.subarray(start,start+length).toString('utf8').split('\0')[0];
 const octal=(header:Buffer,start:number,length:number)=>{const raw=text(header,start,length).trim();if(!/^[0-7]*$/.test(raw))throw Error('Invalid archive numeric field');return parseInt(raw||'0',8);};
 for(let offset=0;offset+512<=tar.length;){
  signal.throwIfAborted();const header=tar.subarray(offset,offset+512);if(header.every(value=>value===0))break;
  const checksum=octal(header,148,8);let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i];if(sum!==checksum)throw Error('Invalid archive header checksum');
  if(text(header,257,5)!=='ustar')throw Error('Plugin release archive must use ustar format');
  const prefix=text(header,345,155),entry=(prefix?prefix+'/':'')+text(header,0,100),path=entry.replace(/\/$/,'');
  if(path.includes('\\')||path.includes('\ufffd')||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..')||path!==name&&!path.startsWith(name+'/'))throw Error('Plugin archive path escapes package');
  if(seen.has(path)||++files>10000)throw Error('Duplicate archive path or too many files');seen.add(path);
  const kind=String.fromCharCode(header[156]),size=octal(header,124,12),mode=octal(header,100,8);
  if(!['0','\0','5'].includes(kind))throw Error('Plugin archives may not contain links or special entries');
  if(kind==='5'&&size!==0||offset+512+size>tar.length)throw Error('Truncated plugin archive');
  const target=join(destination,...path.split('/'));
  if(kind==='5')await mkdir(target,{recursive:true});
  else{await mkdir(join(target,'..'),{recursive:true});await writeFile(target,tar.subarray(offset+512,offset+512+size),{flag:'wx',mode:mode&0o111?0o755:0o644});}
  offset+=512+Math.ceil(size/512)*512;
 }
 if(!seen.has(name+'/plugin.json'))throw Error('Plugin archive is missing its native manifest');
 return join(destination,name);
}
