import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';

export interface ReadCursor {path:string;offset?:number;limit?:number;index:number;hash:string}
const prefix='read-v1:', maximum=16384;
export const readHash=(content:string)=>createHash('sha256').update(content).digest('hex');
export function encodeReadCursor(value:ReadCursor):string {
 const token=prefix+Buffer.from(JSON.stringify([value.path,value.offset??null,value.limit??null,value.index,value.hash])).toString('base64url');
 if(token.length>maximum)throw Error('read: continuation path exceeds the cursor limit; use a shorter canonical path');
 return token;
}
export function decodeReadCursor(token:unknown):ReadCursor {
 const invalid=()=>Error('read.cursor is invalid or unsupported. Copy nextCursor verbatim from a fresh read result.');
 if(typeof token!=='string'||token.length>maximum||!token.startsWith(prefix))throw invalid();
 const encoded=token.slice(prefix.length);if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw invalid();
 const bytes=Buffer.from(encoded,'base64url'),text=bytes.toString('utf8');
 if(bytes.toString('base64url')!==encoded||!Buffer.from(text).equals(bytes))throw invalid();
 let fields:any;try{fields=JSON.parse(text);}catch{throw invalid();}
 if(!Array.isArray(fields)||fields.length!==5)throw invalid();
 const [path,offset,limit,index,hash]=fields;
 if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0')
  ||offset!==null&&(!Number.isSafeInteger(offset)||offset<1)
  ||limit!==null&&(!Number.isSafeInteger(limit)||limit<1||limit>10000)
  ||!Number.isSafeInteger(index)||index<1||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw invalid();
 return{path,offset:offset??undefined,limit:limit??undefined,index,hash};
}

/** Cursor positions use UTF-16; pages preserve code points within a byte bound. */
export function readPageEnd(text:string,start:number,count:number,maxBytes=16000):number {
 let end=start,bytes=0;
 for(let n=0;n<count&&end<text.length;n++){
  const point=text.codePointAt(end)!,size=point<=0x7f?1:point<=0x7ff?2:point<=0xffff?3:4;
  if(bytes+size>maxBytes)break;
  bytes+=size;end+=point>0xffff?2:1;
 }
 return end;
}
