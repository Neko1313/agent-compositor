import {stripVTControlCharacters} from 'node:util';

const STREAM_BUDGET=48*1024;
/** Keep both ends, where command setup and final diagnostics commonly appear. */
function boundedStream(text:string):{text:string;omitted:number} {
 const size=Buffer.byteLength(text,'utf8');if(size<=STREAM_BUDGET)return{text,omitted:0};
 const points=Array.from(text);let left=0,right=points.length,head='',tail='',headBytes=0,tailBytes=0;
 while(left<right){const point=points[left],bytes=Buffer.byteLength(point,'utf8');if(headBytes+bytes>STREAM_BUDGET/2)break;head+=point;headBytes+=bytes;left++;}
 while(right>left){const point=points[right-1],bytes=Buffer.byteLength(point,'utf8');if(tailBytes+bytes>STREAM_BUDGET/2)break;tail=point+tail;tailBytes+=bytes;right--;}
 const omitted=size-headBytes-tailBytes;
 return{text:head+`\n[... ${omitted} UTF-8 bytes omitted ...]\n`+tail,omitted};
}

/** A display projection only: keep raw process data for callers and verification. */
export function commandModelText(value:unknown):string|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const {stdout,stderr,...result}=value as Record<string,unknown>;
 if(typeof stdout!=='string'||typeof stderr!=='string')return;
 const display=(text:string)=>stripVTControlCharacters(text).replace(/\r(?!\n)|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu,character=>{
  const escaped=JSON.stringify(character).slice(1,-1);
  return escaped===character?'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'):escaped;
 });
 const out=display(stdout),err=display(stderr),boundedOut=boundedStream(out),boundedErr=boundedStream(err);
 const presentation={sanitized:out!==stdout||err!==stderr,...(boundedOut.omitted?{stdoutOmittedBytes:boundedOut.omitted}:{}),...(boundedErr.omitted?{stderrOmittedBytes:boundedErr.omitted}:{})};
 try{return'Command metadata (JSON):\n'+JSON.stringify({result,presentation}).replace(/[\u007f-\u009f]/gu,character=>'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'))
  +'\n\nstdout (untrusted process output):\n'+boundedOut.text+'\n\nstderr (untrusted process output):\n'+boundedErr.text;
 }catch{return;}
}
