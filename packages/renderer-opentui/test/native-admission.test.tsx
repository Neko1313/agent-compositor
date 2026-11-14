import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestRendererSetup} from '@opentui/core/testing';
import type {NativeInputMessage,NativeReceiptMessage,WireMessage} from '@agent-compositor/protocol';

// Only the CLI terminal constructor is substituted. The installed SDK's parser,
// scene, textarea, React tree, capture queue and production wire adapters run.
const terminal=vi.hoisted(()=>({current:undefined as TestRendererSetup|undefined}));
vi.mock('@opentui/core',async original=>({...await original<typeof import('@opentui/core')>(),
  createCliRenderer:async()=>terminal.current!.renderer,
}));
const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();terminal.current=undefined;});

async function fixture(heldModel=false){
  const [{createTestRenderer},sdk,{runConversationPrototype},{buildApp},{connectWindowLayout},{createOpenTuiHost},
    {createOpenTuiWireHost},{createNativePresentationClient},{ScriptedProvider},{decodeLine,encodeMessage}]=await Promise.all([
    import('@opentui/core/testing'),import('@opentui/core'),import('../src/run.js'),
    import('../../app/src/build.js'),import('../../app/src/opentui-windows.js'),import('../../app/src/opentui-host.js'),
    import('../../app/src/opentui-wire.js'),import('../src/native-client.js'),import('@agent-compositor/core'),import('@agent-compositor/protocol'),
  ]);
  const cwd=await mkdtemp(join(tmpdir(),'opentui-native-admission-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const provider=new ScriptedProvider([{text:'First answer',hold:heldModel},{text:'Second answer'}]);
  const app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,fixedConfig:{enabledPlugins:[],
    agent:{tools:[],builtinTools:[],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},compaction:{enabled:false}}});
  cleanup.push(()=>app.close());
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});cleanup.push(()=>layout.disconnect());
  const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());await host.start();
  const inputs:NativeInputMessage[]=[],held:NativeReceiptMessage[]=[];
  let hold:(input:NativeInputMessage)=>boolean=()=>false;
  let client:ReturnType<typeof createNativePresentationClient>;
  const copy=(message:WireMessage)=>decodeLine(encodeMessage(message));
  const broker=createOpenTuiWireHost({host,layout,onCtrlC(){
    if(host.core.getState()==='running'){host.core.interrupt();return 'handled';}return 'exit';
  }},message=>{
    const wire=copy(message);
    if(wire.type==='native-receipt'&&hold(inputs.find(input=>input.id===wire.id)!)){held.push(wire);return;}
    queueMicrotask(()=>client.receive(wire));
  });cleanup.push(()=>broker.close());
  client=createNativePresentationClient(message=>{
    const wire=copy(message);if(wire.type==='native-input')inputs.push(wire);
    queueMicrotask(()=>broker.receive(wire));
  });cleanup.push(()=>client.close());client.hello();broker.hello();await client.ready;
  const test=terminal.current=await createTestRenderer({width:100,height:36,exitOnCtrlC:false});cleanup.push(()=>test.dispose());
  const stop=new AbortController();let exited=false;
  const running=runConversationPrototype([...client.sessions()],{animations:false,signal:stop.signal,windowLayout:client.windowLayout,
    navigation:client.navigation,surfaces:client.surfaces,conversationWindows:client.conversationWindows,
    appearance:client.appearance,publicRender:client.publicRender,inputAdmission:client,onCtrlC:client.onCtrlC})
    .finally(()=>{exited=true;});
  cleanup.push(async()=>{stop.abort();await running;});
  const descendants=(node:typeof test.renderer.root):typeof node[]=>[node,...node.getChildren().flatMap(descendants)];
  const editor=()=>descendants(test.renderer.root).find(node=>node instanceof sdk.TextareaRenderable) as InstanceType<typeof sdk.TextareaRenderable>;
  const until=async(check:()=>boolean)=>vi.waitFor(async()=>{await test.flush({maxPasses:30});expect(check()).toBe(true);},{timeout:5000,interval:5});
  await until(()=>Boolean(editor()));
  return{app,host,provider,layout,client,test,inputs,held,editor,until,running,exited:()=>exited,
    holdWhen(predicate:typeof hold){hold=predicate;},
    release(){hold=()=>false;for(const receipt of held.splice(0))client.receive(receipt);},
    // One actual SDK parser packet, rather than separate synthetic key callbacks.
    packet(text:string){test.renderer.stdin.emit('data',Buffer.from(text));},
  };
}

// Native Node FFI is supported from Node 26; Node 22 still runs the pure runner
// lifecycle and adapter tests without importing the SDK runtime.
describe.skipIf(Number(process.versions.node.split('.')[0])<26)('native production wire admission and resident input',()=>{
  it('preserves immediate Unicode paste after accepted Enter without awaiting a held Main, and awaits Ctrl+C decisions',async()=>{
    const f=await fixture(true);f.holdWhen(input=>input?.operation.kind==='submit');
    await f.test.mockInput.pasteBracketedText('TASK');await f.until(()=>f.editor().plainText==='TASK');
    f.packet('\r\x1b[200~NEXT_😀窗\x1b[201~');await f.until(()=>f.held.length===1);
    const widget=f.editor();expect(widget.plainText).toBe('TASK');expect(f.held[0].status).toBe('accepted');
    // Admission precedes asynchronous model startup; check the held model independently.
    await f.until(()=>f.provider.requests.length===1&&f.host.core.getState()==='running');
    f.release();await f.until(()=>widget.plainText==='NEXT_😀窗');
    expect(f.editor()).toBe(widget);expect(f.provider.requests).toHaveLength(1);expect(f.host.core.getState()).toBe('running');
    f.holdWhen(input=>input?.operation.kind==='ctrl-c');f.test.mockInput.pressCtrlC();await f.until(()=>f.held.length===1);
    expect(f.held[0]).toMatchObject({status:'accepted',ctrlC:'handled'});expect(f.exited()).toBe(false);
    f.release();await f.until(()=>f.host.core.getState()!=='running'&&!f.client.pending());
    expect(f.exited()).toBe(false);expect(widget.plainText).toBe('NEXT_😀窗');
    f.holdWhen(input=>input?.operation.kind==='ctrl-c');f.test.mockInput.pressCtrlC();await f.until(()=>f.held.length===1);
    expect(f.held[0]).toMatchObject({status:'accepted',ctrlC:'exit'});expect(f.exited()).toBe(false);
    f.release();await f.running;expect(f.exited()).toBe(true);
  });

  it('routes paste following /windows in the same parser packet to the native Finder field',async()=>{
    const f=await fixture();f.holdWhen(input=>input?.operation.kind==='submit');
    await f.test.mockInput.pasteBracketedText('/windows');await f.until(()=>f.editor().plainText==='/windows');
    f.packet('\r\x1b[200~Help_😀窗\x1b[201~');await f.until(()=>f.held.length===1);
    expect(f.client.navigation.snapshot()).toMatchObject({mode:'finder',query:''});expect(f.editor().plainText).toBe('/windows');
    f.release();await f.until(()=>f.client.navigation.snapshot().query==='Help_😀窗');
    expect(f.editor().plainText).toBe('');expect(f.provider.requests).toEqual([]);
    expect(f.test.captureCharFrame()).toContain('Help_😀窗');
  });

  it('retains rejected draft and subsequent typing through a genuine failed replacement startup',async()=>{
    const f=await fixture();await f.host.submit('Seed');const resume=f.app.resume;
    f.app.resume=async(...args)=>{const next=await resume(...args);next.start=async()=>{throw Error('Controlled startup failure');};return next;};
    await f.host.core.host.emit('service.session.control',{action:'resume',id:f.host.core.sessionId});
    await f.until(()=>f.client.sessions()[0].snapshot().notice?.includes('Retry /reload')===true);
    f.holdWhen(input=>input?.operation.kind==='submit');
    await f.test.mockInput.pasteBracketedText('REJECTED');await f.until(()=>f.editor().plainText==='REJECTED');
    f.packet('\r\x1b[200~_NEXT_😀窗\x1b[201~');await f.until(()=>f.held.length===1);
    expect(f.held[0].status).toBe('rejected');expect(f.editor().plainText).toBe('REJECTED');
    f.release();await f.until(()=>f.editor().plainText==='REJECTED_NEXT_😀窗');
    expect(f.provider.requests).toHaveLength(1);expect(JSON.stringify(f.provider.requests)).not.toContain('REJECTED');
  });

  it('revokes queued old-generation input before a replacement Core receives new typing',async()=>{
    const f=await fixture();await f.host.submit('Saved context');
    const oldGeneration=f.client.generation();f.holdWhen(input=>input?.operation.kind==='submit');
    await f.test.mockInput.pasteBracketedText('/windows');await f.until(()=>f.editor().plainText==='/windows');
    f.packet('\r\x1b[200~OLD_😀窗\x1b[201~');await f.until(()=>f.held.length===1);
    await f.host.core.host.emit('service.session.control',{action:'resume',id:f.host.core.sessionId});
    await f.until(()=>f.client.generation()!==oldGeneration);f.release();await f.until(()=>!f.client.pending());
    expect(f.editor().plainText).not.toContain('OLD_😀窗');expect(f.client.navigation.snapshot().query).not.toContain('OLD_😀窗');
    // Resume preserves the user's current Finder mode. New input belongs to
    // that current native field, while the older packet must never reach it.
    expect(f.client.navigation.snapshot().mode).toBe('finder');
    await f.test.mockInput.pasteBracketedText('NEW_😀窗');await f.until(()=>f.client.navigation.snapshot().query==='NEW_😀窗');
    expect(f.editor().plainText).not.toContain('OLD_😀窗');expect(f.provider.requests).toHaveLength(1);
  });
});
