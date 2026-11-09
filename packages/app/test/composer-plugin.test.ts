import {it,expect} from 'vitest';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import {hello,type WireMessage} from '@agent-compositor/protocol';
import {AppUI} from '../src/ui.js';

it('attaches replaceable plugin art to the host editor without a window, preserves drafts and removes on unload',async()=>{
 const messages:WireMessage[]=[],visibility:any[]=[];
 const ui=new AppUI(approve=>new AgentCore({cwd:process.cwd(),provider:new ScriptedProvider([]),onApproval:approve}));
 ui.core.host.registerPlugin({name:'observer',version:'1.0.0',trust:'trusted'},{'ui.visibility':(e:any)=>{visibility.push(e);}});
 ui.connect(m=>messages.push(m));ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));ui.resize(100,30);
 const publish=(plugin:string,label:string)=>ui.core.host.emit('service.ui.view',{plugin,id:'spirit',title:'Decoration',view:{attachment:{site:'composer',width:16,label},lines:[{text:'  ╱╲',tone:'accent'},{text:'  ╱██╲',tone:'accent'},{text:'  █••█'},{text:'  ╲██╱'}]}});
 const text=()=>{const m=messages.filter(m=>m.type==='render'&&m.surface==='input').at(-1);return m?.type==='render'?m.grid?.map(r=>r.map(c=>c.ch).join('')).join('\n')??'':'';};
 try{
  await publish('example','Ready');await ui.settled();
  expect(ui.windows.ids()).not.toContain('plugin-example-spirit');
  expect(messages.filter(m=>m.type==='layout').at(-1)).not.toMatchObject({frames:expect.arrayContaining([expect.objectContaining({surface:'plugin-example-spirit'})])});
  expect(text()).toContain('••');expect(text()).toContain('Describe your task');
  const painted=messages.filter(m=>m.type==='render'&&m.surface==='input').at(-1);
  expect(painted?.type==='render'&&painted.grid?.flat().some(c=>c.ch===' '&&c.bg==='#8fc7dd')).toBe(true);
  ui.receive({type:'input',surface:'input',data:{kind:'text',text:'a precise edit'}});
  await publish('example','Thinking');expect(text()).toContain('a precise edit');
  ui.resize(48,18);expect(text()).not.toContain('••');expect(text()).toContain('a precise edit');
  expect(messages.filter(m=>m.type==='declare').at(-1)).toMatchObject({surfaces:expect.arrayContaining([expect.objectContaining({id:'input',title:'Message · Thinking'})])});
  ui.resize(100,30);await publish('replacement','Custom');await ui.settled();
  expect(visibility).toContainEqual(expect.objectContaining({site:'plugin:example/spirit',visible:false,attached:true}));
  await ui.core.host.emit('service.ui.remove',{plugin:'replacement',id:'spirit'});await ui.settled();
  expect(visibility.at(-1)).toMatchObject({site:'plugin:example/spirit',visible:true});
  await ui.core.host.emit('service.ui.remove',{plugin:'example',id:'spirit'});expect(text()).not.toContain('••');expect(text()).toContain('a precise edit');
 }finally{ui.close();await ui.settled();}
});
