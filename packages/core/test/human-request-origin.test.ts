import {afterEach,expect,it} from 'vitest';
import {AgentCore,ScriptedProvider,type AgentCoreOptions,type CoreHumanRequestContext,type ModelProvider} from '../src/index.js';
import type {HooksApi} from '@agent-compositor/hooks';
import type {ToolSpec} from '@agent-compositor/tools';
import {AsyncLocalStorage} from 'node:async_hooks';
import {join} from 'node:path';

const cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();});
const form={title:'Private child form',fields:[{id:'note',label:'Private note',type:'text' as const}],actions:[{id:'save',label:'Save'}]};
function core(options:Partial<AgentCoreOptions>={}){const value=new AgentCore({cwd:process.cwd(),provider:new ScriptedProvider([]),...options});cores.push(value);return value;}
const spawn=(owner:AgentCore,prompt:string,agentId?:string)=>owner.host.emit('service.agent.spawn',{prompt,...(agentId?{agentId}:{})});

it.each(['ask_user','ask_questions'] as const)('reports actual child host, instance and parent invocation for %s without publishing private routing context',async tool=>{
  const provider=new ScriptedProvider([
    {toolCalls:[{name:'task',args:{prompt:'PRIVATE_DELEGATED_PROMPT'}}]},
    {toolCalls:[{name:tool,args:tool==='ask_user'?{question:'Child question?',options:['Local','Remote']}
      :{title:'Child questionnaire',questions:[{id:'target',question:'Where?',options:['Local','Remote']}]}}]},
    {text:'Child done'},{text:'Parent done'},
  ]);
  let context!:CoreHumanRequestContext;
  const parent=core({provider,onAsk:async(request,source)=>{context=source!;return request.questions
    ?{answers:[{id:'target',selected:['Local']}]}:'Local';}});
  const events:unknown[]=[];parent.subscribe(event=>events.push(event));await parent.submit('Delegate');
  expect(context.host).not.toBe(parent.host);expect(context.instance).not.toBe(parent);
  expect(context.origin).toMatchObject({depth:1,parent:{sessionId:parent.sessionId,tool:'task'},invocation:{tool}});
  expect(context.origin.sessionId).not.toBe(parent.sessionId);expect(context.origin.agentId).toBeTypeOf('string');
  expect(context.origin.invocation!.id).not.toBe(context.origin.invocation!.callId);
  expect(context.origin.parent!.invocationId).not.toBe(context.origin.invocation!.id);
  expect(context.root.host).toBe(parent.host);expect(context.root.instance).not.toBe(context.instance);
  expect(context.root.signal.aborted).toBe(false);
  expect(Object.isFrozen(context)).toBe(true);expect(Object.isFrozen(context.origin)).toBe(true);
  expect(context.signal.aborted).toBe(true);expect(context.host.hasPlugin('missing')).toBe(false);
  expect(JSON.stringify(context.origin)).not.toContain('PRIVATE_DELEGATED_PROMPT');
  expect(JSON.stringify(events)).not.toContain('toolOperationOrigin');
  expect(JSON.stringify(provider.requests)).not.toContain(context.origin.invocation!.id);
});

it('keeps concurrent same-label sibling approvals and a held Main question independent',async()=>{
  const effects:string[]=[],requests:{tag:string;context:CoreHumanRequestContext;answer:(allow:boolean)=>void}[]=[];
  let main!:CoreHumanRequestContext,answerMain!:(value:string)=>void;
  const provider:ModelProvider={name:'local-origin-probe',async *complete(request){
    const prompt=request.messages.find(message=>message.role==='user')!.content;
    if(request.messages.some(message=>message.role==='tool')){yield{type:'text_delta',text:'Done'};yield{type:'finish',reason:'stop'};return;}
    yield{type:'tool_call',id:'same-provider-id',name:prompt==='Main'?'ask_user':'guarded',args:prompt==='Main'?{question:'Main remains pending'}:{tag:prompt}};
    yield{type:'finish',reason:'tool_calls'};
  }};
  const guarded:ToolSpec={name:'guarded',description:'Record one local effect',parameters:{type:'object',properties:{tag:{type:'string'}},required:['tag']},
    describe:()=>({tool:'guarded'}),execute:async(_ctx,args:any)=>{effects.push(args.tag);return{ok:true,data:'done'};}};
  const parent=core({provider,tools:[guarded],rules:[{tool:'guarded',decision:'ask'}],
    onAsk:(_request,context)=>{main=context!;return new Promise(resolve=>{answerMain=resolve;});},
    onApproval:(request,context)=>new Promise(resolve=>requests.push({tag:(request.input as {tag:string}).tag,context:context!,answer:resolve})),
  });
  const running=parent.submit('Main');await expect.poll(()=>Boolean(main)).toBe(true);
  const first=spawn(parent,'A','same-label'),second=spawn(parent,'B','same-label');await expect.poll(()=>requests.length).toBe(2);
  expect(new Set(requests.map(request=>request.context.instance)).size).toBe(2);
  expect(new Set(requests.map(request=>request.context.origin.invocation!.id)).size).toBe(2);
  expect(new Set(requests.map(request=>request.context.origin.parent!.invocationId)).size).toBe(2);
  for(const request of requests){expect(request.context.origin).toMatchObject({agentId:'same-label',depth:1,invocation:{callId:'same-provider-id',tool:'guarded'}});expect(request.context.instance).not.toBe(main.instance);}
  requests.find(request=>request.tag==='A')!.answer(true);await first;
  expect(effects).toEqual(['A']);expect(requests.find(request=>request.tag==='B')!.context.signal.aborted).toBe(false);
  expect(main.signal.aborted).toBe(false);expect(parent.getState()).toBe('running');
  requests.find(request=>request.tag==='B')!.answer(false);await second;expect(effects).toEqual(['A']);
  answerMain('Keep Main');await running;
});

it('inherits the current private form binding into the actual child registry and captures its source scope',async()=>{
  let seen!:CoreHumanRequestContext,received:unknown;
  const parent=core({onForm:async()=>{throw Error('Obsolete construction handler');},plugins:[{
    manifest:{name:'form-owner',version:'1.0.0',trust:'trusted'},hooks:{'prompt.submit':async(event,$)=>{
      if(event.text!=='Child form')return;received=await $.ui.form(form);return{drop:'Handled private child form'};
    }},
  }]});
  const off=parent.setHumanFormHandler(async(plugin,request,signal,context)=>{
    seen=context;expect(plugin).toBe('form-owner');expect(request).toEqual(form);expect(signal).toBe(context.signal);
    expect(context.host.controllers).not.toBe(parent.host.controllers);expect(context.host.hasPlugin(plugin,'trusted')).toBe(true);
    expect(context.serviceScope).toMatchObject({plugin:'form-owner',background:false});
    return{action:'save',values:{note:'PRIVATE_CHILD_RESULT'}};
  });
  await spawn(parent,'Child form','form-child');off();
  expect(received).toEqual({action:'save',values:{note:'PRIVATE_CHILD_RESULT'}});
  expect(seen.origin).toMatchObject({agentId:'form-child',depth:1,parent:{sessionId:parent.sessionId}});
  expect(seen.origin.parent!.invocationId).toBeTypeOf('string');expect(seen.origin.invocation).toBeUndefined();
  expect(seen.signal.aborted).toBe(true);expect(seen.serviceScope!.lifetime.aborted).toBe(true);
});

it('attributes a grandchild to its direct child parent with a distinct fallback spawn invocation',async()=>{
  const seen:CoreHumanRequestContext[]=[];
  const parent=core({plugins:[{manifest:{name:'nested',version:'1.0.0',trust:'trusted'},hooks:{'prompt.submit':async(event,$)=>{
    if(event.text==='First child'){await $.ui.form(form);await $.emit('service.agent.spawn',{prompt:'Grandchild',agentId:'leaf'});return{drop:'Child handled'};}
    if(event.text==='Grandchild'){await $.ui.form(form);return{drop:'Leaf handled'};}
  }}}],onForm:async(_plugin,_form,_signal,context)=>{seen.push(context);return null;}});
  await spawn(parent,'First child','branch');expect(seen).toHaveLength(2);
  expect(seen[0].origin).toMatchObject({agentId:'branch',depth:1,parent:{sessionId:parent.sessionId}});
  expect(seen[1].origin).toMatchObject({agentId:'leaf',depth:2,parent:{sessionId:seen[0].origin.sessionId,agentId:'branch'}});
  expect(seen[1].origin.parent!.invocationId).not.toBe(seen[0].origin.parent!.invocationId);
  expect(seen[0].instance).not.toBe(seen[1].instance);
  expect(seen[1].delegatedFrom!.instance).toBe(seen[0].instance);
  expect(seen[1].delegatedFrom!.delegatedFrom!.origin.sessionId).toBe(parent.sessionId);
  expect(seen[1].root).toBe(seen[0].root);expect(seen[0].root.host).toBe(parent.host);
});

it('restores only still-bound private handlers and permits explicit headless shadowing',async()=>{
  let api!:HooksApi;const calls:string[]=[];
  const parent=core({onForm:async()=>{calls.push('base');return null;},plugins:[{manifest:{name:'owner',version:'1.0.0',trust:'trusted'},hooks:{'ui.press':(_event,$)=>{api=$;}}}]});
  await parent.host.emit('ui.press',{site:'owner',key:'capture'});
  const a=parent.setHumanFormHandler(async()=>{calls.push('a');return null;}),b=parent.setHumanFormHandler(async()=>{calls.push('b');return null;});
  a();await api.ui.form(form);b();await api.ui.form(form);expect(calls).toEqual(['b','base']);
  const off=parent.setHumanFormHandler();await expect(api.ui.form(form)).rejects.toThrow('interactive UI');
  off();await api.ui.form(form);expect(calls).toEqual(['b','base','base']);
});

it('keeps exact hook and nested tool provenance separate from captured UI authority',async()=>{
  const seen:CoreHumanRequestContext[]=[],hooks:string[]=[],uiOrigin=Object.freeze({operation:'UI-owner'});
  const inner:ToolSpec={name:'inner',description:'Read-only nested probe',parameters:{type:'object'},describe:()=>({tool:'inner'}),execute:async ctx=>{
    await ctx.request('service.ui.ask',{plugin:'core',question:'Nested?'});return{ok:true,data:'inner'};
  }};
  let parent!:AgentCore;
  parent=core({tools:[inner],rules:[{tool:'inner',decision:'allow'}],provider:new ScriptedProvider([{toolCalls:[{name:'ask_user',args:{question:'Outer?'}}]},{text:'Done'}]),
    onAsk:async(_request,context)=>{seen.push(context!);return 'Answer';},plugins:[{manifest:{name:'interceptor',version:'1.0.0',trust:'trusted'},hooks:{
      'tool.call':async(event,$)=>{hooks.push(parent.toolOperationOrigin!.tool);if(event.tool==='ask_user')await $.agent.tool('inner',{});},
    }}],
  });parent.host.setInvocationOriginProvider(()=>uiOrigin);
  await parent.submit('Start');expect(seen).toHaveLength(2);expect(hooks).toEqual(['ask_user','inner']);
  expect(seen[0].origin.invocation).toMatchObject({tool:'inner'});expect(seen[1].origin.invocation).toMatchObject({tool:'ask_user'});
  expect(seen[0].origin.invocation!.parentId).toBe(seen[1].origin.invocation!.id);
  expect(seen[0].serviceScope!.origin).toBe(uiOrigin);
});

it('revokes a detached child private form on actual parent Core close without borrowing the parent turn',async()=>{
  let seen!:CoreHumanRequestContext;
  const parent=core({plugins:[{manifest:{name:'detached-form',version:'1.0.0',trust:'trusted'},hooks:{'prompt.submit':async(event,$)=>{
    if(event.text!=='Detached child')return;await $.ui.form(form);return{drop:'Handled'};
  }}}],onForm:(_plugin,_form,signal,context)=>{
    seen=context;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve(null),{once:true}));
  }});
  parent.host.setInvocationOriginProvider(()=>({operation:'parent UI'}));
  const pending=parent.host.emit('service.agent.spawn',{prompt:'Detached child',agentId:'detached',detached:true}).catch(error=>error);
  await expect.poll(()=>Boolean(seen)).toBe(true);parent.interrupt();
  expect(seen.signal.aborted).toBe(false);expect(seen.serviceScope!.background).toBe(false);
  expect(seen.delegatedFrom).toBeUndefined();expect(seen.invocationOrigin).toBeUndefined();
  expect(seen.root.host).toBe(parent.host);expect(seen.root.signal.aborted).toBe(false);
  expect(seen.origin).toMatchObject({agentId:'detached',parent:{sessionId:parent.sessionId}});
  await parent.close();expect(await pending).toBeInstanceOf(Error);expect(seen.signal.aborted).toBe(true);expect(seen.root.signal.aborted).toBe(true);
});

it('retains only captured background producer labels when a handle is called under a newer tool',async()=>{
  const seen:CoreHumanRequestContext[]=[];let retained!:HooksApi;
  const tool:ToolSpec={name:'capture',description:'Capture a trusted private handle',parameters:{type:'object'},describe:()=>({tool:'capture'}),execute:async()=>({ok:true,data:'captured'})};
  let parent!:AgentCore;
  parent=core({tools:[tool],rules:[{tool:'capture',decision:'allow'}],onForm:async(_plugin,_form,_signal,context)=>{seen.push(context);return null;},
    plugins:[{manifest:{name:'owner',version:'1.0.0',trust:'trusted'},hooks:{'tool.call':(_event,$)=>{if(!retained)retained=$.background();}}}],
  });const ui={id:'original-ui'};parent.host.setInvocationOriginProvider(()=>ui);
  await parent.invokeTool('capture',{});const first=parent.toolOperationOrigin;
  expect(first).toBeUndefined();
  await retained.ui.form(form);
  expect(seen[0].origin.invocation).toMatchObject({tool:'capture'});expect(seen[0].serviceScope).toMatchObject({background:true});
  expect(seen[0].serviceScope!.origin).not.toBe(ui);expect(seen[0].signal.aborted).toBe(false);
  await parent.invokeTool('capture',{});await retained.ui.form(form);
  expect(seen[1].origin.invocation!.id).toBe(seen[0].origin.invocation!.id);
  await parent.close();expect(seen[0].signal.aborted).toBe(true);await expect(retained.ui.form(form)).rejects.toBeDefined();
});

it('captures delegation UI authority before an awaited start hook and never borrows a newer ambient origin',async()=>{
  const old=Object.freeze({operation:'original'}),newer=Object.freeze({operation:'newer'});
  let current:unknown=old,release!:()=>void,started=false,seen!:CoreHumanRequestContext;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const parent=core({onForm:async(_plugin,_form,_signal,context)=>{seen=context;return null;},plugins:[{
    manifest:{name:'authority',version:'1.0.0',trust:'trusted'},hooks:{
      'subagent.start':async()=>{started=true;await gate;},
      'prompt.submit':async(event,$)=>{if(event.text==='Child authority'){await $.ui.form(form);return{drop:'Handled'};}},
    },
  }]});parent.host.setInvocationOriginProvider(()=>current);
  const pending=spawn(parent,'Child authority');await expect.poll(()=>started).toBe(true);current=newer;release();await pending;
  expect(seen.serviceScope!.origin).toBeUndefined();expect(seen.invocationOrigin).toBeUndefined();
  expect(seen.delegatedFrom!.invocationOrigin).toBe(old);expect(seen.delegatedFrom!.host).toBe(parent.host);
  expect(Object.isFrozen(seen.delegatedFrom)).toBe(true);
});

it('retains captured ancestor identity when a child explicitly detaches its own request authority',async()=>{
  const ui=Object.freeze({operation:'parent'});let seen!:CoreHumanRequestContext;
  const parent=core({onForm:async(_plugin,_form,_signal,context)=>{seen=context;return null;},plugins:[{
    manifest:{name:'background-child',version:'1.0.0',trust:'trusted'},hooks:{'prompt.submit':async(event,$)=>{
      if(event.text==='Background child'){await $.background().ui.form(form);return{drop:'Handled'};}
    }},
  }]});parent.host.setInvocationOriginProvider(()=>ui);await spawn(parent,'Background child');
  expect(seen.serviceScope!.background).toBe(true);expect(seen.invocationOrigin).not.toBe(ui);
  expect(seen.delegatedFrom!.invocationOrigin).toBe(ui);
});

it('does not borrow a newer UI operation when an ordinary child capability is called inside it',async()=>{
  const ambient=new AsyncLocalStorage<object>(),old=Object.freeze({operation:'old'}),newer=Object.freeze({operation:'new'});
  let api!:HooksApi,release!:()=>void,seen!:CoreHumanRequestContext,actualAmbient:unknown;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const parent=core({onForm:async(_plugin,_form,_signal,context)=>{seen=context;actualAmbient=ambient.getStore();return null;},plugins:[{
    manifest:{name:'retained-child',version:'1.0.0',trust:'trusted'},hooks:{'prompt.submit':async(event,$)=>{
      if(event.text==='Retain child'){api=$;await gate;return{drop:'Handled'};}
    }},
  }]});parent.host.setInvocationOriginProvider(()=>ambient.getStore());
  const pending=ambient.run(old,()=>spawn(parent,'Retain child'));
  try{
    await expect.poll(()=>Boolean(api)).toBe(true);
    await ambient.run(newer,()=>api.ui.form(form));
    expect(actualAmbient).toBe(newer);expect(seen.invocationOrigin).toBeUndefined();
    expect(seen.serviceScope!.origin).toBeUndefined();expect(seen.delegatedFrom!.invocationOrigin).toBe(old);
  }finally{release();await pending;}
});

it.each(['configured','provider-filtered','allowlist-restricted'] as const)('resolves %s capabilities for a public spawn inside an immediate command',async mode=>{
  let effects=0,approvals=0;const resolved:string[]=[];
  const guarded:ToolSpec={name:'guarded',description:'Permission-gated command child probe',parameters:{type:'object'},describe:()=>({tool:'guarded'}),execute:async()=>{effects++;return{ok:true,data:'effect'};}};
  const excluded:ToolSpec={...guarded,name:'excluded',describe:()=>({tool:'excluded'})};
  const provider=new ScriptedProvider([{toolCalls:[{name:'guarded',args:{}}]},{text:'Child completed'}]);
  const parent=core({provider,tools:[guarded,excluded],controlTools:[],toolNames:mode==='allowlist-restricted'?[]:['guarded'],
    rules:[{tool:'guarded',decision:'ask'}],userCommands:()=>[{name:'/spawn-command',plugin:'spawn-owner'}],
    onApproval:async(_request,context)=>{approvals++;expect(context!.origin.depth).toBe(1);return true;},
    plugins:[{manifest:{name:'spawn-owner',version:'1.0.0',trust:'trusted'},hooks:{
      'command.invoke':async(_event,$)=>{await $.emit('service.agent.spawn',{prompt:'Command child',agentId:'actual-child'});},
      'service.agent.tools':(event,$)=>{resolved.push($.session.id);return{value:mode==='provider-filtered'?[]:event.tools};},
    }}],
  });
  await parent.invokeCommand('/spawn-command');
  expect(resolved).toContain(parent.sessionId);
  expect(provider.requests[0].tools.map(tool=>tool.name)).toEqual(mode==='configured'?['guarded']:[]);
  expect(effects).toBe(mode==='configured'?1:0);expect(approvals).toBe(effects);
});

it('does not start a child if its command is cancelled while resolving effective tools',async()=>{
  let entered=false;const provider=new ScriptedProvider([{text:'Must not run'}]);
  const parent=core({provider,tools:[],controlTools:[],userCommands:()=>[{name:'/spawn-command',plugin:'spawn-owner'}],plugins:[{
    manifest:{name:'spawn-owner',version:'1.0.0',trust:'trusted'},hooks:{
      'command.invoke':async(_event,$)=>{await $.emit('service.agent.spawn',{prompt:'Cancelled child'});},
      'service.agent.tools':async(event,$)=>{entered=true;await new Promise<void>(resolve=>$.signal.addEventListener('abort',()=>resolve(),{once:true}));return{value:event.tools};},
    },
  }]});
  const pending=parent.invokeCommand('/spawn-command');void pending.catch(()=>{});
  await expect.poll(()=>entered).toBe(true);expect(parent.cancelOperations('spawn-owner')).toBe(true);
  await expect(pending).rejects.toBeDefined();expect(provider.requests).toEqual([]);
});

it('keeps a host-labelled root identity through detached descendants independently of their authority',async()=>{
  let root!:CoreHumanRequestContext,child!:CoreHumanRequestContext;
  const parent=core({agentId:'Saved managed name',onAsk:async(_request,context)=>{root=context!;return 'Keep';},
    onForm:async(_plugin,_request,_signal,context)=>{child=context;return null;},plugins:[{
      manifest:{name:'form-owner',version:'1.0.0',trust:'trusted'},hooks:{'prompt.submit':async(event,$)=>{
        if(event.text==='Managed descendant'){await $.ui.form(form);return{drop:'Handled'};}
      }},
    }],
  });
  await parent.host.emit('service.ui.ask',{plugin:'core',question:'Root identity'});
  await parent.host.emit('service.agent.spawn',{prompt:'Managed descendant',agentId:'Leaf alias',detached:true});
  expect(root.origin.agentId).toBe('Saved managed name');expect(root.root.instance).toBe(root.instance);expect(root.root.host).toBe(root.host);
  expect(child.root).toBe(root.root);expect(child.delegatedFrom).toBeUndefined();
  expect(child.origin).toMatchObject({agentId:'Leaf alias',parent:{agentId:'Saved managed name',sessionId:parent.sessionId}});
  expect(child.signal.aborted).toBe(true);expect(root.root.signal.aborted).toBe(false);
  await parent.close();expect(root.root.signal.aborted).toBe(true);
});

it('retains original invocation provenance while approving the effective rewritten tool and arguments',async()=>{
  let captured:unknown,source!:CoreHumanRequestContext,request:any,effect:unknown;
  const original:ToolSpec={name:'original',description:'Original dispatch',parameters:{type:'object'},describe:()=>({tool:'original'}),execute:async()=>{throw Error('Original must not execute');}};
  const effective:ToolSpec={name:'effective',description:'Rewritten operation',parameters:{type:'object'},describe:args=>({tool:'effective',path:String((args as any).path)}),execute:async(_ctx,args)=>{effect=args;return{ok:true,data:'changed'};}};
  let parent!:AgentCore;
  parent=core({tools:[original,effective],controlTools:[],rules:[{tool:'effective',decision:'ask'}],
    onApproval:async(value,context)=>{request=value;source=context!;return true;},plugins:[{manifest:{name:'rewrite',version:'1.0.0',trust:'trusted'},hooks:{'tool.call':(event,$)=>{
      captured=parent.toolOperationOrigin;return $.next({...event,tool:'effective',input:{path:'actual-target'}});
    }}}],
  });
  expect((await parent.invokeTool('original',{path:'original-target'})).ok).toBe(true);
  expect(source.origin.invocation).toBe(captured);expect(source.origin.invocation!.tool).toBe('original');
  expect(Object.isFrozen(captured)).toBe(true);expect(request).toMatchObject({tool:'effective',descriptor:{tool:'effective',path:join(process.cwd(),'actual-target')},input:{path:'actual-target'}});
  expect(effect).toEqual({path:'actual-target'});
});
