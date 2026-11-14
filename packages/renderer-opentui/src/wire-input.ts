import type {InputMessage} from '@agent-compositor/protocol';

type Key={name:string;sequence:string;ctrl?:boolean;meta?:boolean;option?:boolean;shift?:boolean;super?:boolean;hyper?:boolean};
type Mouse={type:string;button:number;x:number;y:number;scroll?:{direction:string;delta:number}};

/** Native parsing owns packet ordering; this maps its events to the legacy wire names. */
export function wireKey(key:Key):InputMessage['data']|undefined {
  const legacy=/^\x1b([!@#$%^&*(])$/.exec(key.sequence);
  if(legacy)return{kind:'key',key:String('!@#$%^&*('.indexOf(legacy[1])+1),modifiers:['meta','shift']};
  if(key.sequence==='\n')return{kind:'key',key:'j',modifiers:['ctrl']};
  const modifiers=[...(key.ctrl?['ctrl']:[]),...(key.meta||key.option?['meta']:[]),...(key.shift?['shift']:[]),...(key.super?['super']:[]),...(key.hyper?['hyper']:[])];
  if(!key.ctrl&&!key.meta&&!key.option&&!key.super&&!key.hyper&&key.sequence&&!/[\p{Cc}\p{Cs}]/u.test(key.sequence))return{kind:'text',text:key.sequence};
  if(!key.name||['shift','ctrl','control','alt','meta','super','hyper'].includes(key.name))return;
  return{kind:'key',key:key.name==='return'||key.name==='kpenter'?'enter':key.name,modifiers};
}

export function wireMouse(event:Mouse):InputMessage['data']|undefined {
  if(!Number.isFinite(event.x)||!Number.isFinite(event.y)||event.x<0||event.y<0)return;
  const action=event.type==='down'||event.type==='scroll'?'press':event.type==='up'?'release':event.type==='move'||event.type==='drag'?'move':undefined;
  if(!action)return;
  const button=event.type==='scroll'?(event.scroll?.direction==='down'?'wheel-down':event.scroll?.direction==='up'?'wheel-up':'other'):event.button===0?'left':'other';
  return{kind:'mouse',row:Math.floor(event.y),col:Math.floor(event.x),button,action};
}
