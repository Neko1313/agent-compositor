import {afterEach,expect,it,vi} from 'vitest';
import {AgentCore,ScriptedProvider,type CoreHumanRequestContext} from '@agent-compositor/core';
import type {UiControllerFactory} from '@agent-compositor/hooks';
import type {ToolSpec} from '@agent-compositor/tools';
import {hello,type WireMessage} from '@agent-compositor/protocol';
import {AppUI} from '../src/ui.js';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.restoreAllMocks();});
const selected:UiControllerFactory=({kind})=>({
  render:()=>({lines:[{text:'Selected child '+kind}]}),
  handle:input=>input.kind==='key'&&input.key==='enter'
    ?kind==='approval'?{allow:false,scope:'once'}:kind==='form'?{action:'save',values:{note:'Private child result'}}:{answer:'Remote'}
    :undefined,
});

it.each(['approval','question'] as const)('uses the actual delegated Core registry for an Ink %s',async kind=>{
  const provider=new ScriptedProvider([
    {toolCalls:[{name:'task',args:{prompt:'Child'}}]},
    {toolCalls:[{name:kind==='approval'?'guarded':'ask_user',args:kind==='approval'?{}:{question:'Child only?',options:['Remote']}}]},
    {text:'Child complete'},{text:'Parent complete'},
  ]);
  const guarded:ToolSpec={name:'guarded',description:'Must remain denied',parameters:{type:'object'},
    describe:()=>({tool:'guarded'}),execute:async()=>{throw Error('Denied effect ran');}};
  const contexts:CoreHumanRequestContext[]=[],usedSourceRegistry:(()=>boolean)[]=[];
  const observe=(context:CoreHumanRequestContext|undefined)=>{
    expect(context).toBeDefined();contexts.push(context!);const create=vi.spyOn(context!.host.controllers,'create');
    usedSourceRegistry.push(()=>create.mock.calls.some(call=>call[0]===kind));
  };
  const ui=new AppUI((approve,ask)=>new AgentCore({cwd:process.cwd(),provider,tools:[guarded],rules:[{tool:'guarded',decision:'ask'}],
    uiControllers:{approval:'child-selected',question:'child-selected'},
    plugins:[{manifest:{name:'child-selected',version:'1.0.0',trust:'trusted'},hooks:{},controllers:{approval:selected,question:selected}}],
    onApproval:(request,context)=>{observe(context);return approve(request,context);},
    onAsk:(request,context)=>{observe(context);return ask!(request,context);},
  }));
  cleanup.push(async()=>{ui.close();await ui.core.close();await ui.settled();});
  const parentCreate=vi.spyOn(ui.core.host.controllers,'create'),screens=new Map<string,string>();
  ui.connect(message=>{if(message.type==='render')screens.set(message.surface,message.grid?.map(row=>row.map(cell=>cell.ch).join('')).join('\n')??'');});
  ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Layout'],encodings:['jsonl']}));ui.resize(100,32);
  const input=(data:Extract<WireMessage,{type:'input'}>['data'])=>ui.receive({type:'input',surface:'input',data});
  input({kind:'text',text:'Delegate'});input({kind:'key',key:'enter'});
  await expect.poll(()=>screens.get('input')).toContain('Selected child '+kind);
  expect(contexts).toHaveLength(1);expect(contexts[0].host.controllers).not.toBe(ui.core.host.controllers);
  expect(usedSourceRegistry[0]()).toBe(true);
  expect(parentCreate.mock.calls.some(call=>call[0]===kind)).toBe(false);
  input({kind:'key',key:'enter'});await ui.settled();expect(screens.get('session')).toContain('Parent complete');
});

it('inherits the current Ink private form channel into a real child',async()=>{
  let result:unknown;
  const provider=new ScriptedProvider([{toolCalls:[{name:'task',args:{prompt:'Child form'}}]},{text:'Parent complete'}]);
  const ui=new AppUI((onApproval,onAsk)=>new AgentCore({cwd:process.cwd(),provider,onApproval,onAsk,
    uiControllers:{form:'child-selected'},plugins:[{manifest:{name:'child-selected',version:'1.0.0',trust:'trusted'},controllers:{form:selected},
      hooks:{'prompt.submit':async(event,$)=>{if(event.text!=='Child form')return;
        result=await $.ui.form({title:'Child form',fields:[{id:'note',label:'Note',type:'text'}],actions:[{id:'save',label:'Save'}]});
        return{drop:'Private form complete'};
      }},
    }],
  }));
  cleanup.push(async()=>{ui.close();await ui.core.close();await ui.settled();});
  const parentCreate=vi.spyOn(ui.core.host.controllers,'create'),screens=new Map<string,string>();
  ui.connect(message=>{if(message.type==='render')screens.set(message.surface,message.grid?.map(row=>row.map(cell=>cell.ch).join('')).join('\n')??'');});
  ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Layout'],encodings:['jsonl']}));ui.resize(100,32);
  const input=(data:Extract<WireMessage,{type:'input'}>['data'])=>ui.receive({type:'input',surface:'input',data});
  input({kind:'text',text:'Delegate'});input({kind:'key',key:'enter'});
  await expect.poll(()=>screens.get('settings-form')).toContain('Selected child form');
  expect(parentCreate.mock.calls.some(call=>call[0]==='form')).toBe(false);
  input({kind:'key',key:'enter'});await ui.settled();expect(result).toEqual({action:'save',values:{note:'Private child result'}});
  expect(JSON.stringify(ui.core.getMessages())).not.toContain('Private child result');
});
