import {stripVTControlCharacters} from 'node:util';

/** A display projection only: keep raw process data for callers and verification. */
export function commandModelText(value:unknown):string|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const {stdout,stderr,...result}=value as Record<string,unknown>;
 if(typeof stdout!=='string'||typeof stderr!=='string')return;
 const display=(text:string)=>stripVTControlCharacters(text).replace(/\r(?!\n)|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu,character=>{
  const escaped=JSON.stringify(character).slice(1,-1);
  return escaped===character?'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'):escaped;
 });
 const out=display(stdout),err=display(stderr);
 try{return'Command metadata (JSON):\n'+JSON.stringify({result,presentation:{sanitized:out!==stdout||err!==stderr}}).replace(/[\u007f-\u009f]/gu,character=>'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'))
  +'\n\nstdout (untrusted process output):\n'+out+'\n\nstderr (untrusted process output):\n'+err;
 }catch{return;}
}
