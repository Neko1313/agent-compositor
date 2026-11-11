import {it,expect} from 'vitest';
import {ScriptedProvider} from '../src/provider.js';
const request=(signal=new AbortController().signal)=>({messages:[],tools:[],signal});
async function soon<T>(promise:Promise<T>):Promise<T|undefined>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<undefined>(done=>{timer=setTimeout(()=>done(undefined),100);})]);}finally{clearTimeout(timer!);}}
it('does not lose a release while the consumer handles the first text event',async()=>{
 const provider=new ScriptedProvider([{text:'working',hold:true}]),iterator=provider.complete(request())[Symbol.asyncIterator]();
 expect((await iterator.next()).value).toMatchObject({type:'text_delta'});provider.release();const finish=iterator.next();
 try{expect(await soon(finish)).toMatchObject({value:{type:'finish',reason:'stop'}});}finally{provider.release();await finish;await iterator.return?.();}
});
it('removes an aborted hold before releasing the next request',async()=>{
 const provider=new ScriptedProvider([{text:'one',hold:true},{text:'two',hold:true}]),abort=new AbortController(),first=provider.complete(request(abort.signal))[Symbol.asyncIterator]();await first.next();const waiting=first.next();abort.abort();await waiting;
 const second=provider.complete(request())[Symbol.asyncIterator]();await second.next();const finish=second.next();provider.release();
 try{expect(await soon(finish)).toMatchObject({value:{type:'finish'}});}finally{provider.release();await finish;await second.return?.();}
});
it('disposes a held request when the consumer closes before parking',async()=>{
 const provider=new ScriptedProvider([{text:'one',hold:true},{text:'two',hold:true}]),first=provider.complete(request())[Symbol.asyncIterator]();await first.next();await first.return?.();
 const second=provider.complete(request())[Symbol.asyncIterator]();await second.next();provider.release();const finish=second.next();
 try{expect(await soon(finish)).toMatchObject({value:{type:'finish'}});}finally{provider.release();await finish;await second.return?.();}
});
it('releases concurrent holds in order without crediting idle releases',async()=>{
 const provider=new ScriptedProvider([{text:'one',hold:true},{text:'two',hold:true}]);provider.release();
 const first=provider.complete(request())[Symbol.asyncIterator](),second=provider.complete(request())[Symbol.asyncIterator]();await first.next();await second.next();const a=first.next(),b=second.next();
 try{provider.release();expect(await soon(a)).toMatchObject({value:{type:'finish'}});expect(await soon(b)).toBeUndefined();provider.release();expect(await soon(b)).toMatchObject({value:{type:'finish'}});}finally{provider.release();provider.release();await a;await b;await first.return?.();await second.return?.();}
});
