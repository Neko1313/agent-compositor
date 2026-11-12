import {it,expect} from 'vitest';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import {hello,type WireMessage} from '@agent-compositor/protocol';
import {AppUI} from '../src/ui.js';

async function fixture(scrollKeys?:'host'|'plugin',editable=true){
 const provider=new ScriptedProvider([]),ui=new AppUI(()=>new AgentCore({cwd:process.cwd(),provider})),messages:WireMessage[]=[],keys:string[]=[];
 let text='';ui.connect(m=>{messages.push(m);if(m.type==='render'&&m.surface==='plugin-paging-main')text=m.grid?.map(row=>row.map(c=>c.ch).join('')).join('\n')??'';});
 ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));ui.resize(60,24);
 ui.core.host.registerPlugin({name:'paging',version:'1.0.0',trust:'trusted'},{'ui.press':e=>{if(e.site==='plugin-paging-main')keys.push(e.key);}});
 const key=(key:string)=>ui.receive({type:'input',surface:'plugin-paging-main',data:{kind:'key',key}});
 try{await ui.core.host.emit('service.ui.view',{plugin:'paging',id:'main',title:'Long report',view:{...(scrollKeys?{scrollKeys}:{}),...(editable?{input:{id:'path',value:'reports/test.json'}}:{}),lines:Array.from({length:80},(_,i)=>({text:i===79?'LAST_DIAGNOSTIC_LINE':`Diagnostic line ${i}`}))}});}
 catch(error){ui.close();await ui.core.close();throw error;}
 const frame=messages.filter(m=>m.type==='layout').at(-1)!.frames.find(f=>f.surface==='plugin-paging-main')!;
 ui.receive({type:'input',surface:'plugin-paging-main',data:{kind:'mouse',row:frame.y+1,col:frame.x+3,button:'left',action:'press'}});
 return{ui,provider,key,keys,text:()=>text};
}
it('pages every line of an editable view with host scroll keys and preserves its field value',async()=>{
 const f=await fixture('host');try{
  expect(f.text()).toContain('reports/test.json');expect(f.text()).not.toContain('LAST_DIAGNOSTIC_LINE');
  for(let i=0;i<20;i++)f.key('pagedown');await f.ui.settled();expect(f.text()).toContain('LAST_DIAGNOSTIC_LINE');expect(f.keys).toEqual([]);
  f.key('pageup');await f.ui.settled();expect(f.text()).not.toContain('LAST_DIAGNOSTIC_LINE');
  for(let i=0;i<20;i++)f.key('pageup');await f.ui.settled();expect(f.text()).toContain('reports/test.json');expect(f.text()).toContain('Diagnostic line 0');expect(f.provider.requests).toHaveLength(0);
 }finally{f.ui.close();await f.ui.core.close();}
});
it.each([undefined,'plugin'] as const)('retains editable-view plugin pagination for %s mode',async mode=>{
 const f=await fixture(mode);try{f.key('pagedown');await f.ui.settled();expect(f.keys).toEqual(['pagedown']);expect(f.text()).toContain('Diagnostic line 0');}finally{f.ui.close();await f.ui.core.close();}
});

it('retains host paging for legacy views without an input',async()=>{
 const f=await fixture(undefined,false);try{for(let i=0;i<20;i++)f.key('pagedown');await f.ui.settled();expect(f.text()).toContain('LAST_DIAGNOSTIC_LINE');expect(f.keys).toEqual([]);}finally{f.ui.close();await f.ui.core.close();}
});
it('lets a noneditable view explicitly delegate page keys to its plugin',async()=>{
 const f=await fixture('plugin',false);try{f.key('pagedown');await f.ui.settled();expect(f.keys).toEqual(['pagedown']);expect(f.text()).toContain('Diagnostic line 0');}finally{f.ui.close();await f.ui.core.close();}
});
it('counts a rendered override and the preserved input field when clamping pages',async()=>{
 const f=await fixture('host');try{
  f.ui.core.host.registerPlugin({name:'custom-render',version:'1.0.0',trust:'trusted'},{'ui.render':e=>e.site==='plugin:paging/main'?{tree:{lines:Array.from({length:100},(_,i)=>({text:i===99?'OVERRIDE_LAST_LINE':`Override line ${i}`}))}}:undefined});
  f.ui.resize(61,24);await f.ui.settled();
  for(let i=0;i<20;i++){f.key('pagedown');await f.ui.settled();}expect(f.text()).toContain('OVERRIDE_LAST_LINE');
  for(let i=0;i<20;i++){f.key('pageup');await f.ui.settled();}expect(f.text()).toContain('reports/test.json');expect(f.text()).toContain('Override line 0');
 }finally{f.ui.close();await f.ui.core.close();}
});
