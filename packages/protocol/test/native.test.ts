import {describe,it,expect} from 'vitest';
import {decodeLine,encodeMessage,nativeStateMessage,nativeInputMessage,nativeReceiptMessage,nativeMediaMessage,
  COMPOSER_MEDIA_STATUS,nativeProtocolElements,type NativeStateMessage,type NativeOperation} from '../src/index.js';

function scene():NativeStateMessage {
  return {type:'native-state',epoch:'binding-1',revision:3,state:{
    sessions:[{port:'session-port-1',id:'journal-1',conversationId:'main',generation:'core-1',paneId:'session',label:'Main',current:true,
      methods:['controllerInput','editorInput'],snapshot:{messages:[{role:'assistant',text:'Transcript 窗😀'}],running:false,
        editor:{id:'editor-1',kind:'editor',revision:4,inputRevision:2,available:true,preferredRows:7,
          view:{lines:[{text:'Private visible text',cells:[{ch:'窗',fg:'#eeeeee',bold:true}]}]},
          admission:{sequence:2,type:'submit',status:'queued'},scroll:{revision:1,rows:-.5}}}}],
    windows:[{id:'session',label:'Main',session:'session-port-1'},{id:'window-1',label:'Main copy',session:'session-port-1'}],
    surfaces:[{port:'surface-port-1',id:'plugin-proof-form',methods:['cancelController'],snapshot:{revision:5,title:'Private form',
      interaction:{kind:'form',id:'form-1',plugin:'proof',request:{title:'Private form',fields:[{id:'secret',label:'Secret',type:'password',required:true}],actions:[{id:'save',label:'Save'}]}}}}],
    layout:{revision:7,width:80,height:25,frames:[{surface:'session',x:0,y:0,width:80,height:25}],focused:'session',workspace:1,
      workspaces:[1,2,3,4,5,6,7,8,9],locations:{session:1,'window-1':2,'plugin-proof-form':3},axis:'horizontal',fullscreen:false,compact:false,pointer:'default'},
    navigation:{revision:8,mode:'finder',query:'PRIVATE_QUERY',entries:[{id:'session',title:'Main',workspace:1,state:'open'}],selected:'session'},
    appearance:{revision:2,appearance:{colors:{accent:'#a6dfd4'},presentation:{hints:false}}},
    publicRender:[{port:'public-port-1',id:'session',revision:6,defaultView:{lines:[{text:'Public default'}]},override:{lines:[{text:'Public action',action:'inspect'}]}}],
    composerMedia:{width:8,height:4},immediateCommands:['/windows','/history','/proof'],
  }};
}

describe('negotiated native presentation data',()=>{
  it('round-trips a complete native scene without changing grid protocol messages',()=>{
    const value=scene();expect(decodeLine(encodeMessage(value))).toEqual(value);
    expect(nativeProtocolElements).toEqual(['native-presentation-v1','native-input-v1']);
    const legacy={type:'render' as const,surface:'plain',mode:'diff' as const,ops:[{op:'cursor' as const,row:2,col:3}],flush:false};
    expect(decodeLine(encodeMessage(legacy))).toEqual(legacy);
  });

  it('retains full history and an empty workspace without inventing transcript caps',()=>{
    const value=scene();value.state.sessions[0].snapshot.messages=[{role:'user',text:'x'.repeat(10001)}];
    value.state.layout.frames=[];value.state.layout.focused='';
    const parsed=nativeStateMessage.parse(value);expect(parsed.state.sessions[0].snapshot.messages[0].text).toHaveLength(10001);
    expect(parsed.state.layout.focused).toBe('');
    value.state.layout.width=0;value.state.layout.height=0;expect(nativeStateMessage.safeParse(value).success).toBe(true);
    value.state.sessions[0].snapshot.messages=[{role:'tool',text:'Tool context',tool:{callId:'provider-data-'.repeat(30),name:'read',state:'complete'}}];
    expect(nativeStateMessage.safeParse(value).success).toBe(true);
  });

  it('distinguishes actual IDs from opaque ports and rejects ambiguous bindings',()=>{
    const value=scene();value.state.sessions.push({...value.state.sessions[0],port:'session-copy-port',paneId:'window-1'});
    value.state.windows[1].session='session-copy-port';expect(nativeStateMessage.safeParse(value).success).toBe(true);
    value.state.sessions[1].port='session-port-1';expect(nativeStateMessage.safeParse(value).success).toBe(false);
    const absent=scene();absent.state.windows[0].session='expired-port';expect(nativeStateMessage.safeParse(absent).success).toBe(false);
    const duplicate=scene();duplicate.state.publicRender[0].port='surface-port-1';expect(nativeStateMessage.safeParse(duplicate).success).toBe(false);
    const retained=scene();retained.epoch='binding-2';retained.state.sessions[0].port='replacement-port';
    for(const window of retained.state.windows)window.session='replacement-port';expect(nativeStateMessage.safeParse(retained).success).toBe(true);
  });

  it('rejects leaked functions, leases, unsupported methods and native request objects',()=>{
    const value=scene();expect(nativeStateMessage.safeParse({...value,source:()=>value}).success).toBe(false);
    expect(nativeStateMessage.safeParse({...value,state:{...value.state,sessions:[{...value.state.sessions[0],snapshot:{...value.state.sessions[0].snapshot,lease:{signal:new AbortController().signal}}}]}}).success).toBe(false);
    expect(nativeStateMessage.safeParse({...value,state:{...value.state,sessions:[{...value.state.sessions[0],methods:['runTool']}]}}).success).toBe(false);
    const editor=value.state.sessions[0].snapshot.editor!;
    expect(nativeStateMessage.safeParse({...value,state:{...value.state,sessions:[{...value.state.sessions[0],snapshot:{...value.state.sessions[0].snapshot,editor:{...editor,request:{commands:()=>[]}}}}]}}).success).toBe(false);
    expect(nativeStateMessage.safeParse({...value,state:{...value.state,surfaces:[{...value.state.surfaces[0],snapshot:{...value.state.surfaces[0].snapshot,controller:{...editor,kind:'history',factory:()=>{}}}}]}}).success).toBe(false);
  });

  it('keeps canonical secret-field and semantic-view validation',()=>{
    const value=scene(),interaction=value.state.surfaces[0].snapshot.interaction!;
    if(interaction.kind!=='form')throw Error('Expected private form');interaction.request.fields[0].value='MUST_NOT_BE_A_DEFAULT';
    expect(nativeStateMessage.safeParse(value).success).toBe(false);
    const view=scene();view.state.publicRender[0].override={lines:[{text:'Invalid action',action:''}]};expect(nativeStateMessage.safeParse(view).success).toBe(false);
    const limit=scene();limit.state.windows=Array.from({length:257},(_,i)=>({id:'window-'+i,label:'Copy',session:'session-port-1'}));
    expect(nativeStateMessage.safeParse(limit).success).toBe(false);
  });
});

describe('native input and admission receipts',()=>{
  it('round-trips every broker operation with explicit JSON data only',()=>{
    const operations:NativeOperation[]=[
      {kind:'submit',text:'Draft 😀'},{kind:'steer',text:'Correction'},{kind:'interrupt'},{kind:'approval',id:'approval-1',allow:false},
      {kind:'interaction',id:'question-1',value:{answers:[{id:'choice',selected:['Production']}]}},{kind:'cancel-interaction',id:'question-1'},
      {kind:'controller-input',id:'controller-1',revision:3,input:{kind:'text',text:'q',paste:true}},
      {kind:'controller-viewport',id:'controller-1',columns:38,rows:8},{kind:'cancel-controller',id:'controller-1'},
      {kind:'editor-input',id:'editor-1',revision:4,input:{kind:'key',key:'f2',modifiers:['shift']}},
      {kind:'editor-viewport',id:'editor-1',columns:38,rows:7,maxRows:12},
      {kind:'layout-resize',width:38,height:24},{kind:'layout-resize',width:0,height:0},{kind:'layout-action',action:{type:'retile',key:'right'}},
      {kind:'layout-action',action:{type:'pointer',phase:'up',x:-1,y:-2,revision:4,workspace:1}},
      {kind:'navigation-handle',input:{kind:'key',key:'w',modifiers:['alt'],repeated:false}},
      {kind:'navigation-handle',input:{kind:'paste',text:'q'}},{kind:'navigation-toggle'},{kind:'navigation-open'},
      {kind:'navigation-choose',id:'session',revision:3},{kind:'navigation-query',text:'Private query',revision:4},{kind:'navigation-select',id:'session',revision:4},
      {kind:'surface-press',action:'inspect',revision:5},{kind:'surface-change',field:'query',value:'ABC',revision:5},
      {kind:'public-measure',metrics:{columns:0,rows:0,visible:false,scrollOffset:10,scrollOrigin:'layout'}},
      {kind:'public-press',action:'inspect',revision:6},{kind:'media-active',enabled:true,active:false},{kind:'ctrl-c'},
    ];
    for(const [id,operation]of operations.entries()){
      const message={type:'native-input' as const,epoch:'binding-1',id,target:'opaque-port',revision:3,operation};
      expect(nativeInputMessage.parse(message)).toEqual(message);expect(decodeLine(encodeMessage(message))).toEqual(message);
    }
  });

  it('rejects unsafe counters, malformed inputs, arbitrary methods and capability answers',()=>{
    const base={type:'native-input',epoch:'binding-1',id:1,target:'opaque-port',operation:{kind:'submit',text:'Draft'}};
    for(const value of [-1,.5,Infinity,Number.MAX_SAFE_INTEGER+1])expect(nativeInputMessage.safeParse({...base,id:value}).success).toBe(false);
    expect(nativeInputMessage.safeParse({...base,operation:{kind:'invoke',method:'core.run'}}).success).toBe(false);
    expect(nativeInputMessage.safeParse({...base,operation:{kind:'submit',text:'Draft',callback:()=>{}}}).success).toBe(false);
    expect(nativeInputMessage.safeParse({...base,operation:{kind:'interaction',id:'form-1',value:()=>{}}}).success).toBe(false);
    expect(nativeInputMessage.safeParse({...base,operation:{kind:'editor-input',id:'editor-1',revision:3,input:{kind:'text',text:'q',paste:false}}}).success).toBe(false);
    expect(nativeInputMessage.safeParse({...base,operation:{kind:'public-measure',metrics:{columns:38,rows:7,visible:true,scrollOffset:NaN}}}).success).toBe(false);
  });

  it('reports admission, input tickets and local consumption independently of completion',()=>{
    for(const fields of [{status:'accepted',ticket:7},{status:'accepted',consumed:false},{status:'accepted',ctrlC:'handled'},{status:'rejected'}] as const){
      const receipt={type:'native-receipt' as const,epoch:'binding-1',id:2,...fields};expect(nativeReceiptMessage.parse(receipt)).toEqual(receipt);
      expect(decodeLine(encodeMessage(receipt))).toEqual(receipt);
    }
    expect(nativeReceiptMessage.safeParse({type:'native-receipt',epoch:'binding-1',id:2,status:'rejected',ticket:7}).success).toBe(false);
    expect(nativeReceiptMessage.safeParse({type:'native-receipt',epoch:'binding-1',id:2,status:'accepted',completion:Promise.resolve()}).success).toBe(false);
  });
});

it('keeps native pixels on the separate negotiated media lane with exact dimensions',()=>{
  const message={type:'native-media' as const,epoch:'binding-1',revision:1,dimensions:{width:8,height:4},frame:{width:1,height:1,rgba:'/wAA/w=='}};
  expect(nativeMediaMessage.parse(message)).toEqual(message);expect(decodeLine(encodeMessage(message))).toEqual(message);
  expect(nativeMediaMessage.safeParse({...message,frame:{...message.frame,rgba:'AAAA'}}).success).toBe(false);
  expect(nativeMediaMessage.safeParse({...message,frame:{...message.frame,width:513}}).success).toBe(false);
  expect(nativeMediaMessage.safeParse({...message,dimensions:{width:0,height:4}}).success).toBe(false);
  expect(nativeStateMessage.safeParse({...scene(),state:{...scene().state,composerMedia:message.frame}}).success).toBe(false);
  expect(nativeMediaMessage.parse({type:'native-media',epoch:'binding-1',revision:2,dimensions:{width:8,height:4}}).frame).toBeUndefined();
});

it('adds bounded optional composer status without changing legacy message shapes or required capabilities',()=>{
  expect(nativeProtocolElements).not.toContain(COMPOSER_MEDIA_STATUS);
  const legacy={type:'native-media' as const,epoch:'binding-1',revision:2,dimensions:{width:18,height:6}};
  expect(decodeLine(encodeMessage(legacy))).toEqual(legacy);
  const status={...legacy,presentation:{label:'Thinking 窗',alt:'Original Ghost',hasImage:true}};
  expect(decodeLine(encodeMessage(status))).toEqual(status);
  for(const presentation of [{label:'x'.repeat(513),hasImage:true},{alt:'x'.repeat(513),hasImage:false},{hasImage:'true'},
    {hasImage:true,producer:()=>{}},{label:'Ready'}])expect(nativeMediaMessage.safeParse({...legacy,presentation}).success).toBe(false);
  expect(nativeMediaMessage.safeParse({...legacy,presentation:{label:'x'.repeat(512),alt:'x'.repeat(512),hasImage:false}}).success).toBe(true);
  const input={type:'native-input' as const,epoch:'binding-1',id:1,target:'@media',operation:{kind:'media-active' as const,enabled:true,active:false}};
  expect(decodeLine(encodeMessage(input))).toEqual(input);
  expect(decodeLine(encodeMessage({...input,operation:{...input.operation,expanded:false}}))).toEqual({...input,operation:{...input.operation,expanded:false}});
  expect(nativeInputMessage.safeParse({...input,operation:{...input.operation,expanded:'false'}}).success).toBe(false);
});
