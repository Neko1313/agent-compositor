import {isAbsolute} from 'node:path';

/** A snapshot selector, not a permission or an authenticated capability. */
export interface EditAnchor {path:string;expectedHash:string;range:{start:number;end:number};strict:boolean}
const prefix='edit-v1:',maxLength=16384;
function valid(value:any):value is EditAnchor {
 return value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.path==='string'&&isAbsolute(value.path)&&!value.path.includes('\0')
  &&typeof value.expectedHash==='string'&&/^[a-f0-9]{64}$/.test(value.expectedHash)
  &&value.range&&!Array.isArray(value.range)&&Number.isSafeInteger(value.range.start)&&Number.isSafeInteger(value.range.end)
  &&value.range.start>=0&&value.range.end>=value.range.start&&value.strict===true;
}
/** Preserve the exact selector while letting the model copy one string. */
export function encodeEditAnchor(value:unknown):string|undefined {
 if(!valid(value))return;
 const ref=prefix+Buffer.from(JSON.stringify([value.path,value.expectedHash,value.range.start,value.range.end])).toString('base64url');
 return ref.length<=maxLength?ref:undefined;
}
export function decodeEditRef(ref:unknown):EditAnchor {
 const invalid=()=>Error('edit.editRef is invalid or unsupported. Copy editRef verbatim from a fresh read/read_symbol result, or use its complete explicit edit anchor.');
 if(typeof ref!=='string'||ref.length>maxLength||!ref.startsWith(prefix))throw invalid();
 const encoded=ref.slice(prefix.length);if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw invalid();
 const bytes=Buffer.from(encoded,'base64url');if(bytes.toString('base64url')!==encoded)throw invalid();
 const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))throw invalid();
 let values:unknown;try{values=JSON.parse(text);}catch{throw invalid();}
 if(!Array.isArray(values)||values.length!==4)throw invalid();
 const anchor={path:values[0],expectedHash:values[1],range:{start:values[2],end:values[3]},strict:true};
 if(!valid(anchor))throw invalid();return anchor;
}
export function editTargetPath(args:{path?:string;editRef?:string}):string {
 const target=args.path===undefined&&args.editRef!==undefined?decodeEditRef(args.editRef).path:args.path;
 if(typeof target!=='string'||!target)throw Error('edit.path must be a non-empty string, or supply a valid editRef.');
 return target;
}
export function resolveEditRef<T extends {path?:string;editRef?:string;expectedHash?:string;range?:{start:number;end:number};strict?:boolean}>(args:T):T {
 if(args.editRef===undefined)return args;
 const anchor=decodeEditRef(args.editRef);
 for(const field of ['expectedHash','range','strict'] as const){
  const given=args[field],expected=anchor[field];
  const same=field==='range'?given&&typeof given==='object'&&!Array.isArray(given)&&(given as any).start===anchor.range.start&&(given as any).end===anchor.range.end:given===expected;
  if(given!==undefined&&!same)throw Error(`edit.${field} conflicts with editRef. Copy the reference unchanged; do not recompute its guards. Omit redundant explicit guards or supply the same values.`);
 }
 return{...args,...(args.path===undefined?{path:anchor.path}:{}),expectedHash:anchor.expectedHash,range:anchor.range,strict:true};
}
