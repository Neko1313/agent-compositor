import {decodeKeys,type DecoderState} from './keys.js';

type Pending={prompt:string;state:DecoderState;signal?:AbortSignal;resolve:(text:string)=>void;abort:()=>void};

/** Own the REPL input stream while a human dialog is active; never submit answers as tasks. */
export function questionInput(write:(text:string)=>void){
 const queue:Pending[]=[];let active:Pending|undefined,closed=false;
 const activate=()=>{if(!active){active=queue.shift();if(active)write(active.prompt);}};
 const settle=(item:Pending,text:string)=>{
  item.signal?.removeEventListener('abort',item.abort);
  if(active===item)active=undefined;else{const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);}
  item.resolve(text);activate();
 };
 const cancel=()=>{
  const items=[...(active?[active]:[]),...queue];active=undefined;queue.length=0;
  for(const item of items){item.signal?.removeEventListener('abort',item.abort);item.resolve('');}
 };
 return{
  read:(prompt:string,signal?:AbortSignal)=>new Promise<string>(resolve=>{
   if(closed||signal?.aborted){resolve('');return;}
   const item:Pending={prompt,state:{line:'',running:false},signal,resolve,abort:()=>{}};
   item.abort=()=>settle(item,'');signal?.addEventListener('abort',item.abort,{once:true});queue.push(item);activate();
  }),
  consume:(character:string):false|true|'interrupt'=>{
   if(!active)return false;
   if(character==='\x03'){cancel();return'interrupt';}
   if(character==='\x1b'){write('\n');settle(active,'');return true;}
   if(character==='\r'||character==='\n'){const item=active;write('\n');settle(item,item.state.line);return true;}
   const before=active.state.line;
   for(const command of decodeKeys(character,active.state))if(command.type==='char')write(command.ch);
   if(active.state.line.length<before.length)write('\b \b');
   return true;
  },
  cancel,
  close:()=>{closed=true;cancel();},
 };
}
