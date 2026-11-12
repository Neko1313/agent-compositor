import {createHash} from 'node:crypto';

/** Fingerprint only the effective arguments and the result visible to the model. */
export function queryObservation(name:string,args:unknown,resultText:string):string {
 const input=JSON.stringify([name,args],(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value);
 return createHash('sha256').update(input).update('\0').update(resultText).digest('hex');
}

/** A bounded observation window; polling/effect/failure steps reset it. */
export class QueryProgress {
 private seen=new Set<string>();
 private repeated=0;
 reset(){this.seen.clear();this.repeated=0;}
 observe(keys:readonly (string|undefined)[]):number {
  if(!keys.length||keys.some(key=>key===undefined)){this.reset();return 0;}
  let novel=false;
  for(const key of keys as readonly string[]){
   if(!this.seen.has(key))novel=true;
   this.seen.delete(key);this.seen.add(key);
   if(this.seen.size>256)this.seen.delete(this.seen.values().next().value!);
  }
  this.repeated=novel?0:this.repeated+1;
  return this.repeated;
 }
}
